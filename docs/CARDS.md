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
  - Ổ có kiểu theo vị trí: `link` (đường gọi giữa hai node: timeout, retry, breaker, pool, retry budget), `compute` (trên service: bigger queue, load shed, Autoscaler), `front` (chèn node trước một node: Redis), `storage` (trên DB: Index, Vertical, Replica), `async` (biến lời gọi thành bất đồng bộ: Message Queue), `edge` (trước cổng vào, dùng từ giai đoạn linh kiện mới). `observe` (Quan sát, trên service chính; Microservice có 2 ổ): Metrics thấy trước ý định lượt sau (đánh lại: 2 lượt; botnet ngẫu nhiên thì hiện tỉ lệ từng chiêu), Distributed Tracing đánh dấu node sẽ là nút cổ chai trong ô Dự kiến và rút 1 lá, Alerting rút thêm lá sau lượt có node sập hoặc từ chối request, Observability Stack gộp cả ba. Đây là lá thông tin: không giảm thiệt hại trực tiếp, nên bot cân bằng không đánh giá được; nhóm APT đổi sang "Né giám sát" (lách 25% bộ lọc) khi thấy Metrics, và combo "Biết trước, cắt sớm" (Metrics + Breaker) giảm độ trễ API.
  - Bốn khung, chọn ở đầu mỗi ca (`RunState.chassis`, phase `chassis`, `chooseChassis`; save cũ không có khung thì dùng khung đầu):

    | Khung | Topology | Ổ | Ngân sách |
    |---|---|---|---|
    | Monolith | Nginx → API → DB, API → Đối tác | 3 `link`, 1 `compute`, 1 `front`, 2 `storage`, 1 `async` | $1.50/h |
    | Hướng sự kiện | Nginx → API → DB, API → Bus → Worker → Đối tác | 3 `link` (2 API → DB, 1 Worker → Đối tác), 2 `compute` (API, Worker), 1 `front`, 2 `storage`; không có `async` (bus có sẵn, địch đọc nó như một Queue qua `builtin`) | $1.60/h |
    | Microservice | Nginx → Gateway (gọi song song) → Đơn hàng → DB và Thanh toán → Đối tác | 3 `link`, 2 `compute` (mỗi service), 1 `front`, 2 `storage`, 1 `async` | $1.90/h |
    | Đọc nhiều | CDN → Nginx → API (1 instance) → DB managed, API → Đối tác | 2 `link`, 1 `compute`, 1 `front`, 1 `async`, 1 `edge`; không có `storage` | $1.30/h |

  - Mọi node cache (Redis của lá bài, CDN có sẵn) đều chịu cài đặt cache (`swr`, `normalize`) và phá cache của địch; chỉ Redis vừa lắp mới nguội. `designTraits.hasCache` tính cả CDN.
  - Lá có `fits` mà khung không có ổ hợp lệ thì không đánh được (trên tay ghi "Hệ thống không có ổ hợp lệ").
  - Linh kiện chỉ có trên ổ (giai đoạn 3):
    - **CDN** (`edge`, op `cdn`): node cache `cdn@<ổ>` trước cổng vào, luôn nóng, 300 trang (+200 mỗi cấp, tối đa 900). Mọi khung có 1 ổ `edge` trước Nginx (Đọc nhiều: trước CDN có sẵn).
    - **Lọc tại biên** (`edge`, op `edgeFilter`): lọc 20% bot mỗi cấp (tối đa 40%) chừng nào module còn lắp; `moduleCut` cộng vào `botCutNow`. Khác WAF ở chỗ gỡ module là mất, và chiếm ổ `edge` mà CDN cũng cần.
    - **Shard DB** (`storage`, op `shard`): router `db-router` trước DB và bản sao `db-2` (copy DB đã tune, $0.30/h). Sự cố DB (`chaos`, `squeeze`) chỉ đánh shard gốc. Module thêm node dựng theo thứ tự: chính sách và tune trước, rồi node chèn trước (cache, queue, CDN), shard sau cùng, nên cache luôn đứng trước cả hai shard.
    - **Service Mesh** (`link`): một module gồm timeout 300ms, retry 1 lần có backoff và budget, circuit breaker; tiết kiệm ổ đường gọi.
  - Relic mở ổ (`RelicDef.sockets`): **Thêm cổng mạng** (+1 ổ cho mỗi đường gọi), **Node pool lớn hơn** (+1 ổ cho mỗi service và DB). Sự kiện **Đợt mua sắm cuối quý** bán relic Thêm cổng mạng (op sự kiện `relic`).
  - Địch phản ứng với linh kiện mới: Bot Spam xoay IP khi gặp Lọc tại biên (lách 30%), Crawler cào URL lạ khi có CDN (phá cache 50%), API Abuser gửi query xuyên shard (DB chậm ×4).
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
- **Combo** (`data/combos.json`): bật khi đủ module, tính chung trong `statusMods`. Combo có thể đòi vị trí: `sameSocket` (cùng một ổ, tức cùng một đường gọi) hoặc `adjacent` (các ổ chạm nhau: cùng chung một node, như một service và đường gọi của nó, hay cache và DB phía sau). Trên Monolith gần như luôn thoả; trên Microservice phải lắp đúng service.
  - Queue + Autoscaler (`adjacent`): autoscale theo độ dài hàng đợi (KEDA, engine `metric: queueLength`).
  - Breaker + Retry budget (`sameSocket`): bão retry của client không còn tác dụng.
  - Timeout + Breaker (`sameSocket`): API ×0.85. Index + Replica: DB ×0.8. Redis + Queue: API ×0.9.
  - CDN + Redis (Cache nhiều tầng): API ×0.9. Load shed + Breaker (`adjacent`, Cô lập service): API ×0.85.
  - Giao diện: module đang nằm trong combo có viền vàng, di chuột thấy tên combo.
- **Địch đọc khung** (`IntentWhen.chassis`): Bầy Kiến đánh nhánh chậm nhất của Microservice (đối tác chậm ×5), Bầy Đàn gây bão sự kiện trên hệ hướng sự kiện (đối tác lỗi 35%, việc lỗi trong bus vẫn tính), Sneaker Bot ghi né cache trên hệ đọc nhiều (phá cache 80%). Biến thể theo khung đứng trước biến thể theo module.
- **Cảnh báo trên sơ đồ**: node bị ý định lượt này nhắm (`chaos`, `squeeze`, phá cache, rò rỉ, nghẽn băng thông) có dấu cảnh báo đỏ; Hotfix huỷ được thì dấu biến mất.
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

## Quản lý chi phí hạ tầng

Chi phí có ba tầng: mỗi lượt (vượt ngân sách thì mất Error Budget), mỗi trận (hóa đơn cloud trừ vào vàng) và cả ca (ít vàng thì mua được ít ở cửa hàng).

- **Chi phí theo node** (`nodeCosts`, panel `CostBreakdown` trong `Cost.tsx`): bấm vào số `$/h` trên khung hệ thống để xem mỗi node tốn bao nhiêu, chiếm bao nhiêu phần trăm, số instance (node autoscale tính theo cỡ trung bình trong lượt). Node chiếm từ 15% chi phí mà dùng dưới 30% công suất có nhãn "dư"; từ 90% là "nóng" (cắt ở đây sẽ hỏng request). Số liệu lấy từ lần chạy thử của engine, nên tính cả Spot, trạng thái và đòn của địch.
  - Mỗi lượt lưu `TurnReport.costs` và `egressPerHour`. Màn kết thúc trận (tab Tổng kết) hiện trung bình mỗi lượt (`spendByNode`); sandbox hiện lượt vừa chạy.
- **Hóa đơn cloud** (`cloudBill`, `run.bill.perDollarTurn` = 2): trong ca leo tháp, sau mỗi trận thắng trả `tổng $/h của các lượt × 2` vàng (cộng phần trả trước của Reserved). Vàng thưởng (thường 22, tinh anh 40, trùm 70) trả nợ cũ trước, rồi đến hóa đơn, thiếu thì lấy vàng tiết kiệm. Scale dư thì thắng dễ nhưng gần như hết tiền ở cửa hàng. Màn phần thưởng hiện phép tính `+thưởng − trả nợ cũ − hóa đơn = vàng giữ lại` và node tốn nhất trận (`FloorResult.bill`, `debtPaid`, `debt`, `topCost`).
- **Nợ cloud** (`RunState.debt`): hết cả vàng tiết kiệm thì phần hóa đơn còn thiếu thành nợ. Vàng kiếm được sau đó (thưởng trận, sự kiện) trả nợ trước. Còn nợ thì trận sau bắt đầu với **Tài khoản bị giới hạn**: chọn `limitOf` thứ cắt giảm, mỗi `debtPerCut` (10) vàng nợ một thứ, tối đa `maxCuts` (2). Chưa chọn xong thì không đánh được lá (`limitPending`).
  - Lựa chọn (`limitOptions`, `concede`), mỗi thứ một lần: **Bớt 1 instance** ở node đang chạy từ 2 instance; **Hạ cấp DB** (rẻ hơn 40%, nhận ít hơn 30% truy vấn cùng lúc); **Trần chi tiêu** (ngân sách trận còn 80%, `budgetMul`).
  - Không tắt node nào trong khung và không cắt ngẫu nhiên: người chơi tự chọn cái ít quan trọng nhất. Thua trận là hết ca nên nợ chỉ có ý nghĩa giữa các trận thắng.
  - Relic **Hợp đồng chiết khấu** (`billMul` 0.6): phần sử dụng của hóa đơn rẻ hơn 40%.
- **Lá FinOps:**
  - Reserved Instance (chính sách, tiêu hao): trả trước 4 vàng (nâng cấp: 2) vào hóa đơn trận, cả trận API rẻ hơn 40%, DB rẻ hơn 30% (`prepay` + `tune`).
  - Spot Instance (ổ service): +2 instance API giá 30% mỗi cấp. Đầu mỗi lượt có 25% bị thu hồi (`spotEvicted`): lượt đó không có số instance này. Tung xúc xắc ngay khi lượt mới bắt đầu, nên dự kiến và chip "Spot bị thu hồi" đã biết trước để kịp bù.
  - Rightsizing (ổ service): instance nhỏ hơn, rẻ hơn 35% nhưng nhận ít hơn 15% request cùng lúc. Lắp hai cấp thì nhân hai lần.
  - Cảnh báo chi phí (ổ quan sát): lượt vượt ngân sách mất ít hơn 4 Error Budget mỗi cấp, tối đa 12 (`costGuard`). Rút 1 lá.
  - Scale-in giờ thấp điểm (hành động, 0 Ops): lượt này API bớt 1 instance, rút 1 lá.
- **Kẻ Rút Ví** (Denial of Wallet, trận thường tầng 2): nội tại "Đánh vào ví" nhân đôi sát thương vượt ngân sách (`passive.budgetDamageMul`).
  - Request đắt: API tốn ×2.5.
  - Hút băng thông: egress `$0.50/h` mỗi 1.000 rps bot lọt vào (`Intent.egress`, cộng vào chi phí lượt qua `turnCost`). Lọc bot là giảm hóa đơn. Có CDN thì bot đổi query string để né cache.
  - Ép autoscale: dồn ×2 trong 6 giây. Nếu có Autoscaler thì nó đẻ pod theo bot: API ×1.8 và Hoá đơn tăng vọt.
  - Chờ hóa đơn: hồi máu, Hoá đơn tăng vọt 2 lượt.
- **Postmortem:** nguyên nhân "Vượt ngân sách" nêu node tốn nhất (và nếu nó đang dư công suất), phần egress, rồi gợi ý Rightsizing, Reserved, Spot, Scale-in, Cảnh báo chi phí.

## Thử thách hằng ngày

Nút "Thử thách hôm nay" ở màn chọn kiến trúc mở run của ngày (UTC): seed là FNV-1a của ngày (`dailySeed`), kiến trúc cố định theo seed (`dailyChassis`), nên mọi người cùng bản đồ, phần thưởng và bài trên tay. `RunState.daily` giữ ngày.

Hết run, màn tổng kết gửi kết quả lên server (`POST /api/cards/daily/:date`, cần đăng nhập, tối đa 10 lần/phút) rồi hiện top 20 (`GET /api/cards/daily/:date/leaderboard`, công khai).

- Điểm (`runScore` ở web, `dailyScore` ở server, cùng công thức): 100 × số ô đã qua + 1.000 nếu chinh phục tháp + 5 × Error Budget còn lại. Server không nhận điểm từ client mà tính lại từ `climbed`, `won`, `hp`.
- Server giữ kết quả tốt nhất của mỗi người mỗi ngày (bảng `CardsDailyEntry`), chỉ nhận ngày hôm nay hoặc hôm qua (run bắt đầu trước nửa đêm vẫn tính).
- Chưa chống gian lận thật: server chưa chơi lại run, nên một client sửa đổi có thể khai số ô và Error Budget tuỳ ý (trong giới hạn kiểm tra). Bước tiếp theo: tách `rules.ts` và `run.ts` thành package dùng chung, client gửi nhật ký nước đi (chọn ô, đánh lá, chọn thưởng), server phát lại bằng engine WASM bản node đã có, như cách `/levels/:id/submit` đang chấm level.

## Error Budget và deploy liều

Thanh máu của người chơi là **Error Budget**: phần lỗi còn được phép trước khi vi phạm SLO. Nó mất đi vì request người dùng lỗi, p99 vượt SLO và vượt ngân sách; hết là thua. Mọi chữ "máu" của người chơi trong giao diện đã đổi thành Error Budget (máu của địch vẫn là máu).

- **Deploy liều** (`CardDef.risk`): lá không tốn Ops mà trừ thẳng `risk` Error Budget khi đánh. Viên đỏ "−n" dưới viên Ops trên mặt lá. Không đánh được nếu Error Budget không còn hơn `risk`.
  - Hotfix thẳng prod (−4, nâng cấp −3): lượt này +3 instance API, +4 Headroom.
  - Feature flag (−2): rút 2 lá (nâng cấp: 3).
  - Chaos test (−3, nâng cấp −2, tiêu hao): thấy trước 2 lượt của botnet đến hết trận (`reveal`, cùng cơ chế với Metrics).
- **Đóng băng deploy** (`FREEZE_AT` = 25%, `deployFrozen`): dưới mức này không được đánh lá liều, và đầu mỗi lượt hồi 1 Error Budget. Thanh Error Budget hiện chip "Đóng băng deploy".

## Sandbox

`/cards/sandbox` (`CardSandbox.tsx`; có nút từ màn chọn kiến trúc và từ Wiki): thử build mà không cần run hay bộ bài.

- Chọn khung, bấm linh kiện để lắp (bấm lại để nâng cấp; ổ đầy thì chọn module để thay), bấm × để gỡ. Có cả vài lá không cần ổ nhưng tồn tại cả trận (Scale Out API, WAF, SWR, chuẩn hoá cache key, Tarpit).
- Chọn botnet, đòn và tầng (traffic của bot và người dùng theo `actScale`); ô "Cache đã ấm" bỏ lượt khởi động của Redis.
- "Chạy 1 lượt" chạy engine thật trên build hiện tại (Error Budget và máu địch đặt rất cao để không kết thúc). Sơ đồ hiện tải cao nhất của từng node trong lượt; bảng bên phải giữ mọi lượt đã chạy để so sánh giữa các build, kèm postmortem.

Build được lưu dưới dạng danh sách bước (`{ card, socket, replace }`, thay theo id lá chứ không theo uid) và dựng lại từ đầu mỗi lần đổi, nên gỡ một module ở giữa vẫn ra đúng hệ thống. Hai hàm luật dành cho sandbox: `forceIntent` (ép địch dùng một đòn, chọn biến thể theo build hiện tại) và `uninstall`.

## Di trú kiến trúc

Từ tầng 2 có thể gặp sự cố "Kế hoạch tái kiến trúc": chuyển run sang một khung khác (`migrateTarget`, cố định theo seed và tầng, luôn khác khung hiện tại), hoặc giữ nguyên và nhận 35 vàng. Màn sự cố đặt hai khung cạnh nhau để so sánh.

Di trú theo kiểu strangler fig (`MIGRATION` trong `rules.ts`):

- Trong 2 trận kế tiếp (`RunState.migrating`), hệ cũ và hệ mới chạy song song. Topology vẫn là của khung cũ, nhưng có thêm ổ: với mỗi kiểu ổ mà khung mới có nhiều hơn, thêm một nửa phần chênh (làm tròn lên) vào ổ đầu tiên cùng kiểu (`migrationRoom`). Đổi lại API chậm ×1.15 và chi phí ×1.15 (đọc trong `statusMods`, nên Rollback không gỡ được).
- Thắng trận thứ 2 thì `run.chassis` đổi hẳn; nhật ký ghi "chuyển sang …". Thua giữa chừng thì run kết thúc như thường.
- Trên thanh tiến độ có huy hiệu "Di trú sang …: còn n trận", trong trận có huy hiệu "→ …" cạnh tên hệ thống.

Sự cố có `minAct` để chỉ xuất hiện từ một tầng; `{chassis}` trong tiêu đề, nội dung và lựa chọn được thay bằng tên khung đích (`eventText`).

## Postmortem

Thua một trận (hoặc mở tab Postmortem ở màn kết thúc trận) sẽ thấy vì sao hệ thống sập:

- Ba biểu đồ nhỏ theo lượt: p99 (vạch SLO), tỉ lệ lỗi, chi phí (vạch ngân sách). Lượt tệ nhất được đánh dấu.
- Tối đa 3 nguyên nhân, xếp theo Error Budget đã mất: DB/service/đối tác quá tải, node sập, bot lọt, vượt SLO, vượt ngân sách.
- Mỗi nguyên nhân kèm lá nên đánh: viền xanh là lá có trong bộ bài, viền đứt là lá chưa có.
- Một dòng bài học, lấy từ `lesson` của lá trả lời nguyên nhân chính.

Mỗi `TurnReport` giữ `hot`: 3 node căng nhất của lượt (đỉnh utilization, có sập không, số request bị từ chối), tính từ các cửa sổ của engine bằng `hotNodes`. `postmortem()` trong `postmortem.ts` là hàm thuần chỉ đọc report, nên chạy được cả trên trận đã lưu: `RunState.lastFight` giữ report của trận thua để màn kết thúc ca cũng hiện postmortem.

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

Thêm lá bài: thêm một mục vào `cards.json` với các `effects` có sẵn (`scale`, `cache`, `edge`, `rateLimit`, `waf`, `attack`, `headroom`, `draw`, `ops`, `hotfix`, `cdn`, `edgeFilter`, `shard`…). Lá hạ tầng nên có `fits` để lắp vào ổ. Nếu cần hiệu ứng mới, thêm một nhánh trong `apply()` ở `rules.ts`.

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
