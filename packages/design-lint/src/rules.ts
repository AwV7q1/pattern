import type { Finding, LintDesign, LintEdge, LintNode, LintNodeConfig, LintScenario, Severity } from './types.ts';

/** Engine defaults for the fields the rules read (crates/engine/src/model.rs). */
const DEFAULTS = {
  instances: 1,
  concurrency: 100,
  maxInFlight: 10_000,
  cpuLanes: 1,
  latencyP99Ms: 5,
  backoffMs: 50,
  bandwidthMbps: 1000,
};

export interface Ctx {
  design: LintDesign;
  scenario?: LintScenario;
  byId: Map<string, LintNode>;
  out: Map<string, LintEdge[]>;
  in: Map<string, LintEdge[]>;
  name: (id: string) => string;
}

export type Rule = (ctx: Ctx) => Finding[];

const cfg = (n: LintNode | undefined): LintNodeConfig => n?.config ?? {};
const instancesOf = (n: LintNode) => {
  const c = cfg(n);
  return Math.max(c.autoscale ? (c.autoscale.max ?? c.instances ?? 1) : (c.instances ?? DEFAULTS.instances), 1);
};
const minInstancesOf = (n: LintNode) => {
  const c = cfg(n);
  return c.autoscale ? (c.autoscale.min ?? 1) : (c.instances ?? DEFAULTS.instances);
};
const processesOf = (n: LintNode) => (cfg(n).model === 'cpu' ? Math.max(cfg(n).cpuLanes ?? DEFAULTS.cpuLanes, 1) : 1);
const p99Of = (n: LintNode | undefined) => {
  const c = cfg(n);
  return c.model === 'cpu' ? (c.cpuP99Ms ?? 5) + (c.ioP99Ms ?? 0) : (c.latencyP99Ms ?? DEFAULTS.latencyP99Ms);
};
const edgeKey = (e: LintEdge): [string, string] => [e.source, e.target];
const retriesOf = (e: LintEdge) => Math.max(0, e.retries ?? 0);
const isClient = (ctx: Ctx, id: string) => ctx.byId.get(id)?.kind === 'client';
/** Time a caller may spend on one edge: every attempt timing out plus the backoffs. */
const budgetOf = (e: LintEdge) => {
  if (!e.timeoutMs) return Infinity;
  const r = retriesOf(e);
  let backoff = 0;
  for (let i = 0; i < r; i++) backoff += (e.backoffMs ?? DEFAULTS.backoffMs) * 2 ** i;
  return e.timeoutMs * (r + 1) + backoff;
};
const round = (v: number, step = 10) => Math.max(step, Math.ceil(v / step) * step);

function f(
  rule: string,
  severity: Severity,
  target: Finding['target'],
  message: string,
  why: string,
  fix?: Finding['fix'],
): Finding {
  return fix ? { rule, severity, target, message, why, fix } : { rule, severity, target, message, why };
}

// ---------------------------------------------------------------- edge policies

export const retryWithoutBackoff: Rule = (ctx) =>
  ctx.design.edges
    .filter((e) => retriesOf(e) > 0 && (e.backoffMs ?? DEFAULTS.backoffMs) <= 0)
    .map((e) =>
      f(
        'retry-no-backoff',
        'warn',
        { edge: edgeKey(e) },
        `${ctx.name(e.source)} → ${ctx.name(e.target)} retry ngay lập tức, không có backoff`,
        'Retry dồn dập trong lúc dependency đang quá tải chỉ làm nó quá tải hơn. Backoff mũ cho dependency thời gian hồi phục.',
        { label: 'Đặt backoff 50ms', patches: [{ target: { edge: edgeKey(e) }, field: 'backoffMs', value: 50 }] },
      ),
    );

export const retryWithoutJitter: Rule = (ctx) =>
  ctx.design.edges
    .filter((e) => retriesOf(e) > 0 && e.jitter === false)
    .map((e) =>
      f(
        'retry-no-jitter',
        'warn',
        { edge: edgeKey(e) },
        `${ctx.name(e.source)} → ${ctx.name(e.target)} retry không có jitter`,
        'Mọi caller lỗi cùng lúc sẽ retry cùng lúc, tạo các đợt sóng tải đồng bộ (thundering herd). Jitter rải các lần retry ra.',
        { label: 'Bật jitter', patches: [{ target: { edge: edgeKey(e) }, field: 'jitter', value: true }] },
      ),
    );

export const retryWithoutTimeout: Rule = (ctx) =>
  ctx.design.edges
    .filter((e) => retriesOf(e) > 0 && !e.timeoutMs && !isClient(ctx, e.source))
    .map((e) => {
      const t = round(p99Of(ctx.byId.get(e.target)) * 3 + (e.latencyMs ?? 1) * 2);
      return f(
        'retry-no-timeout',
        'warn',
        { edge: edgeKey(e) },
        `${ctx.name(e.source)} → ${ctx.name(e.target)} có retry nhưng không có timeout`,
        'Không có timeout thì chỉ lỗi nhanh mới được retry; dependency chậm hoặc treo sẽ giữ request (và slot của caller) mãi mãi.',
        { label: `Đặt timeout ${t}ms (≈3× p99 phía dưới)`, patches: [{ target: { edge: edgeKey(e) }, field: 'timeoutMs', value: t }] },
      );
    });

export const retryStormRisk: Rule = (ctx) =>
  ctx.design.edges
    .filter((e) => retriesOf(e) >= 3 && !e.circuitBreaker && !e.retryBudget && !isClient(ctx, e.source))
    .map((e) =>
      f(
        'retry-storm-risk',
        'warn',
        { edge: edgeKey(e) },
        `${ctx.name(e.source)} → ${ctx.name(e.target)} retry ${retriesOf(e)} lần mà không có retry budget hay circuit breaker`,
        `Khi ${ctx.name(e.target)} quá tải, mỗi request lỗi thành ${retriesOf(e) + 1} lần gọi, tải tăng gấp bội đúng lúc nó yếu nhất và không tự hồi phục được (retry storm). Retry budget giới hạn retry ở một tỉ lệ nhỏ của traffic.`,
        { label: 'Thêm retry budget 10%', patches: [{ target: { edge: edgeKey(e) }, field: 'retryBudget', value: { ratio: 0.1, minPerSec: 10 } }] },
      ),
    );

/** A callee's retries outlast the caller's own timeout: work nobody waits for. */
export const timeoutOrder: Rule = (ctx) => {
  const clientTimeout = ctx.scenario?.timeoutMs ?? 2000;
  // tightest deadline a request still has when it reaches each node, and who set it
  const memo = new Map<string, { ms: number; by: string } | null>();
  const deadline = (id: string, seen: Set<string>): { ms: number; by: string } | null => {
    if (memo.has(id)) return memo.get(id)!;
    let best: { ms: number; by: string } | null = null;
    for (const e of ctx.in.get(id) ?? []) {
      if (seen.has(e.source) || e.fireAndForget || ctx.byId.get(e.source)?.kind === 'queue') continue;
      const own = e.timeoutMs ?? (isClient(ctx, e.source) ? clientTimeout : null);
      seen.add(e.source);
      const up = own ? { ms: own, by: e.source } : deadline(e.source, seen);
      seen.delete(e.source);
      if (up && (!best || up.ms < best.ms)) best = up;
    }
    memo.set(id, best);
    return best;
  };
  const out: Finding[] = [];
  for (const child of ctx.design.edges) {
    // a queue's consumer works on its own clock, not the producer's deadline
    if (child.fireAndForget || isClient(ctx, child.source) || ctx.byId.get(child.source)?.kind === 'queue') continue;
    const limit = deadline(child.source, new Set([child.source]));
    const budget = budgetOf(child);
    if (!limit || budget === Infinity || budget < limit.ms) continue;
    out.push(
      f(
        'timeout-order',
        'warn',
        { edge: edgeKey(child) },
        `${ctx.name(child.source)} → ${ctx.name(child.target)} có thể chờ tới ${Math.round(budget)}ms, lâu hơn timeout ${limit.ms}ms của ${ctx.name(limit.by)}`,
        'Timeout phải giảm dần từ ngoài vào trong. Khi tầng trên đã bỏ cuộc, tầng dưới vẫn retry và làm việc mà không ai chờ kết quả, tốn tài nguyên đúng lúc hệ thống đang yếu.',
        {
          label: 'Giảm timeout cho vừa',
          patches: [
            {
              target: { edge: edgeKey(child) },
              field: 'timeoutMs',
              value: Math.max(1, Math.floor((limit.ms * 0.8) / (retriesOf(child) + 1))),
            },
          ],
        },
      ),
    );
  }
  return out;
};

/** Retries multiply across layers: 3 retries on 3 layers = up to 64 calls at the bottom. */
export const retryAmplification: Rule = (ctx) => {
  const client = ctx.design.nodes.find((n) => n.kind === 'client');
  if (!client) return [];
  let worst = { factor: 1, path: [] as LintEdge[] };
  const walk = (id: string, factor: number, path: LintEdge[], seen: Set<string>) => {
    if (factor > worst.factor) worst = { factor, path };
    for (const e of ctx.out.get(id) ?? []) {
      if (seen.has(e.target)) continue;
      seen.add(e.target);
      walk(e.target, factor * (retriesOf(e) + 1), [...path, e], seen);
      seen.delete(e.target);
    }
  };
  walk(client.id, 1, [], new Set([client.id]));
  if (worst.factor <= 8) return [];
  const retrying = worst.path.filter((e) => retriesOf(e) > 0);
  const deepest = retrying[retrying.length - 1];
  const chain = retrying.map((e) => `${ctx.name(e.target)} ×${retriesOf(e) + 1}`).join(' · ');
  return [
    f(
      'retry-amplification',
      worst.factor >= 27 ? 'error' : 'warn',
      { edge: edgeKey(deepest) },
      `Retry nhân chồng qua ${retrying.length} tầng: một request có thể thành ${worst.factor} lời gọi ở tầng dưới cùng`,
      `Mỗi tầng retry độc lập nên số lần thử nhân lên (${chain}). Khi tầng dưới chậm, tải dội vào nó tăng ${worst.factor} lần: đó là retry storm. Chỉ retry ở một tầng (thường là tầng gần dependency nhất) hoặc dùng retry budget.`,
      {
        label: 'Chỉ giữ retry ở tầng sâu nhất',
        patches: retrying.slice(0, -1).map((e) => ({ target: { edge: edgeKey(e) }, field: 'retries', value: 0 })),
      },
    ),
  ];
};

export const breakerMinRequests: Rule = (ctx) =>
  ctx.design.edges
    .filter((e) => e.circuitBreaker && (e.circuitBreaker.minRequests ?? 20) < 5)
    .map((e) =>
      f(
        'cb-min-requests',
        'warn',
        { edge: edgeKey(e) },
        `Circuit breaker ${ctx.name(e.source)} → ${ctx.name(e.target)} mở chỉ sau ${e.circuitBreaker!.minRequests} request`,
        'Với quá ít mẫu, vài lỗi ngẫu nhiên đủ làm breaker mở và chặn cả traffic khoẻ mạnh.',
        { label: 'Tối thiểu 20 request', patches: [{ target: { edge: edgeKey(e) }, field: 'circuitBreaker', value: { ...e.circuitBreaker, minRequests: 20 } }] },
      ),
    );

export const slowPayload: Rule = (ctx) =>
  ctx.design.edges.flatMap((e) => {
    const mbps = e.bandwidthMbps ?? DEFAULTS.bandwidthMbps;
    const ms = (Math.max(e.requestKb ?? 0, e.responseKb ?? 0) * 8) / mbps;
    if (ms < 50) return [];
    return [
      f(
        'slow-payload',
        'warn',
        { edge: edgeKey(e) },
        `Body qua ${ctx.name(e.source)} → ${ctx.name(e.target)} mất ~${Math.round(ms)}ms chỉ để truyền`,
        'Đường truyền là FIFO: các body xếp hàng nối đuôi nhau, nên link nghẽn trước cả server. Nén, phân trang, hoặc đưa file lớn qua CDN / object storage.',
      ),
    ];
  });

// ---------------------------------------------------------------- topology

/** Nodes every request depends on, with a single instance. */
export const singlePointOfFailure: Rule = (ctx) => {
  const client = ctx.design.nodes.find((n) => n.kind === 'client');
  if (!client) return [];
  const sinks = (skip: string) => {
    const seen = new Set([client.id]);
    const stack = [client.id];
    let found = 0;
    while (stack.length) {
      const id = stack.pop()!;
      const all = (ctx.out.get(id) ?? []).filter((e) => !e.fireAndForget);
      // a real leaf of the design (database, external service), not a node cut off by `skip`
      if (!all.length && id !== client.id) found++;
      const next = all.filter((e) => e.target !== skip);
      for (const e of next) if (!seen.has(e.target)) seen.add(e.target), stack.push(e.target);
    }
    return found;
  };
  if (sinks('') === 0) return [];
  return ctx.design.nodes
    .filter((n) => n.kind !== 'client' && minInstancesOf(n) <= 1 && sinks(n.id) === 0)
    .map((n) => {
      const severity: Severity = n.kind === 'service' || n.kind === 'database' ? 'warn' : 'info';
      return f(
        'spof',
        severity,
        { node: n.id },
        `${ctx.name(n.id)} là điểm lỗi duy nhất (1 instance, mọi request đều đi qua)`,
        n.kind === 'database'
          ? 'Chỉ một máy DB: máy đó chết, deploy hay bảo trì là cả hệ thống dừng. Thêm replica có failover (Patroni, RDS Multi-AZ).'
          : 'Một instance chết (crash, deploy, mất máy) là toàn bộ request lỗi. Chạy ít nhất 2 instance sau load balancer.',
        n.kind === 'database' ? undefined : { label: 'Chạy 2 instance', patches: [{ target: { node: n.id }, field: 'instances', value: 2 }] },
      );
    });
};

export const loadBalancerSingleTarget: Rule = (ctx) =>
  ctx.design.nodes
    .filter((n) => n.kind === 'loadBalancer' && (ctx.out.get(n.id) ?? []).length === 1)
    .filter((n) => instancesOf(ctx.byId.get(ctx.out.get(n.id)![0].target)!) <= 1)
    .map((n) =>
      f(
        'lb-single-target',
        'info',
        { node: n.id },
        `${ctx.name(n.id)} chỉ chia tải cho một instance`,
        'Load balancer chỉ có ích khi phía sau có nhiều instance để chia tải và để thay thế khi một instance chết.',
      ),
    );

/** Total connections from caller pools above what the database accepts. */
export const poolExceedsDatabase: Rule = (ctx) =>
  ctx.design.nodes
    .filter((n) => n.kind === 'database')
    .flatMap((db) => {
      const pooled = (ctx.in.get(db.id) ?? []).filter((e) => e.poolSize);
      if (!pooled.length) return [];
      const total = pooled.reduce((s, e) => {
        const src = ctx.byId.get(e.source);
        return s + (src ? (e.poolSize ?? 0) * instancesOf(src) * processesOf(src) : 0);
      }, 0);
      const c = cfg(db);
      const per = c.model === 'cpu' ? (c.maxInFlight ?? DEFAULTS.maxInFlight) : (c.concurrency ?? DEFAULTS.concurrency);
      const limit = per * instancesOf(db);
      if (total <= limit) return [];
      return [
        f(
          'pool-exceeds-db',
          'error',
          { node: db.id },
          `Các pool mở tới ${total} kết nối vào ${ctx.name(db.id)}, DB chỉ nhận ${limit}`,
          'Pool × số instance × số process (lúc autoscale lên max) phải nhỏ hơn max_connections. Vượt thì kết nối mới bị từ chối đúng lúc cao điểm. Giảm pool hoặc đặt PgBouncer phía trước.',
        ),
      ];
    });

export const fanOutWithoutTimeout: Rule = (ctx) =>
  ctx.design.nodes
    .filter((n) => ['parallel', 'quorum', 'hedge'].includes(cfg(n).routing ?? 'pick') && (ctx.out.get(n.id) ?? []).length > 1)
    .flatMap((n) =>
      (ctx.out.get(n.id) ?? [])
        .filter((e) => !e.timeoutMs && !e.fireAndForget)
        .map((e) => {
          const t = round(p99Of(ctx.byId.get(e.target)) * 3 + (e.latencyMs ?? 1) * 2);
          return f(
            'fan-out-no-timeout',
            'warn',
            { edge: edgeKey(e) },
            `Nhánh ${ctx.name(e.source)} → ${ctx.name(e.target)} gọi song song nhưng không có timeout`,
            'Gọi song song thì latency bằng nhánh chậm nhất. Một nhánh treo là cả request treo theo.',
            { label: `Đặt timeout ${t}ms`, patches: [{ target: { edge: edgeKey(e) }, field: 'timeoutMs', value: t }] },
          );
        }),
    );

export const hedgeWithoutProtection: Rule = (ctx) =>
  ctx.design.nodes
    .filter((n) => cfg(n).routing === 'hedge' && !(ctx.out.get(n.id) ?? []).some((e) => e.rateLimit || e.retryBudget))
    .map((n) =>
      f(
        'hedge-unbounded',
        'info',
        { node: n.id },
        `${ctx.name(n.id)} hedge mà không giới hạn tải thêm`,
        'Khi phía dưới chậm đều (không chỉ vài request), mọi request đều gửi bản dự phòng và tải nhân đôi đúng lúc nó yếu nhất. Đặt rate limit hoặc retry budget trên các nhánh.',
      ),
    );

// ---------------------------------------------------------------- caches, queues, autoscale

export const cacheRisks: Rule = (ctx) =>
  ctx.design.nodes
    .filter((n) => n.kind === 'cache' && cfg(n).cache)
    .flatMap((n) => {
      const c = cfg(n).cache!;
      const out: Finding[] = [];
      if ((c.zipf ?? 1) >= 0.9 && !c.coalesce && !c.staleWhileRevalidate)
        out.push(
          f(
            'cache-stampede',
            'warn',
            { node: n.id },
            `${ctx.name(n.id)} có key nóng nhưng không chống stampede`,
            'Khi một key nóng hết hạn hoặc cache bị flush, mọi request đang đọc key đó cùng miss và cùng đổ xuống DB. Singleflight (coalesce) chỉ cho một request đi lấy, các request khác chờ kết quả.',
            { label: 'Bật singleflight', patches: [{ target: { node: n.id }, field: 'cache', value: { ...c, coalesce: true } }] },
          ),
        );
      if (!c.ttlMs)
        out.push(
          f(
            'cache-no-ttl',
            'info',
            { node: n.id },
            `${ctx.name(n.id)} không có TTL`,
            'Không hết hạn thì dữ liệu cũ nằm trong cache mãi, trừ khi ứng dụng tự xoá khi ghi. Đặt TTL làm lưới an toàn.',
          ),
        );
      return out;
    });

export const queueConsumerFixed: Rule = (ctx) =>
  ctx.design.nodes
    .filter((n) => n.kind !== 'queue' && n.kind !== 'client' && !cfg(n).autoscale)
    .filter((n) => (ctx.in.get(n.id) ?? []).some((e) => ctx.byId.get(e.source)?.kind === 'queue'))
    .map((n) =>
      f(
        'queue-consumer-fixed',
        'info',
        { node: n.id },
        `Consumer ${ctx.name(n.id)} có số instance cố định`,
        'Backlog của queue tăng theo đợt traffic. Scale consumer theo độ dài queue (KEDA) để xả backlog nhanh và về 0 khi rảnh.',
        {
          label: 'Autoscale theo queue',
          patches: [
            {
              target: { node: n.id },
              field: 'autoscale',
              value: {
                min: 1,
                max: 10,
                targetUtilization: 0.6,
                evalEveryMs: 15000,
                stabilizationMs: 60000,
                podStartMs: 10000,
                metric: 'queueLength',
                queueSource: (ctx.in.get(n.id) ?? []).find((e) => ctx.byId.get(e.source)?.kind === 'queue')!.source,
                targetQueuePerInstance: 100,
              },
            },
          ],
        },
      ),
    );

export const autoscaleFromOne: Rule = (ctx) =>
  ctx.design.nodes
    .filter((n) => cfg(n).autoscale && (cfg(n).autoscale!.metric ?? 'utilization') === 'utilization' && (cfg(n).autoscale!.min ?? 1) <= 1)
    .map((n) =>
      f(
        'hpa-min-one',
        'warn',
        { node: n.id },
        `Autoscale của ${ctx.name(n.id)} cho phép xuống 1 replica`,
        'Với 1 replica, pod đó restart (deploy, OOM, node bị thu hồi) là mất dịch vụ cho tới khi pod mới sẵn sàng. Spike cũng phải chờ một chu kỳ HPA cộng thời gian khởi động.',
        { label: 'Min 2 replica', patches: [{ target: { node: n.id }, field: 'autoscale', value: { ...cfg(n).autoscale, min: 2 } }] },
      ),
    );

export const overBudget: Rule = (ctx) => {
  const budget = ctx.scenario?.budgetPerHour;
  if (budget == null) return [];
  const cost = ctx.design.nodes
    .filter((n) => n.kind !== 'client')
    .reduce((s, n) => s + (cfg(n).costPerHour ?? 0) * (cfg(n).instances ?? 1), 0);
  if (cost <= budget + 1e-9) return [];
  return [
    f(
      'over-budget',
      'error',
      { design: true },
      `Chi phí ${cost.toFixed(2)}/giờ vượt ngân sách ${budget.toFixed(2)}/giờ`,
      'Tìm thành phần đang thừa công suất (utilization thấp) để bớt instance, hoặc thêm cache để giảm tải cho thành phần đắt.',
    ),
  ];
};

export const RULES: Record<string, Rule> = {
  retryWithoutBackoff,
  retryWithoutJitter,
  retryWithoutTimeout,
  retryStormRisk,
  timeoutOrder,
  retryAmplification,
  breakerMinRequests,
  slowPayload,
  singlePointOfFailure,
  loadBalancerSingleTarget,
  poolExceedsDatabase,
  fanOutWithoutTimeout,
  hedgeWithoutProtection,
  cacheRisks,
  queueConsumerFixed,
  autoscaleFromOne,
  overBudget,
};
