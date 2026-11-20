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
- Redis là cache theo key thật của engine (`CacheModel`: 10k key, phân bố zipf, LRU theo dung lượng, TTL). Hit rate do engine tính chứ không phải con số cố định:
  - Lượt vừa đặt cache thì cache còn nguội.
  - Đánh lại lá Redis tăng dung lượng (+1k key, tối đa 4k), giúp cache chịu phá key tốt hơn.
  - Địch "phá cache" (`cacheBust`) làm phẳng phân bố key bằng URL ngẫu nhiên; lá **Chuẩn hoá cache key** chỉ còn để lọt 1/3.
  - Địch rút ngắn TTL (`cacheTtlMs`) kéo hit rate xuống khoảng 50% bất kể dung lượng; chỉ **Stale-while-revalidate** cứu được.
- Một số ý định đọc build của bạn lúc bắt đầu lượt (`variants` + `when`, xem `designTraits`):
  - Có cache thì gặp Cache Buster hoặc hết hạn đồng loạt.
  - API từ 4 instance thì gặp Denial of Wallet (chi phí API ×3).
  - WAF từ 25% thì bot chuyển sang proxy dân cư.
  - Retry mà không có budget thì client retry chồng lên.

  Biến thể được chọn một lần khi bắt đầu lượt, nên đánh bài giữa lượt không làm ý định đổi, và ô Dự kiến vẫn đúng.
- Slowloris giữ slot API (`squeeze`), nên cache và index không giúp gì; cần thêm instance, Burst hoặc Hotfix.
- Rò Rỉ Bộ Nhớ tích tụ qua các lượt (`leak`): API chậm dần cho tới khi pod tự restart hoặc bạn đánh **Rolling restart** (lượt đó thiếu 1 instance). Hotfix không chữa được.
- Khuếch Đại DNS làm nghẽn đường truyền bằng phản hồi lớn (`bandwidth`); scale không giúp, chỉ lọc bot mới giảm được tải.
- **Hiệu ứng theo lượt** (status, `data/statuses.json`). Mỗi status có `turns` (số lượt còn lại), `stack: refresh | add`, và `mods`. `statusMods(content, state)` gộp mọi status đang có; đây là chỗ duy nhất luật chơi đọc status, nên ô Dự kiến vẫn đúng.
  - Lá bài cho buff (`op: status`) có hiệu lực ngay lượt đánh, và lượt đó tính là 1.
  - Ý định địch gây debuff (`inflict`) có hiệu lực từ lượt sau, đủ N lượt.
  - Hotfix chỉ huỷ sự cố trong lượt, không gỡ debuff. **Rollback** (`op: cleanse`) gỡ mọi debuff; Hotfix nâng cấp gỡ 1.
  - Debuff: Hàng xóm ồn ào (API −1 instance), Hết CPU credit (API chậm ×1.4), DB nghẽn kéo dài (DB chậm ×1.5), Hoá đơn tăng vọt (chi phí ×1.5), Kiệt sức on-call (−1 Ops mỗi lượt).
  - Buff: Chặn theo vùng (lá Geo-block, bot ×0.7), Tarpit (request bot bị chặn gây sát thương ×1.5).
- **Khung và ổ cắm** (`data/chassis.json`, `CardDef.fits`, `state.modules`). Mỗi trận dựng trên một khung (`ChassisDef`): topology gốc, danh sách ổ cắm (`sockets`) và bí danh vai trò (`aliases`: node nào là `api`, `db`, `ext`). Nội dung (ý định địch, status, lá scale/tune) chỉ gọi tên vai trò, nên chạy được trên mọi khung.
  - Ổ có kiểu theo vị trí: `link` (đường gọi giữa hai node: timeout, retry, breaker, pool, retry budget), `compute` (trên service: bigger queue, load shed, Autoscaler), `front` (chèn node trước một node: Redis), `storage` (trên DB: Index, Vertical, Replica), `async` (biến lời gọi thành bất đồng bộ: Message Queue), `edge` (trước cổng vào, dùng từ giai đoạn linh kiện mới).
  - Khung Monolith: `API → DB` 3 ổ `link`, `API` 1 ổ `compute`, `Trước DB` 1 ổ `front`, `DB` 1 ổ `storage`, `API → Đối tác` 1 ổ `async`.
  - Lá có `fits` lắp vào một ổ hợp lệ thay vì sửa thẳng design. Hiệu ứng lấy đích từ ổ: `tune`, `scale`, `autoscale` lên node của ổ, `edge` lên đường gọi của ổ, `cache` chèn trước node của ổ, `queue` chèn vào lời gọi của ổ. `designOf(content, state)` dựng design từ khung cộng mọi module; module thêm node (`front`, `async`, `edge`) dựng sau cùng, nên policy trên đường gọi đi theo lời gọi vào node mới.
  - `placements(content, state, uid)` liệt kê các nước đi `{ socket, replace? }`: mọi ổ hợp lệ còn chỗ, và mỗi module của ổ hợp lệ đã đầy. `playCard(..., { socket, replace })` lắp theo nước đó; không chỉ định thì lắp vào ổ trống đầu tiên. Đánh lại lá đã lắp thì module lên cấp (Redis +1k key mỗi cấp; tune áp thêm một lần), không tốn ổ.
  - Giao diện: ổ vẽ ngay trên sơ đồ (chip dưới node, khung nét đứt "+ Cache" / "+ Queue" trong đường đi, dải ổ của đường gọi dưới sơ đồ). Kéo lá có `fits` thì ổ hợp lệ sáng lên; thả lên một module trong ổ đầy là thay module đó.
  - Scale API, WAF và các lá Hành động không cần ổ.
- **Đối tác** (`ext`): mỗi request, sau khi đọc dữ liệu, API còn gọi đồng bộ một dịch vụ đối tác (thanh toán, email). Một số địch làm đối tác chậm (`chaos.node: 'ext'`), giữ slot API.
  - **Message Queue** đặt hàng đợi giữa API và đối tác: API trả lời ngay, worker gọi đối tác sau. Việc lỗi (`asyncErr`) hoặc còn tồn (`backlog`) cuối lượt tính là request lỗi theo phần của người dùng thật.
  - **Autoscaler (HPA)** gắn `autoscale` của engine vào API: thêm tối đa 4 pod khi bận, mỗi pod mất 3s mới nhận tải, chỉ tính tiền lúc chạy.
- **Mặt trái của từng module**: điều kiện `hasModule` trong biến thể ý định. Địch khai thác đúng thứ bạn đã lắp:
  - Autoscaler → **Spike chớp nhoáng** (`burst`: bot dồn ×3 trong 2s, pod mới cần 3s).
  - Message Queue → **Poison message** (đối tác lỗi 35%, việc lỗi trong hàng đợi vẫn tính).
  - Read Replica → **Replica tụt lại** (DB nghẽn kéo dài 3 lượt).
  - Circuit Breaker → **Lỗi chập chờn** (DB lỗi 30%, breaker mở và chặn cả người thật).
  - Index → **Lật trang sâu** (OFFSET lớn, index không cứu).
  - Redis → Cache Buster, TTL ngắn (từ giai đoạn 1).
- **Combo** (`data/combos.json`): bật khi đủ module, tính chung trong `statusMods`.
  - Queue + Autoscaler: autoscale theo độ dài hàng đợi (KEDA, engine `metric: queueLength`).
  - Breaker + Retry budget: bão retry của client không còn tác dụng.
  - Timeout + Breaker: API ×0.85. Index + Replica: DB ×0.8. Redis + Queue: API ×0.9.
- **Bot thích nghi** (`battle.adapt`): lượt nào chặn từ `at` bot trở lên thì cộng 1 tầng `adapted` (lách thêm bộ lọc mỗi tầng, tối đa `maxStacks`). Ngừng lọc mạnh `turns` lượt thì hết. Luật này để lọc bot không còn vừa là phòng thủ vừa là sát thương miễn phí mãi.
- Circuit breaker không có fallback biến quá tải thành sập toàn bộ.
- Thêm Read Replica làm vượt ngân sách.
- Retry flood khuếch đại lỗi.

## Tháp: xây bộ bài

Bộ khởi đầu không có hạ tầng tối ưu (Redis, Index). Trước trận đầu, người chơi chọn 1 trong `run.startPick` (Redis, Index, Replica), nên có một trục hạ tầng nhưng phải chọn trục nào. Người dùng thật tăng theo tầng (`run.actScale.legit`: tầng 2 ×1.5, tầng 3 ×2; trận khởi động giữ ×1), ngân sách giữ nguyên: hạ tầng đủ ở tầng 1 sẽ thiếu ở tầng 3.

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
| Black Friday | 2 | Người dùng thật ×1.3 |
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

Lính có thân nhỏ riêng (`MinionAvatar`, thân và chuyển động trong `moves/minions.tsx`): phong bì, kiến con, bánh răng đồng hồ, điện thoại, túi mua sắm, laptop đầu lâu, khiên mặt nạ, đầu rắn, ổ cache nứt nhỏ giọt, cột phát sóng.

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

Mỗi địch có bộ chuyển động riêng (`moves/`, keyframes trong `moves/moves.css`): dáng đứng yên và vài đạo cụ tự chuyển động, đòn đánh đặc trưng, phản ứng khi trúng đòn, khi gọi lính và khi bị hạ. Phần nào bộ riêng bỏ trống thì dùng chuyển động chung theo cấp (`botMotion.ts`). Phần nào cũng chỉ là minh hoạ; luật vẫn do `rules.ts` quyết.

| Địch | Đứng yên | Ra đòn | Trúng đòn | Bị hạ |
|---|---|---|---|---|
| Script Kiddie | Gật gù theo nhạc, nốt nhạc bay ra từ tai nghe | Gõ phím loạn xạ, "Ctrl+V", ném đầu lâu script chép | Mũ văng lên rồi rơi lại | "RAGE QUIT", bật nhảy lộn ra sau |
| Bot Ping | Nghiêng đầu lắng nghe, ăng-ten phát vòng sóng | Ăng-ten nạp sáng, bắn ba vòng ping | Mất gói: chớp tắt, đèn đỏ | Đèn đỏ rồi tắt, chìm xuống, "Request timed out." |
| Bot Spam Form | Lạch bạch, cờ thư phất phơ | Ngả người, xả cả chùm phong bì | Cờ rơi xuống rồi bật lên | Cờ rơi, đổ chúi về trước, thư bung ra |
| Bot Kiểm Tra Uptime | Bước theo nhịp tim, đường nhịp chạy trên màn | Nhịp vọt lên, xung bay ra khỏi màn hình | Rung tim loạn nhịp, đèn đỏ | Đường nhịp thẳng tắp, khuỵu xuống, "UPTIME 0%" |
| Botnet Bầy Kiến | Bước ngang lật đật, râu giật giật | Chồm lên, một hàng kiến bò tới | Cuộn tròn, cụp râu | Lật ngửa, chân quơ quơ |
| Bão Retry | Mây phồng xẹp, mưa phùn | Tối sầm, sét đánh ba lần (thử, thử lại, thử lại) | Mây bung ra, mưa xối | Mưa trút hết rồi bốc hơi |
| Đàn Thundering Herd | Cào móng, phì hơi từ mũi | Cúi đầu cào đất hai lần rồi húc tới trong bụi | Lắc đầu, khoen mũi đung đưa | Khuỵu gối, ngã nghiêng, sao bay quanh đầu |
| Crawler Tham Lam | Nhún trên sợi tơ, chân co duỗi | Tụt xuống, bắn một sợi tơ có lưới | Rút vọt lên rồi thả xuống | Đứt tơ, rơi ngửa, co chân |
| Rò Rỉ Bộ Nhớ | Phình dần cho tới khi bị dọn rác thì co lại | Phình to, "99% RAM" đỏ, phun bit | Đồng hồ RAM giật, vũng nước bắn | "OOM KILLED": phình đỏ rồi nổ thành bit |
| Cron Nửa Đêm | Rung từng hồi như chuông báo | Búa gõ chuông điên cuồng, sóng âm bay tới | Chuông lệch, màn hình mất giờ | Lò xo bật ra, chuông văng, úp mặt xuống |
| Scraper Đối Thủ | Lăn qua lăn lại, bánh xe quay | Chĩa vòi, hút sạch nhãn giá và "$" về phía mình | Vòi giật, bụi phụt ra sau | Túi quá tải, nhãn giá bung ra, bánh xe dừng |
| Credential Stuffer | Rón rén, chùm chìa leng keng | Thử từng chìa: sai, sai, sai, đúng | Túi tiền tuột tay | Còi hú, giơ tay, lủi đi |
| Slowloris | Ôm dây cáp đung đưa thật chậm | Lấy đà rất lâu, vồ uể oải, kết nối treo bò dọc dây | Một lúc sau mới giật mình | Cuộn lại ngủ, "Zzz" |
| Bot Săn Sneaker | Chạy tại chỗ, vệt tốc độ chạy | Lùi lấy đà rồi phóng tới để lại bóng mờ | Chống gót, trượt | Bị đá tung lên rồi mất hút |
| Trại Click Farm | Rung từng hồi, các màn hình sáng lần lượt | Màn hình loé thành sóng, xả con trỏ chuột | Màn hình tắt gợn sóng rồi sáng lại | Mất điện: tắt từng màn hình, giá đỡ võng xuống |
| Kẻ Lạm Dụng API | Nhún như gói JSON, ngoặc nhọn phập phồng | Kẹp ngoặc rồi bung ra, xả GET/POST | Ngoặc kẹp chặt, chìa khoá xoay | "401 REVOKED": chìa rơi, ngoặc rời ra |
| Botnet Camera IoT | Quay qua quay lại trên giá | REC nháy, tia quét đỏ, router xả gói tin | Nhiễu sóng | Bảng màu "NO SIGNAL", đèn tắt, gục trên giá |
| Khuếch Đại DNS | Giật lùi theo mỗi tiếng hét | Quay ngược loa về phía bạn, hít vào rồi thổi | Hú rít, sóng đỏ răng cưa | Sóng tắt, xẹp xuống, "×0" |
| Sâu Zero-day | Co duỗi như sâu đo, sóng chạy qua các đốt | Chồm lên, cắn hai phát, phun mã khai thác | Gợn sóng từ đầu tới đuôi | Rã từng đốt từ đuôi, đầu gục sau cùng |
| Băng Tống Tiền | Lắc như có người đang thử khoá, tờ giấy phất phơ | Sập khoá, quăng sợi xích | Khoá bật hé rồi sập lại | Chìa vào ổ xoay, khoá bật mở, tờ đòi tiền bay mất |
| Nhóm APT | Lẩn khuất, lúc mờ lúc rõ | Biến mất, hiện sát mặt chém một nhát, biến mất | Tan thành khói rồi tụ lại | Tan thành khói, chỉ còn con dao rơi xuống |
| Botnet Hydra | Hai đầu bên lắc lư lệch nhịp | Ba đầu lần lượt mổ, phun nọc | Hai đầu bên giật ra | Từng đầu gục xuống, rồi thân chùng |
| Kẻ Đầu Độc Cache (trùm) | Lướt trên sương độc, bình sủi bọt, mặt nạ phả khói | Ném bình thành vòng cung, vỡ toé độc | Ho sặc khói | Chảy tan thành vũng, bình rơi lăn đi |
| Black Friday (trùm) | Đu trên sợi dây, đồng hồ đếm ngược | Lật mặt, giá nháy, đàn túi mua sắm nảy tới | Xoay mạnh, xu rơi lả tả | Bị đóng dấu "SOLD OUT", đứt dây rơi xuống |

Ai gọi lính thì có cách gọi riêng: Bot Spam dựng cờ bắn phong bì lên, Bầy Kiến rung râu cho kiến bò lên từ đất, Cron nhả bánh răng, Click Farm bật ra thêm một điện thoại, Hydra mọc đầu mới, Kẻ Đầu Độc Cache đổ bình thành vũng độc sủi bọt, Black Friday quét mã vạch "ting" một tiếng. Pha 2 của Kẻ Đầu Độc Cache đổi độc sang tím, khói dày hơn; Black Friday hạ giá còn -99%, đèn còi chớp.

Cấp của địch thêm một lớp chung:

| Cấp | Đứng yên |
|---|---|
| Mini bot (trận khởi động) | Nhỏ hơn, nhịp nhanh hơn, sao lấp lánh |
| Tinh anh | Hai viền vàng xoay ngược nhau, thỉnh thoảng gồng người |
| Trùm tầng | Thở chậm, bóng đổ dưới chân, sóng chấn lan trên mặt đất (pha 2 nhanh hơn, sóng màu lửa) |

Địch mới chưa có bộ riêng dùng chuyển động chung: lơ lửng, lao tới, và phản ứng trúng đòn / bị hạ theo cấp (mini bot bị hất văng, trùm gần như không lùi).

Lãnh Chúa DDoS, trùm cuối, có bộ chuyển động công phu nhất (`moves/ddosLord.tsx`):

| Lúc | Chuyển động |
|---|---|
| Đứng yên | Bay lơ lửng, áo choàng gợn sóng. Vương miện bay tách khỏi đầu, có ánh sáng rỉ ra ở giữa. Mắt thứ ba thường híp lại, thỉnh thoảng mở ra nhìn. Một vòng gói tin xoay quanh người, nửa sau chạy sau lưng, nửa trước chạy trước mặt |
| Ra đòn "Flood" | Ngả người lấy đà, mắt thứ ba nạp sáng rồi bắn một tia kèm chùm gói tin về phía hệ thống của bạn |
| Trúng đòn | Khiên proxy lục giác hiện ra đỡ đòn, gợn sóng chạy dọc các ô, vương miện chao đi |
| Gọi lính | Vương miện bay lên xoay một vòng, cổng triệu hồi mở dưới đất, vòng lính quay nhanh hẳn |
| Pha 2 | Bùng một vòng sóng đỏ khi chuyển pha. Vương miện nứt, nghiêng và rực đỏ. Mắt mở to liên tục, gói tin chạy nhanh gấp đôi, thân thỉnh thoảng nhoè thành hai bản đỏ và xanh. Khi trúng đòn, khiên vỡ thành mảnh |
| Bị hạ | Thân giật nhiễu rồi tắt như màn hình CRT: co thành một vạch sáng, rồi một chấm, rồi biến mất. Vương miện rơi xuống đất, nảy hai lần rồi nằm yên |

Khi địch gọi lính, một vòng sóng cam toả ra quanh nó. Màn tổng kết chờ hiệu ứng bị hạ chạy xong mới hiện.

Lính cũng có bộ chuyển động riêng (`moves/minions.tsx`). Lính xuất hiện thì rơi xuống; khi chủ bị hạ thì quay lưng bỏ chạy.

| Lính | Đứng yên | Ra đòn | Trúng đòn | Bị hạ |
| --- | --- | --- | --- | --- |
| Tin Rác | Bay phấp phới | Nắp mở, ba lá thư nhỏ bay ra | Chấm "!" phồng to | Vo viên rồi bị ném đi |
| Kiến Thợ | Nhảy, râu ngọ nguậy | Quay đầu, chạy tới cắn "phập" | Bị lật nghiêng, chân quẫy | Lật ngửa, chân đạp rồi co lại |
| Job Cron | Tích tắc | Kim quay vèo tới 00:00, chuông reng toả vòng | Bánh răng kẹt, kim giật | Răng cưa văng ra, kim quay lỏng |
| Điện Thoại Click | Rung, vòng chạm lan | Nghiêng tới, gõ liên tục, "+1" bay ra | Màn hình nứt loé | Màn tối, ngã úp mặt |
| Bot Đầu Cơ | Lao tới lui | Há miệng nuốt mấy hộp hàng, phình ra | Rơi một đồng xu | Xẹp như túi rỗng, hàng đổ ra |
| Máy Tính Ma | Lê bước | Đầu lâu giật nhiễu, mã 0/1 phun ra | Màn hình nhiễu | Màn xanh ":(" rồi gập máy |
| Proxy Che Chắn | Phập phồng | Húc khiên, bắn sóng xung kích | Gợn sóng, tia lửa bật ra (khiên không lùi) | Nứt đôi, mặt nạ rơi |
| Đầu Hydra | Uốn lượn, lè lưỡi | Ngửa ra rồi mổ tới, phun nọc | Giật lùi, nheo mắt | Gục xuống đất, nhắm mắt |
| Node Nhiễm Độc | Lơ lửng, nhỏ giọt | Bật nắp, giọt độc bay vòng cung | Vết nứt loé, giọt độc chảy | Nắp bật, chảy thành vũng |
| Trạm C2 | Sóng nhấp nháy | Đèn rực sáng, sóng tín hiệu bay ra | Mất sóng, đèn chập chờn | Đèn tắt, cột đổ |

## Cấu trúc code

| File | Vai trò |
|---|---|
| `apps/web/src/cards/data/cards.json` | Định nghĩa lá bài: chi phí, hiệu ứng (`effects`), mô tả, bài học thực tế |
| `apps/web/src/cards/data/enemies.json` | Địch: máu, chuỗi ý định, mức leo thang mỗi vòng |
| `apps/web/src/cards/data/minions.json` | Lính đi kèm: máu, traffic, che chắn, hồi máu |
| `apps/web/src/cards/data/relics.json` | Relic: độ hiếm, lúc kích hoạt, hiệu ứng |
| `apps/web/src/cards/data/run.json` | Tháp: số tầng, bản đồ, hệ số địch, vàng, cửa hàng, tỉ lệ độ hiếm |
| `apps/web/src/cards/run.ts` | **Luật của tháp**: bản đồ, phần thưởng, nghỉ, sự cố, cửa hàng, relic, lên tầng |
| `apps/web/src/cards/data/battle.json` | Thiết lập trận: máu, Ops, traffic, SLO, ngân sách, hệ số sát thương, bộ bài đầu |
| `apps/web/src/cards/data/chassis.json` | Khung hệ thống: topology gốc, ổ cắm, bí danh vai trò |
| `apps/web/src/cards/rules.ts` | **Luật thuần**: `newBattle`, `playCard`, `planTurn`, `resolveTurn`. Không React, không DOM, RNG có seed nằm trong state |
| `apps/web/src/cards/CardBattle.tsx` | Giao diện. Gọi engine qua `compute.run` (Web Worker) |
| `apps/web/src/cards/Infra.tsx` | Sơ đồ hệ thống vẽ từ đồ thị design (`layoutOf`), ổ cắm và module, đích thả của lá có `fits` |
| `apps/web/src/cards/BotAvatar.tsx` | Tạo hình địch (SVG): thân theo địch, tư thế theo ý định |
| `apps/web/src/cards/moves/minions.tsx` | Thân và chuyển động riêng của từng loại lính |
| `apps/web/src/cards/botMotion.ts` | Chuyển động chung của địch và lính: dáng đi, kiểu ra đòn, trúng đòn, gọi lính, bị hạ theo cấp; chuyển sang bộ riêng nếu địch có |
| `apps/web/src/cards/moves/` | Bộ chuyển động riêng từng địch (`kit.tsx` mô tả cấu trúc `MoveSet`; `warmup`, `floor1`–`floor3`, `bosses`, `ddosLord`), keyframes trong `moves.css` |
| `apps/web/src/cards/CardWiki.tsx` | Trang wiki `/cards/wiki`: chỉ số bot và lính theo tầng, xem thử animation, thẻ bài (cả bản nâng cấp), bảo vật |
| `apps/web/scripts/cards-balance.mjs` | Bot tự chơi nhiều trận bằng engine thật để cân bằng |

Thêm lá bài: thêm một mục vào `cards.json` với các `effects` có sẵn (`scale`, `cache`, `edge`, `rateLimit`, `waf`, `attack`, `headroom`, `draw`, `ops`, `hotfix`). Nếu cần hiệu ứng mới, thêm một nhánh trong `apply()` ở `rules.ts`.

### Cân bằng

```bash
pnpm balance:cards            # 20 trận mỗi chiến thuật (idle, random, greedy)
pnpm balance:cards 50 --log   # in diễn biến từng lượt
pnpm balance:cards 30 --run   # leo cả tháp: tỉ lệ vượt từng tầng và nơi bot chết
pnpm balance:cards 40 --run --by-enemy  # thêm tỉ lệ thắng, máu mất, số lượt theo từng địch
pnpm balance:cards 24 --run --only=greedy  # chỉ chạy một chiến thuật; trận quá 30 lượt tính là thua do giằng co
pnpm balance:cards 20 --each               # từng địch thường và tinh anh, không nhân hệ số, 80 máu
pnpm balance:cards 40 --run --jobs=4       # chia seed ra 4 tiến trình (bot forecast chạy engine ~10 lần mỗi lá)
BALANCE_RUN='{"fight":{"hp":0.6}}' pnpm balance:cards 20 --run  # thử hệ số độ khó mà không sửa run.json
```

Chiến thuật: `idle`, `random`, `greedy` (người chơi hợp lý; giữ bộ bài mỏng sau 18 lá), `rut` (bộ bài lối mòn cũ của [CARDS-RESEARCH.md](CARDS-RESEARCH.md): có sẵn Redis và Index, thêm 2 Scale API và 2 Rate limit, không nhận thêm lá; đây là mốc khó nhất), `thin` (bộ khởi đầu hiện tại cộng Redis, không nhận thêm lá), `cacheOnly` và `filterOnly` (chỉ đi một trục). Các bot thông minh biết chọn module để gỡ khi các ổ hợp lệ đều đầy. Nếu một chiến thuật đơn trục vượt tháp thường xuyên thì game lại có lối chơi thống trị.

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

Phân tích vì sao thẻ Hạ tầng dễ thắng và lặp lại (cache, rate limit, Redis), cùng đề xuất cơ chế mới: xem [CARDS-RESEARCH.md](CARDS-RESEARCH.md).

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
