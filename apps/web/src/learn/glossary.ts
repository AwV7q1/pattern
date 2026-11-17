// Glossary for beginners. Terms found in lesson text are underlined; clicking
// one shows its short definition. The full list is in the glossary dialog.

export interface Term {
  id: string;
  /** Display name, e.g. `p99`. */
  term: string;
  /** Spellings matched in lesson text (case-insensitive, whole words). `term` itself is always matched. */
  aliases?: string[];
  /** One or two plain sentences, no jargon that is not itself in the glossary. */
  short: string;
  /** Optional concrete example. */
  example?: string;
  /** Unit where the term is taught (groups the glossary). */
  unit: string;
}

export const GLOSSARY: Term[] = [
  // ---------------------------------------------------------------- u1: request đi đâu
  {
    id: 'client',
    term: 'Client',
    short: 'Bên gửi yêu cầu: trình duyệt, app điện thoại, hoặc một server khác đang gọi sang.',
    unit: 'u1',
  },
  {
    id: 'server',
    term: 'Server',
    aliases: ['máy chủ'],
    short: 'Chương trình (và cái máy chạy nó) nhận request, xử lý rồi trả response.',
    unit: 'u1',
  },
  {
    id: 'request',
    term: 'Request',
    aliases: ['yêu cầu'],
    short: 'Một lần client hỏi server, ví dụ "cho tôi danh sách sản phẩm".',
    example: '`GET /products`',
    unit: 'u1',
  },
  {
    id: 'response',
    term: 'Response',
    short: 'Câu trả lời server gửi lại cho request: dữ liệu (thường là JSON) hoặc mã lỗi.',
    example: '`200 OK` kèm JSON, hoặc `503` khi server quá tải.',
    unit: 'u1',
  },
  {
    id: 'api',
    term: 'API',
    short: 'Phần backend nhận request từ client qua HTTP, ví dụ một app NestJS hay Express.',
    unit: 'u1',
  },
  {
    id: 'database',
    term: 'Database',
    aliases: ['DB', 'cơ sở dữ liệu'],
    short: 'Nơi lưu dữ liệu lâu dài (Postgres, MySQL, MongoDB…). Thường là phần chậm và khó mở rộng nhất.',
    unit: 'u1',
  },
  {
    id: 'hop',
    term: 'Chặng (hop)',
    aliases: ['hop', 'chặng'],
    short: 'Một lần gọi từ dịch vụ này sang dịch vụ khác, gồm request đi và response về.',
    unit: 'u1',
  },
  {
    id: 'latency',
    term: 'Latency',
    aliases: ['độ trễ'],
    short: 'Thời gian từ lúc gửi request đến lúc nhận đủ response. Gồm thời gian mạng, xử lý và xếp hàng.',
    unit: 'u1',
  },
  {
    id: 'datacenter',
    term: 'Datacenter',
    short: 'Toà nhà chứa hàng nghìn server. Các máy trong cùng datacenter nói chuyện với nhau rất nhanh (dưới 1 ms).',
    unit: 'u1',
  },
  {
    id: 'percentile',
    term: 'Phân vị (percentile)',
    aliases: ['percentile', 'phân vị', 'p90', 'p99.9'],
    short: 'Xếp mọi request từ nhanh đến chậm. pX là mức mà X% request nhanh hơn. p90 = 90% nhanh hơn, p99.9 = 999/1000 nhanh hơn.',
    unit: 'u1',
  },
  {
    id: 'p50',
    term: 'p50',
    aliases: ['median', 'trung vị'],
    short: 'Độ trễ của request "ở giữa": một nửa nhanh hơn, một nửa chậm hơn. Đây là trải nghiệm của người dùng bình thường.',
    example: 'p50 = 40 ms: một nửa số request xong trong 40 ms.',
    unit: 'u1',
  },
  {
    id: 'p99',
    term: 'p99',
    short: '99% request nhanh hơn mức này, 1% chậm hơn. Dùng để đo những người dùng gặp chậm nhất.',
    example: 'p99 = 800 ms: cứ 100 request thì 1 cái chờ hơn 0.8 giây.',
    unit: 'u1',
  },
  {
    id: 'tail',
    term: 'Tail latency',
    aliases: ['cái đuôi', 'đuôi latency'],
    short: 'Phần request chậm nhất (khoảng p99 trở lên). Ít về tỉ lệ nhưng lại là nhiều người thật khi traffic lớn.',
    unit: 'u1',
  },
  {
    id: 'slo',
    term: 'SLO',
    short: 'Service Level Objective: mục tiêu chất lượng mà team cam kết đạt, ví dụ "p99 dưới 300 ms và lỗi dưới 1%".',
    unit: 'u1',
  },
  {
    id: 'rps',
    term: 'rps',
    aliases: ['request/giây'],
    short: 'Requests per second: số request đến (hoặc được xử lý) mỗi giây.',
    unit: 'u1',
  },
  {
    id: 'throughput',
    term: 'Throughput',
    aliases: ['thông lượng'],
    short: 'Số request hệ thống thực sự xử lý xong mỗi giây. Có thể thấp hơn số request đến nếu có request bị từ chối.',
    unit: 'u1',
  },
  {
    id: 'slot',
    term: 'Slot',
    aliases: ['concurrency'],
    short: 'Số request một server xử lý cùng lúc được (thread, connection, worker…). Hết slot thì request mới phải xếp hàng.',
    unit: 'u1',
  },
  {
    id: 'queue',
    term: 'Queue (hàng đợi)',
    aliases: ['queue', 'hàng đợi', 'xếp hàng'],
    short:
      'Chỗ request (hoặc message) nằm chờ đến lượt được xử lý. Trong server, hàng đợi đầy thì request mới bị từ chối. Ở Phần 6, "queue" còn là dịch vụ riêng như SQS hay RabbitMQ.',
    unit: 'u1',
  },
  {
    id: '503',
    term: '503',
    short: 'Mã lỗi HTTP "Service Unavailable": server đang quá tải hoặc tạm ngừng, không nhận thêm request.',
    unit: 'u1',
  },
  {
    id: 'error-rate',
    term: 'Tỉ lệ lỗi',
    aliases: ['error rate'],
    short: 'Phần trăm request thất bại (bị từ chối, timeout, lỗi 5xx) trên tổng số request.',
    unit: 'u1',
  },

  // ---------------------------------------------------------------- u2: gọi nhiều dịch vụ
  {
    id: 'sequential',
    term: 'Tuần tự',
    aliases: ['sequence'],
    short: 'Gọi lần lượt, cái sau chờ cái trước xong. Latency là tổng các chặng.',
    example: 'Nhiều dòng `await` liên tiếp.',
    unit: 'u2',
  },
  {
    id: 'parallel',
    term: 'Song song',
    aliases: ['parallel'],
    short: 'Gửi nhiều lời gọi cùng lúc rồi chờ tất cả. Latency bằng chặng chậm nhất.',
    example: '`Promise.all([...])`',
    unit: 'u2',
  },
  {
    id: 'promise-all',
    term: 'Promise.all',
    short: 'Hàm JavaScript chạy nhiều promise cùng lúc, chờ tất cả xong. Chỉ cần một cái lỗi là cả nhóm lỗi ngay (fail fast).',
    unit: 'u2',
  },
  {
    id: 'data-dependency',
    term: 'Phụ thuộc dữ liệu',
    short: 'Bước sau cần kết quả của bước trước, ví dụ phải có user id mới lấy được giỏ hàng. Chỉ khi đó mới bắt buộc phải gọi tuần tự.',
    unit: 'u2',
  },
  {
    id: 'fire-and-forget',
    term: 'Fire-and-forget',
    aliases: ['không chờ'],
    short: 'Gửi lời gọi đi rồi làm tiếp ngay, không chờ kết quả. Nhanh, nhưng nếu nó lỗi thì request hiện tại không biết.',
    example: 'Gửi email chào mừng sau khi đăng ký.',
    unit: 'u2',
  },
  {
    id: 'fan-out',
    term: 'Fan-out',
    short: 'Một request gọi ra nhiều dịch vụ phía dưới cùng lúc. Fan-out càng rộng thì càng dễ dính một chặng chậm.',
    unit: 'u2',
  },
  {
    id: 'hedged',
    term: 'Hedged request',
    short: 'Nếu một lời gọi chậm quá mức bình thường, gửi thêm một bản sao sang máy khác và lấy kết quả về trước.',
    unit: 'u2',
  },
  {
    id: 'payload',
    term: 'Payload',
    short: 'Phần dữ liệu thật trong request hoặc response (body JSON, ảnh…). Payload càng lớn thì truyền càng lâu.',
    unit: 'u2',
  },
  {
    id: 'bandwidth',
    term: 'Băng thông',
    aliases: ['bandwidth', 'Mbps'],
    short: 'Lượng dữ liệu đường truyền chở được mỗi giây, đo bằng Mbps (megabit/giây). 1 byte = 8 bit.',
    example: '1 MB qua đường 100 Mbps mất khoảng 80 ms.',
    unit: 'u2',
  },
  {
    id: 'pagination',
    term: 'Phân trang',
    aliases: ['pagination'],
    short: 'Trả dữ liệu từng phần (ví dụ 20 dòng mỗi trang) thay vì trả hết một lần.',
    unit: 'u2',
  },
  {
    id: 'cdn',
    term: 'CDN',
    short: 'Content Delivery Network: mạng server đặt gần người dùng, giữ sẵn file tĩnh (ảnh, JS, CSS) để trả nhanh.',
    unit: 'u2',
  },
  {
    id: 'trace',
    term: 'Trace',
    aliases: ['waterfall'],
    short: 'Bản ghi đường đi của một request qua từng dịch vụ, vẽ thành các thanh thời gian (waterfall) để thấy chặng nào tốn thời gian.',
    unit: 'u2',
  },

  // ---------------------------------------------------------------- u3: mở rộng
  {
    id: 'vertical',
    term: 'Scale dọc',
    aliases: ['vertical'],
    short: 'Tăng sức mạnh cho một máy: thêm CPU, RAM. Đơn giản nhưng có giới hạn và đắt dần.',
    unit: 'u3',
  },
  {
    id: 'horizontal',
    term: 'Scale ngang',
    aliases: ['horizontal'],
    short: 'Thêm nhiều máy giống nhau và chia request cho chúng. Mở rộng gần như không giới hạn, còn có dự phòng.',
    unit: 'u3',
  },
  {
    id: 'instance',
    term: 'Instance',
    short: 'Một bản đang chạy của dịch vụ (một máy, một container). "3 instance API" = 3 bản API chạy song song.',
    unit: 'u3',
  },
  {
    id: 'load-balancer',
    term: 'Load balancer',
    short: 'Thành phần đứng trước nhiều server, nhận request rồi chia cho từng server. Ví dụ Nginx, AWS ALB.',
    unit: 'u3',
  },
  {
    id: 'round-robin',
    term: 'Round-robin',
    short: 'Cách chia request lần lượt xoay vòng: máy 1, 2, 3, rồi lại 1.',
    unit: 'u3',
  },
  {
    id: 'least-connections',
    term: 'Least-connections',
    short: 'Cách chia request cho máy đang có ít request dở dang nhất.',
    unit: 'u3',
  },
  {
    id: 'redundancy',
    term: 'Dự phòng',
    aliases: ['N+1', 'redundancy'],
    short: 'Có dư năng lực để mất một máy vẫn chạy được. N+1 = số máy cần thiết cộng thêm một máy.',
    unit: 'u3',
  },
  {
    id: 'little',
    term: 'Định luật Little',
    aliases: ["Little's law"],
    short: 'Số request đang nằm trong hệ thống = tốc độ đến × thời gian mỗi request ở lại (L = λ × W).',
    example: '1000 rps × 0.2 s = 200 request đang mở cùng lúc.',
    unit: 'u3',
  },
  {
    id: 'utilization',
    term: 'Mức tải',
    aliases: ['utilization'],
    short: 'Phần trăm công suất đang dùng: số request đến ÷ số request tối đa xử lý được. Trên khoảng 80% thì thời gian xếp hàng tăng rất nhanh.',
    unit: 'u3',
  },
  {
    id: 'knee',
    term: 'Điểm gãy',
    short: 'Mức tải mà từ đó latency tăng vọt thay vì tăng từ từ. Thường nằm ở khoảng 80–90% tải.',
    unit: 'u3',
  },
  {
    id: 'cost',
    term: 'Chi phí/giờ',
    aliases: ['ngân sách'],
    short: 'Tiền thuê server tính theo giờ. Các bài thực hành giới hạn ngân sách để bạn không giải bằng cách thêm máy vô hạn.',
    unit: 'u3',
  },

  // ---------------------------------------------------------------- u4: dữ liệu
  {
    id: 'cache',
    term: 'Cache',
    short: 'Bộ nhớ đệm nhanh (thường là Redis, nằm trong RAM) giữ bản sao dữ liệu hay đọc, để khỏi hỏi database mỗi lần.',
    unit: 'u4',
  },
  {
    id: 'redis',
    term: 'Redis',
    short: 'Cơ sở dữ liệu key-value chạy trong RAM, rất nhanh (khoảng 1 ms). Hay dùng làm cache.',
    unit: 'u4',
  },
  {
    id: 'hit-miss',
    term: 'Hit / miss',
    aliases: ['hit', 'miss', 'cache hit', 'cache miss'],
    short: 'Hit: dữ liệu có sẵn trong cache. Miss: không có, phải đọc từ database.',
    unit: 'u4',
  },
  {
    id: 'hit-rate',
    term: 'Hit rate',
    short: 'Phần trăm lần đọc tìm thấy trong cache. Hit rate 90% nghĩa là database chỉ nhận 10% số lần đọc.',
    unit: 'u4',
  },
  {
    id: 'cache-aside',
    term: 'Cache-aside',
    short: 'Ứng dụng tự lo cache: hỏi cache trước, miss thì đọc database rồi ghi lại vào cache.',
    unit: 'u4',
  },
  {
    id: 'bottleneck',
    term: 'Nút cổ chai',
    aliases: ['bottleneck', 'nút thắt'],
    short: 'Thành phần chậm nhất, giới hạn tốc độ của cả hệ thống. Tăng chỗ khác không giúp được.',
    unit: 'u4',
  },
  {
    id: 'connection',
    term: 'Connection',
    aliases: ['kết nối'],
    short: 'Một đường kết nối mở sẵn giữa ứng dụng và database. Mỗi query đang chạy chiếm một connection.',
    unit: 'u4',
  },
  {
    id: 'pool',
    term: 'Connection pool',
    aliases: ['pool'],
    short: 'Nhóm connection mở sẵn để dùng lại, vì mở connection mới rất tốn thời gian. Hết connection trong pool thì request phải chờ.',
    unit: 'u4',
  },
  {
    id: 'orm',
    term: 'ORM',
    short: 'Thư viện cho phép làm việc với database bằng object thay vì viết SQL tay, ví dụ Prisma, TypeORM. Thường tự quản lý connection pool.',
    unit: 'u4',
  },
  {
    id: 'max-connections',
    term: 'max_connections',
    short: 'Số connection tối đa Postgres chấp nhận (mặc định 100). Vượt quá thì báo lỗi "too many connections".',
    unit: 'u4',
  },
  {
    id: 'pgbouncer',
    term: 'PgBouncer',
    short: 'Proxy đứng trước Postgres, gom hàng nghìn connection của ứng dụng thành vài chục connection thật tới database.',
    unit: 'u4',
  },
  {
    id: 'process',
    term: 'Process',
    short: 'Một chương trình đang chạy. Một server Node có thể chạy nhiều process (cluster), mỗi process có pool riêng.',
    unit: 'u4',
  },
  {
    id: 'flash-sale',
    term: 'Flash sale',
    short: 'Đợt giảm giá ngắn làm traffic tăng vọt trong vài phút.',
    unit: 'u4',
  },

  // ---------------------------------------------------------------- u5: khi mọi thứ hỏng
  {
    id: 'timeout',
    term: 'Timeout',
    short: 'Thời gian chờ tối đa cho một lời gọi. Quá hạn thì bỏ cuộc và coi là lỗi, thay vì chờ mãi.',
    unit: 'u5',
  },
  {
    id: 'cascading',
    term: 'Cascading failure',
    aliases: ['lỗi lan'],
    short: 'Lỗi dây chuyền: một dịch vụ chậm hoặc chết làm các dịch vụ gọi nó cũng nghẽn theo, lan dần lên trên.',
    unit: 'u5',
  },
  {
    id: 'retry',
    term: 'Retry',
    aliases: ['thử lại'],
    short: 'Gửi lại request khi lần trước lỗi. Hữu ích với lỗi thoáng qua, nhưng làm tăng tải.',
    unit: 'u5',
  },
  {
    id: 'retry-storm',
    term: 'Retry storm',
    short: 'Dịch vụ đang quá tải, mọi client cùng retry làm tải tăng gấp nhiều lần, khiến nó càng không hồi phục được.',
    unit: 'u5',
  },
  {
    id: 'backoff',
    term: 'Backoff',
    short: 'Chờ lâu dần giữa các lần retry. Backoff mũ: mỗi lần chờ gấp đôi (100, 200, 400 ms…).',
    unit: 'u5',
  },
  {
    id: 'jitter',
    term: 'Jitter',
    short: 'Cộng thêm một khoảng thời gian ngẫu nhiên vào lúc retry, để các client không retry cùng một lúc.',
    unit: 'u5',
  },
  {
    id: 'breaker',
    term: 'Circuit breaker',
    aliases: ['breaker', 'cầu dao'],
    short: 'Khi lỗi quá nhiều, tạm ngừng gọi dịch vụ đó và trả lỗi ngay, để nó có thời gian hồi phục. Có 3 trạng thái: đóng, mở, nửa mở.',
    unit: 'u5',
  },
  {
    id: 'zone',
    term: 'Zone',
    aliases: ['availability zone'],
    short: 'Một khu datacenter độc lập về điện và mạng trong cùng vùng. Chạy ở nhiều zone thì mất một zone vẫn sống.',
    unit: 'u5',
  },

  // ---------------------------------------------------------------- u6: bất đồng bộ
  {
    id: 'message',
    term: 'Message',
    short: 'Một gói dữ liệu được gửi vào queue để xử lý sau, ví dụ "đơn hàng #123 cần xử lý".',
    unit: 'u6',
  },
  {
    id: 'mq',
    term: 'SQS / RabbitMQ / Kafka',
    aliases: ['SQS', 'RabbitMQ', 'Kafka', 'message queue'],
    short: 'Các dịch vụ queue phổ biến. Bên gửi đẩy message vào, bên nhận lấy ra xử lý theo tốc độ của mình.',
    unit: 'u6',
  },
  {
    id: 'consumer',
    term: 'Consumer',
    aliases: ['worker'],
    short: 'Tiến trình lấy message ra khỏi queue và xử lý. Thêm consumer thì xử lý nhanh hơn.',
    unit: 'u6',
  },
  {
    id: 'backlog',
    term: 'Backlog',
    short: 'Số message đang tồn trong queue chờ xử lý. Backlog tăng mãi nghĩa là consumer không theo kịp.',
    unit: 'u6',
  },
  {
    id: 'backpressure',
    term: 'Backpressure',
    short: 'Cơ chế báo cho bên gửi chậm lại (hoặc từ chối bớt) khi bên nhận không theo kịp, thay vì để mọi thứ tràn.',
    unit: 'u6',
  },
  {
    id: 'peak',
    term: 'Đỉnh tải',
    aliases: ['đột biến', 'spike'],
    short: 'Khoảng thời gian traffic cao hơn hẳn bình thường, ví dụ Black Friday, flash sale.',
    unit: 'u6',
  },

  // ---------------------------------------------------------------- u7: nâng cao
  {
    id: 'event-loop',
    term: 'Event loop',
    short: 'Vòng lặp của Node.js chạy JavaScript trên một luồng duy nhất. Code đồng bộ chạy lâu sẽ chặn mọi request khác.',
    unit: 'u7',
  },
  {
    id: 'event-loop-lag',
    term: 'Event loop lag',
    short: 'Thời gian một việc phải chờ trước khi event loop rảnh để chạy nó. Lag cao nghĩa là CPU của process đang bận.',
    unit: 'u7',
  },
  {
    id: 'thread',
    term: 'Thread',
    aliases: ['luồng'],
    short: 'Luồng thực thi trong một process. Node chạy JS trên 1 luồng, nhưng có thread pool riêng cho I/O và crypto.',
    unit: 'u7',
  },
  {
    id: 'cpu-io',
    term: 'CPU và I/O',
    aliases: ['I/O', 'CPU-ms'],
    short: 'CPU: thời gian máy thật sự tính toán. I/O: thời gian chờ mạng, đĩa, database, lúc đó CPU rảnh. CPU-ms = số mili giây CPU mỗi request tốn.',
    unit: 'u7',
  },
  {
    id: 'sync',
    term: 'Đồng bộ',
    aliases: ['synchronous'],
    short: 'Code chạy liền một mạch, không nhường event loop, ví dụ `bcrypt.hashSync`. Trong lúc đó các request khác phải chờ.',
    unit: 'u7',
  },
  {
    id: 'cluster',
    term: 'Cluster',
    short: 'Chạy nhiều process Node trên cùng máy, thường mỗi core một process, để dùng hết CPU.',
    unit: 'u7',
  },
  {
    id: 'core',
    term: 'Core / vCPU',
    aliases: ['core', 'vCPU'],
    short: 'Nhân xử lý. Một core chạy được một luồng tại một thời điểm. Trên cloud, vCPU là một core ảo.',
    unit: 'u7',
  },
  {
    id: 'gc',
    term: 'GC pause',
    aliases: ['GC'],
    short: 'Garbage collector dừng chương trình một lúc để dọn bộ nhớ. Làm p99 tăng dù p50 vẫn thấp.',
    unit: 'u7',
  },
  {
    id: 'load-test',
    term: 'Load test',
    aliases: ['load generator'],
    short: 'Bắn nhiều request giả lập vào hệ thống để đo nó chịu được bao nhiêu. Công cụ tạo request gọi là load generator.',
    unit: 'u7',
  },
  {
    id: 'k6',
    term: 'k6',
    short: 'Công cụ load test viết kịch bản bằng JavaScript. `constant-arrival-rate` gửi request theo lịch cố định.',
    unit: 'u7',
  },
  {
    id: 'co',
    term: 'Coordinated omission',
    short: 'Lỗi đo: load generator chờ response mới gửi tiếp, nên khi server chậm nó gửi ít đi và che mất tình trạng quá tải.',
    unit: 'u7',
  },
  {
    id: 'vps',
    term: 'VPS',
    short: 'Virtual Private Server: máy ảo thuê theo tháng với số vCPU và RAM cố định.',
    unit: 'u7',
  },
  {
    id: 'sizing',
    term: 'Sizing',
    short: 'Tính xem cần bao nhiêu server, cỡ nào, từ số liệu đo được (rps, CPU-ms, RAM…).',
    unit: 'u7',
  },
];

// ---------------------------------------------------------------- matching

/** Lowercased spelling -> term. */
export const TERM_BY_SPELLING = new Map<string, Term>();
for (const t of GLOSSARY) {
  // "Queue (hàng đợi)" -> also match "Queue"
  const base = t.term.replace(/\s*\(.*\)$/, '');
  for (const s of new Set([t.term, base, ...(t.aliases ?? [])])) TERM_BY_SPELLING.set(s.toLowerCase(), t);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive; longer spellings win (`cache-aside` before `cache`). */
export const TERM_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${[...TERM_BY_SPELLING.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|')})(?![\\p{L}\\p{N}_])`,
  'giu',
);

/** Split `text` into plain strings and glossary hits. */
export function findTerms(text: string): (string | { text: string; term: Term })[] {
  const out: (string | { text: string; term: Term })[] = [];
  let last = 0;
  for (const m of text.matchAll(TERM_RE)) {
    const term = TERM_BY_SPELLING.get(m[0].toLowerCase());
    if (!term) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ text: m[0], term });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Lowercase, no Vietnamese diacritics, for search. */
export function fold(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}
