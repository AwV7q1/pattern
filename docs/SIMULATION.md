# Simulator lấy số liệu như thế nào

**Tóm tắt: simulator không dùng số liệu thật nào.** Mọi con số trên màn hình (rps, lỗi, p99, utilization, retry...) đều được *đo* từ một mô phỏng chạy từng request riêng lẻ. Đầu vào của mô phỏng là các tham số bạn khai báo (hoặc catalog của level). Kết quả chỉ đúng bằng các giả định đầu vào. Đây là mô hình hàng đợi có ngẫu nhiên, không phải benchmark.

## 1. Đầu vào: các giả định

| Ở đâu | Tham số | Ý nghĩa trong mô hình |
|---|---|---|
| Node | `model` | `threads`: slot giữ suốt request. `cpu`: CPU lane + số request mở (Node.js, Postgres), xem [CAPACITY.md](CAPACITY.md) |
| Node | `instances × concurrency` | Số slot xử lý song song (thread pool / connection pool / worker). Mỗi instance có slot và hàng đợi riêng, chia theo `balance` |
| Node | `queueSize` | Số request được chờ khi hết slot. Vượt quá thì **bị từ chối** |
| Node | `latencyP50Ms`, `latencyP99Ms` | Thời gian xử lý *cục bộ*, phân phối **lognormal** suy ra từ 2 điểm này: `μ = ln p50`, `σ = (ln p99 − ln p50) / 2.326` |
| Node | `errorRate` | Xác suất một request xử lý xong vẫn lỗi |
| Cache | `hitRate` | Xác suất trả lời ngay mà không gọi xuống dưới (cố định). Dùng khi không khai báo `cache` |
| Cache | `cache` | Mô hình theo key: `keys` (Zipf `zipf`), `capacity` (LRU), `ttlMs`, `coalesce` (singleflight), `staleWhileRevalidate`, `warm`. Xem mục 2.8 |
| Node | `queueTimeoutMs` | Request chờ trong hàng quá hạn này thì bị bỏ khi tới lượt (deadline shedding) |
| Node | `adaptiveLimit` | Giới hạn concurrency tự điều chỉnh kiểu AIMD, vượt giới hạn thì từ chối ngay |
| Node | `routing: hedge`, `hedgeAfterMs` / `routing: quorum`, `quorum` | Hedged request và chờ k/n nhánh, xem mục 2.9 |
| Node | `costPerHour` | Chỉ để tính tiền: `Σ instances × costPerHour` |
| Edge | `latencyMs` | Network một chiều (cố định) |
| Edge | `timeoutMs`, `retries`, `backoffMs`, `jitter`, `circuitBreaker` | Chính sách phía caller |
| Edge | `poolSize`, `poolTimeoutMs` | Connection pool mỗi process của caller |
| Edge | `rateLimit: { rps, burst }` | Token bucket phía caller, hết token thì lỗi ngay (429), không retry |
| Edge | `retryBudget: { ratio, minPerSec }` | Mỗi lần gọi đầu tiên nạp `ratio` token, mỗi retry tiêu 1 token, cộng `minPerSec` token/giây. Hết token thì không retry nữa |
| Scenario | `traffic` | Hàm bậc thang rps theo thời gian. Request đến theo **quá trình Poisson** (khoảng cách giữa 2 request ~ phân phối mũ) |
| Scenario | `events` | Chaos theo kịch bản: `down`, `up`, `latency` (×hệ số), `errors`, `flush` (xoá cache). `nodes: [...]` tác động nhiều node một lúc (mất cả zone). `partition`/`heal` với `edge: { source, target }`: đường mạng âm thầm làm rơi mọi gói tin hai chiều |
| Scenario | `chaosMonkey` | `{ everyMs, downMs, targets, seed }`: cứ `everyMs` tắt ngẫu nhiên một node trong `targets` trong `downMs`. Dùng RNG riêng nên không làm lệch phần còn lại của mô phỏng |
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
3. **LocalDone** sau thời gian lognormal. Node trả lời ngay (lỗi, cache hit, hoặc không có downstream), hoặc gọi xuống downstream (round-robin, `callsPerRequest` lần tuần tự) và **vẫn giữ slot** trong lúc chờ. Đây là cơ chế sinh ra cascading failure: DB chậm làm slot của API bị giữ lâu hơn, API hết slot và bắt đầu reject.
   - Node `cpu`: request giữ một "suất mở" (`maxInFlight`), còn CPU được chia thành nhiều lát xen giữa các lần gọi. Mỗi lát phải chờ CPU lane rảnh, thời gian chờ này là event loop lag. Lúc chờ downstream, request không chiếm CPU.
   - Edge có pool: lời gọi phải lấy được kết nối trước, hết kết nối thì xếp hàng.
   - Nhiều edge đi ra (`routing` của node):
     - `pick` (mặc định, luôn dùng cho client và LB): mỗi lời gọi chọn một edge, round-robin.
     - `sequence`: gọi mọi edge theo `order` tăng dần. Các edge cùng `order` chạy cùng lúc.
     - `parallel`: gọi tất cả cùng lúc và chờ đủ. Một nhánh lỗi thì cả bước lỗi ngay (fail fast như `Promise.all`), các nhánh còn lại vẫn chạy tiếp ở phía dưới.

     Mỗi nhánh là một "branch call" riêng, áp đúng timeout, retry, pool và circuit breaker của edge đó. Edge `fireAndForget` không được chờ, kết quả của nó tính vào `async`.
   - Payload: `requestKb`/`responseKb` cộng thêm thời gian truyền `KB × 8 / Mbps`. Mỗi chiều của edge là một đường truyền FIFO, body sau phải chờ body trước truyền xong.
4. Phía caller của edge:
   - **Timeout**: caller bỏ cuộc, nhưng callee *vẫn tiếp tục làm* (lãng phí tài nguyên y như thật).
   - **Retry** sau `backoff × 2ⁿ⁻¹` (có jitter). Round-robin nên lần retry có thể rơi vào backend khác.
   - **Circuit breaker**: đếm lỗi trong cửa sổ trượt. Vượt ngưỡng thì mở và trả lỗi ngay. Hết `openMs` thì cho một probe qua (half-open).
5. **Response** đi ngược lại từng edge. Về tới client thì ghi nhận.
6. **Queue** trả ack cho bên gửi ngay, sau đó message chạy tiếp như một luồng bất đồng bộ riêng.
7. **Autoscale** (giống Kubernetes HPA, `config.autoscale`): cứ `evalEveryMs` thì tính utilization (slot hoặc CPU) trung bình từ lần xét trước. Số instance mong muốn = `ceil(ready × utilization / targetUtilization)`, giới hạn trong `[min, max]`. Instance đang khởi động được tính là rảnh, và chênh lệch trong ±10% thì bỏ qua.
   - Scale lên: quyết định ngay, nhưng instance mới chỉ nhận traffic sau `podStartMs` (pull image, khởi động, readiness probe).
   - Scale xuống: lấy khuyến nghị cao nhất trong `stabilizationMs` gần nhất, để không dao động lên xuống liên tục. Instance bị bỏ không nhận request mới nữa, nhưng vẫn xử lý nốt phần đang làm và đang xếp hàng.
   - Pool kết nối phía gọi (`poolSize` × process × instance) và chi phí cũng thay đổi theo số instance. Cost trong summary là trung bình theo thời gian.
   - `NodeWindow.instances` là số instance đang nhận traffic, `starting` là số instance đang khởi động.

   ```json
   "autoscale": { "min": 2, "max": 10, "targetUtilization": 0.6, "evalEveryMs": 15000, "stabilizationMs": 60000, "podStartMs": 10000 }
   ```

   Bài học điển hình: HPA phản ứng chậm hơn spike (thời gian chờ lần xét kế tiếp cộng thời gian khởi động pod), nên vài chục giây đầu vẫn có lỗi. Khắc phục bằng cách giữ `min` cao hơn, đặt target thấp, hoặc đặt queue phía trước.

   Autoscale theo queue (giống KEDA): `"metric": "queueLength"`, `"queueSource": "<id node queue>"`, `"targetQueuePerInstance": 50`. Số replica = `ceil(backlog / target)`, vẫn áp dung sai ±10%, stabilization và `podStartMs`. Cho phép `min: 0` (scale-to-zero). Lúc 0 replica, request tới node được giữ lại chờ replica đầu tiên sẵn sàng thay vì bị từ chối.

8. **Cache theo key** (`config.cache` của node cache): mỗi request chọn một key theo phân phối Zipf trên `keys` key (CDF tính trước, tìm nhị phân, nên tất định).
   - Còn hạn thì hit. Hết hạn hoặc chưa có thì miss và đi xuống downstream. Downstream trả OK thì ghi key vào cache với hạn `ttlMs`. Cache đầy thì bỏ key lâu nhất không dùng (LRU).
   - `warm: false` nghĩa là cache rỗng lúc đầu, hit ratio tăng dần (warm-up). `warm: true` nạp sẵn các key phổ biến nhất, hạn rải đều trong một TTL để không hết hạn cùng lúc.
   - Không có `coalesce`, N request cùng miss một key tạo N request xuống DB: đó là **thundering herd / cache stampede**, rõ nhất ngay sau chaos `flush`. Có `coalesce` (singleflight), request đầu tiên đi lấy, các request sau chờ kết quả của nó (vẫn giữ slot của cache).
   - `staleWhileRevalidate`: key hết hạn vẫn trả ngay như hit, đồng thời một request nền đi làm mới (không giữ slot, không tính vào số liệu async).
   - `NodeWindow.hitRatio` là tỉ lệ hit trong cửa sổ, có cho mọi node cache (kể cả `hitRate` cố định).

9. **Hedge và quorum**:
   - `hedge`: gọi edge đầu tiên (theo `order`). Sau `hedgeAfterMs` chưa có trả lời thì gọi thêm edge tiếp theo. Kết quả OK đầu tiên thắng. Nhánh lỗi thì chuyển sang edge kế tiếp ngay. Nhánh thua **không bị huỷ**, vẫn làm tiếp ở callee, nên tải tăng thêm đúng bằng phần request chậm.
   - `quorum`: gọi tất cả, OK khi đủ `quorum` nhánh OK (mặc định đa số), lỗi ngay khi không còn đủ nhánh để đạt.

10. **Bảo vệ tải**:
    - `rateLimit` trên edge: token bucket phía caller.
    - `retryBudget` trên edge: chặn retry storm, tổng retry không vượt `ratio` × số request (cộng một mức tối thiểu mỗi giây).
    - `queueTimeoutMs` trên node: bỏ request đã chờ quá lâu thay vì xử lý việc caller đã bỏ cuộc. Tính vào `rejected`.
    - `adaptiveLimit` trên node (AIMD, như Netflix concurrency-limits): request xong nhanh hơn `targetMs` và giới hạn đang được dùng quá nửa thì giới hạn +1. Request chậm hơn hoặc lỗi thì giới hạn × `backoff`. Request vượt giới hạn bị từ chối ngay, không xếp hàng.

11. **Partition**: edge bị chia cắt làm rơi request lẫn response. Callee không nhận được gì, caller chỉ biết qua timeout. Không có timeout thì caller treo mãi. Connection của pool bị treo đến hết timeout của edge (hoặc 30s nếu không có).

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

- Cold start của từng request (JIT). Autoscaling dựa trên utilization hoặc độ dài queue, chưa có custom metric khác. Băng thông ở mức một đường truyền FIFO mỗi chiều, chưa mô phỏng TCP chia sẻ công bằng hay mất gói lẻ tẻ (partition thì mất hết). CPU, GC, lock (USL) và pool đã có nhưng tham số cần đo để hiệu chỉnh, xem [CAPACITY.md](CAPACITY.md).
- Gọi có điều kiện (gọi B chỉ khi A trả về X) chưa có. Hedge không huỷ nhánh thua.
- Cache theo key không phân biệt đọc/ghi: chưa có invalidation khi ghi, nên chưa mô phỏng dữ liệu cũ.
- Latency không tăng theo tải bên trong một node. Tải chỉ làm tăng thời gian *chờ hàng đợi*, phần đó mô phỏng đúng.

## 6. Hiệu chỉnh bằng số liệu thật

Muốn mô phỏng sát hệ thống của bạn:

1. Lấy p50/p99 của từng service hoặc endpoint từ APM (Grafana, Datadog, OpenTelemetry).
2. `concurrency` = kích thước thread pool / connection pool / worker thực tế.
3. Kiểm chứng bằng định luật Little: `số request đang xử lý ≈ rps × latency trung bình` phải khớp với số đo thật.
4. Chạy load test (k6) ở 2 mức tải và so với `pnpm sim --windows`. Lệch nhiều thì xem lại các giả định ở mục 5.

Lệnh `pattern-sim calibrate` làm bước 4 tự động: đọc kết quả k6 ở nhiều mức tải, fit tham số, in bảng so sánh và giới hạn dự đoán. Có kèm kết quả kiểm chứng trên server thật trong [CAPACITY.md](CAPACITY.md).
