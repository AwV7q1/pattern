import type { SimSpec, Unit } from './types';

// ---------------------------------------------------------------- tiny scenario builders for `predict` cards

const scenario = (rps: number, p99Ms = 500) => ({
  seed: 1,
  durationMs: 20000,
  timeoutMs: 5000,
  traffic: [{ atMs: 0, rps }],
  slo: { p99Ms, errorRate: 0.01 },
  windowMs: 1000,
});

const svc = (id: string, p50: number, p99: number, concurrency = 1000, queueSize = 1000, extra: object = {}) => ({
  id,
  kind: 'service',
  config: { latencyP50Ms: p50, latencyP99Ms: p99, concurrency, queueSize, ...extra },
});

/** Users → API, one hop. */
function oneHop(opts: { latencyMs: number; p50: number; p99: number; concurrency?: number; queue?: number; rps: number }): SimSpec {
  return {
    design: {
      nodes: [{ id: 'client', kind: 'client' }, svc('api', opts.p50, opts.p99, opts.concurrency, opts.queue)],
      edges: [{ source: 'client', target: 'api', latencyMs: opts.latencyMs }],
    },
    scenario: scenario(opts.rps),
  };
}

/** API calling `n` identical backends in parallel. */
function fanOut(n: number, p50: number, p99: number): SimSpec {
  const backends = Array.from({ length: n }, (_, i) => svc(`b${i + 1}`, p50, p99));
  return {
    design: {
      nodes: [{ id: 'client', kind: 'client' }, svc('api', 0.5, 1, 1000, 1000, { routing: 'parallel' }), ...backends],
      edges: [
        { source: 'client', target: 'api', latencyMs: 0.5 },
        ...backends.map((b) => ({ source: 'api', target: b.id, latencyMs: 0.5 })),
      ],
    },
    scenario: scenario(100),
  };
}

// ---------------------------------------------------------------- the path

export const UNITS: Unit[] = [
  {
    id: 'u1',
    title: 'Request đi đâu?',
    tier: 'Cơ bản',
    color: '#34d399',
    description: 'Client, server, request, response, độ trễ và vì sao người ta nhìn p99 chứ không nhìn trung bình.',
    lessons: [
      {
        id: 'u1-client-server',
        title: 'Client và server',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Gọi món ở nhà hàng',
            body: 'Bạn (**client**) gọi món, nhà bếp (**server**) nấu, phục vụ mang món ra. Web cũng vậy: trình duyệt gửi **request** (yêu cầu), server xử lý rồi gửi lại **response** (kết quả).\n\nTrong simulator, mũi tên **xanh dương** là request đi tới, chấm **xanh lá** là response quay về, chạy ở làn bên kia của đường nối.',
            anim: {
              actors: ['Trình duyệt', 'API'],
              steps: [
                { from: 0, to: 1, label: 'GET /products' },
                { from: 1, to: 0, label: '200 OK + JSON', kind: 'res' },
              ],
            },
          },
          {
            type: 'choice',
            question: 'Trên canvas, chấm xanh lá chạy từ API về phía Users là gì?',
            options: ['Một request mới', 'Response trả về cho người dùng', 'Một lần retry', 'Lỗi'],
            answer: 1,
            explain: 'Response luôn đi ngược chiều request, về lại bên đã gọi. Retry là mũi tên cam, lỗi là dấu × đỏ.',
          },
          {
            type: 'read',
            title: 'Một request, nhiều chặng',
            body: 'Hiếm khi API trả lời một mình. Nó thường hỏi tiếp database, cache, hay dịch vụ khác. Mỗi lời gọi là một **chặng** (hop): request đi xuống, response đi lên, rồi API mới trả lời người dùng.\n\nĐây là ý quan trọng nhất của cả lộ trình: **người dùng phải chờ đến khi chặng cuối cùng trả lời.**',
            anim: {
              actors: ['Users', 'API', 'Database'],
              steps: [
                { from: 0, to: 1, label: 'request' },
                { from: 1, to: 2, label: 'SELECT …' },
                { from: 2, to: 1, label: 'rows', kind: 'res' },
                { from: 1, to: 0, label: 'response', kind: 'res' },
              ],
            },
          },
          {
            type: 'order',
            question: 'Sắp xếp các bước của một request đọc sản phẩm theo đúng thứ tự:',
            items: ['Trình duyệt gửi request', 'API nhận và hỏi database', 'Database trả dữ liệu cho API', 'API trả response cho trình duyệt'],
            explain: 'Request đi xuống từng tầng, response đi ngược lên theo đúng đường đó.',
          },
        ],
      },
      {
        id: 'u1-latency',
        title: 'Độ trễ',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Latency = mạng + xử lý + chờ',
            body: 'Thời gian người dùng chờ (**latency**) gồm:\n- **mạng**: tín hiệu đi qua dây, khoảng 0.5 ms trong cùng datacenter, 50–150 ms xuyên lục địa\n- **xử lý**: server tính toán, đọc dữ liệu\n- **chờ**: xếp hàng khi server bận (phần nguy hiểm nhất, học ở bài sau)\n\nMạng tính **hai lần**: một lần đi, một lần về.',
          },
          {
            type: 'choice',
            question: 'Mạng mỗi chiều 10 ms, server xử lý 30 ms, không ai xếp hàng. Người dùng chờ bao lâu?',
            options: ['30 ms', '40 ms', '50 ms', '60 ms'],
            answer: 2,
            explain: '10 ms đi + 30 ms xử lý + 10 ms về = 50 ms.',
          },
          {
            type: 'predict',
            question: 'Chạy thử đúng kịch bản đó trong simulator: 100 request/giây, API xử lý 30 ms. p50 sẽ là bao nhiêu?',
            sim: oneHop({ latencyMs: 10, p50: 30, p99: 30, rps: 100 }),
            metric: 'p50Ms',
            options: [
              { label: 'khoảng 30 ms', min: 0, max: 38 },
              { label: 'khoảng 40 ms', min: 38, max: 45 },
              { label: 'khoảng 50 ms', min: 45, max: 60 },
              { label: 'trên 60 ms', min: 60, max: Infinity },
            ],
            explain: 'Simulator cộng đúng như bạn tính: mạng hai chiều cộng thời gian xử lý.',
          },
        ],
      },
      {
        id: 'u1-percentiles',
        title: 'p50, p99',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Trung bình nói dối',
            body: 'Xếp 100 request theo thời gian chờ, từ nhanh đến chậm:\n- **p50**: request thứ 50, người dùng "bình thường"\n- **p99**: request thứ 99. Cứ 100 người thì 1 người chờ lâu hơn mức này\n\n99 request mất 10 ms và 1 request mất 5 giây thì trung bình chỉ khoảng 60 ms, trông rất ổn, trong khi có người đã bỏ đi. Vì vậy SLO (cam kết chất lượng) thường viết theo **p99**.',
          },
          {
            type: 'choice',
            question: '"p99 = 800 ms" nghĩa là gì?',
            options: [
              'Request nhanh nhất mất 800 ms',
              '99% request xong trong 800 ms, 1% chậm hơn',
              'Trung bình là 800 ms',
              '99 request bị lỗi',
            ],
            answer: 1,
            explain: 'p99 là ngưỡng mà 99% request nhanh hơn. 1% còn lại là "cái đuôi" (tail latency).',
          },
          {
            type: 'choice',
            question: 'Trang web có 1 triệu lượt xem/ngày, p99 = 3 giây. Bao nhiêu lượt chờ hơn 3 giây?',
            options: ['Khoảng 100', 'Khoảng 1.000', 'Khoảng 10.000', 'Gần như không có'],
            answer: 2,
            explain: '1% của 1 triệu là 10.000 lượt mỗi ngày. "Chỉ 1%" nhưng là rất nhiều người thật.',
          },
        ],
      },
      {
        id: 'u1-throughput',
        title: 'Throughput và hàng đợi',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Một server phục vụ được bao nhiêu?',
            body: 'Một server có một số **slot** (thread, connection) làm việc cùng lúc. Mỗi request chiếm một slot trong thời gian xử lý.\n\n**Công suất ≈ số slot ÷ thời gian xử lý.** Ví dụ 10 slot, mỗi request 50 ms (0.05 s): 10 ÷ 0.05 = **200 request/giây** (rps).\n\nRequest đến nhanh hơn mức đó thì phải **xếp hàng**. Hàng đợi đầy thì server **từ chối** (lỗi 503).',
          },
          {
            type: 'choice',
            question: 'Server có 20 slot, mỗi request xử lý 100 ms. Công suất tối đa khoảng bao nhiêu?',
            options: ['20 rps', '100 rps', '200 rps', '2000 rps'],
            answer: 2,
            explain: '20 ÷ 0.1 s = 200 rps.',
          },
          {
            type: 'predict',
            question: 'Server 10 slot, 50 ms mỗi request (công suất 200 rps), hàng đợi 20 chỗ. Bắn 300 rps vào. Tỉ lệ lỗi khoảng bao nhiêu?',
            sim: oneHop({ latencyMs: 1, p50: 50, p99: 50, concurrency: 10, queue: 20, rps: 300 }),
            metric: 'errorRate',
            options: [
              { label: 'dưới 1%', min: 0, max: 0.01 },
              { label: '1–15%', min: 0.01, max: 0.15 },
              { label: '15–50%', min: 0.15, max: 0.5 },
              { label: 'trên 50%', min: 0.5, max: Infinity },
            ],
            explain: 'Chỉ 200/300 request được phục vụ, nên khoảng 1/3 bị từ chối. Hàng đợi chỉ giúp được khi vượt tải trong thời gian ngắn, không giúp được khi quá tải kéo dài.',
          },
        ],
      },
      {
        id: 'u1-practice',
        title: 'Thực hành: quán đông khách',
        kind: 'practice',
        cards: [
          {
            type: 'build',
            level: 'learn/01-busy-cafe',
            intro: 'Tăng số server cho API để chịu 900 rps trong ngân sách. Chạy thử, xem node đỏ lên, rồi bấm "Chấm điểm".',
          },
        ],
      },
    ],
  },
  {
    id: 'u2',
    title: 'Gọi nhiều dịch vụ: thứ tự là tất cả',
    tier: 'Cơ bản',
    color: '#60a5fa',
    description: 'Tuần tự hay song song, khi nào không cần chờ, vì sao gọi nhiều dịch vụ làm p99 xấu đi, và payload lớn tốn gì.',
    lessons: [
      {
        id: 'u2-sequence',
        title: 'Gọi tuần tự',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'await nối tiếp',
            body: 'Trong code ta hay viết:\n\n`const user = await auth();`\n`const cart = await getCart(user);`\n`const pay = await charge(cart);`\n\nMỗi lời gọi **chờ cái trước xong** mới chạy. Latency là **tổng** các chặng. Trên canvas, node gọi tuần tự có các nhánh đánh số ①②③.',
            anim: {
              actors: ['Checkout', 'Auth', 'Cart', 'Payment'],
              steps: [
                { from: 0, to: 1, label: '① auth' },
                { from: 1, to: 0, kind: 'res' },
                { from: 0, to: 2, label: '② cart' },
                { from: 2, to: 0, kind: 'res' },
                { from: 0, to: 3, label: '③ charge' },
                { from: 3, to: 0, kind: 'res' },
              ],
            },
          },
          {
            type: 'choice',
            question: 'Auth 20 ms, Cart 30 ms, Payment 50 ms, gọi tuần tự (bỏ qua mạng). Checkout mất bao lâu?',
            options: ['50 ms', '70 ms', '100 ms', '150 ms'],
            answer: 2,
            explain: '20 + 30 + 50 = 100 ms. Tuần tự thì cộng dồn.',
          },
          {
            type: 'read',
            title: 'Khi nào BẮT BUỘC tuần tự?',
            body: 'Khi bước sau **cần kết quả** của bước trước: phải biết user là ai mới lấy được giỏ hàng; phải có giỏ hàng mới tính tiền được. Đó là **phụ thuộc dữ liệu**.\n\nNếu không có phụ thuộc mà vẫn `await` nối tiếp, ta đang tự làm chậm hệ thống.',
          },
        ],
      },
      {
        id: 'u2-parallel',
        title: 'Gọi song song',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Promise.all',
            body: 'Trang sản phẩm cần đánh giá, giá và tồn kho. Ba thứ này **không phụ thuộc nhau**, nên gọi cùng lúc:\n\n`const [reviews, price, stock] = await Promise.all([…])`\n\nLatency là **chặng chậm nhất**, không phải tổng. Trên canvas, nhánh song song có ký hiệu ∥.',
            anim: {
              actors: ['Page', 'Reviews', 'Prices', 'Stock'],
              steps: [
                { from: 0, to: 1, label: 'reviews', at: 0 },
                { from: 0, to: 2, label: 'price', at: 0 },
                { from: 0, to: 3, label: 'stock', at: 0 },
                { from: 1, to: 0, kind: 'res', at: 1 },
                { from: 3, to: 0, kind: 'res', at: 1 },
                { from: 2, to: 0, kind: 'res', at: 2 },
              ],
              caption: 'Ba request đi cùng lúc; trang chờ cái về muộn nhất (Prices).',
            },
          },
          {
            type: 'choice',
            question: 'Reviews 30 ms, Prices 40 ms, Stock 35 ms, gọi song song. Trang mất bao lâu (bỏ qua mạng)?',
            options: ['30 ms', '40 ms', '105 ms', '35 ms'],
            answer: 1,
            explain: 'Chờ cái chậm nhất: 40 ms. Gọi tuần tự sẽ mất 105 ms.',
          },
          {
            type: 'choice',
            question: 'Gọi song song 3 dịch vụ, 1 cái trả lỗi ngay sau 5 ms. Với Promise.all, chuyện gì xảy ra?',
            options: [
              'Chờ 2 cái kia xong rồi mới báo lỗi',
              'Báo lỗi ngay sau 5 ms; 2 lời gọi kia vẫn chạy nhưng bị bỏ kết quả',
              'Tự động retry',
              'Trả kết quả của 2 cái thành công',
            ],
            answer: 1,
            explain: 'Promise.all "fail fast": lỗi đầu tiên làm cả request lỗi ngay. Các lời gọi còn lại vẫn tốn tài nguyên ở phía dưới. Simulator mô phỏng đúng như vậy.',
          },
          {
            type: 'order',
            question: 'Checkout: cần user (Auth) trước, rồi lấy Kho và Giá cùng lúc, rồi Thanh toán. Sắp xếp các bước:',
            items: ['Gọi Auth và chờ', 'Gọi Kho và Giá cùng lúc', 'Chờ cả Kho và Giá trả lời', 'Gọi Thanh toán'],
            explain: 'Đây là kết hợp: tuần tự giữa các bước có phụ thuộc, song song bên trong một bước. Trong simulator: chế độ Tuần tự, đặt Kho và Giá cùng số thứ tự.',
          },
        ],
      },
      {
        id: 'u2-async',
        title: 'Không cần chờ',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Fire-and-forget',
            body: 'Có những việc người dùng **không cần chờ**: gửi email chào mừng, ghi log analytics, bắn event. Ta gửi đi rồi trả lời người dùng ngay.\n\nCái giá phải trả: nếu việc đó lỗi thì **không ai biết** trong request này. Cách bền vững là đẩy vào **queue** để có retry (học ở Phần 6). Trên canvas, nét đứt và ký hiệu ⇢ nghĩa là không chờ.',
            anim: {
              actors: ['Users', 'Signup', 'DB', 'Email'],
              steps: [
                { from: 0, to: 1, label: 'đăng ký' },
                { from: 1, to: 2, label: 'INSERT' },
                { from: 2, to: 1, kind: 'res' },
                { from: 1, to: 3, label: 'gửi mail', kind: 'async', at: 4 },
                { from: 1, to: 0, label: 'Thành công!', kind: 'res', at: 4 },
              ],
            },
          },
          {
            type: 'choice',
            question: 'Việc nào KHÔNG nên làm kiểu fire-and-forget?',
            options: ['Gửi email chào mừng', 'Ghi sự kiện analytics', 'Trừ tiền thẻ tín dụng', 'Xoá cache cũ'],
            answer: 2,
            explain: 'Trừ tiền thì phải biết chắc thành công hay thất bại trước khi báo cho người dùng.',
          },
        ],
      },
      {
        id: 'u2-tail',
        title: 'Fan-out và cái đuôi',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Càng gọi nhiều, càng dễ gặp request chậm',
            body: 'Mỗi dịch vụ có 1% request chậm (p99). Gọi song song **10** dịch vụ thì request của bạn chậm nếu **bất kỳ** cái nào chậm.\n\nXác suất cả 10 đều nhanh = 0.99¹⁰ ≈ 90%. Vậy khoảng **10%** request của bạn dính một cái chậm. p99 của từng dịch vụ trở thành khoảng p90 của bạn. Đây là lý do Google viết bài "The Tail at Scale".',
          },
          {
            type: 'predict',
            question: 'Mỗi backend có p50 10 ms, p99 100 ms. API gọi song song 10 backend. p99 của API khoảng bao nhiêu?',
            sim: fanOut(10, 10, 100),
            metric: 'p99Ms',
            options: [
              { label: '~100 ms, như một backend', min: 0, max: 130 },
              { label: '~150 ms', min: 130, max: 180 },
              { label: '~200–300 ms', min: 180, max: 320 },
              { label: 'trên 320 ms', min: 320, max: Infinity },
            ],
            explain: 'p99 của API ≈ p99.9 của từng backend: cái đuôi bị phóng đại. Cách chữa: giảm fan-out, đặt timeout, hedged request (gửi thêm bản sao khi một request chậm).',
          },
        ],
      },
      {
        id: 'u2-payload',
        title: 'Payload và băng thông',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Dữ liệu cũng cần thời gian để đi',
            body: 'Truyền **1 MB** qua đường 100 Mbps mất 8 Mb ÷ 100 Mbps = **80 ms**, chưa tính độ trễ mạng.\n\nTệ hơn, đường truyền **dùng chung**: các response lớn phải xếp hàng nối đuôi nhau trên dây. Khi đường truyền đầy thì server rảnh cũng vô ích. Trên canvas, particle **to hơn** nghĩa là payload lớn hơn.',
          },
          {
            type: 'choice',
            question: 'Response 60 KB, đường 100 Mbps. Đường truyền gửi được tối đa khoảng bao nhiêu response/giây?',
            options: ['~60', '~200', '~1.600', '~100.000'],
            answer: 1,
            explain: '60 KB = 480 Kb. 100.000 Kb/s ÷ 480 Kb ≈ 208 response/giây. Ví dụ "08 Checkout" trong Sandbox cho thấy đường truyền nghẽn trước cả server.',
          },
          {
            type: 'choice',
            question: 'Cách nào KHÔNG giảm thời gian truyền response?',
            options: ['Nén gzip/brotli', 'Phân trang (pagination)', 'Chỉ trả về field cần dùng', 'Tăng số server API'],
            answer: 3,
            explain: 'Thêm server không làm đường truyền rộng hơn hay body nhỏ đi. Nén, phân trang, chọn field, hoặc CDN mới giúp.',
          },
        ],
      },
      {
        id: 'u2-practice-parallel',
        title: 'Thực hành: trang sản phẩm',
        kind: 'practice',
        cards: [
          {
            type: 'build',
            level: 'learn/02-product-page',
            intro: 'Trang sản phẩm gọi 3 dịch vụ nối tiếp nhau. Đổi cách gọi để p99 dưới 130 ms. Mở tab Trace để thấy waterfall thay đổi.',
          },
        ],
      },
      {
        id: 'u2-practice-async',
        title: 'Thực hành: email đăng ký',
        kind: 'practice',
        cards: [
          {
            type: 'build',
            level: 'learn/03-signup-email',
            intro: 'Người dùng đang phải chờ email được gửi xong. Đừng bắt họ chờ nữa.',
          },
        ],
      },
    ],
  },
  {
    id: 'u3',
    title: 'Mở rộng hệ thống',
    tier: 'Trung cấp',
    color: '#a78bfa',
    description: 'Scale dọc và ngang, load balancer, định luật Little, và vì sao 90% tải đã là quá nhiều.',
    lessons: [
      {
        id: 'u3-scale',
        title: 'Scale dọc, scale ngang',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Máy to hơn hay nhiều máy hơn?',
            body: '- **Scale dọc** (vertical): mua máy mạnh hơn. Đơn giản, nhưng có giới hạn và đắt dần lên\n- **Scale ngang** (horizontal): thêm máy giống nhau, đặt **load balancer** phía trước để chia request\n\nScale ngang còn cho thêm **dự phòng**: mất một máy thì các máy khác gánh thay.',
            anim: {
              actors: ['Users', 'Load balancer', 'API 1', 'API 2'],
              steps: [
                { from: 0, to: 1, label: 'req A' },
                { from: 1, to: 2, label: 'A' },
                { from: 0, to: 1, label: 'req B', at: 1.5 },
                { from: 1, to: 3, label: 'B', at: 2.5 },
                { from: 2, to: 1, kind: 'res', at: 2.5 },
                { from: 3, to: 1, kind: 'res', at: 3.5 },
              ],
              caption: 'Round-robin: request lần lượt chia cho từng máy (⇄ chọn 1).',
            },
          },
          {
            type: 'choice',
            question: 'Load balancer có 3 server phía sau, chia round-robin. Request thứ 4 đi đâu?',
            options: ['Server 1', 'Server 2', 'Server 3', 'Server rảnh nhất'],
            answer: 0,
            explain: 'Round-robin xoay vòng: 1, 2, 3, rồi lại 1. "Rảnh nhất" là chiến lược least-connections.',
          },
        ],
      },
      {
        id: 'u3-little',
        title: 'Định luật Little',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'L = λ × W',
            body: 'Số request **đang ở trong hệ thống** (L) = tốc độ đến (λ, rps) × thời gian mỗi request ở lại (W).\n\n1000 rps × 0.2 s = **200 request** đang mở cùng lúc. Con số này cho biết bạn cần bao nhiêu slot, thread hay connection.\n\nĐịnh luật này luôn đúng, với mọi hệ thống ổn định.',
          },
          {
            type: 'choice',
            question: '500 rps, mỗi request giữ 1 connection DB trong 40 ms. Cần ít nhất bao nhiêu connection?',
            options: ['12', '20', '40', '500'],
            answer: 1,
            explain: '500 × 0.04 = 20 connection, và đó là mức tối thiểu ở tải đều. Cần dư ra để chịu đột biến.',
          },
          {
            type: 'choice',
            question: 'DB đột nhiên chậm từ 40 ms lên 400 ms, traffic giữ nguyên 500 rps. Số connection cần dùng thành bao nhiêu?',
            options: ['20', '50', '200', 'Không đổi'],
            answer: 2,
            explain: '500 × 0.4 = 200. Downstream chậm 10 lần thì cần gấp 10 lần tài nguyên ở phía trên. Đây là cách một DB chậm làm sập cả API.',
          },
        ],
      },
      {
        id: 'u3-knee',
        title: 'Điểm gãy',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Vì sao không chạy server ở 95%?',
            body: 'Thời gian xếp hàng tăng theo **1 ÷ (1 − tải)**:\n- 50% tải: chờ ×2\n- 80%: ×5\n- 90%: ×10\n- 95%: ×20\n\nGần 100% thì hàng đợi tăng rất nhanh, chỉ một đợt request dồn lên là p99 bùng nổ. Vì vậy người ta thường nhắm **60–70%** khi lên kế hoạch.',
          },
          {
            type: 'predict',
            question: 'Server 1 slot, xử lý p50 10 ms. Bắn 80 rps (khoảng 93% tải). p99 khoảng bao nhiêu?',
            sim: oneHop({ latencyMs: 0.5, p50: 10, p99: 30, concurrency: 1, queue: 1000, rps: 80 }),
            metric: 'p99Ms',
            options: [
              { label: '~30 ms, như lúc rảnh', min: 0, max: 45 },
              { label: '~60 ms', min: 45, max: 90 },
              { label: '~100–250 ms', min: 90, max: 250 },
              { label: 'trên 250 ms', min: 250, max: Infinity },
            ],
            explain: 'Server không chậm đi, nhưng request phải xếp hàng. Ở 93% tải, đuôi latency dài gấp nhiều lần thời gian xử lý.',
          },
        ],
      },
      {
        id: 'u3-practice',
        title: 'Thực hành: một máy không đủ',
        kind: 'practice',
        cards: [
          {
            type: 'build',
            level: 'learn/04-scale-out',
            intro: 'Mỗi node API chỉ có tối đa 2 server. Dùng load balancer để chia 1400 rps cho nhiều node.',
          },
        ],
      },
    ],
  },
  {
    id: 'u4',
    title: 'Dữ liệu: cache, connection, pool',
    tier: 'Trung cấp',
    color: '#fbbf24',
    description: 'Database thường là nút cổ chai. Cache-aside, hit rate, connection pool và max_connections.',
    lessons: [
      {
        id: 'u4-cache',
        title: 'Cache-aside',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Đọc nhiều thì nhớ lại',
            body: 'Database chậm và đắt. Phần lớn request đọc lặp lại cùng dữ liệu, nên ta đặt **cache** (Redis) phía trước:\n- **hit**: có trong cache, trả về ngay, khoảng 1 ms\n- **miss**: hỏi DB, ghi vào cache, rồi trả về\n\nHit rate 90% nghĩa là DB chỉ còn nhận **10%** traffic.',
            anim: {
              actors: ['API', 'Cache', 'DB'],
              steps: [
                { from: 0, to: 1, label: 'GET p:1' },
                { from: 1, to: 0, label: 'hit ✓', kind: 'res' },
                { from: 0, to: 1, label: 'GET p:2' },
                { from: 1, to: 0, label: 'miss', kind: 'err' },
                { from: 0, to: 2, label: 'SELECT' },
                { from: 2, to: 0, kind: 'res' },
                { from: 0, to: 1, label: 'SET p:2', kind: 'async' },
              ],
            },
          },
          {
            type: 'order',
            question: 'Sắp xếp các bước đọc dữ liệu theo cache-aside khi bị MISS:',
            items: ['Hỏi cache', 'Cache báo không có', 'Đọc từ database', 'Ghi kết quả vào cache', 'Trả về cho người dùng'],
            explain: 'Chính ứng dụng lo việc nạp dữ liệu vào cache, vì vậy gọi là cache-"aside" (cache đứng bên cạnh).',
          },
          {
            type: 'choice',
            question: '3000 rps, hit rate tăng từ 90% lên 95%. Tải lên DB thay đổi thế nào?',
            options: ['Giảm 5%', 'Giảm một nửa (300 → 150 rps)', 'Không đổi', 'Tăng'],
            answer: 1,
            explain: 'Miss giảm từ 10% xuống 5%, tức một nửa. Mỗi điểm phần trăm hit rate ở gần 100% có giá trị rất lớn.',
          },
        ],
      },
      {
        id: 'u4-pool',
        title: 'Connection pool',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Mỗi process một bể kết nối',
            body: 'Mở kết nối DB tốn kém, nên ORM (Prisma, TypeORM) giữ sẵn một **pool** N kết nối **cho mỗi process**. Hết kết nối thì request phải xếp hàng chờ, dù CPU còn rảnh.\n\nTổng kết nối = pool × số process × số server. Con số này phải **nhỏ hơn `max_connections`** của Postgres (mặc định 100).',
          },
          {
            type: 'choice',
            question: '4 server, mỗi server 8 process Node (cluster), pool 10/process. Postgres max_connections = 100. Chuyện gì xảy ra?',
            options: ['Ổn, dư nhiều', 'Cần 320 kết nối > 100: lỗi "too many connections"', 'Postgres tự tăng giới hạn', 'Pool tự chia đều'],
            answer: 1,
            explain: '4 × 8 × 10 = 320. Giảm pool xuống khoảng 3, hoặc dùng PgBouncer. Sizing wizard (tab Công suất) tự kiểm tra lỗi này.',
          },
        ],
      },
      {
        id: 'u4-practice',
        title: 'Thực hành: đợt sale đầu tiên',
        kind: 'practice',
        cards: [
          {
            type: 'build',
            level: '01-first-sale',
            intro: 'Flash sale làm traffic tăng hơn gấp đôi, database không được đụng vào. Giữ hệ thống sống với $1/giờ.',
          },
        ],
      },
    ],
  },
  {
    id: 'u5',
    title: 'Khi mọi thứ hỏng',
    tier: 'Trung cấp',
    color: '#f87171',
    description: 'Timeout, retry với backoff và jitter, retry storm, circuit breaker, và mất cả một zone.',
    lessons: [
      {
        id: 'u5-timeout',
        title: 'Timeout',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Đừng chờ mãi',
            body: 'Không có timeout thì một dịch vụ treo sẽ giữ slot của bên gọi **mãi mãi**. Theo định luật Little, slot bị chiếm hết rất nhanh và lỗi lan ngược lên trên (cascading failure).\n\nĐặt timeout **ngắn hơn** timeout của bên gọi mình, nhưng **dài hơn** p99 bình thường của bên được gọi.',
          },
          {
            type: 'choice',
            question: 'Payment bình thường có p99 = 300 ms. Timeout nào hợp lý nhất?',
            options: ['50 ms', '500 ms–1 s', '30 giây', 'Không đặt'],
            answer: 1,
            explain: '50 ms thì cắt cả request bình thường. 30 s thì coi như không có timeout. Hãy để dư so với p99 một chút.',
          },
        ],
      },
      {
        id: 'u5-retry',
        title: 'Retry, backoff, jitter',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Thử lại, nhưng có kỷ luật',
            body: 'Lỗi thoáng qua thì nên **retry**. Nhưng nếu dịch vụ đang quá tải, mỗi retry là thêm tải: 3 retry nghĩa là tải có thể **×4**. Đó là **retry storm**.\n- **Backoff**: chờ lâu dần, 50 → 100 → 200 ms\n- **Jitter**: cộng thêm một khoảng ngẫu nhiên để các client không retry cùng một lúc',
          },
          {
            type: 'choice',
            question: 'DB quá tải, API retry 3 lần ngay lập tức, không backoff. Tải lên DB tối đa tăng bao nhiêu lần?',
            options: ['×1', '×2', '×3', '×4'],
            answer: 3,
            explain: '1 lần gọi gốc + 3 lần retry = 4 lần. Đúng lúc DB yếu nhất thì nhận nhiều tải nhất. Xem ví dụ "05 retry storm" trong Sandbox.',
          },
          {
            type: 'order',
            question: 'Backoff mũ, base 100 ms. Sắp xếp thời gian chờ trước mỗi lần retry:',
            items: ['Retry 1: chờ 100 ms', 'Retry 2: chờ 200 ms', 'Retry 3: chờ 400 ms'],
            explain: 'Lần thứ n chờ base × 2ⁿ⁻¹. Thực tế còn nhân thêm jitter trong khoảng [0.5, 1.5).',
          },
        ],
      },
      {
        id: 'u5-breaker',
        title: 'Circuit breaker',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Cầu dao tự ngắt',
            body: 'Khi tỉ lệ lỗi vượt ngưỡng, breaker **mở**: trả lỗi ngay mà không gọi xuống nữa, để dịch vụ phía dưới có thời gian hồi phục. Sau một lúc, breaker chuyển sang **nửa mở**, cho một request thử đi qua. Request thử thành công thì **đóng** lại, thất bại thì mở tiếp.',
          },
          {
            type: 'order',
            question: 'Sắp xếp vòng đời của circuit breaker khi dịch vụ phía dưới gặp sự cố rồi hồi phục:',
            items: ['Đóng (closed): gọi bình thường', 'Lỗi vượt ngưỡng: chuyển sang mở', 'Mở (open): trả lỗi ngay', 'Nửa mở: cho 1 request thử', 'Thử thành công: đóng lại'],
            explain: 'Trên canvas, edge chuyển sang nét đứt đỏ khi breaker mở, vàng khi nửa mở.',
          },
        ],
      },
      {
        id: 'u5-practice-db',
        title: 'Thực hành: database chập chờn',
        kind: 'practice',
        cards: [
          {
            type: 'build',
            level: '02-flaky-db',
            intro: 'Database chậm gấp 3 trong 15 giây, và team trước đã cài retry "cho chắc ăn". Xem chuyện gì xảy ra rồi sửa.',
          },
        ],
      },
      {
        id: 'u5-practice-zone',
        title: 'Thực hành: mất cả zone',
        kind: 'practice',
        cards: [{ type: 'build', level: '04-zone-outage', intro: 'Một zone sập giữa chừng. Thiết kế để người dùng không nhận ra.' }],
      },
    ],
  },
  {
    id: 'u6',
    title: 'Bất đồng bộ và tải đột biến',
    tier: 'Trung cấp',
    color: '#22d3ee',
    description: 'Queue để san phẳng đỉnh tải, consumer, backlog và backpressure.',
    lessons: [
      {
        id: 'u6-queue',
        title: 'Queue san phẳng đỉnh',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Nhận ngay, làm sau',
            body: 'Queue (SQS, RabbitMQ, Kafka) **xác nhận ngay** với bên gửi, còn consumer xử lý theo tốc độ của mình. Đỉnh 5000 rps trong 1 phút có thể được xử lý dần ở 1000 rps trong 5 phút.\n\nKhác fire-and-forget: message nằm an toàn trong queue, consumer lỗi thì **thử lại được**.',
            anim: {
              actors: ['API', 'Queue', 'Worker'],
              steps: [
                { from: 0, to: 1, label: 'đơn #1' },
                { from: 1, to: 0, label: 'ack', kind: 'res' },
                { from: 0, to: 1, label: 'đơn #2' },
                { from: 1, to: 0, label: 'ack', kind: 'res' },
                { from: 1, to: 2, label: '#1', kind: 'async', at: 2 },
                { from: 1, to: 2, label: '#2', kind: 'async', at: 4 },
              ],
            },
          },
          {
            type: 'choice',
            question: 'Đơn hàng đến 3000/s trong 60 s, worker xử lý được 1000/s. Sau đợt đỉnh, backlog trong queue là bao nhiêu?',
            options: ['0', '60.000', '120.000', '180.000'],
            answer: 2,
            explain: '(3000 − 1000) × 60 = 120.000 message, cần thêm khoảng 2 phút để xử lý hết. Hợp lý nếu người dùng chấp nhận đơn được xác nhận trễ.',
          },
        ],
      },
      {
        id: 'u6-practice',
        title: 'Thực hành: Black Friday',
        kind: 'practice',
        cards: [{ type: 'build', level: '03-black-friday', intro: 'Đỉnh tải gấp nhiều lần bình thường. Đừng để mất đơn hàng nào.' }],
      },
    ],
  },
  {
    id: 'u7',
    title: 'Nâng cao: đo và dự đoán',
    tier: 'Nâng cao',
    color: '#f472b6',
    description: 'Event loop Node.js, CPU và I/O, GC, đo tải bằng k6, và chọn cỡ server từ số liệu thật.',
    lessons: [
      {
        id: 'u7-event-loop',
        title: 'Event loop Node.js',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Một luồng CPU, nghìn request chờ I/O',
            body: 'Node.js chạy JavaScript trên **một luồng**. Lúc chờ DB, request không tốn CPU, nên hàng nghìn request có thể cùng chờ. Nhưng phần **tính toán** thì phải xếp hàng lần lượt trên luồng đó. Thời gian chờ đó là **event loop lag**.\n\nCông suất của 1 process ≈ 1000 ms ÷ CPU-ms mỗi request. Trong simulator, chọn mô hình "Event loop / CPU".',
          },
          {
            type: 'choice',
            question: 'Mỗi request tốn 2 ms CPU (JSON, validate), còn lại chờ DB 30 ms. Một process Node chịu được tối đa khoảng bao nhiêu rps?',
            options: ['~33', '~500', '~1000', 'Không giới hạn vì async'],
            answer: 1,
            explain: '1000 ÷ 2 = 500 rps. Thời gian chờ DB không tính, vì lúc đó event loop rảnh để làm việc khác. Muốn hơn thì chạy cluster: 1 process cho mỗi core.',
          },
          {
            type: 'choice',
            question: 'Một endpoint chạy bcrypt đồng bộ mất 100 ms CPU. Điều gì xảy ra với các request khác trên process đó?',
            options: ['Không ảnh hưởng', 'Tất cả phải chờ, event loop lag tăng ~100 ms', 'Node tự chạy sang luồng khác', 'Chỉ chậm request bcrypt'],
            answer: 1,
            explain: 'Code đồng bộ chặn event loop. Dùng bcrypt async (chạy trên thread pool), worker_threads, hoặc tách thành service riêng.',
          },
        ],
      },
      {
        id: 'u7-measure',
        title: 'Đo cho đúng',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Load test kiểu mở và coordinated omission',
            body: 'Nếu load generator dùng số user cố định chờ response rồi mới gửi tiếp, thì khi server chậm nó cũng **gửi chậm lại**, che mất tình trạng quá tải. Hãy dùng mô hình **mở** (k6 `constant-arrival-rate`): request đến theo lịch, bất kể server.\n\nVà **load generator không được là nút thắt**: chạy nó trên máy khác, theo dõi CPU của chính nó.',
          },
          {
            type: 'choice',
            question: 'Vì sao chỉ có latency (p50/p99) ở tải thấp thì chưa đủ để dự đoán giới hạn của server?',
            options: [
              'Vì latency luôn chính xác',
              'Vì p99 cao có thể do CPU gần đầy HOẶC do GC pause; hai nguyên nhân cho cùng con số nhưng dự đoán khác hẳn. Cần đo thêm CPU',
              'Vì k6 không đo được p99',
              'Vì cần đo bằng trình duyệt',
            ],
            answer: 1,
            explain: 'Đây là bài học khi kiểm chứng simulator trên server NestJS thật: chỉ fit theo latency thì dự đoán sai khoảng 2 lần. Tab Công suất → Hiệu chỉnh sẽ cảnh báo khi bạn chưa nhập CPU.',
          },
        ],
      },
      {
        id: 'u7-sizing',
        title: 'Chọn server',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Từ số đo đến gói VPS',
            body: '**Số core cần = rps × CPU-ms ÷ 1000**, sau đó chia cho mức tải mục tiêu (khoảng 0.6). Rồi kiểm tra RAM, pool so với max_connections, và chuyện gì xảy ra khi **mất một server** (N+1).\n\nSizing wizard ở tab **Công suất** làm đúng các bước này và mô phỏng từng phương án.',
          },
          {
            type: 'choice',
            question: '700 rps, mỗi request 4 ms CPU, nhắm 60% tải. Cần khoảng bao nhiêu vCPU (chưa tính dự phòng)?',
            options: ['~3', '~5', '~12', '~28'],
            answer: 1,
            explain: '700 × 4 ÷ 1000 = 2.8 core bận. 2.8 ÷ 0.6 ≈ 4.7, tức khoảng 5 vCPU. Thêm N+1 thì nên là 2–3 server nhỏ thay vì 1 server lớn.',
          },
        ],
      },
    ],
  },
];

/** Lessons in path order. */
export const LESSONS = UNITS.flatMap((u) => u.lessons.map((l) => ({ ...l, unit: u })));

export function lessonXp(kind: 'learn' | 'practice') {
  return kind === 'practice' ? 20 : 10;
}
