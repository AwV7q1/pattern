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

/** Give a scenario node a display name for the mini canvas (the engine ignores it). */
const named = <T extends object>(node: T, label: string) => ({ ...node, label });

/** Product page calling three independent services one after another. */
const productPage: SimSpec = {
  design: {
    nodes: [
      named({ id: 'client', kind: 'client' }, 'Users'),
      named(svc('page', 1, 2, 1000, 1000, { routing: 'sequence' }), 'Product page'),
      named(svc('reviews', 30, 45), 'Reviews'),
      named(svc('prices', 40, 60), 'Prices'),
      named(svc('stock', 35, 50), 'Stock'),
    ],
    edges: [
      { source: 'client', target: 'page', latencyMs: 0.5 },
      { source: 'page', target: 'reviews', latencyMs: 0.5, order: 1 },
      { source: 'page', target: 'prices', latencyMs: 0.5, order: 2 },
      { source: 'page', target: 'stock', latencyMs: 0.5, order: 3 },
    ],
  },
  scenario: scenario(100),
};

/** Signup that waits for a slow email provider. */
const signup: SimSpec = {
  design: {
    nodes: [
      named({ id: 'client', kind: 'client' }, 'Users'),
      named(svc('signup', 2, 4, 1000, 1000, { routing: 'sequence' }), 'Signup'),
      named({ id: 'db', kind: 'database', config: { latencyP50Ms: 5, latencyP99Ms: 15, concurrency: 1000, queueSize: 1000 } }, 'Database'),
      named(svc('email', 300, 1500), 'Email provider'),
    ],
    edges: [
      { source: 'client', target: 'signup', latencyMs: 0.5 },
      { source: 'signup', target: 'db', latencyMs: 0.5, order: 1 },
      { source: 'signup', target: 'email', latencyMs: 0.5, order: 2 },
    ],
  },
  scenario: scenario(50),
};

/** 500 rps on an API whose instances handle ~200 rps each (4 slots × 20 ms). */
const undersized: SimSpec = {
  design: {
    nodes: [
      named({ id: 'client', kind: 'client' }, 'Users'),
      named(svc('api', 20, 40, 4, 200, { instances: 1, costPerHour: 0.1 }), 'API'),
    ],
    edges: [{ source: 'client', target: 'api', latencyMs: 0.5 }],
  },
  scenario: scenario(500),
};

const edge = (source: string, target: string, extra: object = {}) => ({ source, target, latencyMs: 0.5, ...extra });
const db = (id: string, p50: number, p99: number, concurrency: number, queueSize: number) => ({
  id,
  kind: 'database',
  config: { latencyP50Ms: p50, latencyP99Ms: p99, concurrency, queueSize },
});

/** Order page that loads 20 items with one query each (ORM in a loop). */
const nPlusOne: SimSpec = {
  design: {
    nodes: [
      named({ id: 'client', kind: 'client' }, 'Users'),
      named(svc('orders', 1, 2, 1000, 1000, { callsPerRequest: 20 }), 'Orders API'),
      named(db('db', 2, 6, 200, 1000), 'Database'),
    ],
    edges: [edge('client', 'orders'), edge('orders', 'db')],
  },
  scenario: scenario(100),
};

/** API → Redis → Postgres at 2000 rps; the DB alone handles ~1000 rps. */
const cacheTtl: SimSpec = {
  design: {
    nodes: [
      named({ id: 'client', kind: 'client' }, 'Users'),
      named(svc('api', 5, 15, 80, 50, { instances: 4 }), 'API'),
      named({ id: 'cache', kind: 'cache', config: { latencyP50Ms: 0.5, latencyP99Ms: 2, concurrency: 2000, queueSize: 1000, hitRate: 0.5 } }, 'Redis'),
      named(db('db', 8, 40, 10, 100), 'PostgreSQL'),
    ],
    edges: [edge('client', 'api'), edge('api', 'cache'), edge('cache', 'db')],
  },
  scenario: scenario(2000),
};

/** 600 rps, 2 API instances, each with a connection pool of 2 to a 10 ms database. */
const smallPool: SimSpec = {
  design: {
    nodes: [
      named({ id: 'client', kind: 'client' }, 'Users'),
      named(svc('api', 2, 5, 100, 100, { instances: 2 }), 'API ×2'),
      named(db('db', 10, 30, 100, 1000), 'PostgreSQL'),
    ],
    edges: [edge('client', 'api'), edge('api', 'db', { poolSize: 2, poolTimeoutMs: 2000 })],
  },
  scenario: scenario(600),
};

/** HPA starting from 1 pod; traffic jumps 100 → 500 rps at 10 s (each pod ~200 rps). */
const hpaSpike: SimSpec = {
  design: {
    nodes: [
      { id: 'client', kind: 'client' },
      svc('api', 20, 40, 4, 50, {
        instances: 1,
        costPerHour: 0.1,
        autoscale: { min: 1, max: 10, targetUtilization: 0.6, evalEveryMs: 15000, stabilizationMs: 60000, podStartMs: 10000 },
      }),
    ],
    edges: [edge('client', 'api')],
  },
  scenario: { ...scenario(100), durationMs: 40000, traffic: [{ atMs: 0, rps: 100 }, { atMs: 10000, rps: 500 }] },
};

/** `examples/05-retry-storm`: DB 2× slower from 20 s to 35 s, API → DB timeout 60 ms. */
function retryStorm(edgePolicy: object): SimSpec {
  return {
    design: {
      nodes: [
        named({ id: 'client', kind: 'client' }, 'Users'),
        named({ id: 'lb', kind: 'loadBalancer', config: { instances: 1, concurrency: 20000, queueSize: 0, latencyP50Ms: 0.2, latencyP99Ms: 1 } }, 'Load balancer'),
        named(svc('api', 15, 50, 80, 50, { instances: 2 }), 'API'),
        named(db('db', 8, 40, 20, 200), 'PostgreSQL'),
      ],
      edges: [
        { source: 'client', target: 'lb', latencyMs: 5 },
        { source: 'lb', target: 'api', latencyMs: 1 },
        { source: 'api', target: 'db', latencyMs: 1, timeoutMs: 60, retries: 3, backoffMs: 10, ...edgePolicy },
      ],
    },
    scenario: {
      seed: 42,
      durationMs: 60000,
      timeoutMs: 1000,
      traffic: [{ atMs: 0, rps: 1000 }],
      slo: { p99Ms: 250, errorRate: 0.01 },
      windowMs: 1000,
      events: [
        { atMs: 20000, node: 'db', action: 'latency', value: 2 },
        { atMs: 35000, node: 'db', action: 'up' },
      ],
    },
  };
}

/** Payment provider that fails 5% of calls at random (transient errors). */
const flakyPayment: SimSpec = {
  design: {
    nodes: [
      named({ id: 'client', kind: 'client' }, 'Users'),
      named(svc('checkout', 2, 5), 'Checkout'),
      named(svc('pay', 20, 60, 1000, 1000, { errorRate: 0.05 }), 'Payment'),
    ],
    edges: [edge('client', 'checkout'), edge('checkout', 'pay', { timeoutMs: 500, retries: 0, backoffMs: 20 })],
  },
  scenario: scenario(100),
};

/** Orders spike 1500 → 3500 rps for 10 s; API writes straight to the DB, or through a queue. */
function orderSpike(withQueue: boolean): SimSpec {
  const nodes: object[] = [
    named({ id: 'client', kind: 'client' }, 'Users'),
    named(svc('api', 15, 50, 80, 50, { instances: 2 }), 'API'),
    named(db('db', 8, 40, 20, 200), 'PostgreSQL'),
  ];
  const edges = withQueue
    ? [edge('client', 'api'), edge('api', 'queue'), edge('queue', 'worker'), edge('worker', 'db')]
    : [edge('client', 'api'), edge('api', 'db')];
  if (withQueue)
    nodes.push(
      named({ id: 'queue', kind: 'queue', config: { concurrency: 36, queueSize: 500000, latencyP50Ms: 0.3, latencyP99Ms: 1 } }, 'Queue'),
      named(svc('worker', 5, 15, 20, 10, { instances: 2 }), 'Worker'),
    );
  return {
    design: { nodes, edges },
    scenario: {
      ...scenario(1500),
      timeoutMs: 1000,
      traffic: [
        { atMs: 0, rps: 1500 },
        { atMs: 5000, rps: 3500 },
        { atMs: 15000, rps: 1500 },
      ],
    },
  };
}

/** Node.js process: one CPU lane, ~2 ms CPU per request. */
function nodeProcess(rps: number, instances = 1): SimSpec {
  return {
    design: {
      nodes: [
        named({ id: 'client', kind: 'client' }, 'Users'),
        named(
          { id: 'api', kind: 'service', config: { instances, model: 'cpu', cpuLanes: 1, maxInFlight: 5000, cpuP50Ms: 2, cpuP99Ms: 4, costPerHour: 0.1 } },
          'Node.js API',
        ),
      ],
      edges: [edge('client', 'api')],
    },
    scenario: scenario(rps),
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
          {
            type: 'read',
            title: 'Mã trạng thái: lỗi của ai?',
            body: 'Mỗi response HTTP mang một **mã trạng thái** (status code). Nhóm đầu tiên cho biết ai cần sửa:\n- **2xx** thành công: `200 OK`, `201 Created`\n- **3xx** chuyển hướng: `301`, `304 Not Modified` (dùng bản đã cache)\n- **4xx** lỗi phía client: `400` dữ liệu sai, `401` chưa đăng nhập, `404` không có, `429` gửi quá nhiều\n- **5xx** lỗi phía server: `500` bug, `502/504` server phía sau không trả lời, `503` quá tải\n\nPhân biệt hai nhóm cuối rất quan trọng: **4xx gửi lại y nguyên vẫn lỗi**, còn 5xx (nhất là 503) có thể thành công nếu thử lại sau. Đây là nền cho bài retry ở Phần 5.',
          },
          {
            type: 'choice',
            question: 'Người dùng gửi form đăng ký thiếu email và nhận về `400 Bad Request`. Client có nên tự động gửi lại không?',
            options: [
              'Có, gửi lại 3 lần cho chắc',
              'Không: dữ liệu sai thì gửi lại vẫn sai, cần báo người dùng sửa',
              'Có, nhưng đợi 1 giây',
              'Chỉ khi server đang quá tải',
            ],
            answer: 1,
            explain: '4xx nghĩa là request có vấn đề. Lặp lại y nguyên chỉ tốn tài nguyên. Retry chỉ hợp lý với lỗi tạm thời: timeout, 502, 503, 504, và 429 (sau khi chờ).',
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
          {
            type: 'read',
            title: 'Cỡ độ lớn nên thuộc lòng',
            body: 'Không cần nhớ chính xác, chỉ cần biết **chênh nhau bao nhiêu lần**:\n- đọc RAM: ~0.1 µs\n- đọc SSD ngẫu nhiên: ~0.1 ms\n- Redis trong cùng datacenter: ~0.5–1 ms\n- query Postgres có index: ~1–10 ms\n- Hà Nội ↔ Singapore: ~30–50 ms mỗi chiều\n- Việt Nam ↔ Mỹ: ~100–200 ms mỗi chiều\n\nHệ quả: một lời gọi **xuyên lục địa** đắt bằng hàng trăm query DB. Đặt API và database **cùng một nơi**, và đừng gọi qua đại dương nhiều lần trong một request.',
          },
          {
            type: 'choice',
            question: 'API đặt ở Singapore, database đặt ở Mỹ (mỗi chiều ~90 ms). Mỗi request chạy 5 query tuần tự. Riêng phần mạng tới DB mất bao lâu?',
            options: ['90 ms', '180 ms', '450 ms', '900 ms'],
            answer: 3,
            explain: 'Mỗi query đi và về: 180 ms. 5 query tuần tự: 900 ms, trong khi bản thân các query chỉ mất vài ms. Chuyển DB về cùng region, hoặc gộp query lại.',
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
          {
            type: 'predict',
            question: 'API rất rảnh (50 rps), không ai phải xếp hàng. Thời gian xử lý của nó có p50 = 20 ms, p99 = 200 ms. p99 người dùng thấy là bao nhiêu?',
            sim: {
              design: {
                nodes: [{ id: 'client', kind: 'client' }, svc('api', 20, 200)],
                edges: [{ source: 'client', target: 'api', latencyMs: 0.5 }],
              },
              scenario: scenario(50),
            },
            metric: 'p99Ms',
            options: [
              { label: '~20 ms, vì server rảnh', min: 0, max: 40 },
              { label: '~60 ms', min: 40, max: 100 },
              { label: '~200 ms', min: 100, max: 400 },
              { label: 'trên 400 ms', min: 400, max: Infinity },
            ],
            explain: 'Cái đuôi không chỉ do xếp hàng: bản thân công việc đã có request chậm (GC, cache nguội, query lớn). Server rảnh thì p99 người dùng ≈ p99 xử lý. Khi tải tăng, xếp hàng còn kéo đuôi dài thêm.',
          },
          {
            type: 'choice',
            question: 'Có 3 server, p99 lần lượt 100, 120, 500 ms (traffic chia đều). p99 của cả hệ thống là bao nhiêu?',
            options: ['240 ms (trung bình cộng)', '500 ms (lấy cái lớn nhất)', 'Không tính được từ 3 con số này; phải gộp dữ liệu gốc lại rồi tính', '720 ms (tổng)'],
            answer: 2,
            explain: 'Percentile không cộng hay lấy trung bình được. Dashboard đúng phải gộp histogram của mọi server rồi mới tính p99 (Prometheus: `histogram_quantile` trên `sum` của các bucket).',
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
            body: 'Một server có một số **slot** (thread, connection) làm việc cùng lúc. Mỗi request chiếm một slot trong thời gian xử lý.\n\n**Công suất ≈ số slot ÷ thời gian xử lý.** Ví dụ 10 slot, mỗi request 50 ms (0.05 s): 10 ÷ 0.05 = **200 request/giây** (rps). Số request thực sự xử lý xong mỗi giây gọi là **throughput**.\n\nRequest đến nhanh hơn mức đó thì phải **xếp hàng**. Hàng đợi đầy thì server **từ chối** (lỗi 503).',
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
          {
            type: 'read',
            title: 'Hàng đợi dài không phải là tốt',
            body: 'Nghe có vẻ hàng đợi càng lớn càng an toàn: không ai bị từ chối. Nhưng khi quá tải **kéo dài**, hàng đợi lớn chỉ biến lỗi nhanh thành **chờ lâu rồi vẫn lỗi**:\n- người dùng đã bỏ đi (hoặc client đã timeout) nhưng server vẫn xử lý request của họ\n- hàng đợi 10.000 chỗ ở 200 rps nghĩa là request mới phải chờ **50 giây**\n\nQuy tắc: hàng đợi chỉ nên đủ để hấp thụ **vài trăm ms** dao động. Quá tải thật thì từ chối sớm (503) để client thử lại chỗ khác, rồi thêm công suất.',
          },
          {
            type: 'choice',
            question: 'Server xử lý 200 rps, client timeout sau 2 giây. Hàng đợi tối đa nên vào khoảng bao nhiêu?',
            options: ['10 chỗ', 'Dưới 400 chỗ (200 rps × 2 s), nên nhỏ hơn nữa', '100.000 chỗ', 'Không giới hạn'],
            answer: 1,
            explain: 'Request đứng sau hơn 400 người thì phải chờ quá 2 s, client đã bỏ cuộc trước khi tới lượt. Xử lý nó là phí công. Thực tế để vài chục đến vài trăm.',
          },
        ],
      },
      {
        id: 'u1-slo',
        title: 'SLO và error budget',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'SLI, SLO, SLA',
            body: '- **SLI** (chỉ số): thứ đo được, ví dụ "tỉ lệ request trả về dưới 300 ms" hoặc "tỉ lệ request không lỗi 5xx"\n- **SLO** (mục tiêu): ngưỡng team tự đặt cho SLI, ví dụ "99.9% request thành công trong 30 ngày"\n- **SLA** (hợp đồng): cam kết với khách hàng, vi phạm thì đền tiền. SLA luôn **lỏng hơn** SLO để còn chỗ phản ứng\n\nSLO tốt đo thứ **người dùng cảm nhận**: latency và lỗi ở cửa ngõ, không phải CPU của từng máy.',
          },
          {
            type: 'choice',
            question: 'SLO 99.9% thành công trong 30 ngày. Hệ thống được phép "sập hoàn toàn" tổng cộng bao lâu mỗi tháng?',
            options: ['~43 giây', '~43 phút', '~7 giờ', '~3 ngày'],
            answer: 1,
            explain: '0.1% của 30 ngày = 0.001 × 43.200 phút ≈ 43 phút. Phần 0.1% này gọi là **error budget**. 99.99% chỉ còn ~4 phút, 99% là ~7 giờ.',
          },
          {
            type: 'read',
            title: 'Tiêu error budget',
            body: 'Error budget biến độ tin cậy thành **ngân sách** để tiêu:\n- còn nhiều budget: được deploy nhanh, thử nghiệm\n- sắp hết: tạm dừng tính năng mới, dồn sức sửa độ ổn định\n\nNó cũng nhắc rằng **100% không phải mục tiêu**. Mỗi con số 9 thêm vào đắt gấp nhiều lần, trong khi wifi và điện thoại của người dùng chưa chắc đã đạt 99.9%.',
          },
          {
            type: 'choice',
            question: 'Chỉ số nào phù hợp nhất để làm SLO cho trang thanh toán?',
            options: [
              'CPU trung bình của các server API dưới 70%',
              'Tỉ lệ request thanh toán trả về thành công trong 1 giây',
              'Số lần deploy mỗi tuần',
              'Dung lượng ổ đĩa còn trống',
            ],
            answer: 1,
            explain: 'CPU hay ổ đĩa là tín hiệu nội bộ, tốt cho cảnh báo sớm nhưng người dùng không thấy chúng. SLO nên đo đúng trải nghiệm: thành công và đủ nhanh.',
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
          {
            type: 'predict',
            question: 'Trang sản phẩm gọi tuần tự Reviews (p50 30 ms), Prices (40 ms), Stock (35 ms), mạng 0.5 ms mỗi chiều. p50 của trang khoảng bao nhiêu?',
            sim: productPage,
            metric: 'p50Ms',
            options: [
              { label: '~40 ms (chậm nhất)', min: 0, max: 60 },
              { label: '~75 ms', min: 60, max: 95 },
              { label: '~110 ms (cộng dồn)', min: 95, max: 140 },
              { label: 'trên 140 ms', min: 140, max: Infinity },
            ],
            explain: '30 + 40 + 35 = 105 ms, cộng thêm mạng và thời gian của chính trang. Ba lời gọi này không phụ thuộc nhau, nên đây là thời gian bị lãng phí. Bài sau sẽ sửa nó.',
          },
          {
            type: 'choice',
            question: 'Đoạn code nào có phụ thuộc dữ liệu thật sự giữa hai lời gọi?',
            options: [
              '`await getUser(id); await getBanner();`',
              '`const order = await getOrder(id); await getShipment(order.shipmentId);`',
              '`await logView(id); await getProduct(id);`',
              '`await getReviews(id); await getStock(id);`',
            ],
            answer: 1,
            explain: 'Cần `order.shipmentId` mới gọi được getShipment, nên bắt buộc tuần tự. Các cặp còn lại không dùng kết quả của nhau, có thể chạy song song (logView còn có thể fire-and-forget).',
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
          {
            type: 'fix',
            question: 'Trang sản phẩm mất hơn 100 ms vì gọi lần lượt 3 dịch vụ không phụ thuộc nhau. Sửa để p50 dưới 60 ms.',
            sim: productPage,
            knobs: [
              {
                id: 'routing',
                label: 'Product page gọi các nhánh',
                target: { node: 'page' },
                field: 'routing',
                control: {
                  kind: 'select',
                  options: [
                    { value: 'sequence', label: '①②③ Tuần tự' },
                    { value: 'parallel', label: '∥ Song song' },
                  ],
                },
                help: 'Tuần tự = await từng cái. Song song = Promise.all.',
              },
            ],
            goals: [{ metric: 'p50Ms', op: '<', value: 60 }],
            solution: { routing: 'parallel' },
            hint: 'Reviews, Prices, Stock không cần kết quả của nhau.',
            explain: 'Gọi song song thì trang chỉ chờ nhánh chậm nhất (Prices, khoảng 40 ms), thay vì cộng cả ba.',
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
          {
            type: 'fix',
            question: 'Người dùng đăng ký phải chờ tới 1.7 giây vì Signup đợi nhà cung cấp email. Sửa để p99 dưới 100 ms, nhưng vẫn phải lưu vào database trước khi báo thành công.',
            sim: signup,
            knobs: [
              {
                id: 'email-ff',
                label: 'Signup → Email: không chờ trả lời (fire-and-forget)',
                target: { edge: ['signup', 'email'] },
                field: 'fireAndForget',
                control: { kind: 'switch' },
              },
              {
                id: 'db-ff',
                label: 'Signup → Database: không chờ trả lời',
                target: { edge: ['signup', 'db'] },
                field: 'fireAndForget',
                control: { kind: 'switch' },
                trap: {
                  value: true,
                  why: 'Nhanh thật, nhưng Signup báo "thành công" trước khi biết dữ liệu đã được lưu. Database lỗi thì người dùng mất tài khoản mà không ai hay.',
                },
              },
            ],
            goals: [{ metric: 'p99Ms', op: '<', value: 100 }],
            solution: { 'email-ff': true },
            hint: 'Việc nào người dùng không cần chờ kết quả?',
            explain: 'Chỉ email là không cần chờ. Bỏ chờ cả Database thì cũng nhanh, nhưng sẽ báo "thành công" khi dữ liệu có thể chưa được lưu.',
          },
          {
            type: 'read',
            title: 'Fire-and-forget trong NestJS: cẩn thận',
            body: 'Viết `this.mail.send(user)` mà không `await` là cách nhanh nhất để "không chờ", nhưng có 3 cái bẫy:\n- promise lỗi mà không có `.catch()` thì thành **unhandled rejection**, Node có thể tắt process\n- process bị restart (deploy) thì việc đang làm **mất luôn**\n- không có giới hạn: 10.000 email cùng lúc sẽ chiếm hết kết nối ra ngoài\n\nViệc quan trọng nên đẩy vào **queue** (BullMQ, RabbitMQ): nó lưu lại, có retry, có giới hạn số worker. Fire-and-forget thuần chỉ hợp với việc mất cũng không sao, như log analytics.',
          },
          {
            type: 'choice',
            question: 'Sau khi đặt hàng, cần gửi email xác nhận đơn (khách cần nó để tra cứu). Cách nào hợp lý nhất?',
            options: [
              '`await mail.send()` trước khi trả lời người dùng',
              '`mail.send()` không await, không catch',
              'Ghi job "gửi email" vào queue trong cùng request, worker gửi và tự retry khi lỗi',
              'Không gửi email nữa',
            ],
            answer: 2,
            explain: 'Người dùng không phải chờ, mà email cũng không bị mất khi nhà cung cấp lỗi hay server restart. Phần 6 nói kỹ về queue, retry và DLQ.',
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
          {
            type: 'choice',
            question: 'Mỗi backend có 1% request chậm. Một trang tìm kiếm gọi song song 100 shard. Khoảng bao nhiêu % lượt tìm kiếm dính ít nhất một shard chậm?',
            options: ['~1%', '~10%', '~63%', '100%'],
            answer: 2,
            explain: '1 − 0.99¹⁰⁰ ≈ 63%. Với fan-out lớn, request "chậm hiếm gặp" của từng máy trở thành trường hợp **bình thường** của người dùng.',
          },
          {
            type: 'read',
            title: 'Cắt cái đuôi',
            body: 'Các kỹ thuật thường dùng khi buộc phải fan-out:\n- **Hedged request**: chờ tới khoảng p95 mà chưa có kết quả thì gửi thêm một bản sao sang replica khác, lấy cái về trước. Chỉ tốn thêm ~5% request mà p99 giảm mạnh\n- **Timeout + kết quả một phần**: hết 150 ms thì trả về những gì đã có (ví dụ trang chủ thiếu ô "gợi ý" vẫn hơn là trang trắng)\n- **Giảm fan-out**: gộp dữ liệu hay đi cùng nhau vào một chỗ, hoặc cache kết quả tổng hợp\n\nChỉ hedge những lời gọi **đọc**, an toàn khi chạy hai lần.',
          },
          {
            type: 'choice',
            question: 'Lời gọi nào KHÔNG được dùng hedged request?',
            options: ['GET danh sách sản phẩm', 'Tìm kiếm trong Elasticsearch', 'POST trừ tiền ví người dùng', 'Đọc profile từ cache'],
            answer: 2,
            explain: 'Hedge nghĩa là có thể chạy hai lần. Trừ tiền hai lần là bug nghiêm trọng, trừ khi API có idempotency key (Phần 5).',
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
          {
            type: 'read',
            title: 'CDN: đưa dữ liệu lại gần người dùng',
            body: '**CDN** (Cloudflare, CloudFront…) là mạng các server đặt ở nhiều thành phố. Nội dung tĩnh (ảnh, JS, CSS, video) được cache ở server gần người dùng nhất:\n- người dùng ở Hà Nội tải ảnh từ server ở Hà Nội thay vì từ Mỹ: từ ~200 ms còn ~10 ms\n- origin (server gốc) chỉ nhận một phần nhỏ request, phần còn lại CDN trả\n- băng thông ra Internet của origin giảm theo\n\nĐiều khiển bằng header `Cache-Control`, ví dụ `public, max-age=31536000, immutable` cho file có hash trong tên (`app.3f9a.js`).',
          },
          {
            type: 'choice',
            question: 'Thứ nào KHÔNG nên cache ở CDN với `Cache-Control: public`?',
            options: ['Logo của trang', 'File `main.8c1d.js` đã build', 'Trang "Đơn hàng của tôi" sau khi đăng nhập', 'Ảnh sản phẩm'],
            answer: 2,
            explain: 'Dữ liệu riêng của từng người không được cache chung. Nếu cache nhầm, người sau có thể thấy đơn hàng của người trước. Dùng `private` hoặc `no-store`.',
          },
        ],
      },
      {
        id: 'u2-n-plus-1',
        title: 'N+1 query',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Vòng lặp gọi database',
            body: 'Lỗi hiệu năng phổ biến nhất với ORM:\n\n`const orders = await repo.find();` (1 query)\n`for (const o of orders) o.items = await itemRepo.findBy({ orderId: o.id });` (N query)\n\nCode trông vô hại, nhưng 20 đơn hàng là **21 lượt đi về** database, tuần tự. Mỗi lượt chỉ 2–3 ms, cộng lại thành 50–60 ms, và số query tăng theo dữ liệu.',
            anim: {
              actors: ['API', 'Database'],
              steps: [
                { from: 0, to: 1, label: 'SELECT orders' },
                { from: 1, to: 0, kind: 'res' },
                { from: 0, to: 1, label: 'items #1' },
                { from: 1, to: 0, kind: 'res' },
                { from: 0, to: 1, label: 'items #2' },
                { from: 1, to: 0, kind: 'res' },
                { from: 0, to: 1, label: 'items #3 …' },
                { from: 1, to: 0, kind: 'res' },
              ],
              caption: 'Mỗi item một lượt đi về. Thời gian tăng theo số dòng.',
            },
          },
          {
            type: 'predict',
            question: 'API chạy 20 query tuần tự cho mỗi request (mỗi query p50 2 ms, mạng 0.5 ms mỗi chiều). p50 của API khoảng bao nhiêu?',
            sim: nPlusOne,
            metric: 'p50Ms',
            options: [
              { label: '~3 ms, query nhanh mà', min: 0, max: 15 },
              { label: '~30 ms', min: 15, max: 45 },
              { label: '~60–70 ms', min: 45, max: 90 },
              { label: 'trên 90 ms', min: 90, max: Infinity },
            ],
            explain: '20 × (2 ms xử lý + 1 ms mạng) ≈ 60 ms, cộng thêm phần đuôi lognormal của từng query. Một query nhỏ không chậm, nhưng 20 cái nối tiếp thì có.',
          },
          {
            type: 'fix',
            question: 'Trang đơn hàng chạy 1 query cho mỗi item. Viết lại để p50 dưới 20 ms.',
            sim: nPlusOne,
            knobs: [
              {
                id: 'calls',
                label: 'Orders API lấy items bằng',
                target: { node: 'orders' },
                field: 'callsPerRequest',
                control: {
                  kind: 'select',
                  options: [
                    { value: 20, label: 'vòng lặp: 20 query WHERE order_id = ?' },
                    { value: 1, label: '1 query WHERE order_id IN (...) hoặc JOIN' },
                  ],
                },
                help: 'Prisma: include. TypeORM: relations hoặc leftJoinAndSelect. GraphQL: DataLoader.',
              },
            ],
            goals: [{ metric: 'p50Ms', op: '<', value: 20 }],
            solution: { calls: 1 },
            hint: 'Lấy tất cả items trong một lần đi về.',
            explain: 'Một query lớn hơn chút vẫn nhanh hơn nhiều so với 20 lượt đi về. Bật log query của ORM ở môi trường dev để bắt lỗi này sớm.',
          },
          {
            type: 'choice',
            question: 'Dấu hiệu nào trong trace (Jaeger, Datadog) gợi ý ngay N+1 query?',
            options: [
              'Một span DB rất dài',
              'Hàng chục span DB ngắn, giống hệt nhau, nối đuôi nhau',
              'CPU 100%',
              'Lỗi 503',
            ],
            answer: 1,
            explain: 'Waterfall hình "bậc thang" toàn các query giống nhau là chữ ký của N+1. Một span dài thì thường là thiếu index (Phần 4).',
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
            body: '- **Scale dọc** (vertical): mua máy mạnh hơn. Đơn giản, nhưng có giới hạn và đắt dần lên\n- **Scale ngang** (horizontal): thêm máy giống nhau (mỗi bản đang chạy gọi là một **instance**), đặt **load balancer** phía trước để chia request\n\nScale ngang còn cho thêm **dự phòng**: mất một máy thì các máy khác gánh thay.',
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
          {
            type: 'read',
            title: 'Muốn scale ngang, server phải stateless',
            body: 'Load balancer có thể gửi request kế tiếp của cùng một người sang **máy khác**. Nếu máy 1 giữ session trong RAM (`express-session` mặc định, biến global, file upload tạm trên đĩa) thì sang máy 2 người dùng bị "đăng xuất".\n\nGiải pháp: đưa **trạng thái ra ngoài** process:\n- session vào Redis, hoặc dùng JWT (client tự giữ)\n- file vào S3/MinIO thay vì đĩa local\n- job nền vào queue thay vì `setInterval` trong từng instance\n\nSticky session (LB luôn gửi một người về một máy) chỉ là chữa cháy: máy đó chết thì vẫn mất, và tải chia không đều.',
          },
          {
            type: 'choice',
            question: 'App NestJS lưu giỏ hàng trong một `Map` ở RAM. Scale từ 1 lên 3 instance sau load balancer. Chuyện gì xảy ra?',
            options: [
              'Không sao, các instance tự đồng bộ Map',
              'Giỏ hàng "lúc có lúc mất" tuỳ request rơi vào instance nào',
              'Chạy nhanh gấp 3, không vấn đề gì',
              'Load balancer tự lưu giỏ hàng',
            ],
            answer: 1,
            explain: 'Mỗi instance có RAM riêng. Đưa giỏ hàng vào Redis hoặc database để mọi instance thấy cùng một dữ liệu.',
          },
          {
            type: 'read',
            title: 'Health check: LB biết máy nào còn sống',
            body: 'Load balancer gọi định kỳ một endpoint như `GET /health`. Trả lỗi vài lần liên tiếp thì máy bị **rút khỏi vòng quay**.\n\nKubernetes tách làm hai loại:\n- **liveness**: process còn sống không? Fail thì **restart** container\n- **readiness**: có nhận traffic được không? Fail thì **ngừng gửi traffic** nhưng không restart (đang khởi động, đang warm cache)\n\nĐừng để liveness kiểm tra database: DB chậm một chút là mọi pod bị restart cùng lúc, biến sự cố nhỏ thành sập toàn bộ.',
          },
          {
            type: 'choice',
            question: 'Endpoint liveness của bạn query thử Postgres. Postgres chậm 10 giây vì backup. Điều gì có thể xảy ra?',
            options: [
              'Không ảnh hưởng gì',
              'Kubernetes restart tất cả pod API cùng lúc, dù chúng không hỏng',
              'Postgres tự nhanh lên',
              'Chỉ pod chậm nhất bị restart',
            ],
            answer: 1,
            explain: 'Liveness chỉ nên kiểm tra chính process (event loop còn chạy). Phụ thuộc bên ngoài, nếu cần, thì đặt ở readiness, và cân nhắc kỹ.',
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
          {
            type: 'choice',
            question: 'Dashboard cho thấy API có trung bình 300 request đang xử lý cùng lúc, throughput 1500 rps. Latency trung bình là bao nhiêu?',
            options: ['5 ms', '50 ms', '200 ms', '450 ms'],
            answer: 2,
            explain: 'W = L ÷ λ = 300 ÷ 1500 = 0.2 s. Little dùng được theo mọi chiều: biết 2 trong 3 đại lượng là suy ra cái còn lại, rất tiện để kiểm tra số liệu monitoring có hợp lý không.',
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
            body: 'Thời gian xếp hàng tăng theo **1 ÷ (1 − tải)**:\n- 50% tải: chờ ×2\n- 80%: ×5\n- 90%: ×10\n- 95%: ×20\n\nGần 100% thì hàng đợi tăng rất nhanh, chỉ một đợt request dồn lên là p99 bùng nổ. Chỗ latency bắt đầu tăng vọt gọi là **điểm gãy**. Vì vậy người ta thường nhắm **60–70%** khi lên kế hoạch.',
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
          {
            type: 'fix',
            question: 'API nhận 500 rps nhưng mỗi máy chỉ xử lý được khoảng 200 rps. Chọn số máy vừa đủ: không lỗi, p99 dưới 100 ms, và không vượt ngân sách $0.30/giờ.',
            sim: undersized,
            knobs: [
              {
                id: 'instances',
                label: 'Số máy API',
                target: { node: 'api' },
                field: 'instances',
                control: { kind: 'number', min: 1, max: 6, unit: ' máy' },
                help: 'Mỗi máy: 4 slot, xử lý ~20 ms, $0.10/giờ.',
              },
            ],
            goals: [
              { metric: 'errorRate', op: '<', value: 0.01 },
              { metric: 'p99Ms', op: '<', value: 100 },
              { metric: 'costPerHour', op: '<=', value: 0.3 },
            ],
            solution: { instances: 3 },
            hint: '500 ÷ 200 = 2.5 máy. Làm tròn lên, rồi xem tải mỗi máy còn bao nhiêu %.',
            explain: '2 máy là 125% tải: hàng đợi tràn, lỗi. 3 máy là khoảng 83% tải, p99 ~65 ms. 4 máy nhanh hơn chút nhưng vượt ngân sách.',
          },
        ],
      },
      {
        id: 'u3-autoscale',
        title: 'Autoscaling',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Tự thêm máy khi bận',
            body: 'Kubernetes **HPA** (Horizontal Pod Autoscaler) cứ ~15 giây đo mức bận trung bình (CPU hoặc slot) rồi tính:\n\n**số pod mong muốn = ⌈số pod hiện tại × mức bận ÷ mục tiêu⌉**\n\nVí dụ 2 pod đang bận 90%, mục tiêu 60%: ⌈2 × 0.9 ÷ 0.6⌉ = 3 pod.\n\nNhưng pod mới **không có ngay**: phải đợi lần đo kế tiếp, kéo image, khởi động app, chờ readiness. Tổng cộng thường 30 giây đến vài phút. Khi giảm, HPA còn đợi thêm (stabilization) để không dao động lên xuống.',
          },
          {
            type: 'predict',
            question: 'Autoscale từ 1 pod (mỗi pod chịu ~200 rps, khởi động mất 10 s, HPA đo mỗi 15 s). Giây thứ 10, traffic nhảy từ 100 lên 500 rps. Tỉ lệ lỗi trong 40 giây là bao nhiêu?',
            sim: hpaSpike,
            metric: 'errorRate',
            options: [
              { label: 'dưới 1%: autoscale lo hết', min: 0, max: 0.01 },
              { label: '1–15%', min: 0.01, max: 0.15 },
              { label: '15–60%', min: 0.15, max: 0.6 },
              { label: 'trên 60%', min: 0.6, max: Infinity },
            ],
            explain: 'Trong lúc chờ HPA quyết định và pod mới khởi động, 1 pod phải gánh 500 rps nên phần lớn request bị từ chối. Autoscale phản ứng theo **chục giây**, còn spike đến trong **một giây**.',
          },
          {
            type: 'choice',
            question: 'Biết trước 20h tối nay có livestream bán hàng. Cách nào giúp hệ thống không lỗi lúc đầu đợt?',
            options: [
              'Tin vào HPA, nó sẽ tự scale',
              'Tăng `minReplicas` trước giờ G (scale chủ động), hạ lại sau',
              'Đặt mục tiêu CPU 95% cho tiết kiệm',
              'Tắt autoscale',
            ],
            answer: 1,
            explain: 'Sự kiện biết trước thì scale trước. Ngoài ra: đặt mục tiêu thấp hơn (50–60%) để có dư, giảm thời gian khởi động pod, hoặc đặt queue phía trước để hấp thụ đỉnh.',
          },
          {
            type: 'order',
            question: 'Sắp xếp những gì xảy ra từ lúc traffic tăng vọt tới lúc pod mới nhận request:',
            items: ['Traffic tăng, pod hiện có quá tải', 'HPA tới lượt đo, thấy mức bận vượt mục tiêu', 'HPA tăng số replica, scheduler đặt pod lên node', 'Kéo image và khởi động app', 'Readiness probe thành công, pod bắt đầu nhận traffic'],
            explain: 'Mỗi bước tốn vài giây đến vài chục giây. Nếu cụm hết node, còn phải chờ thêm cluster autoscaler bật máy mới (vài phút).',
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
          {
            type: 'read',
            title: 'TTL và chuyện dữ liệu cũ',
            body: 'Có câu đùa: hai việc khó nhất trong ngành là **đặt tên** và **xoá cache**. Cache luôn có thể **cũ** hơn database. Hai cách giữ nó tươi:\n- **TTL** (time to live): mỗi key tự hết hạn sau N giây. TTL dài thì hit rate cao nhưng dữ liệu cũ lâu hơn\n- **Xoá khi ghi**: cập nhật DB xong thì `DEL` key tương ứng. Lần đọc sau sẽ miss và nạp bản mới\n\nChọn TTL theo câu hỏi: **dữ liệu này cũ bao lâu thì người dùng chấp nhận được?** Số lượt xem: vài phút. Giá và tồn kho lúc đang sale: vài giây, hoặc xoá ngay khi ghi.',
          },
          {
            type: 'choice',
            question: 'Key `product:1` rất hot (5000 rps) vừa hết TTL. Chuyện gì có thể xảy ra trong vài ms đó?',
            options: [
              'Không sao, chỉ 1 request đi xuống DB',
              'Hàng trăm request cùng miss, cùng query DB một lúc (cache stampede)',
              'Redis tự gia hạn key',
              'Mọi request bị lỗi',
            ],
            answer: 1,
            explain: 'Gọi là cache stampede (thundering herd). Chữa bằng khoá: chỉ một request được nạp lại, số còn lại chờ hoặc dùng bản cũ. Hoặc làm mới key trước khi hết hạn, hoặc cộng ngẫu nhiên vào TTL để các key không hết hạn cùng lúc.',
          },
          {
            type: 'fix',
            question: 'Postgres chỉ chịu ~1000 rps mà API nhận 2000 rps. TTL cache đang quá ngắn. Chọn TTL để p99 dưới 60 ms và không lỗi, nhưng giá sản phẩm (đổi vài lần mỗi ngày) không được cũ quá lâu.',
            sim: cacheTtl,
            knobs: [
              {
                id: 'ttl',
                label: 'TTL của key sản phẩm trong Redis',
                target: { node: 'cache' },
                field: 'hitRate',
                control: {
                  kind: 'select',
                  options: [
                    { value: 0.5, label: '5 giây (hit ~50%)' },
                    { value: 0.9, label: '60 giây (hit ~90%)' },
                    { value: 0.99, label: '1 ngày (hit ~99%)' },
                  ],
                },
                help: 'Simulator không mô phỏng TTL trực tiếp, chỉ dùng hit rate tương ứng.',
                trap: {
                  value: 0.99,
                  why: 'Số liệu rất đẹp, nhưng khi đổi giá thì khách có thể thấy giá cũ suốt một ngày, và đặt hàng theo giá sai. TTL phải theo mức "cũ chấp nhận được" của dữ liệu, không chỉ theo hiệu năng.',
                },
              },
            ],
            goals: [
              { metric: 'p99Ms', op: '<', value: 60 },
              { metric: 'errorRate', op: '<', value: 0.01 },
            ],
            solution: { ttl: 0.9 },
            hint: 'DB nhận 2000 × (1 − hit rate). Cần dưới ~1000 với khoảng dư.',
            explain: 'Hit 90% thì DB chỉ nhận ~200 rps. Muốn giá mới hiện ngay, kết hợp thêm xoá key khi cập nhật giá.',
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
          {
            type: 'predict',
            question: '600 rps, 2 instance API, mỗi instance có pool 2 kết nối. Query mất ~10 ms. Database còn rất rảnh. Tỉ lệ lỗi là bao nhiêu?',
            sim: smallPool,
            metric: 'errorRate',
            options: [
              { label: 'dưới 1%: DB còn rảnh mà', min: 0, max: 0.01 },
              { label: '1–15%', min: 0.01, max: 0.15 },
              { label: '15–60%', min: 0.15, max: 0.6 },
              { label: 'trên 60%', min: 0.6, max: Infinity },
            ],
            explain: 'Little: cần 600 × ~0.011 s ≈ 7 kết nối, nhưng chỉ có 2 × 2 = 4. Request xếp hàng chờ kết nối tới khi quá timeout. Nút thắt là pool ở phía API, không phải database.',
          },
          {
            type: 'fix',
            question: 'Sửa pool để không lỗi và p99 dưới 100 ms. Postgres có `max_connections = 100`, và sắp tới API sẽ scale lên 4 instance.',
            sim: smallPool,
            knobs: [
              {
                id: 'pool',
                label: 'Pool size mỗi instance API',
                target: { edge: ['api', 'db'] },
                field: 'poolSize',
                control: {
                  kind: 'select',
                  options: [
                    { value: 2, label: '2 kết nối' },
                    { value: 10, label: '10 kết nối' },
                    { value: 200, label: '200 kết nối' },
                  ],
                },
                help: 'Tổng kết nối = pool × số instance.',
                trap: {
                  value: 200,
                  why: 'Hôm nay chạy được, nhưng 4 instance × 200 = 800 kết nối, gấp 8 lần max_connections. Ngày scale lên, Postgres từ chối kết nối và cả hệ thống lỗi. Pool to cũng không làm DB nhanh hơn: DB chỉ có vài core.',
                },
              },
            ],
            goals: [
              { metric: 'errorRate', op: '<', value: 0.01 },
              { metric: 'p99Ms', op: '<', value: 100 },
            ],
            solution: { pool: 10 },
            hint: 'Cần ~7 kết nối tổng, nhớ cả giới hạn 100 của Postgres.',
            explain: '10 × 2 = 20 kết nối, dư gấp ~3 lần nhu cầu. Lên 4 instance là 40, vẫn dưới 100.',
          },
        ],
      },
      {
        id: 'u4-replicas',
        title: 'Read replica',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Một máy ghi, nhiều máy đọc',
            body: 'Hầu hết ứng dụng **đọc nhiều hơn ghi** hàng chục lần. Postgres/MySQL cho phép một **primary** nhận mọi lệnh ghi, rồi gửi thay đổi sang các **replica** chỉ để đọc.\n\nAPI chia việc: `INSERT/UPDATE` vào primary, `SELECT` sang replica. Thêm replica là tăng sức đọc, đồng thời có sẵn máy dự phòng nếu primary chết.\n\nNhưng bản sao **đến chậm**: thường vài ms, lúc primary bận có thể vài giây. Đó là **replication lag**.',
            anim: {
              actors: ['API', 'Primary', 'Replica'],
              steps: [
                { from: 0, to: 1, label: 'UPDATE name' },
                { from: 1, to: 0, label: 'OK', kind: 'res' },
                { from: 0, to: 2, label: 'SELECT name' },
                { from: 2, to: 0, label: 'tên CŨ', kind: 'err' },
                { from: 1, to: 2, label: 'WAL (trễ)', kind: 'async', at: 3.5 },
              ],
              caption: 'Đọc ngay sau khi ghi, replica chưa nhận được thay đổi.',
            },
          },
          {
            type: 'choice',
            question: 'Người dùng đổi tên hiển thị, trang reload và vẫn thấy tên cũ, vài giây sau mới đúng. Nguyên nhân hợp lý nhất?',
            options: ['Trình duyệt bị lỗi', 'Ghi vào primary nhưng đọc từ replica đang trễ', 'Database mất dữ liệu', 'Thiếu index'],
            answer: 1,
            explain: 'Cần đảm bảo "đọc được cái mình vừa ghi" (read-your-writes): đọc từ primary trong vài giây sau khi người đó ghi, hoặc với những màn hình của chính họ.',
          },
          {
            type: 'choice',
            question: 'Query nào nên đi sang replica?',
            options: [
              'Kiểm tra số dư trước khi trừ tiền',
              'Trang "Sản phẩm bán chạy tuần này"',
              'Đọc lại đơn hàng ngay sau khi tạo để hiện trang xác nhận',
              'Kiểm tra mã giảm giá còn lượt dùng',
            ],
            answer: 1,
            explain: 'Thống kê cũ vài giây không ai để ý. Ba trường hợp còn lại cần dữ liệu mới nhất: đọc nhầm số cũ có thể cho trừ tiền quá số dư hoặc dùng mã quá số lượt.',
          },
        ],
      },
      {
        id: 'u4-sharding',
        title: 'Index và sharding',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Index: mục lục của bảng',
            body: 'Không có index, `SELECT * FROM orders WHERE user_id = 42` phải **đọc từng dòng** trong bảng (sequential scan). Bảng 10 triệu dòng có thể mất vài giây.\n\nIndex B-tree giống mục lục sách: tìm trong ~log₂(10 triệu) ≈ 23 bước, chỉ còn **vài ms**.\n\nĐổi lại, mỗi lệnh ghi phải cập nhật thêm index, và index tốn đĩa. Dùng `EXPLAIN ANALYZE` để xem query có dùng index hay không.',
          },
          {
            type: 'choice',
            question: 'Query trang "Đơn hàng của tôi" chạy 2 giây, `EXPLAIN` báo `Seq Scan on orders`. Việc đầu tiên nên làm?',
            options: ['Mua máy DB mạnh hơn', 'Thêm index trên `orders(user_id)`', 'Thêm read replica', 'Thêm cache Redis'],
            answer: 1,
            explain: 'Thiếu index là lỗi rẻ nhất để sửa và hiệu quả nhất. Cache hay replica chỉ che đi một query vốn đã tệ.',
          },
          {
            type: 'read',
            title: 'Sharding: chia dữ liệu ra nhiều máy',
            body: 'Khi **lượng ghi** hoặc **dung lượng** vượt sức một máy (replica chỉ giúp phần đọc), ta chia dữ liệu theo một **shard key**:\n- `user_id % 4` → 4 database, mỗi cái giữ 1/4 số user\n- mọi query có `user_id` chỉ chạm 1 shard\n- query không có shard key (thống kê toàn hệ thống) phải hỏi **tất cả** shard rồi gộp lại\n\nSharding rất khó đảo ngược. Hãy dùng hết index, cache, replica và máy to hơn trước khi shard.',
          },
          {
            type: 'choice',
            question: 'App chat chia shard theo `country`. 70% người dùng ở Việt Nam. Vấn đề là gì?',
            options: [
              'Không có vấn đề',
              'Shard Việt Nam gánh 70% tải (hot shard), các shard khác gần như rảnh',
              'Không query được theo user',
              'Tốn nhiều ổ đĩa hơn',
            ],
            answer: 1,
            explain: 'Shard key tốt phải chia **đều** tải. Ở đây nên dùng `conversation_id` (hash) để mọi tin nhắn của một cuộc chat nằm cùng shard, và tải chia đều.',
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
          {
            type: 'read',
            title: 'Timeout phải giảm dần theo chiều sâu',
            body: 'Client chờ 1 giây. API gọi Service B với timeout 3 giây. Khi B chậm, client đã bỏ đi từ lâu mà API vẫn **chờ tiếp** và B vẫn **làm tiếp**: toàn công vô ích.\n\nQuy tắc: mỗi tầng có timeout **ngắn hơn** tầng gọi nó. Tốt hơn nữa là truyền **deadline** xuống: "còn 600 ms cho cả phần còn lại" (gRPC làm sẵn việc này), mỗi tầng trừ đi phần mình đã dùng.\n\nĐừng quên timeout mặc định: `fetch` của Node **không có** timeout, axios mặc định là 0 (vô hạn).',
          },
          {
            type: 'fix',
            question: 'DB chậm gấp đôi trong 15 giây (p99 ~80 ms). Timeout API → DB đang là 60 ms, kèm 3 retry, nên lỗi tràn lan. Chọn timeout để tỉ lệ lỗi cả trận dưới 1%.',
            sim: retryStorm({}),
            knobs: [
              {
                id: 'timeout',
                label: 'Timeout API → DB',
                target: { edge: ['api', 'db'] },
                field: 'timeoutMs',
                control: {
                  kind: 'select',
                  options: [
                    { value: 60, label: '60 ms' },
                    { value: 300, label: '300 ms' },
                    { value: 30000, label: '30 giây' },
                  ],
                },
                help: 'Client của người dùng tự bỏ cuộc sau 1 giây.',
                trap: {
                  value: 30000,
                  why: 'Lần này qua được vì DB chỉ chậm gấp đôi. Nhưng client bỏ cuộc sau 1 s, nên chờ DB 30 s là vô nghĩa. Khi DB treo hẳn, mỗi request giữ slot API 30 giây và API sập theo. Timeout phải ngắn hơn timeout của tầng trên.',
                },
              },
            ],
            goals: [{ metric: 'errorRate', op: '<', value: 0.01 }],
            solution: { timeout: 300 },
            hint: 'Timeout phải dài hơn p99 lúc DB chậm, nhưng ngắn hơn 1 giây của client.',
            explain: '60 ms ngắn hơn p99 lúc DB chậm, nên request bình thường cũng bị cắt rồi retry, nhân tải lên. 300 ms dư so với p99 và vẫn để thời gian cho client.',
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
          {
            type: 'predict',
            question: 'Ví dụ "05 retry storm": 1000 rps, DB chậm gấp đôi từ giây 20 đến 35, API timeout 60 ms và retry 3 lần. Tỉ lệ lỗi cả 60 giây là bao nhiêu?',
            sim: retryStorm({}),
            metric: 'errorRate',
            options: [
              { label: 'dưới 1%: retry cứu hết', min: 0, max: 0.01 },
              { label: '1–15%: chỉ lỗi lúc DB chậm', min: 0.01, max: 0.15 },
              { label: '15–35%', min: 0.15, max: 0.35 },
              { label: 'trên 35%: sập, không tự hồi phục', min: 0.35, max: Infinity },
            ],
            explain: 'Retry nhân tải lên DB đúng lúc nó yếu nhất. DB không bao giờ đuổi kịp, nên hệ thống vẫn lỗi cả **sau khi** DB hết chậm. Đó là metastable failure: nguyên nhân đã hết nhưng sự cố vẫn tự duy trì.',
          },
          {
            type: 'fix',
            question: 'Cổng thanh toán lỗi ngẫu nhiên 5% (lỗi mạng thoáng qua). Thêm retry để tỉ lệ lỗi dưới 1%, nhưng đừng retry nhiều hơn cần thiết.',
            sim: flakyPayment,
            knobs: [
              {
                id: 'retries',
                label: 'Checkout → Payment: số lần retry',
                target: { edge: ['checkout', 'pay'] },
                field: 'retries',
                control: { kind: 'number', min: 0, max: 5 },
                help: 'Backoff 20 ms, có jitter.',
                trap: { value: 5, why: '5 retry nghĩa là lúc Payment quá tải thật, tải lên nó có thể ×6. Xác suất lỗi 5 lần liên tiếp do ngẫu nhiên đã gần bằng 0 từ lần thứ 2.' },
              },
            ],
            goals: [{ metric: 'errorRate', op: '<', value: 0.01 }],
            solution: { retries: 1 },
            hint: 'Hai lần cùng lỗi ngẫu nhiên: 5% × 5% = ?',
            explain: '1 retry: 0.05² = 0.25% lỗi. Mỗi retry thêm chỉ cải thiện rất ít mà tăng rủi ro retry storm. Và vì là thanh toán, API phải có idempotency key (bài sau) để retry không trừ tiền hai lần.',
          },
          {
            type: 'read',
            title: 'Retry budget',
            body: 'Thay vì "mỗi request retry tối đa 3 lần", nhiều hệ thống lớn giới hạn **tổng** lượng retry: retry không được vượt quá **10%** số request thành công gần đây.\n- lỗi lẻ tẻ: đủ budget, retry bình thường\n- downstream sập thật: budget cạn ngay, gần như không retry, không khuếch đại tải\n\nNgoài ra chỉ retry ở **một tầng**. Ba tầng mỗi tầng retry 3 lần thì tầng dưới cùng nhận tới 4 × 4 × 4 = 64 lần tải.',
          },
          {
            type: 'choice',
            question: 'Browser → API → Service → DB. Mỗi tầng retry 2 lần (3 lần thử). DB lỗi hẳn. Mỗi click của người dùng tạo ra tối đa bao nhiêu lời gọi tới DB?',
            options: ['3', '6', '9', '27'],
            answer: 3,
            explain: '3 × 3 × 3 = 27. Retry ở nhiều tầng nhân lên theo cấp số. Chọn một tầng để retry (thường là tầng gần lỗi nhất), các tầng khác trả lỗi ngay.',
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
          {
            type: 'choice',
            question: 'Breaker tới dịch vụ Gợi ý sản phẩm đang mở. Trang chủ nên làm gì?',
            options: [
              'Trả lỗi 500 cho cả trang',
              'Hiện trang chủ bình thường, ô gợi ý thay bằng "sản phẩm bán chạy" lấy từ cache',
              'Chờ breaker đóng lại rồi mới trả lời',
              'Retry liên tục cho tới khi thành công',
            ],
            answer: 1,
            explain: 'Breaker chỉ có ích khi đi kèm **fallback**: giá trị mặc định, dữ liệu cache, hoặc ẩn tính năng phụ. Gợi ý không phải tính năng cốt lõi, đừng để nó kéo sập trang chủ.',
          },
          {
            type: 'predict',
            question: 'Cùng ví dụ retry storm (DB chậm gấp đôi 15 giây, timeout 60 ms, 3 retry), nhưng thêm circuit breaker (mở khi lỗi ≥ 50%, mở trong 2 giây). Tỉ lệ lỗi cả trận là bao nhiêu?',
            sim: retryStorm({ circuitBreaker: { failureThreshold: 0.5, minRequests: 50, windowMs: 1000, openMs: 2000 } }),
            metric: 'errorRate',
            options: [
              { label: 'dưới 1%', min: 0, max: 0.01 },
              { label: '1–15%', min: 0.01, max: 0.15 },
              { label: '15–35%: vẫn lỗi lúc DB chậm, nhưng hồi phục ngay sau đó', min: 0.15, max: 0.35 },
              { label: 'trên 35%', min: 0.35, max: Infinity },
            ],
            explain: 'Breaker không làm DB nhanh hơn, nên lúc DB chậm vẫn có lỗi. Nhưng nó cắt retry storm, nên hệ thống **hồi phục ngay** khi DB khoẻ lại thay vì tiếp tục sập. Sửa tận gốc vẫn là timeout hợp lý (bài Timeout).',
          },
        ],
      },
      {
        id: 'u5-idempotency',
        title: 'Idempotency',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Gọi hai lần, kết quả như một lần',
            body: 'Timeout **không có nghĩa là thất bại**. Có thể server đã trừ tiền xong, chỉ là response bị mất trên đường về. Client retry thì người dùng bị **trừ tiền hai lần**.\n\nCách chữa: client tạo một **idempotency key** (UUID) cho mỗi thao tác và gửi kèm mọi lần thử. Server lưu key cùng kết quả:\n- key mới: xử lý, lưu `(key → kết quả)`\n- key đã có: trả lại kết quả cũ, **không làm lại**\n\nStripe, PayPal và hầu hết API thanh toán đều dùng header `Idempotency-Key`.',
            anim: {
              actors: ['Client', 'Payment API', 'DB'],
              steps: [
                { from: 0, to: 1, label: 'charge (key=abc)' },
                { from: 1, to: 2, label: 'INSERT key, trừ tiền' },
                { from: 2, to: 1, kind: 'res' },
                { from: 1, to: 0, label: 'mất response', kind: 'err' },
                { from: 0, to: 1, label: 'retry (key=abc)' },
                { from: 1, to: 2, label: 'key đã có?' },
                { from: 2, to: 1, label: 'có, kết quả cũ', kind: 'res' },
                { from: 1, to: 0, label: 'OK (không trừ lại)', kind: 'res' },
              ],
            },
          },
          {
            type: 'choice',
            question: 'Thao tác nào vốn đã idempotent (gọi nhiều lần cũng như một lần)?',
            options: ['`balance = balance - 100`', '`INSERT INTO orders ...` không có ràng buộc unique', '`UPDATE users SET email = \'a@b.c\' WHERE id = 1`', 'Gửi một tin nhắn SMS'],
            answer: 2,
            explain: 'Đặt một giá trị cố định thì lặp lại vẫn ra cùng kết quả. Trừ dần, chèn thêm dòng, gửi tin đều cộng dồn mỗi lần gọi. HTTP quy ước GET, PUT, DELETE là idempotent, POST thì không.',
          },
          {
            type: 'order',
            question: 'Sắp xếp cách server xử lý một request có `Idempotency-Key`:',
            items: [
              'Nhận request kèm key',
              'Thử INSERT key vào bảng có ràng buộc UNIQUE',
              'Nếu trùng key: trả lại kết quả đã lưu',
              'Nếu key mới: xử lý thanh toán',
              'Lưu kết quả cùng key, trả response',
            ],
            explain: 'Ràng buộc UNIQUE trong DB chặn cả trường hợp hai lần thử đến cùng lúc ở hai instance khác nhau, điều mà kiểm tra bằng `if` trong code không làm được.',
          },
          {
            type: 'choice',
            question: 'Ai nên tạo idempotency key?',
            options: ['Server, mỗi lần nhận request', 'Client, một lần cho mỗi thao tác của người dùng, dùng lại cho mọi lần retry', 'Database', 'Load balancer'],
            answer: 1,
            explain: 'Nếu mỗi lần thử có key mới thì server không nhận ra đó là cùng một thao tác. Key phải sinh ra khi người dùng bấm nút, trước lần gửi đầu tiên.',
          },
        ],
      },
      {
        id: 'u5-bulkhead',
        title: 'Bulkhead và load shedding',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Vách ngăn chống chìm tàu',
            body: 'Thân tàu chia thành nhiều khoang kín (**bulkhead**): thủng một khoang thì tàu vẫn nổi.\n\nTrong phần mềm: đừng để một phụ thuộc chậm **chiếm hết** tài nguyên chung. Ví dụ API có 100 slot dùng chung cho mọi endpoint. Dịch vụ báo cáo treo, request `/reports` giữ hết 100 slot, nên `/checkout` cũng chết theo.\n\nChia riêng: pool kết nối riêng, giới hạn đồng thời riêng cho từng phụ thuộc (`/reports` tối đa 20). Báo cáo có treo thì checkout vẫn còn 80 slot.',
          },
          {
            type: 'choice',
            question: 'API dùng một pool 50 kết nối HTTP chung để gọi cả Payment và Recommendation. Recommendation bắt đầu treo. Điều gì xảy ra?',
            options: [
              'Chỉ phần gợi ý bị chậm',
              'Kết nối bị Recommendation giữ hết, gọi Payment cũng phải chờ, thanh toán chết theo',
              'Payment nhanh hơn vì ít cạnh tranh',
              'Pool tự tăng lên',
            ],
            answer: 1,
            explain: 'Tài nguyên dùng chung là đường lan của sự cố. Tách pool hoặc đặt giới hạn đồng thời cho từng phụ thuộc, kèm timeout ngắn cho tính năng phụ.',
          },
          {
            type: 'read',
            title: 'Load shedding: chủ động bỏ bớt',
            body: 'Khi quá tải, phục vụ **một phần** request cho tốt vẫn hơn phục vụ **tất cả** thật tệ. Load shedding là từ chối sớm (503 hoặc 429) khi:\n- hàng đợi vượt ngưỡng, hoặc request đã chờ quá lâu (client chắc đã bỏ đi)\n- event loop lag hay CPU vượt ngưỡng\n\nCó ưu tiên thì càng tốt: bỏ bớt request phụ (prefetch, analytics, bot) trước, giữ request quan trọng (thanh toán, đăng nhập). Đó cũng là **graceful degradation**: tắt bớt tính năng phụ để giữ tính năng chính.',
          },
          {
            type: 'choice',
            question: 'Flash sale làm hệ thống quá tải. Nên ưu tiên bỏ bớt loại request nào trước?',
            options: ['Thanh toán đơn hàng', 'Đăng nhập', 'Gợi ý "có thể bạn cũng thích" và ghi analytics', 'Thêm vào giỏ hàng'],
            answer: 2,
            explain: 'Tính năng phụ được tắt đầu tiên để dồn tài nguyên cho luồng tạo ra doanh thu. Nhiều công ty có sẵn "nút tắt" (feature flag) cho các tính năng này.',
          },
        ],
      },
      {
        id: 'u5-redundancy',
        title: 'Dự phòng và nhiều zone',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Thiết kế để mất một phần',
            body: 'Một region của cloud gồm nhiều **availability zone**: các datacenter riêng điện, riêng mạng, cách nhau vài km. Một zone có thể mất hoàn toàn (mất điện, đứt cáp).\n\nĐể sống sót:\n- chạy instance ở **ít nhất 2–3 zone**, LB chia đều\n- mỗi zone còn lại phải đủ sức **gánh phần của zone đã mất**\n- database có replica ở zone khác, failover tự động\n\nVới 3 zone, mỗi zone bình thường chỉ nên chạy tới ~**66%** công suất của nó, vì mất một zone thì 2 zone còn lại nhận thêm 50% tải.',
          },
          {
            type: 'choice',
            question: 'Cần chịu 1200 rps, mỗi instance chịu 200 rps (ở mức an toàn). Chạy ở 3 zone, phải chịu được mất 1 zone. Cần ít nhất bao nhiêu instance?',
            options: ['6', '7', '9', '12'],
            answer: 2,
            explain: 'Mất 1 zone, 2 zone còn lại phải chịu 1200 rps, tức 6 instance, 3 mỗi zone. Chia đều 3 zone là 9 instance. Chạy 2 zone thì phải 12 (6 mỗi zone): 3 zone tiết kiệm hơn.',
          },
          {
            type: 'choice',
            question: 'API chạy 3 zone, nhưng Redis và Postgres chỉ có ở zone A. Zone A sập. Kết quả?',
            options: [
              'Không sao, API vẫn còn ở zone B và C',
              'Toàn hệ thống sập: API còn sống nhưng không có dữ liệu',
              'Chậm hơn một chút',
              'Chỉ mất cache',
            ],
            answer: 1,
            explain: 'Hệ thống chỉ chịu lỗi tốt bằng thành phần yếu nhất. Mọi tầng trên đường đi của request đều phải có dự phòng ở zone khác, nhất là database.',
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
          {
            type: 'predict',
            question: 'API ghi đơn thẳng vào Postgres (chịu ~2000 rps). Traffic 1500 rps, có 10 giây vọt lên 3500 rps. Tỉ lệ lỗi trong 20 giây là bao nhiêu?',
            sim: orderSpike(false),
            metric: 'errorRate',
            options: [
              { label: 'dưới 1%', min: 0, max: 0.01 },
              { label: '1–15%', min: 0.01, max: 0.15 },
              { label: '15–50%', min: 0.15, max: 0.5 },
              { label: 'trên 50%', min: 0.5, max: Infinity },
            ],
            explain: 'Trong 10 giây đỉnh, DB chỉ xử lý được ~2000/3500. API giữ slot chờ DB, hết slot và từ chối. Phần dư không có chỗ nào để "gửi tạm".',
          },
          {
            type: 'predict',
            question: 'Cùng kịch bản, nhưng API ghi vào queue rồi trả lời ngay; worker đọc queue và ghi vào DB theo tốc độ của DB. p99 người dùng thấy là bao nhiêu?',
            sim: orderSpike(true),
            metric: 'p99Ms',
            options: [
              { label: 'dưới 100 ms', min: 0, max: 100 },
              { label: '100–300 ms', min: 100, max: 300 },
              { label: '300 ms – 1 s', min: 300, max: 1000 },
              { label: 'trên 1 s (chờ DB)', min: 1000, max: Infinity },
            ],
            explain: 'Người dùng chỉ chờ API ghi vào queue (~1 ms), không chờ DB. Đỉnh tải biến thành backlog trong queue, worker xử lý dần sau đó. Đổi lại: đơn hàng được xử lý **trễ**, nên giao diện phải nói "Đang xử lý", không phải "Đã xác nhận".',
          },
        ],
      },
      {
        id: 'u6-delivery',
        title: 'Giao message: ít nhất một lần',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'At-least-once và ack',
            body: 'Consumer nhận message, xử lý, rồi gửi **ack** để queue xoá nó. Nếu consumer chết **giữa chừng** (trước khi ack), queue giao lại message cho consumer khác.\n\nHệ quả: message có thể được xử lý **hai lần** (đã ghi DB xong nhưng chết trước khi ack). Đây là đảm bảo **at-least-once**, mặc định của SQS, RabbitMQ, Kafka.\n- at-most-once: ack trước khi xử lý, có thể **mất** message\n- exactly-once: trên thực tế là at-least-once + consumer **idempotent**',
            anim: {
              actors: ['Queue', 'Worker A', 'Worker B', 'DB'],
              steps: [
                { from: 0, to: 1, label: 'msg #7' },
                { from: 1, to: 3, label: 'INSERT' },
                { from: 3, to: 1, kind: 'res' },
                { from: 1, to: 0, label: 'chết trước ack', kind: 'err' },
                { from: 0, to: 2, label: 'msg #7 (giao lại)' },
                { from: 2, to: 3, label: 'INSERT lần 2?' },
              ],
            },
          },
          {
            type: 'choice',
            question: 'Worker gửi email "Đơn hàng đã được giao" từ queue. Thỉnh thoảng khách nhận 2 email giống nhau. Cách sửa đúng?',
            options: [
              'Đổi sang queue khác',
              'Ghi lại `message_id` đã xử lý (bảng có UNIQUE), gặp lại thì bỏ qua',
              'Tắt retry của queue',
              'Ack trước khi gửi email',
            ],
            answer: 1,
            explain: 'Consumer idempotent là cách duy nhất có "exactly-once" thực sự. Ack trước khi gửi thì chuyển sang at-most-once: worker chết là khách không nhận email nào.',
          },
          {
            type: 'read',
            title: 'Dead letter queue',
            body: 'Có message **không bao giờ** xử lý được: JSON hỏng, đơn hàng trỏ tới sản phẩm đã xoá, bug trong code. Nếu cứ giao lại mãi, nó chặn queue và đốt CPU (**poison message**).\n\nGiải pháp: sau N lần thất bại (thường 3–5), chuyển message sang **DLQ** (dead letter queue). Team xem DLQ, sửa bug, rồi đẩy lại. Luôn đặt cảnh báo khi DLQ có message.',
          },
          {
            type: 'order',
            question: 'Sắp xếp vòng đời của một message bị lỗi do bug trong consumer:',
            items: ['Producer gửi message vào queue', 'Consumer nhận, xử lý bị lỗi, không ack', 'Queue giao lại sau một khoảng chờ, vẫn lỗi', 'Quá số lần thử tối đa: chuyển sang DLQ', 'Sửa bug, đẩy message từ DLQ về queue chính'],
            explain: 'Retry trong queue nên có backoff (visibility timeout tăng dần), giống retry khi gọi HTTP.',
          },
          {
            type: 'read',
            title: 'Outbox: ghi DB và gửi event cho chắc',
            body: 'Đoạn code quen thuộc có lỗ hổng:\n\n`await db.save(order);`\n`await queue.publish("order.created");`\n\nProcess chết giữa hai dòng: đơn đã lưu nhưng event **mất**. Đảo thứ tự thì có event mà không có đơn.\n\n**Outbox pattern**: ghi event vào bảng `outbox` **trong cùng transaction** với đơn hàng. Một tiến trình riêng đọc bảng outbox và publish (at-least-once), rồi đánh dấu đã gửi. Hai việc giờ thành công hoặc thất bại **cùng nhau**.',
          },
          {
            type: 'choice',
            question: 'Vì sao outbox giải quyết được vấn đề "lưu DB xong nhưng publish thất bại"?',
            options: [
              'Vì queue nhanh hơn',
              'Vì ghi đơn và ghi event nằm trong một transaction của database, nên không thể có cái này mà thiếu cái kia',
              'Vì không cần queue nữa',
              'Vì retry vô hạn',
            ],
            answer: 1,
            explain: 'Database đảm bảo transaction là nguyên tử. Phần publish sau đó có thể gửi trùng, nên consumer vẫn cần idempotent.',
          },
        ],
      },
      {
        id: 'u6-backpressure',
        title: 'Backpressure và rate limit',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Queue cũng có thể đầy',
            body: 'Queue giúp san đỉnh **ngắn**. Nếu producer **luôn** nhanh hơn consumer, backlog tăng mãi: message ngày càng trễ, rồi hết RAM/đĩa.\n\n**Backpressure** là tín hiệu "chậm lại" truyền ngược về phía gửi:\n- queue có giới hạn, đầy thì producer bị chặn hoặc nhận lỗi\n- API trả `429 Too Many Requests` kèm header `Retry-After`\n- stream trong Node (`pipe`) tự dừng đọc khi bên ghi chưa kịp\n\nQueue không làm consumer nhanh hơn. Nó chỉ **dời** việc sang sau.',
          },
          {
            type: 'choice',
            question: 'Producer gửi 1200 msg/s liên tục, consumer xử lý 1000 msg/s. Sau 1 giờ backlog là bao nhiêu, và cách sửa?',
            options: [
              '0, queue tự lo',
              '720.000 message và tăng mãi; phải thêm consumer hoặc giảm tốc producer',
              '1200 message',
              'Queue tự xoá message cũ, không cần làm gì',
            ],
            answer: 1,
            explain: '200 × 3600 = 720.000. Một message mới phải chờ 12 phút và con số này tăng không dừng. Theo dõi độ dài backlog và tuổi của message cũ nhất, scale consumer theo đó (KEDA làm việc này trên Kubernetes).',
          },
          {
            type: 'read',
            title: 'Rate limit: token bucket',
            body: 'Để bảo vệ API khỏi một client gửi quá nhiều (bug vòng lặp, bot, đối thủ), ta giới hạn mỗi client N request mỗi giây. Thuật toán phổ biến là **token bucket**:\n- mỗi client có một xô chứa tối đa B token\n- token được thêm vào đều đặn, R token mỗi giây\n- mỗi request lấy 1 token; xô rỗng thì trả `429`\n\nB cho phép **burst** ngắn (mở app tải 20 thứ cùng lúc), R giới hạn tốc độ trung bình. Với nhiều instance, đếm bằng Redis để mọi instance thấy chung một xô.',
          },
          {
            type: 'choice',
            question: 'Token bucket: tối đa 10 token, nạp 2 token/giây. Client im lặng 1 phút rồi gửi 15 request cùng lúc. Bao nhiêu request được chấp nhận ngay?',
            options: ['2', '10', '15', '120'],
            answer: 1,
            explain: 'Xô chỉ chứa tối đa 10 token dù đã chờ lâu. 10 request qua, 5 bị 429. Sau đó client chỉ được ~2 request/giây.',
          },
        ],
      },
      {
        id: 'u6-pubsub',
        title: 'Pub/sub và Kafka',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Một event, nhiều bên nghe',
            body: 'Queue thường: mỗi message chỉ **một** consumer xử lý. **Pub/sub**: mỗi event được giao cho **mọi** nhóm đăng ký.\n\nVí dụ `order.created` được: kho trừ hàng, email gửi xác nhận, analytics ghi số liệu. Order service không cần biết có ai nghe, thêm bên nghe mới không phải sửa nó.\n\nKafka làm cả hai: mỗi **consumer group** nhận đủ mọi event (pub/sub), còn trong một group các consumer **chia nhau** xử lý (queue).',
            anim: {
              actors: ['Order', 'Kafka', 'Kho', 'Email', 'Analytics'],
              steps: [
                { from: 0, to: 1, label: 'order.created' },
                { from: 1, to: 0, label: 'ack', kind: 'res' },
                { from: 1, to: 2, kind: 'async', at: 2 },
                { from: 1, to: 3, kind: 'async', at: 2 },
                { from: 1, to: 4, kind: 'async', at: 2 },
              ],
              caption: 'Mỗi consumer group nhận một bản của event.',
            },
          },
          {
            type: 'read',
            title: 'Partition: thứ tự và song song',
            body: 'Một topic Kafka chia thành nhiều **partition**. Message có cùng **key** luôn vào cùng partition, và **thứ tự chỉ được đảm bảo trong một partition**.\n\nTrong một consumer group, mỗi partition chỉ do **một** consumer đọc. Vì vậy:\n- số partition là **giới hạn trên** của số consumer chạy song song\n- chọn key theo thực thể cần giữ thứ tự: `order_id` để các event của một đơn không bị đảo (created → paid → shipped)',
          },
          {
            type: 'choice',
            question: 'Topic có 6 partition. Một consumer group chạy 10 consumer. Bao nhiêu consumer thực sự nhận được message?',
            options: ['10', '6, 4 cái còn lại ngồi chơi', '1', '60'],
            answer: 1,
            explain: 'Mỗi partition chỉ gán cho một consumer trong group. Muốn 10 consumer cùng làm thì cần ít nhất 10 partition, nên tạo topic với dư partition ngay từ đầu.',
          },
          {
            type: 'choice',
            question: 'Event `order.paid` đôi khi được xử lý trước `order.created` của cùng đơn hàng. Nguyên nhân hợp lý nhất?',
            options: [
              'Kafka bị lỗi',
              'Message không có key (hoặc key ngẫu nhiên), nên hai event của cùng một đơn rơi vào hai partition khác nhau',
              'Consumer quá chậm',
              'Thiếu DLQ',
            ],
            answer: 1,
            explain: 'Dùng `order_id` làm key để mọi event của một đơn vào cùng một partition và giữ đúng thứ tự.',
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
          {
            type: 'predict',
            question: 'Một process Node, mỗi request tốn ~2 ms CPU (công suất ~480 rps). Bắn 450 rps (khoảng 94% CPU). p99 là bao nhiêu?',
            sim: nodeProcess(450),
            metric: 'p99Ms',
            options: [
              { label: '~4 ms, bằng thời gian CPU', min: 0, max: 10 },
              { label: '~10–30 ms', min: 10, max: 30 },
              { label: '~30–200 ms', min: 30, max: 200 },
              { label: 'trên 200 ms', min: 200, max: Infinity },
            ],
            explain: 'Ở 200 rps p99 chỉ ~10 ms. Ở 94% CPU, mỗi request phải chờ hàng chục request khác dùng xong CPU: event loop lag. Cùng điểm gãy như Phần 3, chỉ là "slot" ở đây là luồng JS duy nhất.',
          },
          {
            type: 'fix',
            question: 'API Node nhận 1500 rps, mỗi process chịu ~480 rps. Đang chạy cluster 2 process. Chọn số process để p99 dưới 50 ms, ngân sách tối đa $0.40/giờ (mỗi process cần 1 core, $0.10/giờ).',
            sim: nodeProcess(1500, 2),
            knobs: [
              {
                id: 'procs',
                label: 'Số process (PM2 cluster / pod)',
                target: { node: 'api' },
                field: 'instances',
                control: { kind: 'number', min: 1, max: 8, unit: ' process' },
                help: 'Mỗi process là một event loop riêng trên một core.',
              },
            ],
            goals: [
              { metric: 'p99Ms', op: '<', value: 50 },
              { metric: 'costPerHour', op: '<=', value: 0.4 },
            ],
            solution: { procs: 4 },
            hint: '1500 × 2 ms ≈ 3 core bận. Cần thêm khoảng dư.',
            explain: '3 process là ~104% CPU: hàng đợi tăng mãi, p99 gần 1 giây. 4 process là ~78%, p99 ~10 ms. Chạy nhiều process hơn số core thì không thêm được công suất, vì chúng tranh nhau cùng CPU.',
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
          {
            type: 'order',
            question: 'Sắp xếp các bước của một lần load test tìm giới hạn server:',
            items: [
              'Chọn endpoint và dữ liệu giống thật (không chỉ GET /health)',
              'Warm-up vài chục giây ở tải thấp',
              'Tăng tải theo bậc, mỗi bậc giữ 1–2 phút',
              'Ghi p99, tỉ lệ lỗi, CPU và RAM ở từng bậc',
              'Tìm bậc mà p99 tăng vọt: đó là điểm gãy',
            ],
            explain: '`tools/k6/step-load.js` trong repo làm đúng các bậc này. Kết quả đưa vào tab Công suất → Hiệu chỉnh.',
          },
          {
            type: 'choice',
            question: 'Load test cho p99 = 15 ms với 2000 rps, nhưng production chỉ 500 rps đã p99 = 400 ms. Nguyên nhân nào hay gặp nhất?',
            options: [
              'k6 bị lỗi',
              'Dữ liệu test quá nhỏ hoặc lặp lại: mọi thứ nằm gọn trong cache và RAM, còn production có hàng triệu dòng',
              'Production có nhiều người dùng hơn',
              'Do mạng của người dùng',
            ],
            answer: 1,
            explain: 'Test với 100 sản phẩm thì DB cache toàn bộ, không bao giờ đọc đĩa. Dùng dữ liệu cỡ production (hoặc bản sao đã ẩn danh) và phân phối truy cập giống thật.',
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
          {
            type: 'choice',
            question: 'Mỗi process NestJS dùng ~250 MB RAM lúc tải cao. Server 4 vCPU chạy 4 process, cộng hệ điều hành ~1 GB. Gói RAM nào hợp lý?',
            options: ['1 GB', '2 GB', '4 GB', '32 GB'],
            answer: 2,
            explain: '4 × 250 MB + 1 GB = 2 GB lúc cao điểm. 2 GB là sát nút, không còn chỗ cho GC hay spike. 4 GB cho dư gấp đôi. 32 GB là phí tiền: Node không dùng hết RAM nếu CPU đã là nút thắt.',
          },
          {
            type: 'choice',
            question: 'Cần 6 vCPU ở mức 60% tải. Chọn phương án nào để vẫn ổn khi mất một server?',
            options: ['1 server 6 vCPU', '2 server 3 vCPU', '3 server 3 vCPU', '6 server 1 vCPU'],
            answer: 2,
            explain: '3 × 3 = 9 vCPU, mất một máy còn 6, vẫn đủ. 2 × 3 mất một máy chỉ còn 3 (tải 120%). 1 máy thì không có dự phòng. 6 máy 1 vCPU đủ nhưng mỗi máy nhỏ quá, overhead (OS, agent) chiếm tỉ lệ lớn.',
          },
        ],
      },
      {
        id: 'u7-gc',
        title: 'GC và tranh chấp',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Garbage collector dừng cả thế giới',
            body: 'V8 (Node), JVM, Go đều có **GC** dọn bộ nhớ không dùng nữa. Một phần công việc đó **dừng** JavaScript lại (stop-the-world): mọi request đang chạy trên process đều chờ.\n\nTriệu chứng: p50 bình thường nhưng p99 có những **gai** đều đặn, CPU chưa cao. Nguyên nhân hay gặp:\n- tạo nhiều object tạm (map/filter dài trên mảng lớn, JSON lớn)\n- cache trong RAM không giới hạn, heap phình to\n- heap gần chạm `--max-old-space-size` nên GC chạy liên tục\n\nTrong simulator: tham số `gcPauseMs` và `gcEveryRequests` của node CPU.',
          },
          {
            type: 'choice',
            question: 'p50 = 8 ms ổn định, CPU 40%, nhưng p99 = 250 ms và biểu đồ có gai đều đặn mỗi vài giây. Nghi ngờ đầu tiên?',
            options: ['Thiếu CPU', 'GC pause (heap lớn, nhiều object tạm)', 'Mạng chậm', 'Database thiếu index'],
            answer: 1,
            explain: 'CPU còn dư nên không phải thiếu CPU. Gai đều đặn ở đuôi là chữ ký của GC. Kiểm tra bằng `--trace-gc` hoặc metric `nodejs_gc_duration_seconds`.',
          },
          {
            type: 'read',
            title: 'Thêm core không phải lúc nào cũng nhanh hơn',
            body: 'Định luật **USL** (Universal Scalability Law) nói thêm máy hay thêm luồng có hai cái giá:\n- **tranh chấp** (contention): mọi người cùng chờ một khoá, một dòng DB, một connection\n- **đồng bộ** (coherency): các bên phải trao đổi để thống nhất dữ liệu, chi phí tăng theo bình phương số bên\n\nKết quả: throughput tăng chậm dần, có lúc còn **giảm** khi thêm tài nguyên. Ví dụ hay gặp: 50 request cùng `UPDATE products SET stock = stock - 1 WHERE id = 1` trong flash sale, tất cả xếp hàng chờ khoá của một dòng.',
          },
          {
            type: 'choice',
            question: 'Flash sale 1 sản phẩm, mọi request cùng trừ tồn kho trên một dòng. Tăng API từ 4 lên 16 instance, throughput gần như không đổi. Vì sao?',
            options: [
              'Load balancer bị lỗi',
              'Nút thắt là khoá trên một dòng DB: thêm API chỉ thêm người xếp hàng',
              'Thiếu RAM',
              'Do GC',
            ],
            answer: 1,
            explain: 'Cách chữa: giữ tồn kho trong Redis (`DECR` nguyên tử, rất nhanh), chia tồn kho thành nhiều "lô" trên nhiều dòng, hoặc xếp đơn vào queue rồi xử lý tuần tự.',
          },
        ],
      },
      {
        id: 'u7-observability',
        title: 'Quan sát hệ thống',
        kind: 'learn',
        cards: [
          {
            type: 'read',
            title: 'Metrics, logs, traces',
            body: 'Ba nguồn tín hiệu, mỗi cái trả lời một câu hỏi:\n- **Metrics** (Prometheus): con số theo thời gian, rẻ, để vẽ biểu đồ và **cảnh báo**. "Có chuyện gì không?"\n- **Logs**: sự kiện chi tiết từng dòng. "Chuyện gì đã xảy ra với request này?"\n- **Traces** (OpenTelemetry, Jaeger): một request đi qua những service nào, mỗi chặng mất bao lâu. "Chậm ở đâu?"\n\nGắn cùng một `trace_id` vào log và trace để nhảy qua lại giữa chúng. Tab Trace trong simulator là một trace đơn giản.',
          },
          {
            type: 'read',
            title: 'RED cho service, USE cho tài nguyên',
            body: 'Hai bộ metric tối thiểu nên có:\n\n**RED** cho mỗi service, nhìn từ phía người gọi:\n- **R**ate: số request mỗi giây\n- **E**rrors: tỉ lệ lỗi\n- **D**uration: phân phối latency (p50, p99)\n\n**USE** cho mỗi tài nguyên (CPU, RAM, đĩa, pool kết nối):\n- **U**tilization: bận bao nhiêu %\n- **S**aturation: có bao nhiêu việc đang **chờ** (hàng đợi, event loop lag)\n- **E**rrors: lỗi của tài nguyên đó\n\nRED cho biết người dùng có đang khổ không, USE giúp tìm ra vì sao.',
          },
          {
            type: 'choice',
            question: 'Cảnh báo nào nên **đánh thức** người trực lúc 3 giờ sáng?',
            options: [
              'CPU một máy vượt 80% trong 1 phút',
              'Tỉ lệ lỗi thanh toán vượt SLO và đang đốt error budget nhanh',
              'Có một dòng log ERROR',
              'Ổ đĩa còn 60%',
            ],
            answer: 1,
            explain: 'Chỉ đánh thức người khi người dùng **đang** bị ảnh hưởng. CPU cao hay vài log lỗi có thể tự hết; để chúng ở dashboard hoặc ticket ban ngày. Cảnh báo quá nhiều làm người trực bỏ qua cả cảnh báo thật.',
          },
          {
            type: 'choice',
            question: 'p99 của API tăng từ 80 ms lên 900 ms. Công cụ nào giúp tìm ra **chặng nào** chậm nhanh nhất?',
            options: ['Dashboard CPU', 'Distributed trace của một request chậm', 'Đếm số dòng log', 'Restart server'],
            answer: 1,
            explain: 'Trace cho thấy waterfall của request: chờ pool, query DB hay gọi service khác. Metrics báo có vấn đề, trace chỉ ra chỗ.',
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

/** Resolve a review key (`lessonId#index`) to its card; null if the path changed. */
export function cardByKey(key: string) {
  const [id, i] = key.split('#');
  const lesson = LESSONS.find((l) => l.id === id);
  const card = lesson?.cards[Number(i)];
  if (!lesson || !card || card.type === 'read' || card.type === 'build') return null;
  return { lesson, card, index: Number(i) };
}

/** Short text of a question card, for lists. */
export function cardPrompt(card: { type: string } & Record<string, unknown>) {
  return String(card.question ?? card.title ?? '');
}
