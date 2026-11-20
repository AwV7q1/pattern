# Nghiên cứu: phá lối mòn thẻ Hạ tầng trong game thẻ bài On-Call

Tài liệu nghiên cứu, chưa phải spec. Mục tiêu: tìm vì sao phần hạ tầng của game thẻ bài (`/cards`, xem [CARDS.md](CARDS.md)) dễ thắng và lặp lại "cache + rate limit + Redis", rồi đề xuất cơ chế để mỗi trận là một câu hỏi kiến trúc khác nhau. Mọi đề xuất đều ghi rõ map vào trường nào của `rules.ts`, JSON hay engine, và độ khó cài đặt (**S**: chỉ JSON, **M**: sửa `rules.ts`, **L**: sửa engine Rust).

## 1. Chẩn đoán

Các điểm dưới đây đã đối chiếu với code ở commit hiện tại.

### 1.0 Số liệu đo

**Leo tháp** (`pnpm balance:cards 30 --run`, 30 run mỗi chiến thuật):

| Chiến thuật | Vượt T1 | Vượt T2 | Vượt cả tháp | Trận thường: thắng / máu mất | Tinh anh | Trùm |
|---|---:|---:|---:|---|---|---|
| idle | 0% | 0% | 0% | 0% / -80 | – | – |
| random | 50% | 10% | 0% | **99% / -5** | 67% / -50 | 47% / -62 |
| greedy | 77% | 43% | 17% | **98% / -4** | 87% / -36 | 71% / -54 |

Trận thường gần như không có rủi ro, kể cả khi đánh ngẫu nhiên: mất trung bình 4–5 máu trên 80. Độ khó của tháp dồn hết vào tinh anh và trùm, nên phần lớn thời gian chơi không có quyết định thật.

**Bộ bài "lối mòn"**: bộ bài đầu thêm 1 Rate limit và 1 Scale API, chỉ đánh theo thứ tự cố định Redis → Scale API → Index → Timeout → Rate limit → Vá nóng → Buffer, không bao giờ nhận thêm lá. 20 seed mỗi địch, 80 máu, chưa nhân hệ số tầng:

| Địch | Thắng | Máu mất TB |
|---|---:|---:|
| 12 địch thường của cả 3 tầng | **100%** (cả 12) | 1.6 – 20.3 |
| Tinh anh T1–T2 (Rò Rỉ Bộ Nhớ, Cron Nửa Đêm, Trại Click Farm, Kẻ Lạm Dụng API) | **100%** | 17 – 30 |
| Nhóm APT | 10% | 78 |
| Botnet Hydra | 0% | 80 |

Một kịch bản 7 lá không đổi thắng mọi địch thường, kể cả địch tầng 3, và 4/6 tinh anh. Chỉ địch có lính che chắn/hồi máu (APT, Hydra) chặn được nó, tức là cơ chế lính chứ không phải câu hỏi hạ tầng. Script đo nằm ở phụ lục.

### 1.1 Design là một đường thẳng cố định

`battle.json` dựng `client → lb → api → db`; lá Redis chèn `cache` vào giữa thành `api → cache → db` (`addCache` trong `rules.ts`). Mọi lá Chính sách (`timeout`, `backoff`, `breaker`, `pool`, `retry_budget`) đều `Object.assign` vào **đúng một edge** `apiOut(design)`. Hệ quả:

- Không có câu hỏi "đặt ở đâu": chỉ có "có hay không".
- Không có nhánh để địch nhắm vào: mọi request đi cùng một đường, nên một cache hit rate cao che được gần như mọi thứ.

### 1.2 Hạ tầng là khoản đầu tư một lần, không mất giá

`scale`, `cache`, `tune` sửa thẳng `state.design` và giữ đến hết trận. Chi phí duy nhất là `$/h` vượt `budgetPerHour` (1.5), mà design ban đầu tốn khoảng 0.73/h (LB 0.03 + 2 API × 0.1 + DB 0.5) nên còn dư chỗ cho Redis (0.15) và thêm một instance API (0.1). Chơi Redis + Scale API trong 1–2 lượt đầu là đủ cho phần lớn trận. Không có:

- hao mòn (cache hết hạn, cold start sau deploy, instance mới khởi động chậm),
- chi phí vận hành theo lượt (Ops, thẻ nợ),
- phản đòn nhắm riêng vào hạ tầng đã xây.

### 1.3 Địch có ít kiểu phản đòn, và phần lớn không đọc build

Thống kê 129 ý định của 25 địch trong `enemies.json` (một ý định có thể có nhiều trường):

| Kiểu ý định | Số ý định | Đánh vào |
|---|---:|---|
| Chỉ có `botRps` | 33 | Tải thô |
| `heal` | 23 | Máu địch |
| `clientRetries` | 20 | Retry ở client |
| `chaos` latency (API 7, DB 11) | 18 | Node cố định |
| `cacheHitScale` | 14 | Cache |
| `summon` | 9 | Thêm lính (thêm tải) |
| `addCards` (thẻ nợ) | 9 | Bộ bài |
| `chaos` errors (API 3, DB 3) | 6 | Node cố định |
| `wafStrip` / `bypass` / `drainOps` | 5 / 4 / 4 | Bộ lọc, Ops |

Không có ý định nào nhắm vào LB, mạng/băng thông, connection pool, đường ghi, queue, chi phí, hay phản ứng theo việc người chơi đã xây gì. `cacheHitScale` là phản đòn duy nhất chống cache, và nó chỉ nhân hit rate đi một lượt.

### 1.4 Chủ đề địch không khớp cơ chế

Tên địch hứa hẹn một bài học, nhưng cơ chế đều quy về "API chậm ×N" hoặc "API lỗi N%":

| Địch | Ý định | Cơ chế hiện tại | Engine đã có thứ khớp hơn |
|---|---|---|---|
| Slowloris | "Giữ kết nối", "Cạn connection" | `chaos api latency 2.5`, `errors 0.06` | `maxInFlight`, `poolSize`, `poolTimeoutMs`: giữ kết nối thật, cạn pool thật |
| Rò Rỉ Bộ Nhớ | "GC dừng hình" | `chaos api latency 2.5` | `gcPauseMs`, `gcEveryRequests`: p50 thấp, p99 vọt |
| Khuếch Đại DNS | "Nghẽn đường truyền" | `chaos api errors 0.12` | `requestKb`, `responseKb`, `bandwidthMbps`: nghẽn đường truyền trước cả server |
| Kẻ Đầu Độc Cache | "Key rác" | `cacheHitScale 0.5` | `CacheModel` (`keys`, `zipf`, `capacity`): key rác đẩy key thật ra khỏi LRU |
| Kẻ Lạm Dụng API | "Lật trang vô tận" | `cacheHitScale 0.3` | `callsPerRequest`: N query mỗi request |

Khi cơ chế giống nhau, lời giải cũng giống nhau: thêm cache, thêm instance, chặn bot.

### 1.5 Điều kiện thắng nghiêng về lọc bot

Sát thương lên địch đến từ lá Phản công và `botBlockedRps × 10s / blockedPerDamage`. Rate limit, Captcha, WAF vì thế vừa là phòng thủ (giảm tải) vừa là tấn công (gây sát thương). Không có cái giá nào cho việc lọc quá tay: lọc 90% bot không làm người dùng thật bị chặn nhầm.

### 1.6 Không có trạng thái giữa các lượt

Mỗi lượt là một mô phỏng mới từ design (đã ghi trong "Giới hạn của prototype"). Không có cache nóng/nguội, backlog queue, breaker đang mở, autoscaler đang khởi động. Vì thế những bài học hay nhất về hạ tầng (thundering herd sau khi cache sập, retry storm kéo dài, autoscale đến muộn) không thể xuất hiện.

### 1.7 Engine có nhiều hơn game đang dùng

Game chỉ dùng: `instances`, `hitRate`, `latencyP50/P99Ms`, `concurrency`, `queueSize`, `costPerHour`, và trên edge: `timeoutMs`, `retries`, `backoffMs`, `jitter`, `circuitBreaker`, `poolSize`, `retryBudget`. Engine (`crates/engine/src/model.rs`) còn có:

| Tính năng engine | Trường | Game dùng chưa |
|---|---|---|
| Node Queue (ack ngay, xử lý sau) | `kind: queue` | Chưa |
| Cache theo key | `cache: { keys, zipf, capacity, ttlMs, coalesce, staleWhileRevalidate, warm }` | Chưa (chỉ `hitRate` cố định) |
| Chaos xoá cache | `action: flush` | Chưa |
| Chia cắt mạng | `action: partition` / `heal` trên edge | Chưa |
| Node sập hẳn | `action: down` / `up` | Chưa |
| Routing nhiều nhánh | `routing: sequence / parallel / hedge / quorum`, `hedgeAfterMs`, `quorum` | Chưa |
| Autoscale kiểu HPA | `autoscale: { min, max, targetUtilization, podStartMs, metric: queueLength … }` | Chưa (relic Autoscaler chỉ +1 instance) |
| Adaptive concurrency limit | `adaptiveLimit` | Chưa |
| Bỏ request chờ quá lâu | `queueTimeoutMs` | Chưa |
| Event loop vs thread pool | `model: cpu / threads`, `cpuLanes`, `maxInFlight` | Chưa |
| USL contention | `contention`, `coherency` | Chưa |
| GC pause | `gcPauseMs`, `gcEveryRequests` | Chưa |
| N query mỗi request | `callsPerRequest` | Chưa |
| Payload và băng thông | `requestKb`, `responseKb`, `bandwidthMbps` | Chưa |
| Fire-and-forget | edge `fireAndForget` | Chưa |

Đây là nguồn nội dung lớn nhất: phần lớn đề xuất bên dưới không cần sửa engine.

## 2. Nguyên lý thiết kế tham khảo

Rút từ thể loại deckbuilder roguelike và game mô phỏng nói chung, không sao chép game cụ thể nào:

1. **Không có lựa chọn trội.** Mỗi lá mạnh phải có một hoàn cảnh nó yếu hoặc phản tác dụng. Hiện tại Redis không có hoàn cảnh nào phản tác dụng.
2. **Địch hỏi câu hỏi, bộ bài trả lời.** Mỗi địch nên kiểm tra một năng lực (đọc nhiều, ghi nhiều, payload lớn, kết nối treo, chi phí). Bộ bài tốt là bộ trả lời được nhiều câu hỏi, không phải bộ trả lời một câu thật mạnh.
3. **Ý định phản ứng với build.** Địch "thông minh" nhắm vào điểm mạnh nhất của người chơi buộc họ đa dạng hoá. Ý định vẫn phải hiện trước để người chơi có thể chuẩn bị.
4. **Chi phí duy trì thay vì chi phí một lần.** Hạ tầng thật tốn tiền, tốn công vận hành, và hỏng dần. Chi phí theo lượt tạo ra quyết định "giữ hay bỏ".
5. **Trạng thái kéo dài tạo hệ quả.** Một quyết định lượt 2 nên còn ảnh hưởng lượt 5 (cache nóng dần, backlog tích lại, autoscaler đến muộn).
6. **Mỗi tầng một chủ đề kiến trúc.** Tầng 1 dạy đọc/cache, tầng 2 dạy ghi/hàng đợi/kết nối, tầng 3 dạy phân tán/mạng/chi phí. Bộ bài xây ở tầng 1 phải bị thử thách ở tầng 2.
7. **Archetype rõ ràng.** Nhiều hướng build có thể thắng: "pháo đài lọc" (WAF, rate limit), "co giãn" (autoscale, queue), "tiết kiệm" (ít hạ tầng, nhiều chính sách), "phản công". Mỗi hướng có địch khắc chế riêng.

## 3. Các trụ cột đề xuất

### A. Địch đọc build (ý định có điều kiện)

Thêm trường `when` vào ý định, chọn biến thể theo design hiện tại. Ví dụ:

```json
{ "label": "Cache Buster", "botRps": 1400, "when": { "has": "cache" }, "cacheBust": { "keys": 50000 } }
{ "label": "Denial of Wallet", "botRps": 1800, "when": { "instancesAtLeast": { "api": 4 } }, "costSpike": 1.5 }
{ "label": "Xoay IP", "botRps": 1600, "when": { "filterAtLeast": 0.5 }, "bypass": 0.4 }
```

| Build người chơi | Địch đáp lại | Bài học thật |
|---|---|---|
| Có cache, hit cao | Cache Buster: query string ngẫu nhiên, key không bao giờ trùng | Cache key phải chuẩn hoá; cache không bảo vệ được request có key ngẫu nhiên |
| Có cache | Hot Key: một key bị dồn (zipf rất cao), shard Redis đó nghẽn | Hot key, cần local cache hoặc tách key |
| Scale API nhiều | Denial of Wallet: tải đắt, mỗi instance thêm làm vượt ngân sách nhanh hơn | Autoscale không trần là lỗ hổng tài chính |
| Rate limit / WAF cao | Phân tán IP: `bypass` tăng theo mức lọc | Rate limit theo IP không chặn được botnet phân tán |
| Retry nhiều, không budget | Khuếch đại: `clientRetries` nhân với retry của người chơi | Retry chồng retry |
| Không có gì | Ý định cơ bản | |

Cài đặt: **M**. `currentIntent` lọc danh sách ý định theo `when` (hoặc thay thế ý định bằng biến thể `alt`). Ý định vẫn hiện trước một lượt nên người chơi vẫn đọc được. Cần thêm hàm `designTraits(state)` thuần trong `rules.ts`.

### B. Hạ tầng có hao mòn và trạng thái

1. **Cache thật** (**M**): lá Redis tạo node cache với `cache: { keys, zipf, capacity, ttlMs, warm: false }` thay vì `hitRate` cố định. Hit rate do engine tính từ phân bố key. Hệ quả miễn phí:
   - Lượt đầu sau khi đặt Redis, cache nguội, hit rate thấp ("cold start").
   - Bot dùng nhiều key khác nhau (`keys` lớn) đẩy key thật ra khỏi LRU, không cần `cacheHitScale`.
   - Ý định "Deploy lỗi" dùng `chaos flush`: cache rỗng, DB bị dồn đột ngột (thundering herd). Lá **Singleflight** (`coalesce`) và **Stale-while-revalidate** trở thành câu trả lời có nghĩa.
   - Cần trạng thái "cache đã nóng bao nhiêu lượt" trong `BattleState` để `warm` bật dần (không cần engine giữ state).
2. **Autoscale thay cho +instance tức thì** (**S/M**): lá Autoscaler đặt `autoscale` với `podStartMs` 3–5s trong lượt 10s. Spike đầu lượt vẫn gây lỗi; spike giữa lượt thì kịp. Lá Burst (+3 tạm thời) giữ vai trò phản ứng nhanh nhưng đắt Ops.
3. **Chi phí vận hành theo lượt** (**M**): mỗi lá Hạ tầng có `upkeep` (ví dụ Redis: mỗi 3 lượt nhét 1 "Cảnh báo bộ nhớ" vào bộ bài, hoặc bớt 1 Ops mỗi khi số hạ tầng vượt N). Người chơi phải chọn giữa giữ và gỡ hạ tầng (thêm lá **Decommission** gỡ một thành phần để hồi Ops/ngân sách).
4. **Ngân sách theo trận thay vì theo lượt** (**M**): `$/h` vượt ngân sách đang chỉ trừ máu từng lượt. Đổi thành quỹ chi phí cả trận (cloud bill), thêm địch "Denial of Wallet" ăn vào quỹ đó.

### C. Topology có lựa chọn

1. **Đường ghi** (**M**): thêm node `write` (hoặc tách client thành hai luồng đọc/ghi bằng tỉ lệ trong ý định). Request ghi đi thẳng vào DB, không qua cache. Ý định "Write Storm" (đặt hàng hàng loạt, Black Friday) vô hiệu hoá chiến thuật chỉ có cache. Câu trả lời: **Queue + Worker** (`kind: queue`, KEDA autoscale theo `queueLength`), **Write-behind**, **Batch insert**.
   - Engine hiện chưa có request class. Cách làm tạm ở tầng game: chạy hai mô phỏng con trong một lượt (đọc và ghi) rồi cộng kết quả, hoặc dùng `routing: sequence` trên API với edge ghi riêng (mỗi request đọc rồi ghi) và chỉnh tỉ lệ bằng `callsPerRequest`.
2. **Dịch vụ phụ** (**M**): design có thêm `auth` và `payment` (gọi `sequence`). Lá Chính sách hỏi người chơi chọn edge (`api→db`, `api→auth`, `api→payment`). Địch nhắm vào một dịch vụ cụ thể ("Payment provider chậm"), người chơi phải đặt timeout/breaker đúng chỗ. Đây là bài học trực tiếp nhất về timeout theo dependency.
   - UI cần thêm bước chọn mục tiêu cho lá, giống bước chọn lính.
3. **CDN / edge** (**S/M**): node trước LB, cache phản hồi tĩnh và phần đọc ẩn danh; không giúp được request đã đăng nhập. Địch "Credential Stuffer" toàn request đăng nhập nên CDN vô dụng, phải dùng Captcha/WAF.

### D. Trục cạnh tranh mới, ngoài cache và rate limit

| Trục | Địch kiểm tra | Câu trả lời | Engine |
|---|---|---|---|
| Kết nối treo | Slowloris giữ `maxInFlight`, cạn pool | `queueTimeoutMs`, timeout phía LB, tăng `maxInFlight` có giới hạn | Có sẵn, **S/M** |
| GC / bộ nhớ | Rò Rỉ Bộ Nhớ tăng `gcPauseMs` mỗi lượt | Restart định kỳ (lá Rolling Restart), giảm tải mỗi instance, hedge | Có sẵn, **S/M** |
| Contention | Scale API quá nhiều làm DB chậm (`contention` trên DB) | Pool nhỏ, read replica, cache | Có sẵn, **M** |
| Băng thông | Upload khổng lồ, khuếch đại phản hồi (`responseKb` lớn) | CDN, nén, giới hạn kích thước body | Có sẵn, **M** |
| Tail latency | DB p99 tệ (`latencyP99Ms` cao) | **Hedge read** (`routing: hedge` lên 2 replica) | Có sẵn, **M** |
| Quá tải mềm | Spike lớn hơn mọi khả năng | **Adaptive limit**, load shedding, `queueTimeoutMs` | Có sẵn, **S** |
| Chia cắt mạng | Split-brain: `partition` edge `api→db` một phần lượt | Timeout ngắn + breaker + fallback | Có sẵn, **M** |
| Sập hẳn | Zone outage: `down` một instance/node | Replica, quorum, multi-AZ | Có sẵn, **M** |

Mỗi trục thêm một địch ở tầng phù hợp và 1–2 lá trả lời. Cache và rate limit vẫn hữu ích nhưng không còn đủ.

### E. Thắng không chỉ bằng chặn bot

1. **Chặn nhầm** (**M**): mỗi mức lọc vượt ngưỡng (ví dụ 60%) chặn nhầm một phần người dùng thật, tính như request lỗi. Rate limit thô (`rate_limit`) chặn nhầm nhiều, WAF/Captcha ít hơn nhưng đắt hơn. Bài học: rate limit là đánh đổi giữa bot lọt và người dùng bị chặn.
2. **Sát thương từ SLO** (**M**): giữ SLO (p99 dưới ngưỡng, lỗi < 1%) trong lượt gây sát thương nhỏ lên địch ("botnet nản vì không làm sập được"). Như vậy build phòng thủ thuần cũng có đường thắng, không bắt buộc phải lọc.
3. **Giảm lợi nhuận của lọc** (**S**): `blockedPerDamage` tăng theo số lượt liên tiếp đã lọc trên X% (bot thích nghi), để lọc là một pha chứ không phải cả trận.

### F. Rủi ro kiến trúc có chủ đích

Những cái bẫy nên tồn tại để người chơi tự vấp:

- **Cache làm DB "quên" tải thật**: DB được tối ưu cho 30% tải (vì cache đỡ 70%). Khi địch `flush` cache, DB nhận 100% và sập. Người chơi phải giữ đủ năng lực DB hoặc có singleflight.
- **Breaker không fallback**: đã có, nhưng nên có lá **Fallback** (trả dữ liệu cũ khi breaker mở) để breaker thành câu trả lời hoàn chỉnh.
- **SPOF**: một instance LB; địch "Zone outage" `down` LB một phần lượt. Lá **LB thứ hai** rẻ nhưng chỉ có ích khi gặp địch này.
- **Autoscale vô hạn**: build co giãn mạnh nhưng gặp Denial of Wallet thì cháy ngân sách.

## 4. Danh mục nội dung đề xuất

### 4.1 Lá bài mới

| Lá | Loại | Hiệu ứng (đề xuất) | Trả lời câu hỏi | Cài đặt |
|---|---|---|---|---|
| Singleflight | Chính sách | Cache `coalesce: true` | Flush, stampede | M (cần cache thật) |
| Stale-while-revalidate | Chính sách | Cache `staleWhileRevalidate: true` | TTL hết hạn, DB chậm | M |
| Chuẩn hoá cache key | Chính sách | Giảm `keys` của bot về mức người dùng thật | Cache Buster | M |
| Queue + Worker | Hạ tầng | Thêm queue trên đường ghi, worker autoscale theo `queueLength` | Write storm | M |
| Autoscaler (lá) | Hạ tầng | `autoscale` trên API, `podStartMs` 4000 | Spike giữa lượt | S |
| Hedge read | Chính sách | Thêm replica, `routing: hedge`, `hedgeAfterMs` theo p95 | Tail latency DB | M |
| Read replica có lag | Hạ tầng | Như `replica` hiện tại, nhưng một phần đọc bị "dữ liệu cũ" tính như lỗi nhẹ | Đánh đổi nhất quán | M |
| Adaptive limit | Chính sách | `adaptiveLimit` trên API | Quá tải mềm | S |
| Bulkhead | Chính sách | Pool riêng cho từng dependency | Một dependency chậm kéo sập tất cả | M (cần topology C2) |
| Fallback | Chính sách | Khi breaker mở, trả phản hồi thay thế (không tính lỗi) | Breaker biến quá tải thành sập | M |
| Feature flag | Hành động | Tắt tính năng nặng một lượt: giảm `callsPerRequest` / `responseKb` | API lạm dụng, băng thông | S |
| Rolling restart | Hành động | Reset `gcPauseMs` tích luỹ, mất 1 instance trong lượt | Rò rỉ bộ nhớ | M |
| Decommission | Hành động | Gỡ một thành phần, hồi ngân sách | Chi phí duy trì | M |
| Chaos drill | Hành động | Lượt này giả lập sự cố của lượt sau; nếu sống, miễn nhiễm sự cố đó | Chuẩn bị chủ động | M |

### 4.2 Ý định và địch mới

| Ý định / địch | Tầng | Cơ chế | Khắc chế | Cài đặt |
|---|---|---|---|---|
| Cache Buster | 1 | `when: has cache`; bot dùng key ngẫu nhiên | Chuẩn hoá key, rate limit | M |
| Hot Key | 1–2 | `zipf` rất cao, một key nghẽn | Local cache, tách key | M |
| Deploy lỗi | 1 | `chaos flush` cache giữa lượt | Singleflight, SWR, DB dư năng lực | S (khi có cache thật) |
| Write Storm | 2 | Tỉ lệ ghi tăng mạnh, ghi bỏ qua cache | Queue + Worker | M |
| Slowloris (sửa) | 2 | Giữ `maxInFlight` thay vì latency ×2.5 | `queueTimeoutMs`, timeout LB | S |
| Rò Rỉ Bộ Nhớ (sửa) | 1 | `gcPauseMs` tăng mỗi lượt | Rolling restart | M |
| Upload khổng lồ | 2 | `requestKb` lớn, nghẽn băng thông | Giới hạn body, CDN | M |
| Denial of Wallet | 3 | `when: scale cao`; tải đắt, đốt ngân sách | Trần autoscale, lọc | M |
| Split-brain | 3 | `partition` `api→db` một phần lượt | Timeout + breaker + fallback | M |
| Zone outage | 3 | `down` LB hoặc một nhóm instance | LB thứ hai, replica | M |

Gợi ý phân bố: tầng 1 thêm Cache Buster, Deploy lỗi, sửa Rò Rỉ Bộ Nhớ (bài học: cache có giới hạn); tầng 2 thêm Write Storm, Upload khổng lồ, sửa Slowloris (bài học: ghi, kết nối, băng thông); tầng 3 thêm Denial of Wallet, Split-brain, Zone outage (bài học: phân tán, chi phí, sự cố mạng).

## 5. Ràng buộc kỹ thuật

| Đề xuất | Làm được ở tầng game | Cần engine |
|---|---|---|
| Ý định có điều kiện (A) | Có: `currentIntent` + `designTraits` | Không |
| Cache theo key, flush (B1, Deploy lỗi) | Có: dựng `CacheModel` trong design, thêm event `flush` vào `planTurn` | Không. Cache nóng dần giữa lượt mô phỏng bằng `warm` + bộ đếm trong state |
| Autoscale, adaptive limit, GC, queue timeout, băng thông, hedge (D) | Có: chỉ cần đặt trường trong design | Không |
| Partition, down (Split-brain, Zone outage) | Có: event chaos trong `planTurn` | Không. Cần event có `atMs` giữa lượt, engine đã hỗ trợ |
| Đường ghi riêng (C1) | Tạm: hai mô phỏng con hoặc `routing: sequence` | Đúng nghĩa cần **request class** |
| Chặn nhầm người dùng thật (E1) | Có: tính ở `planTurn`/`scoreTurn` | Đúng nghĩa cần request class |
| Backlog, breaker, cache kéo sang lượt sau (1.6) | Một phần (bộ đếm trong state) | Cần `apply_patch` khi đang chạy, hoặc snapshot/restore state engine |
| Rate limit/WAF là node thật | Không | Cần node limiter |

Kết luận: phần lớn thay đổi (A, B, D, E, một phần C) chỉ cần `rules.ts`, `types.ts` và JSON. Engine chỉ cần cho đường ghi đúng nghĩa, chặn nhầm đúng nghĩa và trạng thái kéo dài, đã có trong kế hoạch mở rộng engine ghi ở [CARDS.md](CARDS.md#giới-hạn-của-prototype).

Lưu ý tất định: `scoreTurn` dùng chung cho ô **Dự kiến** và `resolveTurn`. Mọi cơ chế mới phải giữ tính chất này (cùng state + seed cho cùng kết quả), nên điều kiện `when` chỉ đọc state, không đọc kết quả mô phỏng của lượt đang chơi.

## 6. Lộ trình đề xuất

**Giai đoạn 1: nội dung trên engine có sẵn** (S/M, không đụng Rust). Phần đã làm và kết quả đo: xem [mục 8](#8-giai-đoạn-1-đã-làm-gì-và-đo-được-gì).
- `designTraits` + ý định có điều kiện `when`; thêm biến thể cho 6–8 địch hiện có.
- Cache theo key (`CacheModel`) thay `hitRate`; thêm Singleflight, SWR, Chuẩn hoá key; ý định Deploy lỗi.
- Sửa Slowloris, Rò Rỉ Bộ Nhớ, Khuếch Đại DNS dùng trường engine khớp chủ đề (bảng 1.4).
- Lá Autoscaler, Adaptive limit, Feature flag.
- Chặn nhầm khi lọc quá ngưỡng (E1, xấp xỉ ở tầng game).

**Giai đoạn 2: topology có lựa chọn** (M)
- Dịch vụ phụ `auth`/`payment`, lá Chính sách chọn edge (cần UI chọn mục tiêu).
- Đường ghi (tạm bằng hai mô phỏng con), Queue + Worker, Write Storm.
- Upkeep cho hạ tầng, lá Decommission, Fallback, Bulkhead.

**Giai đoạn 3: engine**
- Request class (người dùng / bot, đọc / ghi) để lọc, chặn nhầm và đường ghi đúng nghĩa.
- Node rate limiter / WAF.
- Trạng thái kéo sang lượt sau (`apply_patch` hoặc snapshot).

## 7. Đo và kiểm chứng

Mục tiêu đo được, dùng `apps/web/scripts/cards-balance.mjs`:

1. **Baseline trước khi sửa**: `pnpm balance:cards 30 --run --by-enemy`. Thêm thống kê "tỉ lệ lá đánh ra theo loại và theo id" cho chiến thuật `greedy`, để có con số cụ thể cho "cache + rate limit chiếm bao nhiêu".
2. **Thêm chiến thuật bot đơn trục**: `cacheOnly` (ưu tiên cache/index/scale), `filterOnly` (rate limit/WAF/captcha), `scaleOnly`, `policyOnly`, cạnh `greedy` hiện có.
3. **Tiêu chí sau mỗi giai đoạn**:
   - Không chiến thuật đơn trục nào vượt cả tháp quá 25%.
   - `greedy` (đa dạng) vẫn vượt tháp khoảng 40% như mục tiêu hiện tại.
   - Ít nhất 3 chiến thuật khác nhau có tỉ lệ vượt tầng 1 trên 70%.
   - Mỗi địch mới có ít nhất một chiến thuật đơn trục thua rõ rệt (tỉ lệ thắng thấp hơn trung bình 30 điểm), chứng tỏ nó thật sự kiểm tra một năng lực.
4. **Kiểm tra tất định**: test trong `cards.test.ts` rằng dự kiến (`scoreTurn` trước khi kết thúc lượt) bằng kết quả `resolveTurn` cho các ý định có điều kiện và event giữa lượt.

## Phụ lục: script đo bộ bài "lối mòn"

Chạy sau `pnpm build:wasm`: `node --experimental-strip-types rut.mjs "$PWD"` từ thư mục gốc repo.

```js
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const require = createRequire(import.meta.url);
const wasm = require(join(root, 'crates/engine-wasm/pkg-node/pattern_engine_wasm.js'));
const rules = await import(join(root, 'apps/web/src/cards/rules.ts'));
const d = (f) => JSON.parse(readFileSync(join(root, 'apps/web/src/cards/data', f), 'utf8'));
const content = { cards: d('cards.json'), enemies: d('enemies.json'), battle: d('battle.json'), run: d('run.json'), events: d('events.json'), relics: d('relics.json'), minions: d('minions.json') };
const run = (i) => JSON.parse(wasm.run_headless(JSON.stringify(i)));
// "rut" deck: starter + 2 extra cache-ish/infra/filter cards, play infra first then rate limit then attack
const deck = [...content.battle.startingDeck, 'rate_limit', 'scale_api'];
const order = ['cache', 'scale_api', 'index', 'timeout', 'rate_limit', 'patch', 'buffer'];
const pick = (s) => { for (const id of order) { const c = s.hand.find((h) => h.id === id && rules.canPlay(content, s, h.uid)); if (!c) continue; if (id==='cache' && rules.nodeOf(s.design,'cache')?.config.hitRate>=0.95) continue; return c.uid; } return null; };
const ids = content.run.normal.flat().concat(content.run.elites.flat());
for (const enemy of ids) {
  let wins = 0, hpLost = 0, turns = 0; const N = 20;
  for (let seed = 1; seed <= N; seed++) {
    let s = rules.newBattle(content, seed, { enemy, deck, maxHp: 80 });
    while (s.phase === 'player' && s.turn <= 30) {
      let u; while ((u = pick(s)) !== null) s = rules.playCard(content, s, u);
      if (s.phase !== 'player') break;
      const p = rules.planTurn(content, s); s = rules.resolveTurn(content, s, p, run(p.input));
    }
    if (s.phase === 'won') wins++; hpLost += 80 - s.hp; turns += s.turn;
  }
  console.log(enemy.padEnd(14), `win ${Math.round(100*wins/N)}%`, `hpLost ${(hpLost/N).toFixed(1)}`, `turns ${(turns/N).toFixed(1)}`);
}
```
