# Simulator lấy số liệu như thế nào

**Tóm tắt: simulator không dùng số liệu thật nào.** Mọi con số trên màn hình (rps, lỗi, p99, utilization, retry...) đều được *đo* từ một mô phỏng chạy từng request riêng lẻ. Đầu vào của mô phỏng là các tham số bạn khai báo (hoặc catalog của level). Kết quả chỉ đúng bằng các giả định đầu vào. Đây là mô hình hàng đợi có ngẫu nhiên, không phải benchmark.

## 1. Đầu vào: các giả định

| Ở đâu | Tham số | Ý nghĩa trong mô hình |
|---|---|---|
| Node | `instances × concurrency` | Số slot xử lý song song (thread pool / connection pool / worker) |
| Node | `queueSize` | Số request được chờ khi hết slot. Vượt quá thì **bị từ chối** |
| Node | `latencyP50Ms`, `latencyP99Ms` | Thời gian xử lý *cục bộ*, phân phối **lognormal** suy ra từ 2 điểm này: `μ = ln p50`, `σ = (ln p99 − ln p50) / 2.326` |
| Node | `errorRate` | Xác suất một request xử lý xong vẫn lỗi |
| Cache | `hitRate` | Xác suất trả lời ngay mà không gọi xuống dưới (cố định, không mô phỏng warm-up hay eviction) |
| Node | `costPerHour` | Chỉ để tính tiền: `Σ instances × costPerHour` |
| Edge | `latencyMs` | Network một chiều (cố định) |
| Edge | `timeoutMs`, `retries`, `backoffMs`, `jitter`, `circuitBreaker` | Chính sách phía caller |
| Scenario | `traffic` | Hàm bậc thang rps theo thời gian. Request đến theo **quá trình Poisson** (khoảng cách giữa 2 request ~ phân phối mũ) |
| Scenario | `events` | Chaos theo kịch bản: `down`, `up`, `latency` (×hệ số), `errors` |
| Scenario | `seed` | Cùng seed thì cùng kết quả, đến từng bit, trên mọi máy |

Các con số mặc định trong catalog (`crates/engine/src/level.rs`, `default_catalog`) chỉ là **cỡ độ lớn hợp lý**, chưa được hiệu chỉnh bằng benchmark:

| Thành phần | Slot/instance | p50 / p99 | Giá/h | Lý do chọn |
|---|---|---|---|---|
| Load balancer | 20000 | 0.2 / 1 ms | 0.03 | Gần như không phải nút thắt |
| Service | 80 | 15 / 50 ms | 0.10 | API thông thường, pool 80 thread |
| Cache (Redis) | 2000 | 0.5 / 2 ms | 0.15 | Dưới 1ms, hit 90% |
| Database | 20 | 8 / 40 ms | 0.50 | Connection pool 20, đắt và chậm |
| Queue | 36 consumer | 0.2 / 1 ms | 0.08 | Ack ngay, consumer xử lý dần |

## 2. Cách mô phỏng: discrete-event

Engine (`crates/engine/src/sim.rs`) giữ một hàng đợi sự kiện sắp theo thời gian (µs). Mỗi request đi qua các sự kiện sau:

1. **ClientArrival**: client tạo request rồi hẹn request kế tiếp sau `Exp(rps)` giây.
2. **Arrive** ở node: còn slot thì chiếm slot, hết slot thì vào hàng đợi, hàng đợi đầy (hoặc node down) thì **reject**.
3. **LocalDone** sau thời gian lognormal. Node trả lời ngay (lỗi, cache hit, hoặc không có downstream), hoặc gọi xuống **một** downstream (round-robin) và **vẫn giữ slot** trong lúc chờ. Đây là cơ chế sinh ra cascading failure: DB chậm làm slot của API bị giữ lâu hơn, API hết slot và bắt đầu reject.
4. Phía caller của edge:
   - **Timeout**: caller bỏ cuộc, nhưng callee *vẫn tiếp tục làm* (lãng phí tài nguyên y như thật).
   - **Retry** sau `backoff × 2ⁿ⁻¹` (có jitter). Round-robin nên lần retry có thể rơi vào backend khác.
   - **Circuit breaker**: đếm lỗi trong cửa sổ trượt. Vượt ngưỡng thì mở và trả lỗi ngay. Hết `openMs` thì cho một probe qua (half-open).
5. **Response** đi ngược lại từng edge. Về tới client thì ghi nhận.
6. **Queue** trả ack cho bên gửi ngay, sau đó message chạy tiếp như một luồng bất đồng bộ riêng.

Mô phỏng này chạy nhanh hơn thời gian thực rất nhiều. Ví dụ native chạy 20k rps × 60s (1.2 triệu request) mất khoảng 1.3s.

## 3. Đầu ra: các con số được đo thế nào

| Số liệu | Cách đo |
|---|---|
| **ok rps, lỗi** | Đếm request về tới client trong mỗi cửa sổ 1s (giờ mô phỏng). Timeout ở client tính là lỗi |
| **p50/p95/p99** | Mọi latency end-to-end ở client được ghi vào histogram log-bucket (sai số khoảng 1%), tính percentile mỗi cửa sổ và cho cả trận |
| **Utilization node** | Trung bình *theo thời gian* của số slot bận chia cho tổng slot trong cửa sổ |
| **queue** | Độ dài hàng đợi ở cuối cửa sổ |
| **arrivals/s** | Số call tới node, *gồm cả retry*. Nhờ vậy thấy được retry storm khuếch đại tải |
| **drop/s** | Số request bị reject (hết chỗ hoặc node down) |
| **retry, timeout, CB** | Đếm theo từng edge mỗi cửa sổ, kèm trạng thái breaker cuối cửa sổ |
| **% thời gian đạt SLO** | Số cửa sổ có traffic đạt cả p99 và tỉ lệ lỗi, chia cho tổng số cửa sổ |
| **Sao (game)** | ★ đạt SLO cả trận, ★★ thêm điều kiện trong ngân sách, ★★★ thêm điều kiện ≥ 98% cửa sổ đạt SLO và không còn backlog trong queue |

## 4. Kiểm tra nhanh bằng định luật Little

Có thể tự tính để tin kết quả. Với DB mặc định (20 slot, p50 = 8ms, p99 = 40ms):

- σ = ln(40/8) / 2.326 ≈ 0.69, nên thời gian xử lý trung bình = 8 × e^(σ²/2) ≈ **10.2 ms**
- Công suất ≈ 20 slot / 10.2 ms ≈ **1960 rps**

Ví dụ `01-no-cache` bắn 3500 rps vào DB, nên phải sập. Đặt cache hit 90% thì DB chỉ còn khoảng 350 rps, sống thoải mái. CLI cho đúng kết quả đó (`pnpm sim examples/*.json`).

## 5. Những gì CHƯA mô phỏng

- CPU/GC, băng thông mạng, lock trong DB, cold start, autoscaling.
- Fan-out: hiện mỗi request chỉ gọi **một** downstream. Chưa có kiểu gọi song song A + B rồi gộp kết quả.
- Cache hit rate là hằng số (không có warm-up, eviction hay thundering herd).
- Latency không tăng theo tải bên trong một node. Tải chỉ làm tăng thời gian *chờ hàng đợi*, phần đó mô phỏng đúng.

## 6. Hiệu chỉnh bằng số liệu thật

Muốn mô phỏng sát hệ thống của bạn:

1. Lấy p50/p99 của từng service hoặc endpoint từ APM (Grafana, Datadog, OpenTelemetry).
2. `concurrency` = kích thước thread pool / connection pool / worker thực tế.
3. Kiểm chứng bằng định luật Little: `số request đang xử lý ≈ rps × latency trung bình` phải khớp với số đo thật.
4. Chạy load test (k6) ở 2 mức tải và so với `pnpm sim --windows`. Lệch nhiều thì xem lại các giả định ở mục 5.

Bước tiếp theo hợp lý là import trực tiếp từ trace của OpenTelemetry để tự sinh design và tham số.
