# Studio: thiết kế hệ thống bằng công nghệ thật

Studio nằm trong tab **Sandbox**. Thay vì một canvas dùng một lần, mỗi thiết kế là một **dự án** được lưu lại. Dự án dựng từ các công nghệ thật, mô phỏng được tải và sự cố, và xuất được thành prompt cho agent triển khai.

## 1. Thư viện công nghệ

Dữ liệu nằm ở `apps/web/src/tech/catalog.ts`. Mỗi công nghệ gồm:

| Trường | Ý nghĩa |
|---|---|
| `kind` | Loại node engine dùng để mô phỏng: `loadBalancer`, `service`, `cache`, `database`, `queue` |
| `config` | Số mô phỏng mặc định thực tế cho một instance (slot, p50/p99, mô hình CPU, GC, giá) |
| `edgeDefaults` | Chính sách cho edge mới trỏ vào nó, ví dụ PostgreSQL có pool 10 |
| `summary`, `details` | Tổng quan, điểm mạnh/yếu, nên dùng khi, tránh khi, ngữ nghĩa (at-least-once, ordering…) |
| `scores` | 7 tiêu chí 1–10: thông lượng, độ trễ, độ bền, mở rộng, dễ vận hành, chi phí, hệ sinh thái |
| `deploy` | Image và các thiết lập then chốt, được đưa vào prompt |
| `alternatives` | Gợi ý so sánh và đổi nhanh |

Điểm là **ước lượng định tính để hỗ trợ lựa chọn, không phải benchmark**. Node lưu `tech` trong JSON. Engine, CLI và server bỏ qua field này, nên design vẫn chạy bằng `pnpm sim`.

Thêm một công nghệ: thêm một mục vào `TECHS`. Logo lấy từ `simple-icons` (`import { siXxx } from 'simple-icons'`), nếu không có thì dùng `mono('AB', 'hex')`.

Logo thương hiệu thuộc về chủ sở hữu tương ứng và chỉ được dùng để nhận diện.

## 2. Dự án, auto-save và phiên bản

- Lưu local-first trong IndexedDB (`pattern-studio`, gồm 2 store là `projects` và `versions`) qua interface `ProjectStore` (`apps/web/src/projects/store.ts`). Có thể viết thêm adapter HTTP tới NestJS mà không phải sửa UI.
- Auto-save chạy 800ms sau lần sửa cuối, gồm kéo node, đổi cấu hình, nối dây, khung và ghi chú. Header hiện trạng thái "Đang lưu…" hoặc "Đã lưu".
- Phiên bản:
  - Tự chụp mỗi 5 phút khi có sửa, giữ 50 bản.
  - ⌘/Ctrl+S tạo bản có tên, được giữ vĩnh viễn.
  - Khôi phục luôn chụp lại trạng thái hiện tại trước, nên không mất gì.
- Dự án còn lưu `lastRun`: số liệu mô phỏng gần nhất và các node nóng, để đưa vào prompt.

## 3. Prompt cho agent triển khai

Code ở `apps/web/src/prompt/buildPrompt.ts`, là hàm thuần với đầu vào là dự án và tuỳ chọn, đầu ra là markdown. Nội dung gồm:

1. Mục tiêu, lấy từ tab Ghi chú.
2. Sơ đồ Mermaid (khung K8s thành subgraph lồng nhau) và bảng thành phần: công nghệ, image, quy mô, thiết lập then chốt, tổng connection vào DB, HPA.
3. Từng lời gọi với timeout, retry, circuit breaker, pool, fire-and-forget. Với queue có thêm yêu cầu consumer idempotent và DLQ.
4. SLO, profile traffic, các sự cố phải chịu được, chi phí.
5. Kết quả mô phỏng gần nhất (tuỳ chọn).
6. Sản phẩm bàn giao (Docker Compose, Kubernetes, code NestJS, script k6) và tiêu chí chấp nhận.

## 4. Kubernetes

- **Khung** (Cluster, Namespace, Node pool, Zone) kéo từ nhóm Kubernetes trong thư viện. Khung chỉ để hiển thị:
  - Kéo khung thì node bên trong đi theo.
  - Khung được lưu trong `design.groups`, mỗi node có `group` là khung nhỏ nhất chứa nó.
  - Chọn khung có thể giả lập mất cả khung (mọi node bên trong down).
- **HPA** nằm trong engine (`config.autoscale`), xem [SIMULATION.md](SIMULATION.md) mục 2.7. Node card hiện số replica, tab Số liệu có biểu đồ Replica.
- Mẫu `10-k8s-hpa-spike` cho thấy HPA phản ứng chậm hơn spike.

## 5. Case study

Các file `case-studies/*.json` là mô hình đơn giản hoá dựa trên bài viết engineering công khai (Discord, Slack, Netflix, Twitter, Stack Overflow, Figma). Mỗi case gồm bối cảnh, quyết định kèm đánh đổi, các giai đoạn (design + scenario, ví dụ trước/sau), thử thách và nguồn. **Con số là minh hoạ cơ chế, không phải số liệu thật của công ty.** "Tạo bản sao để thử nghiệm" biến một giai đoạn thành dự án, đưa thử thách vào Ghi chú.

Kiểm tra một giai đoạn bằng CLI: lấy `stages[i].design` và `stages[i].scenario` ra một file `{ design, scenario }`, rồi chạy `pnpm sim <file> --windows`.

## 6. Giới hạn hiện tại

- Mỗi design chỉ có một client, nên traffic chia đều giữa các nhánh đi ra từ client.
- Chưa có fallback (trả dữ liệu dự phòng khi lỗi), DLQ, ordering hay idempotency trong engine. Prompt có yêu cầu những thứ này, nhưng mô phỏng chưa đo được.
- HPA chỉ scale theo utilization, chưa scale theo độ dài queue (KEDA).
- Dự án chỉ lưu trong trình duyệt. Chưa có đồng bộ server hay chia sẻ link.
