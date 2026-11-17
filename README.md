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

## Tính năng

- **Sandbox**: kéo thả thành phần (LB, service, cache, DB, queue), nối dây, xoá. Chỉnh mọi tham số node và chính sách edge (timeout, retry + backoff + jitter, circuit breaker). Điều khiển RPS, spike ×2/×3/×5, tắt node (chaos). Tải design ra JSON để chạy bằng CLI.
- **Game**: 4 level, mỗi level một bài học (cache-aside, retry storm, queue leveling, failover). Có ngân sách, chaos theo kịch bản và 3 tiêu chí sao. Giá và hiệu năng lấy từ catalog trong engine, người chơi chỉ chọn topology, số instance và policy nên không gian lận được.
- **Leaderboard**: NestJS chạy lại đúng engine WASM để chấm. Client chỉ gửi design, scenario do server giữ.
- **Particle**: WebGPU (ring buffer, vertex shader tính vị trí trên bezier). Nếu trình duyệt không hỗ trợ thì dùng Canvas2D fallback (`?renderer=2d` để ép dùng). Màu: request xanh dương, retry cam, OK xanh lá, lỗi đỏ.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `crates/engine` | Discrete-event simulation (`sim.rs`), luật level và catalog (`level.rs`) |
| `crates/engine-wasm` | Binding `wasm-bindgen`: `Sim`, `run_headless`, `play_level`, `level_input`, `catalog_json` |
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
pnpm test               # cargo test + typecheck web + test server
pnpm test:gpu           # smoke test renderer WebGPU (cần pnpm dev)
node apps/web/scripts/e2e.cjs   # chơi thử level 1 qua UI thật (cần dev + dev:server)
```

Thêm component shadcn: `cd apps/web && pnpm dlx shadcn@latest add <component>` (đã có sẵn `components.json`).

## Kết quả mẫu

```
scenario            requests  ok rps   err %   p99 ms  retries  cost/h  SLO   stars
01-no-cache           130661    1663   23.65    174.5        0    0.73  FAIL  ☆☆☆
02-cache-aside        130391    2173    0.00     68.8        0    0.88  PASS  ★★★
03-read-replicas      129499    2158    0.00     85.5        0    1.25  PASS  ★★★
04-queue-leveling     130054    2168    0.00     63.6        0    0.98  PASS  ★★☆   (backlog chưa xử lý hết)
05-retry-storm         59364     360   63.64    607.6    80105    0.73  FAIL  ☆☆☆   (sập, không tự hồi phục)
06-circuit-breaker     60268     779   22.43    181.6     2543    0.73  FAIL  ☆☆☆   (hồi phục ngay khi DB khoẻ)
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

Các `kind` hỗ trợ: `client`, `loadBalancer`, `service`, `cache` (`hitRate`), `database`, `queue` (ack ngay, xử lý async). Chaos `action`: `down`, `up`, `latency`, `errors`.
