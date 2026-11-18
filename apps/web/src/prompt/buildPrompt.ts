import { KIND_META } from '@/lib/meta';
import { policyOf } from '@/model/flow';
import { DEFAULT_CONFIG, type DesignEdge, type DesignNode, type NodeConfig } from '@/types';
import { techOf } from '@/tech/catalog';
import type { Project } from '@/projects/store';

export type PromptTarget = 'compose' | 'k8s' | 'nestjs';

export interface PromptOptions {
  targets: PromptTarget[];
  includeRun: boolean;
  includeMermaid: boolean;
}

export const TARGET_LABELS: Record<PromptTarget, string> = {
  compose: 'Docker Compose',
  k8s: 'Kubernetes manifests',
  nestjs: 'Code NestJS',
};

const ms = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}s` : `${+v.toFixed(1)}ms`);
const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;

type Node = DesignNode & { cfg: NodeConfig };

const techName = (n: DesignNode) => techOf(n.tech)?.name ?? KIND_META[n.kind].name;

function role(n: Node, outs: DesignEdge[]) {
  switch (n.kind) {
    case 'client':
      return 'Nguồn traffic (người dùng / hệ thống bên ngoài)';
    case 'loadBalancer':
      return 'Nhận traffic và chia đều cho các node phía sau';
    case 'cache':
      return `Cache, hit rate mục tiêu ${pct(n.cfg.hitRate)}; miss thì đọc xuống ${outs.length ? 'downstream' : 'nguồn dữ liệu'}`;
    case 'database':
      return 'Lưu trữ dữ liệu';
    case 'queue':
      return 'Hàng đợi: ack ngay cho producer, consumer xử lý bất đồng bộ';
    default:
      if (!outs.length) return 'Service xử lý request';
      return n.cfg.routing === 'sequence'
        ? 'Service, gọi tuần tự các downstream'
        : n.cfg.routing === 'parallel'
          ? 'Service, gọi song song các downstream (Promise.all)'
          : 'Service';
  }
}

function scale(n: Node) {
  if (n.kind === 'client') return '—';
  const c = n.cfg;
  if (c.model === 'cpu') return `${c.instances} instance × ${c.cpuLanes} CPU, tối đa ${c.maxInFlight} request mở/instance`;
  if (n.kind === 'queue') return `${c.instances} node, consumer concurrency ${c.concurrency}`;
  return `${c.instances} instance × ${c.concurrency} concurrency`;
}

function policyText(e: DesignEdge, target: Node) {
  const p = policyOf(e);
  const parts: string[] = [];
  if (p.fireAndForget) parts.push('không chờ kết quả (fire-and-forget)');
  if (p.timeoutMs) parts.push(`timeout ${ms(p.timeoutMs)}`);
  if (p.retries) parts.push(`retry ${p.retries} lần (backoff ${ms(p.backoffMs)}${p.jitter ? ', có jitter' : ''})`);
  if (p.circuitBreaker) {
    const b = p.circuitBreaker;
    parts.push(
      `circuit breaker (mở khi lỗi ≥ ${pct(b.failureThreshold)} trong ${ms(b.windowMs)}, tối thiểu ${b.minRequests} request; mở ${ms(b.openMs)})`,
    );
  }
  if (p.poolSize) parts.push(`connection pool ${p.poolSize}/process (chờ tối đa ${ms(p.poolTimeoutMs ?? 10000)})`);
  if (p.requestKb || p.responseKb) parts.push(`payload ~${p.requestKb ?? 0}KB → ~${p.responseKb ?? 0}KB`);
  if (target.kind === 'queue') parts.push('publish có xác nhận (publisher confirm / acks)');
  return parts.length ? parts.join(', ') : 'mặc định (nên đặt timeout)';
}

function mermaid(nodes: Node[], edges: DesignEdge[], groups: Project['design']['groups'] = []) {
  const id = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');
  const label = (n: Node) => {
    const t = techOf(n.tech);
    const name = n.label.replace(/"/g, "'");
    return t && !n.label.includes(t.name) ? `${name}<br/><small>${t.name}</small>` : name;
  };
  const shape = (n: Node) => {
    const l = label(n);
    if (n.kind === 'database') return `${id(n.id)}[("${l}")]`;
    if (n.kind === 'queue') return `${id(n.id)}[/"${l}"/]`;
    if (n.kind === 'client') return `${id(n.id)}(("${l}"))`;
    return `${id(n.id)}["${l}"]`;
  };
  const lines = ['flowchart LR'];
  const inGroup = new Set<string>();
  const all = groups ?? [];
  const area = (g: NonNullable<typeof groups>[number]) => g.size.width * g.size.height;
  const contains = (o: NonNullable<typeof groups>[number], g: NonNullable<typeof groups>[number]) =>
    o.id !== g.id &&
    g.position.x >= o.position.x &&
    g.position.y >= o.position.y &&
    g.position.x + g.size.width <= o.position.x + o.size.width &&
    g.position.y + g.size.height <= o.position.y + o.size.height;
  // parent = smallest frame that fully contains the frame
  const parentOf = (g: NonNullable<typeof groups>[number]) => all.filter((o) => contains(o, g)).sort((a, b) => area(a) - area(b))[0]?.id;
  const emit = (g: NonNullable<typeof groups>[number], depth: number) => {
    const pad = '  '.repeat(depth);
    lines.push(`${pad}subgraph ${id(g.id)}["${g.label.replace(/"/g, "'")}"]`);
    nodes
      .filter((n) => n.group === g.id)
      .forEach((n) => {
        lines.push(`${pad}  ${shape(n)}`);
        inGroup.add(n.id);
      });
    all.filter((c) => parentOf(c) === g.id).forEach((c) => emit(c, depth + 1));
    lines.push(`${pad}end`);
  };
  all.filter((g) => !parentOf(g)).forEach((g) => emit(g, 1));
  nodes.filter((n) => !inGroup.has(n.id)).forEach((n) => lines.push(`  ${shape(n)}`));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = byId.get(e.source);
    const p = policyOf(e);
    const sequential = src && src.cfg.routing === 'sequence' && src.kind !== 'loadBalancer' && src.kind !== 'client';
    const orders = sequential ? [...new Set(edges.filter((x) => x.source === e.source).map((x) => x.order ?? 0))].sort((a, b) => a - b) : [];
    const order = sequential ? `${orders.indexOf(p.order ?? 0) + 1}` : '';
    const async = src?.kind === 'queue' ? 'async' : p.fireAndForget ? 'fire&forget' : '';
    const text = [order && `#${order}`, async].filter(Boolean).join(' ');
    const arrow = async ? '-.->' : '-->';
    lines.push(`  ${id(e.source)} ${arrow}${text ? `|${text}|` : ''} ${id(e.target)}`);
  }
  return lines.join('\n');
}

/** Markdown brief for a coding agent that will build the designed system. */
export function buildPrompt(project: Project, opts: PromptOptions): string {
  const d = project.design;
  const sc = project.scenario;
  const nodes: Node[] = d.nodes.map((n) => ({ ...n, cfg: { ...DEFAULT_CONFIG, ...n.config } }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outs = (id: string) => d.edges.filter((e) => e.source === id);
  const ins = (id: string) => d.edges.filter((e) => e.target === id);
  const name = (id: string) => byId.get(id)?.label ?? id;
  const hasQueue = nodes.some((n) => n.kind === 'queue');
  const out: string[] = [];

  out.push(`# Yêu cầu triển khai: ${project.name}`);
  out.push('');
  out.push(
    'Bạn là kỹ sư backend/DevOps. Hãy triển khai hệ thống dưới đây đúng kiến trúc, công nghệ và chính sách gọi giữa các thành phần. ' +
      'Thiết kế đã được mô phỏng tải trong Pattern (discrete-event simulator); các con số là giả định và mục tiêu cần giữ. ' +
      'Nếu thấy điểm nào không hợp lý, hãy nêu rõ và đề xuất trước khi làm khác đi.',
  );

  out.push('', '## 1. Mục tiêu và bối cảnh', '');
  out.push(project.notes.trim() || project.description || '_(Chưa có ghi chú. Bổ sung mục tiêu nghiệp vụ ở tab Ghi chú.)_');
  if (project.notes.trim() && project.description) out.push('', `> Mô tả thiết kế: ${project.description}`);

  out.push('', '## 2. Kiến trúc', '');
  if (opts.includeMermaid) out.push('```mermaid', mermaid(nodes, d.edges, d.groups), '```', '');
  out.push('| Thành phần | Công nghệ | Vai trò | Quy mô | Cấu hình then chốt |');
  out.push('|---|---|---|---|---|');
  for (const n of nodes) {
    const t = techOf(n.tech);
    const keys: string[] = [];
    const pools = ins(n.id)
      .map((e) => policyOf(e).poolSize)
      .filter((x): x is number => !!x);
    if (n.kind === 'database' && pools.length) {
      const total = ins(n.id).reduce((s, e) => s + (policyOf(e).poolSize ?? 0) * (byId.get(e.source)?.cfg.instances ?? 1) * (byId.get(e.source)?.cfg.model === 'cpu' ? byId.get(e.source)!.cfg.cpuLanes : 1), 0);
      keys.push(`tổng connection từ app ≈ ${total} (max_connections phải lớn hơn)`);
    }
    if (n.kind === 'queue') keys.push(`consumer concurrency/prefetch tổng = ${n.cfg.concurrency}`, `độ sâu tối đa ${n.cfg.queueSize.toLocaleString('en')}`);
    if (n.kind === 'cache' && n.cfg.cache) {
      const c = n.cfg.cache;
      keys.push(
        c.ttlMs ? `TTL ${ms(c.ttlMs)}${c.ttlJitter ? ` ± ${pct(c.ttlJitter)} (jitter, tránh hết hạn đồng loạt)` : ' (cân nhắc thêm jitter: key nạp cùng lúc sẽ hết hạn cùng lúc)'}` : 'không TTL (cần chiến lược invalidation)',
        c.coalesce ? 'gộp miss cùng key (singleflight / lock khi nạp lại) để chống stampede' : 'chưa chống stampede khi key nóng hết hạn',
      );
    } else if (n.kind === 'cache') keys.push(`hit rate ${pct(n.cfg.hitRate)}`);
    if (t) keys.push(...t.deploy.keySettings.slice(0, 3));
    const hpa = n.cfg.autoscale;
    if (hpa?.metric === 'queueLength') {
      const q = hpa.queue ? byId.get(hpa.queue)?.label ?? hpa.queue : 'hàng đợi của chính service';
      keys.push(
        `KEDA ScaledObject ${hpa.min}–${hpa.max} replica theo backlog của ${q}, ${hpa.targetQueueLength ?? 100} message mỗi replica, polling ${ms(hpa.evalEveryMs)}, pod ready trong ≤ ${ms(hpa.podStartMs)}, cooldown ${ms(hpa.stabilizationMs)}`,
      );
    } else if (hpa) {
      keys.push(
        `HPA ${hpa.min}–${hpa.max} replica, ${n.cfg.model === 'cpu' ? 'CPU' : 'utilization'} mục tiêu ${pct(hpa.targetUtilization)}, pod ready trong ≤ ${ms(hpa.podStartMs)}, scale-down stabilization ${ms(hpa.stabilizationMs)}`,
      );
    }
    out.push(
      `| ${n.label} | ${t ? `${t.name}${t.deploy.image ? ` (\`${t.deploy.image}\`)` : ''}` : KIND_META[n.kind].name} | ${role(n, outs(n.id))} | ${scale(n)} | ${keys.join('; ') || '—'} |`,
    );
  }

  out.push('', '## 3. Luồng xử lý và chính sách gọi', '');
  for (const n of nodes) {
    const es = outs(n.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!es.length) continue;
    const mode =
      n.kind === 'client'
        ? 'gửi request tới'
        : n.kind === 'loadBalancer'
          ? 'chia tải (round-robin) cho'
          : n.kind === 'queue'
            ? 'giao message bất đồng bộ cho consumer'
            : n.kind === 'cache'
              ? 'khi miss thì đọc'
              : n.cfg.routing === 'sequence'
                ? 'gọi tuần tự (await lần lượt, cùng số thứ tự thì chạy song song)'
                : n.cfg.routing === 'parallel'
                  ? 'gọi song song và chờ tất cả (Promise.all)'
                  : es.length > 1
                    ? 'mỗi request chọn một trong'
                    : 'gọi';
    out.push(`- **${n.label}** (${techName(n)}) ${mode}:`);
    es.forEach((e, i) => {
      const target = byId.get(e.target)!;
      const step = n.cfg.routing === 'sequence' && n.kind !== 'loadBalancer' && n.kind !== 'client' ? `${i + 1}. ` : '';
      const detail =
        n.kind === 'client' || n.kind === 'loadBalancer'
          ? `độ trễ mạng ~${ms(policyOf(e).latencyMs)}`
          : n.kind === 'queue'
            ? `consumer ack sau khi xử lý xong, tối đa ${n.cfg.concurrency} message đang xử lý cùng lúc (chia cho ${target.cfg.instances} instance)`
            : policyText(e, target);
      out.push(`  - ${step}**${name(e.target)}** (${techName(target)}): ${detail}`);
    });
  }
  if (hasQueue) {
    out.push('', 'Với mỗi queue: consumer phải **idempotent** (at-least-once), có retry giới hạn và dead-letter queue cho message lỗi; producer chỉ trả lời sau khi broker xác nhận đã nhận message.');
  }

  out.push('', '## 4. Yêu cầu phi chức năng', '');
  out.push(`- **SLO**: p99 ≤ ${ms(sc.slo.p99Ms)}, tỉ lệ lỗi ≤ ${pct(sc.slo.errorRate)}; timeout phía client ${ms(sc.timeoutMs)}.`);
  const traffic = sc.traffic.map((t) => `${t.rps} rps từ giây ${Math.round(t.atMs / 1000)}`).join(' → ');
  out.push(`- **Traffic**: ${traffic}.`);
  if (sc.events?.length) {
    out.push('- **Phải chịu được các sự cố**:');
    for (const ev of sc.events) {
      const what =
        ev.action === 'down' ? 'ngừng hoạt động' : ev.action === 'up' ? 'hoạt động trở lại' : ev.action === 'latency' ? `chậm ×${ev.value}` : `lỗi ${pct(ev.value ?? 0)}`;
      out.push(`  - giây ${Math.round(ev.atMs / 1000)}: **${name(ev.node)}** ${what}`);
    }
  }
  const cost = nodes.reduce((s, n) => s + (n.kind === 'client' ? 0 : n.cfg.costPerHour * n.cfg.instances), 0);
  out.push(`- **Chi phí ước tính** trong mô phỏng: ~${cost.toFixed(2)}/giờ${sc.budgetPerHour ? ` (ngân sách ${sc.budgetPerHour}/giờ)` : ''}.`);

  if (opts.includeRun && project.lastRun) {
    const r = project.lastRun;
    out.push('', '## 5. Kết quả mô phỏng gần nhất', '');
    out.push(
      `Tại giây ${r.simSeconds}, ${r.rps} rps: p50 ${ms(r.p50Ms)}, p99 ${ms(r.p99Ms)}, lỗi ${pct(r.errorRate)}, đạt SLO ${pct(r.sloOk)} thời gian.`,
    );
    if (r.hot.length) {
      out.push('', 'Điểm nóng cần chú ý khi triển khai và test tải:');
      r.hot.forEach((h) =>
        out.push(`- ${h.label}: tải ${pct(h.utilization)}${h.queue ? `, hàng đợi ${h.queue}` : ''}${h.dropped ? `, bỏ ${h.dropped} req/s` : ''}`),
      );
    }
  }

  out.push('', `## ${opts.includeRun && project.lastRun ? 6 : 5}. Sản phẩm bàn giao`, '');
  if (opts.targets.includes('compose')) {
    out.push('- **Docker Compose** (`docker-compose.yml`): mọi thành phần self-host ở trên, healthcheck, volume cho dữ liệu, biến môi trường trong `.env.example`, giới hạn CPU/RAM gần với quy mô trong bảng.');
  }
  if (opts.targets.includes('k8s')) {
    out.push(
      '- **Kubernetes** (thư mục `k8s/`, dùng Kustomize): Namespace; Deployment cho service stateless và StatefulSet (hoặc operator) cho dữ liệu; Service; Ingress/Gateway; resources requests/limits khớp cột Quy mô; readiness/liveness probe; HPA và PodDisruptionBudget cho service có nhiều replica.',
    );
    for (const g of d.groups ?? []) {
      const members = nodes.filter((n) => n.group === g.id).map((n) => n.label);
      if (members.length) out.push(`  - ${g.kind === 'namespace' ? 'Namespace' : g.kind === 'nodePool' ? 'Node pool' : g.kind === 'zone' ? 'Zone' : 'Cluster'} **${g.label}**: ${members.join(', ')}`);
    }
  }
  if (opts.targets.includes('nestjs')) {
    out.push(
      '- **Code NestJS** cho các service trong bảng: module rõ ràng, config qua `@nestjs/config`, client HTTP có timeout/retry/circuit breaker đúng mục 3, connection pool đúng kích thước, consumer queue idempotent, graceful shutdown, endpoint `/health`, log có correlation id.',
    );
  }
  out.push('- Script **k6** tái hiện profile traffic ở mục 4 và README hướng dẫn chạy local.');

  out.push('', `## ${opts.includeRun && project.lastRun ? 7 : 6}. Tiêu chí chấp nhận`, '');
  out.push(`- Chạy k6 theo profile traffic: p99 ≤ ${ms(sc.slo.p99Ms)}, lỗi ≤ ${pct(sc.slo.errorRate)}.`);
  out.push('- Timeout, retry, circuit breaker, pool đúng mục 3 (có test hoặc cấu hình kiểm chứng được).');
  if (sc.events?.length) out.push('- Tái hiện các sự cố ở mục 4 (tắt/làm chậm thành phần) mà hệ thống vẫn phục hồi, không mất dữ liệu.');
  if (hasQueue) out.push('- Gửi trùng một message hai lần không tạo dữ liệu trùng; message lỗi vào dead-letter queue.');
  out.push('- Mọi thành phần có healthcheck; khởi động bằng một lệnh.');
  out.push('', '---', `_Sinh từ Pattern Studio · ${new Date().toLocaleString('vi-VN')}_`);
  return out.join('\n');
}
