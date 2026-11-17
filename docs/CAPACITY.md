# Ước lượng giới hạn chịu tải và chọn server

Simulator chỉ đúng bằng các con số đầu vào. Tài liệu này mô tả cách lấy các con số đó từ hệ thống thật, và cách dùng chúng để:

1. **Chọn server** (Sizing wizard, `pattern-sim size`): từ tải mục tiêu và chi phí mỗi request đã đo, tính ra số vCPU, RAM, pool, gói VPS, rồi mô phỏng để kiểm chứng.
2. **Hiệu chỉnh mô hình** (`pattern-sim calibrate`): đưa kết quả k6 ở vài mức tải vào, fit tham số để mô phỏng khớp số đo, rồi dự đoán giới hạn chịu tải.

Cả hai đều có trên web (tab **Công suất**) và CLI.

## 1. Mô hình gần thực tế hơn

| Tính năng | Ý nghĩa thực tế | Tham số |
|---|---|---|
| **`model: "cpu"`** | Node.js, Postgres: request chỉ cần CPU lúc tính toán. Lúc chờ I/O hay chờ DB, request chỉ được tính vào số request đang mở, không chiếm CPU. Thời gian xếp hàng chờ CPU chính là **event loop lag**. | `cpuLanes` (số process Node, hoặc số core DB), `maxInFlight` (Postgres: `max_connections`), `cpuP50Ms/P99Ms`, `ioP50Ms/P99Ms` |
| `model: "threads"` (mặc định cũ) | Java/Go/PHP-FPM với pool: mỗi request giữ 1 slot suốt vòng đời, kể cả lúc chờ downstream. | `concurrency`, `latencyP50Ms/P99Ms` |
| **Mỗi instance hàng đợi riêng** | LB chia round-robin, máy nào chậm thì hàng đợi máy đó dài ra (khác với mô hình M/M/c lý tưởng dùng chung một hàng đợi). | `balance`: `roundRobin`, `leastConnections`, `random` |
| **Nhiều lời gọi tuần tự** | `await` nối tiếp N query. CPU được chia thành nhiều lát xen giữa các lần gọi. | `callsPerRequest` |
| **Connection pool trên edge** | Pool Prisma/TypeORM/HikariCP **cho mỗi process**: hết kết nối thì xếp hàng, quá `poolTimeoutMs` thì lỗi. Kết nối chỉ được trả khi query xong, kể cả khi caller đã timeout. | `poolSize`, `poolTimeoutMs` (Prisma mặc định 10s) |
| **USL** | Tranh chấp lock: N request chạy song song thì mỗi request chậm đi `1 + σ(N−1) + κN(N−1)` lần. | `contention`, `coherency` |
| **GC pause** | Mỗi N request, một process dừng toàn bộ (stop-the-world) trong vài ms. p50 không đổi nhưng p99 dày lên. | `gcPauseMs`, `gcEveryRequests` |
| **Wake-up** | Đánh thức một process đang rảnh tốn CPU (epoll, timer, context switch). Lúc bận, các request chạy nối tiếp nên không tốn khoản này. Vì vậy **CPU mỗi request giảm khi tải tăng**, đúng như đo được trên Node. | `wakeupMs` |
| **Tái hiện đúng bài test k6** | `constant-arrival-rate` phát request đều, không theo Poisson. Khi hết VU thì k6 bỏ iteration (dropped). | `scenario.arrival: "uniform"`, `scenario.maxConcurrent` |

Ví dụ `examples/07-nestjs-pool.json`: lúc có spike, CPU Node chỉ khoảng 67% và Postgres khoảng 71%, nhưng pool 5 kết nối mỗi process đã cạn nên p99 lên khoảng 1s. Tăng pool lên 10 thì p99 về 45ms.

## 2. Đo trên hệ thống thật

```bash
# CPU mỗi request (input quan trọng nhất). Nên đo ở 2 mức: thấp và gần tải thật.
tools/k6/cpu-per-request.sh $(pgrep -d, -f dist/main) http://localhost:3000/api/products 50 60
tools/k6/cpu-per-request.sh $(pgrep -d, -f dist/main) http://localhost:3000/api/products 800 60

# Tải theo bậc, xuất file summary cho calibrate
k6 run -e BASE_URL=http://localhost:3000/api/products -e RATES=100,300,600 -e STEP=60s \
  --summary-export=k6-summary.json tools/k6/step-load.js
```

Lưu ý khi đo:

- **Mô hình mở** (`constant-arrival-rate`). Nếu dùng số VU cố định, server chậm thì k6 cũng tự gửi chậm lại, che mất tình trạng quá tải (coordinated omission).
- **Load generator không được là nút thắt.** Chạy nó trên máy hoặc core khác. Trong lần kiểm chứng bên dưới, bộ tạo tải tự viết bị nghẽn event loop ở khoảng 1000 rps, làm số đo sai tới 3 lần.
- **Ghi lại CPU của process ở từng mức** (`top`, Prometheus `process_cpu_seconds_total`). Đây là số đo giúp phân biệt "p99 cao vì CPU đầy" với "p99 cao vì GC/pause".
- Dữ liệu cỡ production, cùng giới hạn CPU (k8s limits), cùng cỡ DB.

## 3. Hiệu chỉnh

```bash
pnpm sim calibrate my-design.json k6-summary.json \
  --observe api.utilization@300=0.35 --observe api.utilization@600=0.68 \
  --fit api.cpu --fit '*.latency' --out calibrated.json
pnpm sim sweep calibrated.json --rates 600,900,1200,1500
```

- Design phải đúng **cấu trúc**: ai gọi ai, số process, kích thước pool, số query. Calibrate chỉ fit các **con số**.
- Không có `--fit` thì tool tự chọn núm công suất của tài nguyên bận nhất (CPU, slot hoặc pool) cộng một hệ số latency chung.
- Tham số fit được:
  - Hệ số nhân: `node.latency|cpu|io|cpuTail`, `*.latency`.
  - Giá trị tuyệt đối: `node.concurrency|cpuLanes|maxInFlight|contention|gcPause|gcEvery|wakeup`, `a->b.pool`, `a->b.latency`.
  - Khoảng tìm kiếm viết dạng `=min:max`.
- Thuật toán: quét từng tham số, sau đó chạy Nelder–Mead trên thang log và khởi động lại nhiều lần. Mỗi lần đánh giá là một lần mô phỏng lại toàn bộ bài test k6 với cùng seed.

## 4. Kiểm chứng trên hệ thống thật (server NestJS của repo)

Đối tượng đo:
- `POST /api/levels/:id/submit`: chạy engine WASM rồi ghi file leaderboard.
- 1 process, ghim vào 1 core.
- Bộ tạo tải kiểu open-model gồm 3 process trên 3 core khác.

Số liệu nằm trong `examples/calibration/`.

| rps | p50 | p95 | p99 | CPU process | CPU / request |
|---:|---:|---:|---:|---:|---:|
| 200 | 1.2 | 3.2 | 7.1 | 18% | 0.90 ms |
| 900 | 0.8 | 3.4 | 17.1 | 49% | 0.55 ms |
| 1500 | 0.8 | 39.5 | 80.7 | 71% | 0.47 ms |
| 2000 | 0.6 | 24.7 | 89.6 | 85% | 0.42 ms |
| 2500 | 3.0 | 56.8 | 153.8 | 91% | 0.36 ms |
| 2800 | 6.4 | 68.2 | 194.2 | 94% | 0.34 ms |
| 3200 | 79 | 4261 | 11083 | sập | |

Chỉ dùng 3 mức đầu (200, 900, 1500) để hiệu chỉnh, rồi so dự đoán với các mức còn lại:

| Cách làm | Dự đoán p99 ≤ 100ms | Dự đoán điểm sập | Thực tế |
|---|---:|---:|---|
| Fit tự động chỉ từ latency (`api.cpu` + `*.latency`) | ~1465 rps | ~1520 rps | **sai khoảng 2 lần**: mô hình giải thích đuôi p99 bằng CPU gần đầy |
| CPU đo trực tiếp (0.3 ms ở tải cao), chỉ fit `wakeup` + GC | ~2440–2530 rps | ~2700 rps | p99 ≤ 100ms tới khoảng 2000–2200; sập khoảng 3000 |

Bài học:

1. **Chỉ có latency thì chưa đủ.** p99 tăng có thể do xếp hàng (CPU gần đầy) hoặc do pause (GC, I/O đồng bộ) trong khi CPU còn thấp. Hai nguyên nhân này cho ra cùng một bộ p50/p99 ở tải thấp nhưng dự đoán điểm gãy hoàn toàn khác nhau. Hãy đo CPU.
2. **CPU mỗi request không cố định.** Trên Node, nó giảm 2–3 lần khi tải tăng vì các request được gom batch trong event loop. Hãy dùng con số đo ở gần tải mục tiêu. Mô hình `wakeupMs` chỉ xấp xỉ được hiệu ứng này: đường cong utilization ở mức giữa vẫn lệch.
3. **Kết quả đạt được:** điểm sập lệch khoảng 10%, p99 lệch tối đa khoảng 2 lần, ngưỡng SLO lạc quan khoảng 20%. Đủ để chọn cỡ server và so sánh phương án. **Chưa đủ** để thay bước load test xác nhận: luôn chạy thêm một bậc k6 quanh mức giới hạn dự đoán.

## 5. Sizing: từ tải mục tiêu đến gói VPS

```bash
pnpm sim size sizing.json          # hoặc tab Công suất → Chọn server
```

```jsonc
{
  "traffic": { "peakRps": 700, "burstFactor": 1.5 },           // hoặc dailyActiveUsers, requestsPerUser, peakFactor
  "app": { "cpuMsP50": 4, "cpuMsP99": 12, "queriesPerRequest": 3, "ramMbPerProcess": 200, "poolPerProcess": 10 },
  "db": { "queryMsP50": 2, "queryMsP99": 10, "cpuFraction": 0.5, "maxConnections": 100, "hotDataGb": 4 },
  "cpuSpeedRatio": 0.6,                                         // vCPU cloud so với máy bạn đã đo
  "slo": { "p99Ms": 300, "errorRate": 0.01 },
  "redundancy": true,                                           // N+1: chịu được mất 1 app server
  "plans": [{ "name": "Shared 4 vCPU / 8 GB", "vcpu": 4, "ramGb": 8, "pricePerMonth": 24, "dedicated": false }]
}
```

Cách tính:

1. **Utilization law:** số core bận = rps × CPU-ms ÷ 1000, áp cho app và cho DB (rps × số query × phần CPU của query).
2. **Lọc tổ hợp** (gói app × số server × gói DB):
   - RAM phải đủ: 1 process mỗi vCPU × RAM/process; DB chứa vừa dữ liệu nóng.
   - Loại tổ hợp quá tải rõ ràng (trên 92% lúc đột biến, hoặc lúc mất 1 server).
   - Tự giảm pool cho mỗi process sao cho tổng ≤ 90% `max_connections`.
   - vCPU dùng chung bị trừ khoảng 15% (steal) và có đuôi latency dày gấp 1.5.
3. **Mô phỏng tổ hợp rẻ nhất trước**, với design Node cluster (round-robin) kèm pool và Postgres. Các kịch bản:
   - Cao điểm.
   - Đột biến ×burst.
   - Mất 1 app server.
   - DB chậm ×2 (chỉ để tham khảo).

   Chọn tổ hợp đầu tiên đạt SLO ở mọi kịch bản bắt buộc.
4. **So với quy tắc "60% CPU":** mô phỏng thường chỉ ra phương án rẻ hơn vẫn đạt, hoặc phương án theo công thức trượt vì pool hay vì mất một server.

Các bẫy wizard tự cảnh báo:
- Pool vượt `max_connections`.
- vCPU dùng chung bị steal.
- Node chạy đơn luồng: cần chạy cluster, mỗi process có pool riêng.

Các yếu tố wizard chưa xét:
- Cache, read replica.
- Hiệu năng ổ đĩa (IOPS).
- Giới hạn băng thông của nhà cung cấp.
