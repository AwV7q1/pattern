# Server: PostgreSQL, tài khoản, chạy trên một VPS

Server NestJS (`apps/server`) lo phần cần chia sẻ: tài khoản, đồng bộ dự án, link chia sẻ, leaderboard, level cộng đồng, lịch sử phỏng vấn. Không có server thì web vẫn chạy đầy đủ ở **chế độ cục bộ** (IndexedDB).

Quy mô nhắm tới: chạy local là chính, khi deploy thì một VPS, vài chục người dùng. Vì vậy mọi thứ dùng thành phần tiêu chuẩn, ít phụ thuộc: PostgreSQL, Prisma, session lưu ở server, không Redis, không message broker.

## Chạy local

```bash
cp apps/server/.env.example apps/server/.env
pnpm db:up                      # PostgreSQL 17 trong Docker (cổng 5432, chỉ localhost)
pnpm db:migrate                 # áp schema (prisma migrate deploy)
pnpm user:create --email ban@vi.du --name "Bạn" --admin --password 'mat-khau-dai'
pnpm dev:server                 # http://localhost:3000/api
pnpm dev                        # web, proxy /api → 3000
```

Không dùng Docker: tạo user và database `pattern` (cùng `pattern_test` cho test) trên PostgreSQL có sẵn, sửa `DATABASE_URL` trong `.env`.

Đổi schema: sửa `apps/server/prisma/schema.prisma` rồi `pnpm --filter server db:migrate:dev --name <tên>` để sinh migration mới, commit cả thư mục `prisma/migrations`.

## Cấu hình (`apps/server/.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | (bắt buộc) | Chuỗi kết nối PostgreSQL |
| `DATABASE_URL_TEST` | `…/pattern_test` | Database riêng cho test, bị xoá sạch mỗi lần chạy |
| `ALLOW_SIGNUP` | `false` | Cho phép tự tạo tài khoản. Tài khoản đầu tiên tự đăng ký là admin |
| `SESSION_TTL_DAYS` | `30` | Session trượt: mỗi lần dùng được gia hạn |
| `COOKIE_SECURE` | `true` khi production | Cookie chỉ gửi qua HTTPS |
| `WEB_ORIGIN` | (trống) | Chỉ cần khi web và API khác origin (bật CORS kèm cookie) |
| `TRUST_PROXY` | (trống) | Đặt `1` khi chạy sau Caddy/nginx để lấy đúng IP người dùng |
| `ENGINE_THREADS` | `min(2, CPU − 1)` | Số worker thread chạy mô phỏng |
| `ENGINE_TIMEOUT_MS` | `15000` | Mô phỏng chạy lâu hơn thì huỷ (503) |

Biến môi trường được kiểm tra bằng zod lúc khởi động; sai là dừng ngay với thông báo rõ ràng.

## Xác thực

- **Mật khẩu**: argon2id (19 MiB, 2 vòng), theo khuyến nghị OWASP. Email sai và mật khẩu sai trả cùng một lỗi, cùng thời gian xử lý.
- **Session phía server** (bảng `Session`): cookie `pattern_sid` là token ngẫu nhiên 256 bit, `HttpOnly`, `SameSite=Lax`, `Secure` khi production. Database chỉ lưu SHA-256 của token, nên lộ database không lộ session đang sống. Đăng xuất hoặc thu hồi thiết bị có hiệu lực ngay (khác với JWT).
- **CSRF**: mọi request thay đổi dữ liệu phải có header `X-Requested-With`. Trình duyệt không cho site khác thêm header tuỳ ý nếu không qua CORS preflight (mà server không cấp), cộng thêm `SameSite=Lax`.
- **Phân quyền**: guard toàn cục, route mặc định cần đăng nhập, mở công khai bằng `@Public()`, giới hạn vai trò bằng `@Roles('admin')`.
- **Giới hạn tốc độ** (`@nestjs/throttler`, theo user nếu đã đăng nhập, theo IP nếu chưa): đăng nhập 10 lần/phút, đăng ký 5 lần/phút, các route chạy mô phỏng 10 lần/phút.
- Trang `/account`: đổi tên hiển thị, đổi mật khẩu (các thiết bị khác bị đăng xuất), xem và thu hồi thiết bị.

### Kế hoạch SSO (OIDC)

Schema đã tách **User** (con người) khỏi **Identity** (cách đăng nhập: `provider` + `subject`). Thêm SSO (Authentik, Keycloak, Google…) gồm:

1. Một `OidcProvider` dùng `openid-client`: route `GET /api/auth/oidc/:name` chuyển hướng tới IdP (PKCE + state lưu trong cookie tạm), route callback đổi code lấy ID token.
2. Gọi `AuthService.signInExternal({ provider: 'oidc:<name>', subject: sub, email, displayName })`: tìm Identity đã liên kết, không có thì liên kết theo email đã xác minh hoặc tạo User mới.
3. Tạo session như đăng nhập thường. Guard, cookie, controller khác không đổi. `GET /api/auth/providers` liệt kê thêm provider để trang đăng nhập hiện nút.

## Mô phỏng phía server

Engine Rust biên dịch sang WASM (`pkg-node`) chạy trong **worker pool** (`piscina`), nên một lần chấm điểm nặng không chặn event loop. Hàng đợi tối đa 16 việc, quá thì trả 503. Kết quả giống hệt trình duyệt và CLI native (test kiểm tra từng chữ số).

## CLI quản trị

```bash
pnpm --filter server cli create-user --email a@b.c --name Alice [--admin] --password '...'
pnpm --filter server cli set-password --email a@b.c --password '...'   # đăng xuất mọi thiết bị của user
pnpm --filter server cli list-users
pnpm --filter server cli import-leaderboard data/leaderboard.json   # dữ liệu của bản leaderboard cũ (file JSON)
```

Có thể truyền mật khẩu qua biến `PATTERN_PASSWORD` thay vì `--password` để không lưu trong lịch sử shell.

## Deploy lên một VPS

1. Cài Node 22, pnpm, Rust + `wasm-pack`, Docker (cho PostgreSQL), Caddy.
2. `pnpm install && pnpm build:wasm && pnpm --filter web build && pnpm --filter server build`.
3. `.env` với `NODE_ENV=production`, `TRUST_PROXY=1`, mật khẩu PostgreSQL mạnh (`POSTGRES_PASSWORD` khi `docker compose up`).
4. `pnpm db:up && pnpm db:migrate`, tạo tài khoản admin bằng CLI.
5. Chạy server bằng systemd (`node apps/server/dist/main.js`, `WorkingDirectory=apps/server`, `Restart=always`).
6. Caddy phục vụ web tĩnh và chuyển `/api` vào server, HTTPS tự động:

```caddy
pattern.example.com {
  encode zstd gzip
  handle /api/* {
    reverse_proxy 127.0.0.1:3000
  }
  handle {
    root * /srv/pattern/apps/web/dist
    try_files {path} /index.html
    file_server
  }
}
```

Web và API cùng origin nên không cần CORS. Sao lưu: `docker compose exec db pg_dump -U pattern pattern | gzip > backup-$(date +%F).sql.gz` theo cron.

## Kiểm tra

`pnpm --filter server test` chạy migration lên `DATABASE_URL_TEST`, xoá sạch các bảng, rồi kiểm tra: health, đăng ký/đăng nhập/đăng xuất, CSRF, thu hồi session, chấm điểm khớp CLI native, xếp hạng, từ chối design sai, worker pool chạy song song cho kết quả giống nhau.
