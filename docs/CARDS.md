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

### Trận khởi động

3 trận thường đầu tiên của tầng 1 (`run.json` `warmupFights`) bốc từ nhóm `warmup`: địch ít máu, traffic thấp (tối đa ~1500 rps trước hệ số tầng), mỗi con dạy một cơ chế. Phần thưởng vẫn như trận thường (chọn 1 trong 3 lá + vàng), nên người chơi có bài để xây bộ bài trước khi gặp địch thật của tầng. Tên trận hiện "Khởi động: …".

| Địch | Dạy gì |
|---|---|
| Script Kiddie | Spike và retry nhẹ |
| Bot Ping | Traffic tăng dần, một lượt dồn |
| Bot Spam Form | Lính và chọn mục tiêu (kéo theo Tin Rác) |
| Bot Kiểm Tra Uptime | Chaos nhẹ (API chậm ×1.5), để thử Hotfix |

### Lính đi kèm

Một số địch đánh cùng lính (`data/minions.json`). Lính có máu riêng, cộng thêm traffic mỗi lượt, và có thể:

| Trường | Hiệu ứng |
|---|---|
| `botRps` | Traffic cộng thêm mỗi lượt (theo hệ số traffic của trận), không giảm khi chỉ huy yếu đi |
| `guard` | Chỉ huy chịu ít sát thương hơn khi lính còn sống (nhiều lính nhân dồn) |
| `heal` | Hồi máu cho chỉ huy cuối mỗi lượt |

- Địch có thể ra trận cùng lính (`minions` trên địch) hoặc gọi thêm qua ý định (`summon: { minion, n }`). Tối đa 3 lính cùng lúc (`MAX_MINIONS`).
- Bấm một lính để nhắm: lá Phản công và sát thương từ bot bị lọc đều dồn vào lính đó. Sát thương thừa khi lính chết bị mất, mục tiêu quay về chỉ huy. Bấm chỉ huy để nhắm lại chỉ huy.
- Hạ chỉ huy là thắng: lính tan rã.
- Máu lính nhân theo hệ số máu của trận nếu lớn hơn 1 (trùm, tầng cao).

| Lính | Đi cùng | Vai trò |
|---|---|---|
| Tin Rác | Bot Spam Form | Traffic |
| Kiến Thợ | Botnet Bầy Kiến | Traffic |
| Job Cron | Cron Nửa Đêm (gọi) | Traffic |
| Điện Thoại Click | Trại Click Farm | Traffic |
| Bot Đầu Cơ | Black Friday (gọi) | Traffic |
| Máy Tính Ma | Lãnh Chúa DDoS (gọi) | Traffic |
| Proxy Che Chắn | Nhóm APT, Lãnh Chúa DDoS | Che 50% sát thương |
| Đầu Hydra | Botnet Hydra | Traffic, che 30% |
| Node Nhiễm Độc | Kẻ Đầu Độc Cache (gọi) | Traffic, hồi 4 máu/lượt |
| Trạm C2 | Nhóm APT | Traffic, hồi 3 máu/lượt |

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
| Script Kiddie | Cậu nhóc đội mũ lưỡi trai ngược, đeo tai nghe, áo hoodie |
| Bot Ping | Ăng-ten radar phát vòng sóng "PING" |
| Bot Spam Form | Hộp thư robot dựng cờ, phun phong bì |
| Bot Kiểm Tra Uptime | Màn hình nhịp tim có chân |

Lính có thân nhỏ riêng (`MinionAvatar`, bảng `MINION_LOOKS`): phong bì, kiến con, bánh răng đồng hồ, điện thoại, túi mua sắm, laptop đầu lâu, khiên mặt nạ, đầu rắn, ổ cache nứt nhỏ giọt, cột phát sóng.

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

### Chuyển động

Mỗi địch và lính có bộ chuyển động riêng (`botMotion.ts`, keyframes trong `styles.css`): dáng đi lúc đứng yên, kiểu ra đòn khi tới lượt địch, và phản ứng khi trúng đòn, khi gọi lính, khi bị hạ. Phần nào cũng chỉ là minh hoạ; luật vẫn do `rules.ts` quyết.

| Dáng đi | Địch |
|---|---|
| Nhún nhảy (`hop`) | Script Kiddie, Bot Săn Sneaker |
| Lơ lửng (`hover`) | Bot Ping, Nhóm APT |
| Bay lên, nghiêng nhẹ (`levitate`) | Lãnh Chúa DDoS |
| Bước đều (`march`) | Bot Spam Form, Kẻ Lạm Dụng API |
| Đập như tim (`beat`) | Bot Kiểm Tra Uptime, Khuếch Đại DNS |
| Trôi (`drift`) | Botnet Bầy Kiến, Bão Retry |
| Giậm chân (`stomp`) | Đàn Thundering Herd |
| Đu tơ (`dangle`) | Crawler Tham Lam |
| Run rẩy (`jitter`) | Rò Rỉ Bộ Nhớ, Trại Click Farm |
| Tích tắc (`tick`) | Cron Nửa Đêm |
| Rình (`prowl`) | Scraper Đối Thủ, Credential Stuffer, Kẻ Đầu Độc Cache |
| Bò rất chậm (`creep`) | Slowloris |
| Quét qua lại (`scan`) | Botnet Camera IoT |
| Uốn lượn (`slither`) | Sâu Zero-day, Botnet Hydra |
| Đung đưa (`swing`) | Băng Tống Tiền, Black Friday |

| Kiểu ra đòn | Địch |
|---|---|
| Lao tới (`lunge`) | Script Kiddie, Crawler, Slowloris, Sâu, Hydra |
| Lấy đà rồi húc (`charge`) | Bot Uptime, Bầy Kiến, Thundering Herd, Scraper, Sneaker |
| Nhảy lên dậm xuống (`slam`) | Rò Rỉ Bộ Nhớ, Băng Tống Tiền, Black Friday |
| Xoay vòng (`spin`) | Bão Retry, Cron Nửa Đêm |
| Biến mất rồi hiện sát (`blink`) | Credential Stuffer, Kẻ Lạm Dụng API, Nhóm APT |
| Phun hai nhịp (`spit`) | Bot Ping, Bot Spam, Click Farm, Camera IoT, Khuếch Đại DNS, Kẻ Đầu Độc Cache |

Cấp của địch thêm một lớp chuyển động:

| Cấp | Đứng yên | Trúng đòn | Bị hạ |
|---|---|---|---|
| Mini bot (trận khởi động) | Nhỏ hơn, nhịp nhanh hơn, sao lấp lánh | Bị hất văng, xoay | Xoay tít rồi biến mất |
| Thường | Dáng đi riêng | Rung | Ngã nghiêng, bạc màu |
| Tinh anh | Hai viền vàng xoay ngược nhau, thỉnh thoảng gồng người | Rung ngắn, loé vàng | Loé sáng hai lần rồi vỡ mờ |
| Trùm tầng | Thở chậm, bóng đổ dưới chân, sóng chấn lan trên mặt đất (pha 2 nhanh hơn, sóng màu lửa) | Gần như không lùi | Rung, loé sáng nhiều lần rồi nổ tan |

Lãnh Chúa DDoS, trùm cuối, có bộ chuyển động riêng thay cho các kiểu dùng chung (`ddosLord.tsx`):

| Lúc | Chuyển động |
|---|---|
| Đứng yên | Bay lơ lửng, áo choàng gợn sóng. Vương miện bay tách khỏi đầu, có ánh sáng rỉ ra ở giữa. Mắt thứ ba thường híp lại, thỉnh thoảng mở ra nhìn. Một vòng gói tin xoay quanh người, nửa sau chạy sau lưng, nửa trước chạy trước mặt |
| Ra đòn "Flood" | Ngả người lấy đà, mắt thứ ba nạp sáng rồi bắn một tia kèm chùm gói tin về phía hệ thống của bạn |
| Trúng đòn | Khiên proxy lục giác hiện ra đỡ đòn, gợn sóng chạy dọc các ô, vương miện chao đi |
| Gọi lính | Vương miện bay lên xoay một vòng, cổng triệu hồi mở dưới đất, vòng lính quay nhanh hẳn |
| Pha 2 | Bùng một vòng sóng đỏ khi chuyển pha. Vương miện nứt, nghiêng và rực đỏ. Mắt mở to liên tục, gói tin chạy nhanh gấp đôi, thân thỉnh thoảng nhoè thành hai bản đỏ và xanh. Khi trúng đòn, khiên vỡ thành mảnh |
| Bị hạ | Thân giật nhiễu rồi tắt như màn hình CRT: co thành một vạch sáng, rồi một chấm, rồi biến mất. Vương miện rơi xuống đất, nảy hai lần rồi nằm yên |

Trùm có đòn to và chậm hơn, mini bot có đòn nhỏ và nhanh hơn. Khi địch sắp gọi lính, nó vươn lên, loé cam rồi toả một vòng sóng. Màn tổng kết chờ hiệu ứng bị hạ chạy xong mới hiện.

Lính cũng có dáng riêng: phong bì bay phấp phới, kiến con nhảy, bánh răng tích tắc, điện thoại rung, túi mua sắm lao lên, laptop zombie lê bước, khiên và cột phát sóng phập phồng, đầu rắn uốn lượn, ổ cache lơ lửng. Lính xuất hiện thì rơi xuống, nhảy vào đánh cùng chủ, trúng đòn thì bẹp lại, chết thì loé sáng và rơi, còn khi chủ bị hạ thì quay lưng bỏ chạy.

## Cấu trúc code

| File | Vai trò |
|---|---|
| `apps/web/src/cards/data/cards.json` | Định nghĩa lá bài: chi phí, hiệu ứng (`effects`), mô tả, bài học thực tế |
| `apps/web/src/cards/data/enemies.json` | Địch: máu, chuỗi ý định, mức leo thang mỗi vòng |
| `apps/web/src/cards/data/minions.json` | Lính đi kèm: máu, traffic, che chắn, hồi máu |
| `apps/web/src/cards/data/relics.json` | Relic: độ hiếm, lúc kích hoạt, hiệu ứng |
| `apps/web/src/cards/data/run.json` | Tháp: số tầng, bản đồ, hệ số địch, vàng, cửa hàng, tỉ lệ độ hiếm |
| `apps/web/src/cards/run.ts` | **Luật của tháp**: bản đồ, phần thưởng, nghỉ, sự cố, cửa hàng, relic, lên tầng |
| `apps/web/src/cards/data/battle.json` | Thiết lập trận: máu, Ops, traffic, SLO, ngân sách, hệ số sát thương, bộ bài đầu, design ban đầu |
| `apps/web/src/cards/rules.ts` | **Luật thuần**: `newBattle`, `playCard`, `planTurn`, `resolveTurn`. Không React, không DOM, RNG có seed nằm trong state |
| `apps/web/src/cards/CardBattle.tsx` | Giao diện. Gọi engine qua `compute.run` (Web Worker) |
| `apps/web/src/cards/BotAvatar.tsx` | Tạo hình địch (SVG): thân theo địch, tư thế theo ý định |
| `apps/web/src/cards/botMotion.ts` | Chuyển động của địch và lính: dáng đi, kiểu ra đòn, trúng đòn, gọi lính, bị hạ theo cấp |
| `apps/web/src/cards/ddosLord.tsx` | Bộ chuyển động riêng của Lãnh Chúa DDoS: các lớp SVG và các hàm ra đòn, trúng đòn, gọi lính |
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
