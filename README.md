# Pattern: System Design Simulator

Công cụ minh hoạ các pattern kiến trúc hệ thống: thiết kế hệ thống trên canvas, bắn traffic vào, gây sự cố, và xem hệ thống chịu tải hoặc sập ở đâu, chơi như một trò chơi.

```
┌──────────────────────── apps/web (React) ─────────────────────────┐
│  React Flow (DOM)   : node, edge, kéo thả, inspector             │
│  WebGPU canvas      : particle request/response, GPU tự tính vị trí│
│        ▲ Float32Array (event mới mỗi tick, transferable)          │
│  Web Worker ── pattern-engine-wasm (Rust → WASM)                 │
└────────────────────────────────────────────────────────────────────┘
        crates/engine: Rust thuần, tất định, chạy được native và WASM
        crates/engine-cli: chạy scenario headless (CI, so sánh pattern)
```

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `crates/engine` | Discrete-event simulation: hàng đợi, slot concurrency, latency lognormal, cascading failure, queue async, metrics theo cửa sổ |
| `crates/engine-wasm` | Binding `wasm-bindgen` mỏng (`Sim`, `run_headless`) |
| `crates/engine-cli` | `pattern-sim`: chạy scenario JSON và in bảng so sánh |
| `examples/*.json` | Scenario mẫu `{ design, scenario }`, dùng chung cho CLI và UI |
| `apps/web/src/sim` | Worker sở hữu WASM, đồng hồ mô phỏng có nội suy |
| `apps/web/src/gpu` | Renderer WebGPU: ring buffer + vertex shader tính vị trí trên bezier |

## Chạy

Yêu cầu: Rust (target `wasm32-unknown-unknown`), `wasm-pack`, Node 22+, pnpm.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

pnpm build:wasm          # build engine sang WASM (crates/engine-wasm/pkg)
pnpm install
pnpm dev                 # http://localhost:5173

pnpm sim examples/*.json             # so sánh các pattern headless
pnpm sim --windows examples/01-no-cache.json   # chi tiết từng giây
cargo test --workspace               # test engine
pnpm test:gpu                        # smoke test renderer (cần pnpm dev + playwright)
```

## Các quyết định thiết kế

- **Engine trên CPU, tất định.** Event heap sắp theo `(time µs, seq)`, RNG SplitMix64 có seed, toán siêu việt dùng `libm`. Kết quả native và WASM giống nhau đến từng bit, nên server (NestJS) có thể chạy lại cùng seed để xác minh điểm leaderboard.
- **Giữ slot khi chờ downstream.** Service giữ concurrency slot trong lúc chờ DB trả lời, nhờ đó cascading failure xuất hiện tự nhiên, không cần viết kịch bản.
- **GPU-driven particles.** Mỗi particle `[edge, t0, dur, kind]` chỉ được upload một lần. Vertex shader tự tính vị trí theo thời gian mô phỏng, CPU mỗi frame chỉ tốn O(event mới). Renderer chỉ draw vùng ring buffer còn sống.
- **Edge geometry dùng chung.** Edge của React Flow vẽ đúng đường bezier mà shader dùng, nên particle luôn chạy khớp trên đường.

## Mô hình JSON

```jsonc
{
  "design": {
    "nodes": [{ "id": "api", "kind": "service", "config": {
      "instances": 2, "concurrency": 80, "queueSize": 50,
      "latencyP50Ms": 15, "latencyP99Ms": 50, "errorRate": 0, "costPerHour": 0.1 } }],
    "edges": [{ "source": "lb", "target": "api", "latencyMs": 1 }]
  },
  "scenario": {
    "seed": 42, "durationMs": 60000, "timeoutMs": 1000,
    "traffic": [{ "atMs": 0, "rps": 1500 }, { "atMs": 20000, "rps": 3500 }],
    "slo": { "p99Ms": 250, "errorRate": 0.01 }
  }
}
```

Các `kind` hỗ trợ: `client`, `loadBalancer`, `service`, `cache` (`hitRate`), `database`, `queue` (ack ngay, xử lý async).
