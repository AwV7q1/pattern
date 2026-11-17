# Pattern: System Design Simulator

Công cụ minh hoạ các pattern kiến trúc hệ thống. Bạn thiết kế hệ thống trên canvas, bắn traffic vào, gây sự cố, rồi xem hệ thống chịu tải hoặc sập ở đâu. Có chế độ game với level, ngân sách, chấm sao và leaderboard.

```
┌──────────────────────── apps/web (React + shadcn/ui) ─────────────┐
│  React Flow (DOM)   : node, edge, kéo thả, nối dây, inspector    │
│  WebGPU canvas      : particle, GPU tự tính vị trí (fallback 2D) │
│        ▲ Float32Array (event mới mỗi tick, transferable)          │
│  Web Worker ── pattern-engine-wasm (Rust → WASM, --target web)   │
└───────────────────────────────┬────────────────────────────────────┘
                                │ /api (submit design, leaderboard)
┌───────────────────────────────▼──── apps/server (NestJS) ─────────┐
│  pattern-engine-wasm (--target nodejs): chấm lại điểm phía server │
└────────────────────────────────────────────────────────────────────┘
   crates/engine     : Rust thuần, tất định (native = WASM, từng bit)
   crates/engine-cli : chạy scenario/level headless (CI, so sánh)
   examples/, levels/: dữ liệu dùng chung cho CLI, test, web, server
```

> Các con số được tạo ra thế nào, giả định gì, chưa mô phỏng gì: xem **[docs/SIMULATION.md](docs/SIMULATION.md)**.
> Đo hệ thống thật, hiệu chỉnh mô hình, chọn server: **[docs/CAPACITY.md](docs/CAPACITY.md)**.

## Tính năng

- **Học** (tab mặc định): lộ trình kiểu Duolingo từ người mới đến nâng cao, 7 phần, 29 bài. Mỗi bài gồm thẻ giải thích có sơ đồ tuần tự động, câu hỏi trắc nghiệm, sắp xếp thứ tự và **dự đoán**: người học đoán kết quả, engine chạy thật để chấm. Bài thực hành mở level trên canvas, đạt ≥ 1★ là qua. Có XP, chuỗi ngày, mục tiêu ngày, câu sai được hỏi lại cuối bài. Xem [docs/LEARNING.md](docs/LEARNING.md).
- **Sandbox**: kéo thả thành phần (LB, service, cache, DB, queue), nối dây, xoá. Chỉnh mọi tham số node và chính sách edge (timeout, retry + backoff + jitter, circuit breaker). Điều khiển RPS, spike ×2/×3/×5, tắt node (chaos). Tải design ra JSON để chạy bằng CLI.
- **Game**: 4 level, mỗi level một bài học (cache-aside, retry storm, queue leveling, failover). Có ngân sách, chaos theo kịch bản và 3 tiêu chí sao. Giá và hiệu năng lấy từ catalog trong engine, người chơi chỉ chọn topology, số instance và policy nên không gian lận được.
- **Leaderboard**: NestJS chạy lại đúng engine WASM để chấm. Client chỉ gửi design, scenario do server giữ.
- **Công suất**:
  - Sizing wizard: tải mục tiêu cộng chi phí mỗi request đo được, cho ra số vCPU, RAM, pool, gói VPS. Kết quả được kiểm chứng bằng mô phỏng ở các kịch bản cao điểm, đột biến, mất 1 server và DB chậm.
  - Hiệu chỉnh từ kết quả k6: fit tham số để mô phỏng khớp số đo, rồi dự đoán giới hạn chịu tải.
- **Mô hình gần thực tế**:
  - Node `cpu` (event loop, CPU lane tách khỏi số request mở) và `threads` (thread pool).
  - Mỗi instance có hàng đợi riêng, LB round-robin hoặc least-conn.
  - Nhiều query tuần tự mỗi request.
  - Connection pool cho mỗi process.
  - USL contention, GC pause, chi phí wake-up.
- **Gọi nhiều nhánh**: node có nhiều edge đi ra chọn cách gọi: ⇄ chọn 1 (round-robin), ①②③ tuần tự (`await` nối tiếp, edge cùng số thứ tự chạy cùng lúc), ∥ song song (`Promise.all`, lỗi là fail ngay). Edge có thể đánh dấu fire-and-forget (không chờ trả lời).
- **Payload và băng thông**: mỗi edge có kích thước request/response (KB) và băng thông. Body truyền nối đuôi nhau trên đường truyền (FIFO), nên đường truyền có thể nghẽn trước cả server.
- **Trace**: theo dõi từng request, xem waterfall (mạng, chờ connection, xếp hàng, xử lý) và diễn biến theo thời gian. Request đó được vẽ to hơn, có vòng trắng trên canvas.
- **Particle**: WebGPU (ring buffer, vertex shader tính vị trí trên bezier). Nếu trình duyệt không hỗ trợ thì dùng Canvas2D fallback (`?renderer=2d` để ép dùng). Request là **mũi tên** xanh dương chỉ hướng đi, retry là mũi tên cam, response OK là chấm xanh lá ở làn ngược lại, lỗi là dấu × đỏ. Particle to hơn khi payload lớn. Edge chung một node được tách ra, có mũi tên ở đầu đích và dày lên theo lưu lượng.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `crates/engine` | Discrete-event simulation (`sim.rs`), luật level và catalog (`level.rs`), hiệu chỉnh từ k6 (`calibrate.rs`), chọn server (`sizing.rs`) |
| `crates/engine-wasm` | Binding `wasm-bindgen`: `Sim`, `run_headless`, `play_level`, `level_input`, `catalog_json`, `size_json`, `calibrate_json` |
| `tools/k6` | `step-load.js` (tải theo bậc, xuất summary cho calibrate), `cpu-per-request.sh` |
| `examples/calibration` | Số đo thật của server NestJS trong repo, dùng để thử calibrate |
| `crates/engine-cli` | `pattern-sim`: chạy scenario hoặc chấm design theo level |
| `examples/*.json` | Scenario sandbox `{ design, scenario }` |
| `levels/*.json`, `levels/solutions/` | Level game và lời giải tham khảo (test đảm bảo lời giải đạt 3★, design ban đầu 0★) |
| `apps/web` | React 19 + shadcn/ui (Tailwind v4, Radix) + React Flow + WebGPU |
| `apps/server` | NestJS 11: `GET /api/levels`, `POST /api/levels/:id/submit`, `GET /api/levels/:id/leaderboard` |

## Chạy

Yêu cầu: Rust (target `wasm32-unknown-unknown`), `wasm-pack`, Node 22+, pnpm.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

pnpm build:wasm          # engine → WASM cho web (pkg) và Node (pkg-node)
pnpm install
pnpm dev:server          # NestJS http://localhost:3000/api (leaderboard)
pnpm dev                 # http://localhost:5173 (proxy /api → 3000)

pnpm sim examples/*.json                                   # so sánh pattern
pnpm sim --windows examples/05-retry-storm.json            # chi tiết từng giây
pnpm sim --level levels/02-flaky-db.json my-design.json    # chấm design theo level
pnpm sim sweep examples/07-nestjs-pool.json --rates 1000,2000,3000  # dự đoán ở nhiều mức tải
pnpm sim size sizing.json                                   # chọn server (xem docs/CAPACITY.md)
pnpm sim calibrate examples/calibration/nest-server.json examples/calibration/measured-low.json \
  --fit api.wakeup --fit api.gcPause --fit api.gcEvery       # hiệu chỉnh từ số đo thật
k6 run -e BASE_URL=http://localhost:3000/api/x -e RATES=100,300,600 \
  --summary-export=k6.json tools/k6/step-load.js            # đo hệ thống của bạn
pnpm test               # cargo test + typecheck web + test server
pnpm test:gpu           # smoke test renderer WebGPU (cần pnpm dev)
node apps/web/scripts/e2e.cjs   # chơi thử level 1 qua UI thật (cần dev + dev:server)
```

Thêm component shadcn: `cd apps/web && pnpm dlx shadcn@latest add <component>` (đã có sẵn `components.json`).

## Kết quả mẫu

```
scenario            requests  ok rps   err %   p99 ms  retries  cost/h  SLO   stars
01-no-cache           129886    1664   23.13    174.5        0    0.73  FAIL  ☆☆☆
02-cache-aside        130391    2173    0.00     68.8        0    0.88  PASS  ★★★
03-read-replicas      130256    2171    0.00     85.5        0    1.25  PASS  ★★★
04-queue-leveling     129740    2162    0.00     63.6        0    0.98  PASS  ★★☆   (backlog chưa xử lý hết)
05-retry-storm         60250     584   41.82    572.6    61036    0.73  FAIL  ☆☆☆   (sập, không tự hồi phục)
06-circuit-breaker     60219     775   22.80    204.5     2815    0.73  FAIL  ☆☆☆   (hồi phục ngay khi DB khoẻ)
07-nestjs-pool        125896    2098    0.00   1239.4        0    0.67  FAIL  ☆☆☆   (pool cạn lúc spike; pool 10 → p99 45ms)
08-checkout-fan-out     6078     101    0.00   1315.3        0    1.05  FAIL  ☆☆☆   (đường truyền 100 Mbps nghẽn ở ~208 rps lúc spike)
```

## Các quyết định thiết kế

- **Engine trên CPU, tất định.** Event heap sắp theo `(time µs, seq)`, RNG SplitMix64 có seed, toán siêu việt qua `libm`. Native, WASM web và WASM Node cho kết quả giống nhau đến từng bit; test server kiểm tra điều này.
- **Mỗi hop là một "call" riêng.** Caller có thể timeout và retry trong khi callee vẫn đang làm. Đó là cơ chế sinh retry storm và metastable failure, không cần viết kịch bản.
- **Giữ slot khi chờ downstream** nên cascading failure xuất hiện tự nhiên.
- **Luật game nằm trong engine**, không nằm ở UI hay server, nên một nguồn chân lý cho cả preview lẫn chấm điểm.
- **GPU-driven particles.** Mỗi particle `[edge, t0, dur, kind]` chỉ upload một lần, CPU mỗi frame tốn O(event mới).

## Mô hình JSON

```jsonc
{
  "design": {
    "nodes": [{ "id": "api", "kind": "service", "config": {
      "instances": 2, "concurrency": 80, "queueSize": 50,
      "latencyP50Ms": 15, "latencyP99Ms": 50, "errorRate": 0, "costPerHour": 0.1 } }],
    "edges": [{ "source": "api", "target": "db", "latencyMs": 1,
      "timeoutMs": 100, "retries": 2, "backoffMs": 20, "jitter": true,
      "circuitBreaker": { "failureThreshold": 0.5, "minRequests": 20, "windowMs": 1000, "openMs": 5000 } }]
  },
  "scenario": {
    "seed": 42, "durationMs": 60000, "timeoutMs": 1000,
    "traffic": [{ "atMs": 0, "rps": 1500 }, { "atMs": 20000, "rps": 3500 }],
    "events": [{ "atMs": 20000, "node": "db", "action": "latency", "value": 3 }],
    "slo": { "p99Ms": 250, "errorRate": 0.01 },
    "budgetPerHour": 1.0
  }
}
```

Node `cpu` và edge có pool:

```jsonc
{ "id": "api", "kind": "service", "config": {
    "instances": 2, "balance": "roundRobin", "model": "cpu", "cpuLanes": 4, "maxInFlight": 5000,
    "cpuP50Ms": 1.5, "cpuP99Ms": 4.5, "callsPerRequest": 3, "wakeupMs": 0, "gcPauseMs": 0, "gcEveryRequests": 0 } }
{ "source": "api", "target": "db", "poolSize": 10, "poolTimeoutMs": 10000 }
```

Gọi nhiều nhánh, payload và băng thông:

```jsonc
{ "id": "checkout", "kind": "service", "config": { "routing": "sequence" } }   // "pick" | "sequence" | "parallel"
{ "source": "checkout", "target": "auth", "order": 1 }
{ "source": "checkout", "target": "inventory", "order": 2 }                     // cùng order = chạy cùng lúc
{ "source": "checkout", "target": "pricing", "order": 2 }
{ "source": "checkout", "target": "email", "order": 3, "fireAndForget": true }
{ "source": "client", "target": "checkout", "requestKb": 2, "responseKb": 60, "bandwidthMbps": 100 }
```

Các `kind` hỗ trợ: `client`, `loadBalancer`, `service`, `cache` (`hitRate`), `database`, `queue` (ack ngay, xử lý async). Chaos `action`: `down`, `up`, `latency`, `errors`.
