# Học system design bằng simulator

Simulator này dùng để tính toán, nhưng cũng là công cụ học và luyện tập. Tài liệu này mô tả:

1. **Ngôn ngữ hình ảnh**: nhìn vào canvas là biết request đi đâu, theo thứ tự nào, mang bao nhiêu dữ liệu.
2. **Lộ trình học** kiểu Duolingo, từ người chưa biết gì đến nâng cao.

## 1. Animation: request, response, payload, thứ tự

### Particle

| Hình | Nghĩa |
|---|---|
| Mũi tên xanh dương, chỉ theo hướng đi | request (caller → callee) |
| Mũi tên cam | retry |
| Chấm xanh lá, làn bên kia của edge | response OK, đi ngược về caller |
| Dấu × đỏ, to hơn | response lỗi |
| To hơn | payload lớn hơn theo chiều đó: `1 + log2(1 + KB/4) × 0.25`, tối đa 2.6× |
| Ánh tím | request fire-and-forget |
| To gấp đôi, có vòng trắng | request đang được trace |

Request và response chạy ở hai làn đối diện nên không đè lên nhau. Thời gian bay của particle bằng đúng độ trễ của chặng đó (mạng + chờ đường truyền + truyền body), tối thiểu 0.45 s thời gian thực để mắt kịp nhìn.

WebGPU và Canvas2D vẽ cùng một kiểu. Shader nhận thêm `style` của mỗi edge (kích thước request, kích thước response, cờ fire-and-forget), nằm cạnh 4 điểm bezier trong buffer edge (12 float mỗi edge).

### Đường nối

- **Tách nhánh**: các edge chung một phía của node được dàn ra theo chiều dọc (cách nhau 14 px, tối đa 64 px), sắp theo độ cao của đầu bên kia để không cắt nhau.
- **Mũi tên** ở đầu đích. Edge dày lên theo lưu lượng (log của call/s).
- **Ký hiệu cách gọi** ở gần đầu nguồn:
  - `⇄`: chọn 1 trong các nhánh (round-robin, như LB)
  - `①②③`: tuần tự, số là bước
  - `∥`: song song, chờ tất cả
  - `⇢` kèm nét đứt: fire-and-forget
- **Badge**: timeout, retry, circuit breaker, pool, payload (`↑2KB ↓60KB`), mức bận của đường truyền (`link 87%`).

### Thứ tự xử lý khi một node nối nhiều nơi

Chọn trong Thuộc tính của node, mục "Gọi các nhánh phía sau":

| Chế độ | Code tương đương | Latency | Khi nhánh lỗi |
|---|---|---|---|
| Chọn 1 | load balancer, replica | một nhánh | retry có thể sang nhánh khác |
| Tuần tự | `await a(); await b();` | tổng các bước | dừng, cả request lỗi |
| Song song | `await Promise.all([a(), b()])` | nhánh chậm nhất | lỗi ngay (fail fast), các nhánh khác vẫn chạy |

- Kết hợp được: chế độ Tuần tự với hai edge cùng `order` nghĩa là bước đó gọi song song. Ví dụ `examples/08-checkout-fan-out.json`: ① Auth → ② Kho ∥ Giá → ③ Thanh toán → ④ Email (fire-and-forget).
- Với node `cpu`, CPU được chia thành `số bước + 1` lát xen giữa các bước gọi, giống code chạy giữa các `await`.

### Trace

Tab **Trace** → "Theo dõi 1 request". Engine đánh dấu request kế tiếp và ghi lại sự kiện của từng chặng: `send`, `arrive`, `start` (có slot), `reply`, `recv`, `timeout`, `reject`. Từ đó UI dựng ra:

- **Waterfall** giống Jaeger, mỗi chặng một dòng theo cây gọi. Mỗi dòng có các đoạn: chờ connection, request trên mạng, xếp hàng, xử lý, response trên mạng. Vạch đứt đánh dấu lúc người dùng nhận response; phần sau vạch là việc chạy nền (fire-and-forget).
- **Diễn biến** bằng lời, ví dụ "24ms Checkout gọi cùng lúc Kho, Giá (song song)".
- Trên canvas, particle của request đó to hơn, có vòng trắng. Bấm "Xem chậm 0.25×" để nhìn kịp.

Trace là một phần của engine (`Simulation::trace_next`, `TraceEvent`), nên CLI và test dùng được.

## 2. Lộ trình học

Tab **Học** là tab mặc định. Nội dung nằm trong `apps/web/src/learn/curriculum.ts`.

### Cấu trúc

- **Phần** (unit): một chủ đề, có màu riêng và gắn với một cấp độ (Cơ bản, Trung cấp, Nâng cao).
- **Bài** (lesson): khoảng 3–4 thẻ, mất 2–3 phút. Bài thực hành chỉ có một thẻ là level trên canvas.
- **Thẻ** (card):
  - `read`: giải thích ngắn, có thể kèm **sơ đồ tuần tự động** (`SequenceAnim`: lifeline, mũi tên bay theo thứ tự, các bước cùng `at` bay cùng lúc).
  - `choice`: trắc nghiệm, luôn có giải thích.
  - `order`: bấm các bước theo đúng thứ tự (thứ tự xử lý request, vòng đời circuit breaker, backoff).
  - `predict`: người học đoán một con số (p50, p99, tỉ lệ lỗi), rồi **engine chạy thật** kịch bản đó ngay trong trình duyệt. Đáp án đúng là khoảng chứa kết quả mô phỏng, không phải con số viết tay.
  - `build`: mở level trên canvas, đạt ≥ 1★ là qua bài. Chấm điểm bằng đúng engine của Game.

### Cơ chế kiểu Duolingo

- Đường đi uốn lượn, mỗi bài một nút tròn. Bài đã xong có dấu ✓, bài hiện tại có vòng sáng và nhãn "Bắt đầu/Tiếp tục", bài chưa tới bị khoá.
- Câu trả lời sai được **hỏi lại ở cuối bài** (một lần).
- **XP**: bài học 10, thực hành 20. Đúng 100% được thêm 5, mỗi ★ ở bài thực hành thêm 5. Học lại một bài được 1/3 số XP.
- **Mục tiêu ngày** 30 XP và **chuỗi ngày liên tiếp**.
- "Tôi biết rồi, mở khoá tất cả" cho người đã có nền tảng.
- Tiến độ lưu trong `localStorage` (`pattern.learn.v1`), không cần tài khoản.

### Nội dung

| Phần | Cấp độ | Bài | Thực hành |
|---|---|---|---|
| 1. Request đi đâu? | Cơ bản | client/server, latency, p50/p99, throughput và hàng đợi | Quán cà phê đông khách: scale instance |
| 2. Gọi nhiều dịch vụ: thứ tự là tất cả | Cơ bản | tuần tự, song song, fire-and-forget, fan-out làm p99 xấu đi, payload và băng thông | Trang sản phẩm: tuần tự → song song. Email đăng ký: fire-and-forget |
| 3. Mở rộng hệ thống | Trung cấp | scale dọc/ngang, LB, định luật Little, điểm gãy | Một máy không đủ: LB + nhiều node |
| 4. Dữ liệu | Trung cấp | cache-aside, hit rate, connection pool và `max_connections` | Đợt sale đầu tiên |
| 5. Khi mọi thứ hỏng | Trung cấp | timeout, retry/backoff/jitter, circuit breaker | Database chập chờn, Mất một zone |
| 6. Bất đồng bộ | Trung cấp | queue, backlog | Black Friday |
| 7. Nâng cao: đo và dự đoán | Nâng cao | event loop Node.js, đo bằng k6 và coordinated omission, sizing | dẫn sang tab Công suất |

Level thực hành nằm ở `levels/learn/`, có lời giải ở `levels/learn/solutions/`. Hai luật mới giữ cho bài học có ý nghĩa:

- `requiredEdges`: lời gọi bắt buộc phải giữ (trang sản phẩm phải lấy giá). Vì vậy không thể "thắng" bài thứ tự gọi bằng cách xoá lời gọi.
- `allowFireAndForget`: chỉ level cho phép mới được bỏ chờ. Nếu không, một lệnh đọc có thể "giả vờ" xong mà không có dữ liệu.

### Kiểm tra nội dung

```bash
pnpm check:learn       # chạy mọi thẻ predict bằng engine, kiểm tra kết quả rơi vào đúng 1 lựa chọn
cargo test -p pattern-engine --test levels   # level ban đầu phải thua, lời giải phải được 3★
```

Đổi engine làm lệch một câu dự đoán thì `check:learn` báo ngay, nên nội dung bài học không bị cũ đi so với simulator.

### Thêm bài mới

1. Thêm `Lesson` vào `UNITS` trong `curriculum.ts`.
2. Với `predict`: dựng kịch bản bằng các helper `oneHop`, `fanOut`, hoặc viết `{ design, scenario }`, rồi chạy `pnpm check:learn` để chỉnh các khoảng đáp án.
3. Với `build`: thêm level vào `levels/learn/` và lời giải vào `levels/learn/solutions/`.

## Hướng phát triển

- Thẻ "sửa design": cho sẵn một design hỏng, người học sửa trên một canvas mini ngay trong bài.
- Ôn tập ngắt quãng (spaced repetition): đưa lại các câu hay sai sau vài ngày.
- Bài kiểm tra nhảy cóc để mở nhanh cả một phần.
- Trace so sánh: đặt hai waterfall cạnh nhau, trước và sau khi đổi Tuần tự → Song song.
