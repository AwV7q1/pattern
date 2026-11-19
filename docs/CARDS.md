# Game thẻ bài "On-Call" (prototype)

Tab **Game → Thẻ bài (beta)**. Một trận đánh theo lượt kiểu deckbuilder roguelike: bạn giữ một hệ thống nhỏ sống sót trước botnet đang spam request. Mỗi lượt bạn đánh bài để đổi kiến trúc, sau đó **engine thật chạy 10 giây traffic** và số liệu mô phỏng quyết định sát thương của cả hai bên.

Chế độ chính là **Tháp On-Call**: leo 3 tầng, mỗi tầng một bản đồ nhiều nhánh có trận thường, tinh anh, sự cố, nghỉ, cửa hàng và trùm ở đỉnh. Cách chơi theo khuôn deckbuilder roguelike (kiểu Slay the Spire): bộ bài đầu nhỏ, mạnh lên nhờ phần thưởng, nâng cấp, relic và cửa hàng.

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

Cạnh nút **Kết thúc lượt** có ô **Dự kiến**: sau mỗi lá đánh ra, engine chạy thử lượt với bài đã đánh và hiện số máu bạn sẽ mất, botnet sẽ mất. `scoreTurn` dùng chung cho dự báo và `resolveTurn`, cùng seed, nên dự báo đúng bằng kết quả thật.

Một số tình huống được dạy qua cơ chế, không cần viết kịch bản:
- Redis đỡ được spike, nhưng "Truy vấn nặng" né cache.
- Circuit breaker không có fallback biến quá tải thành sập toàn bộ.
- Thêm Read Replica làm vượt ngân sách.
- Retry flood khuếch đại lỗi.

## Tháp: xây bộ bài

| Cơ chế | Chi tiết |
|---|---|
| Bộ bài đầu | 14 lá: 4 Vá nóng, 4 Buffer (lá **Cơ bản**), Scale Out API, Rate limit, Redis, Timeout, Index |
| Độ hiếm | Cơ bản (không bao giờ được thưởng), Thường, Ít gặp, Hiếm. Phần thưởng bốc theo `run.json` `rarityWeights`; tinh anh nghiêng về Hiếm |
| Nâng cấp | Điểm nghỉ có 3 lựa chọn: hồi máu, bỏ 1 lá, nâng cấp 1 lá. Lá nâng cấp có id `<id>+`; `cardDef` dựng nó từ trường `upgrade` (giá và/hoặc hiệu ứng mới) |
| Relic | `data/relics.json`. Kích hoạt lúc bắt đầu trận (`battleStart`), đầu mỗi lượt (`turnStart`), hoặc sau mỗi lá / mỗi lá thứ n của một loại (`cardPlayed`). Hiệu ứng dùng lại các `effects` của lá bài. Tinh anh rơi 1 relic; trùm (trừ trùm cuối) cho chọn 1 trong 3 relic **Trùm** |
| Vàng | Bắt đầu 40, mỗi trận thắng cộng thêm (thường 16, tinh anh 32, trùm 60, ±5). Một số sự cố cho hoặc lấy vàng |
| Cửa hàng | Mỗi tầng ít nhất một. Bán 5 lá (giá theo độ hiếm), 2 relic, và dịch vụ bỏ 1 lá (50 vàng, tăng 25 mỗi lần dùng trong run) |

### Địch theo tầng

Mỗi tầng có nhóm địch thường và tinh anh riêng (`run.json` `normal` và `elites`, mỗi tầng một danh sách), theo chủ đề sự cố leo thang dần. Ô trận bốc ngẫu nhiên trong nhóm của tầng, không gặp lại đúng con vừa đánh ở trận cùng loại trước đó.

| Tầng | Chủ đề | Địch thường | Tinh anh |
|---|---|---|---|
| 1 | Sự cố thường ngày | Botnet Bầy Kiến, Bão Retry, Đàn Thundering Herd, Crawler Tham Lam | Rò Rỉ Bộ Nhớ, Cron Nửa Đêm |
| 2 | Tấn công có chủ đích | Scraper Đối Thủ, Credential Stuffer, Slowloris, Bot Săn Sneaker | Trại Click Farm, Kẻ Lạm Dụng API |
| 3 | Tấn công phân tán | Botnet Camera IoT, Khuếch Đại DNS, Sâu Zero-day, Băng Tống Tiền | Nhóm APT, Botnet Hydra |

Ngoài traffic, retry, chaos (`api` hoặc `db`), cache và thẻ nợ, ý định của địch còn có thể:

| Trường | Hiệu ứng | Hotfix gỡ được? |
|---|---|---|
| `bypass` | Bot lách một phần bộ lọc (WAF + rate limit) lượt này | Không |
| `wafStrip` | WAF mất ngay một phần sau lượt (xoay proxy, IP mới) | Không |
| `drainOps` | Lượt sau bớt Ops (giữ kết nối, họp khẩn), tối thiểu 1 | Không |

Nội tại (`passive`) không chỉ dành cho trùm: một số tinh anh có `bypass` (luôn lách bộ lọc), `regen` (hồi máu mỗi lượt) hoặc `wafDecay`.

### Trùm

Mỗi tầng có một trùm riêng (`run.json` `bosses`). Trùm có 3 cơ chế mà địch thường không có:

- **Ý định ngẫu nhiên có trọng số** (`pattern: "weighted"`, `weight` trên từng ý định): không biết trước lượt sau, nhưng không bao giờ lặp một ý định 3 lượt liền.
- **Pha 2** (`phase2`): khi máu xuống dưới `at` × máu tối đa, từ lượt sau chuyển sang bộ ý định khác.
- **Nội tại** (`passive`), luôn bật, Hotfix không gỡ được:

| Trùm | Tầng | Nội tại |
|---|---|---|
| Kẻ Đầu Độc Cache | 1 | Cache hit luôn ×0.7 |
| Black Friday | 2 | Người dùng thật ×1.6 |
| Lãnh Chúa DDoS | 3 | WAF mất 10% mỗi lượt |

### Tạo hình địch

Mỗi địch có thân và bảng màu riêng (`BotAvatar.tsx`, bảng `LOOKS`, khoá theo id địch):

| Địch | Tạo hình |
|---|---|
| Botnet Bầy Kiến | Kiến máy đỏ, râu và hàm, bầy kiến nhỏ bay quanh |
| Bão Retry | Đám mây xanh có sét, mũi tên retry bay quanh |
| Đàn Thundering Herd | Đầu bò cam có sừng và khoen mũi, đàn bò nhỏ chạy vòng |
| Crawler Tham Lam | Nhện máy treo trên sợi tơ, nhện nhỏ bò quanh |
| Rò Rỉ Bộ Nhớ | Thanh RAM "99% RAM" nhỏ giọt xuống vũng, số 0/1 bay quanh |
| Cron Nửa Đêm | Đồng hồ báo thức chuông rung, màn hình "00:00" |
| Scraper Đối Thủ | Robot hút bụi hút thẻ giá |
| Credential Stuffer | Kẻ trộm mũ len, bịt mắt, chùm chìa khoá và túi tiền |
| Slowloris | Cu li mắt to ôm dây cáp, chữ "z" bay quanh |
| Bot Săn Sneaker | Giày chạy có vệt tốc độ, hộp giày bay quanh |
| Trại Click Farm | Giá 9 điện thoại đang bị bấm, con trỏ chuột bay quanh |
| Kẻ Lạm Dụng API | Robot giữa hai dấu ngoặc `{ }`, đeo chìa khoá API |
| Botnet Camera IoT | Camera an ninh "REC" trên router nhấp nháy |
| Khuếch Đại DNS | Loa phóng thanh "×50" phát sóng âm |
| Sâu Zero-day | Sâu nhiều đốt có râu, sâu con bò quanh |
| Băng Tống Tiền | Ổ khoá đỏ có giấy đòi tiền chuộc |
| Nhóm APT | Bóng người trùm mũ, mặt là khoảng tối, cầm dao |
| Botnet Hydra | Rắn ba đầu |
| Kẻ Đầu Độc Cache | Áo choàng mặt nạ phòng độc, nhỏ giọt độc, cầm lọ thuốc |
| Black Friday | Thẻ giá đen "-70%", túi mua sắm và đồng xu bay quanh |
| Lãnh Chúa DDoS | Đội vương miện, mắt thứ ba, áo choàng, đạo quân bot nhỏ |

Ý định của lượt quyết định tư thế, vẽ chồng lên thân:

| Ý định | Tư thế |
|---|---|
| Dò quét (`probe`) | Mắt tâm ngắm, tia quét |
| Dồn tải (`spike`) | Gai bung ra, mắt giận, rung |
| Retry (`retry`) | Mắt xoáy, mũi tên quay, bóng mờ nhân bản |
| Làm chậm (`slow`) | Mắt lim dim, đồng hồ cát, đung đưa chậm, bạc màu |
| Gieo nợ (`debt`) | Mắt X, xích, lá bài bug bay quanh, giật hình |
| Hồi phục (`heal`) | Mắt cười, khiên, dấu cộng bay lên |

Trùm ở pha 2 có vòng lửa, địch tinh anh có viền vàng, dưới nửa máu thì nứt. Địch mới chưa có trong `LOOKS` dùng thân kiến.

## Cấu trúc code

| File | Vai trò |
|---|---|
| `apps/web/src/cards/data/cards.json` | Định nghĩa lá bài: chi phí, hiệu ứng (`effects`), mô tả, bài học thực tế |
| `apps/web/src/cards/data/enemies.json` | Địch: máu, chuỗi ý định, mức leo thang mỗi vòng |
| `apps/web/src/cards/data/relics.json` | Relic: độ hiếm, lúc kích hoạt, hiệu ứng |
| `apps/web/src/cards/data/run.json` | Tháp: số tầng, bản đồ, hệ số địch, vàng, cửa hàng, tỉ lệ độ hiếm |
| `apps/web/src/cards/run.ts` | **Luật của tháp**: bản đồ, phần thưởng, nghỉ, sự cố, cửa hàng, relic, lên tầng |
| `apps/web/src/cards/data/battle.json` | Thiết lập trận: máu, Ops, traffic, SLO, ngân sách, hệ số sát thương, bộ bài đầu, design ban đầu |
| `apps/web/src/cards/rules.ts` | **Luật thuần**: `newBattle`, `playCard`, `planTurn`, `resolveTurn`. Không React, không DOM, RNG có seed nằm trong state |
| `apps/web/src/cards/CardBattle.tsx` | Giao diện. Gọi engine qua `compute.run` (Web Worker) |
| `apps/web/src/cards/BotAvatar.tsx` | Tạo hình địch (SVG): thân theo địch, tư thế theo ý định |
| `apps/web/scripts/cards-balance.mjs` | Bot tự chơi nhiều trận bằng engine thật để cân bằng |

Thêm lá bài: thêm một mục vào `cards.json` với các `effects` có sẵn (`scale`, `cache`, `edge`, `rateLimit`, `waf`, `attack`, `headroom`, `draw`, `ops`, `hotfix`). Nếu cần hiệu ứng mới, thêm một nhánh trong `apply()` ở `rules.ts`.

### Cân bằng

```bash
pnpm balance:cards            # 20 trận mỗi chiến thuật (idle, random, greedy)
pnpm balance:cards 50 --log   # in diễn biến từng lượt
pnpm balance:cards 30 --run   # leo cả tháp: tỉ lệ vượt từng tầng và nơi bot chết
pnpm balance:cards 40 --run --by-enemy  # thêm tỉ lệ thắng, máu mất, số lượt theo từng địch
```

Mục tiêu hiện tại cho trận đầu:
- Không làm gì: thua.
- Đánh ngẫu nhiên: thắng khoảng 60%, còn ít máu.
- Đánh có chiến thuật: thắng khoảng 90%, còn khoảng 25–30 máu, trận dài khoảng 7 lượt.

Mục tiêu cho cả tháp (`--run`, 30 run):
- Đánh ngẫu nhiên: vượt tầng 1 khoảng 50%, vượt cả tháp khoảng 10–15%.
- Đánh có chiến thuật: vượt tầng 1 gần như chắc chắn, vượt cả tháp khoảng 40%.

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
