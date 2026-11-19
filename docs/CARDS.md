# Game thẻ bài "On-Call" (prototype)

Tab **Game → Thẻ bài (beta)**. Một trận đánh theo lượt kiểu deckbuilder roguelike: bạn giữ một hệ thống nhỏ sống sót trước botnet đang spam request. Mỗi lượt bạn đánh bài để đổi kiến trúc, sau đó **engine thật chạy 10 giây traffic** và số liệu mô phỏng quyết định sát thương của cả hai bên.

Đây là prototype bước 0, dùng để thử cảm giác chơi. Chưa có bản đồ, shop, relic hay nhiều trận nối tiếp.

## Luật chơi

| Cơ chế | Trong game |
|---|---|
| Máu | **Error Budget** (60) |
| Năng lượng | **Ops**: 3 mỗi lượt |
| Giáp | **Headroom**: hấp thụ sát thương trong lượt, mất khi sang lượt mới |
| Địch | **Botnet Bầy Kiến** (55 máu), có ý định hiện trước mỗi lượt |

Mỗi lượt diễn ra như sau:

1. Rút 5 lá và hồi Ops. Địch hiện ý định cho lượt này (spike, retry flood, truy vấn nặng…).
2. Người chơi đánh bài.
3. Bấm **Kết thúc lượt**. `planTurn` dựng design và scenario, engine chạy 10s mô phỏng với `legitRps + bot lọt qua bộ lọc`.
4. `resolveTurn` tính sát thương:
   - **Bạn mất máu**:
     - 1 máu cho mỗi `failedPerDamage` request người dùng thật bị lỗi (ước lượng: `errorRate × legitRps × 10s`).
     - `latencyDamage` máu nếu p99 vượt SLO.
     - Máu theo số $/h vượt ngân sách.
     - Tối đa `maxDamagePerTurn` mỗi lượt.
   - **Botnet mất máu**: từ lá Phản công, và 1 máu cho mỗi `blockedPerDamage` request bot bị WAF hoặc rate limit chặn. Botnet càng yếu thì càng gửi ít traffic.

Thẻ **Hạ tầng** và **Chính sách** giữ tác dụng cả trận, nhưng tốn tiền mỗi giờ. Thẻ **Hành động** chỉ có tác dụng trong lượt đánh ra.

Một số tình huống được dạy qua cơ chế, không cần viết kịch bản:
- Redis đỡ được spike, nhưng "Truy vấn nặng" né cache.
- Circuit breaker không có fallback biến quá tải thành sập toàn bộ.
- Thêm Read Replica làm vượt ngân sách.
- Retry flood khuếch đại lỗi.

## Cấu trúc code

| File | Vai trò |
|---|---|
| `apps/web/src/cards/data/cards.json` | Định nghĩa lá bài: chi phí, hiệu ứng (`effects`), mô tả, bài học thực tế |
| `apps/web/src/cards/data/enemies.json` | Địch: máu, chuỗi ý định, mức leo thang mỗi vòng |
| `apps/web/src/cards/data/battle.json` | Thiết lập trận: máu, Ops, traffic, SLO, ngân sách, hệ số sát thương, bộ bài đầu, design ban đầu |
| `apps/web/src/cards/rules.ts` | **Luật thuần**: `newBattle`, `playCard`, `planTurn`, `resolveTurn`. Không React, không DOM, RNG có seed nằm trong state |
| `apps/web/src/cards/CardBattle.tsx` | Giao diện. Gọi engine qua `compute.run` (Web Worker) |
| `apps/web/scripts/cards-balance.mjs` | Bot tự chơi nhiều trận bằng engine thật để cân bằng |

Thêm lá bài: thêm một mục vào `cards.json` với các `effects` có sẵn (`scale`, `cache`, `edge`, `rateLimit`, `waf`, `attack`, `headroom`, `draw`, `ops`, `hotfix`). Nếu cần hiệu ứng mới, thêm một nhánh trong `apply()` ở `rules.ts`.

### Cân bằng

```bash
pnpm balance:cards            # 20 trận mỗi chiến thuật (idle, random, greedy)
pnpm balance:cards 50 --log   # in diễn biến từng lượt
```

Mục tiêu hiện tại cho trận đầu:
- Không làm gì: thua.
- Đánh ngẫu nhiên: thắng khoảng 60%, còn ít máu.
- Đánh có chiến thuật: thắng khoảng 90%, còn khoảng 25–30 máu, trận dài khoảng 7 lượt.

Mỗi trận chạy khoảng 0.15s nên có thể sweep tham số thoải mái.

### Giới hạn của prototype

- Engine chưa phân biệt request người dùng và bot. Bộ lọc bot được tính ở tầng game, trước khi đưa vào engine. Lỗi được chia đều theo tỉ lệ traffic.
- Mỗi lượt là một mô phỏng mới từ design: hàng đợi và trạng thái circuit breaker không chuyển sang lượt sau.
- Rate limit và WAF chưa phải node trong engine.

Cả ba điểm này nằm trong kế hoạch mở rộng engine: request class, node rate limiter/WAF, `apply_patch` khi đang chạy.

## Hướng tới Godot, Steam và console

Prototype được viết để chuyển sang client khác mà không phải thiết kế lại:

1. **Nội dung là JSON thuần.** Godot đọc trực tiếp (`JSON.parse_string`) hoặc chuyển thành `Resource`.
2. **Luật là reducer thuần, tất định.** Đầu vào là state và action, đầu ra là state mới. RNG mulberry32 nằm trong state. Có thể port sang GDScript hoặc C# gần như từng dòng, hoặc tốt hơn là viết lại một lần bằng Rust (`crates/deck`) để web, server và Godot dùng chung.
3. **Engine mô phỏng là Rust thuần** (`crates/engine`). Có thể nhúng vào Godot 4 bằng [godot-rust (gdext)](https://github.com/godot-rust/gdext) dưới dạng GDExtension. Cùng seed cho cùng kết quả trên mọi nền tảng, nên dùng được cho replay, Daily Run và chống gian lận leaderboard.

Rủi ro cần kiểm tra sớm:

- **Console (Switch, PlayStation, Xbox):** Godot không tự xuất sang console. Cần đơn vị port (ví dụ W4 Games, Lone Wolf Technology) hoặc dev kit chính thức, kèm SDK theo NDA.
- **Biên dịch Rust cho console:** GDExtension viết bằng Rust phải biên dịch được cho target của từng console. Việc này khả thi nhưng phụ thuộc toolchain của nhà sản xuất. Nên làm proof-of-concept trước khi chốt kiến trúc. Phương án dự phòng là port engine sang C++ hoặc C#, chấp nhận phải kiểm tra lại tính tất định.
- **Steam:** dùng [GodotSteam](https://godotsteamkit.com) hoặc plugin tương đương cho achievement, leaderboard và cloud save.
- **Hiệu năng:** engine chạy khoảng 1 triệu request/giây trên native. Một lượt khoảng 20k request, nên không đáng lo kể cả trên Switch.
