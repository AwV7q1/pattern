/**
 * Postmortem of a fight: what hurt, where, and which cards would have helped.
 * Pure (reads the turn reports only), so it works on a saved fight too.
 */
import { baseId, budgetOf, chassisDef } from './rules.ts';
import type { BattleState, Content, HotNode, NodeCost, TurnReport } from './types';

export type CauseKind = 'db' | 'api' | 'ext' | 'cache' | 'queue' | 'down' | 'errors' | 'bots' | 'latency' | 'budget';

export interface Cause {
  kind: CauseKind;
  /** Error Budget it cost over the fight (before headroom and the per-turn cap). */
  damage: number;
  /** The turn it hurt most. */
  turn: number;
  intent: string;
  /** The node at fault, when one was. */
  node?: string;
  title: string;
  text: string;
  /** Cards that answer it: in the deck first. */
  advice: { card: string; inDeck: boolean }[];
}

export interface Postmortem {
  /** The turn that cost the most (absent when nothing did). */
  worst?: TurnReport;
  /** Error Budget lost over the fight (after headroom). */
  lost: number;
  causes: Cause[];
  /** One lesson, from the card that answers the main cause. */
  lesson?: { card: string; text: string };
}

const TITLE: Record<CauseKind, string> = {
  db: 'Database quá tải',
  api: 'Service quá tải',
  ext: 'Đối tác kéo chậm cả hệ thống',
  cache: 'Cache không đỡ được',
  queue: 'Hàng đợi dồn việc',
  down: 'Node sập',
  errors: 'Request lỗi',
  bots: 'Bot lọt qua bộ lọc',
  latency: 'Vượt SLO độ trễ',
  budget: 'Vượt ngân sách',
};

const ADVICE: Record<CauseKind, string[]> = {
  db: ['cache', 'index', 'replica', 'shard', 'vertical'],
  api: ['scale_api', 'autoscaler', 'load_shed', 'bigger_queue'],
  ext: ['queue', 'breaker', 'timeout', 'mesh'],
  cache: ['swr', 'cache_key', 'cache'],
  queue: ['bigger_queue', 'autoscaler'],
  down: ['breaker', 'load_shed', 'restart'],
  errors: ['breaker', 'retry_budget', 'timeout'],
  bots: ['waf', 'edge_shield', 'block_ip', 'rate_limit', 'captcha'],
  latency: ['timeout', 'cache', 'cdn'],
  budget: ['rightsize', 'reserved', 'spot', 'scale_in', 'cost_alert', 'autoscaler'],
};

type Role = Exclude<CauseKind, 'down' | 'errors' | 'bots' | 'latency' | 'budget'> | 'lb';

function roleOf(content: Content, chassis: string, h: HotNode): Role {
  const a = chassisDef(content, chassis).aliases;
  if (h.kind === 'database' || h.node === a.db || h.node.startsWith(`${a.db}-`)) return 'db';
  if (h.kind === 'cache') return 'cache';
  if (h.kind === 'queue') return 'queue';
  if (h.node === a.ext) return 'ext';
  if (h.kind === 'loadBalancer') return 'lb';
  return 'api';
}

/** The node behind a turn's failed requests: down first, then the one turning requests away, then the busiest. */
function culprit(content: Content, chassis: string, r: TurnReport): { hot: HotNode; role: Role } | undefined {
  for (const hot of r.hot ?? []) {
    const role = roleOf(content, chassis, hot);
    if (role === 'lb') continue;
    if (hot.down || hot.rejected > 0 || hot.util >= 0.9) return { hot, role };
  }
  return undefined;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function describe(kind: CauseKind, r: TurnReport, hot: HotNode | undefined, content: Content, chassis: { chassis: string }): string {
  const at = `lượt ${r.turn} (${r.intent})`;
  const name = hot?.label ?? '';
  switch (kind) {
    case 'db':
      return `${name} chạy tới ${pct(hot!.util)} công suất ở ${at}${hot!.rejected ? ` và từ chối ${hot!.rejected.toLocaleString('vi-VN')} request` : ''}. Mọi lần đọc đều đi tới DB: cần chặn bớt ở phía trước hoặc làm mỗi truy vấn rẻ hơn.`;
    case 'api':
      return `${name} chạy tới ${pct(hot!.util)} công suất ở ${at}. Không đủ instance cho lượng traffic, request xếp hàng rồi hết hạn.`;
    case 'ext':
      return `${name} chậm hoặc lỗi ở ${at}, và lời gọi đồng bộ giữ slot của API trong lúc chờ. Tách ra chạy bất đồng bộ hoặc cắt sớm.`;
    case 'cache':
      return `${name} vẫn để lọt nhiều request tới DB ở ${at}: cache lạnh, bị phá, hoặc quá nhỏ.`;
    case 'queue':
      return `${name} dồn việc ở ${at}: worker xử lý không kịp, việc tồn cuối lượt cũng tính là lỗi.`;
    case 'down':
      return `${name} sập ở ${at}. Khi một node chết, lỗi lan ngược lên mọi service gọi nó.`;
    case 'errors':
      return `Request của người dùng thật bị lỗi ở ${at} (${r.legitFailed.toLocaleString('vi-VN')} request). Retry không giới hạn có thể khuếch đại lỗi.`;
    case 'bots': {
      const leaked = r.botRps - r.botBlockedRps;
      return `Ở ${at}, ${leaked.toLocaleString('vi-VN')} rps bot lọt vào (chỉ chặn ${pct(r.botRps ? r.botBlockedRps / r.botRps : 0)}). Bot chiếm tài nguyên của người dùng thật.`;
    }
    case 'latency':
      return `p99 lên ${Math.round(r.p99Ms).toLocaleString('vi-VN')}ms ở ${at}, vượt SLO ${content.battle.sloP99Ms}ms. Chậm cũng là hỏng với người dùng.`;
    case 'budget': {
      const top = r.costs?.[0];
      const total = r.costPerHour || 1;
      const where = top ? ` Tốn nhất: ${top.label} ($${top.costPerHour.toFixed(2)}/h, ${Math.round((top.costPerHour / total) * 100)}%${top.util !== undefined && top.util < 0.3 ? `, chỉ dùng ${Math.round(top.util * 100)}% công suất` : ''}).` : '';
      const egress = r.egressPerHour ? ` Egress do bot tải ra: $${r.egressPerHour.toFixed(2)}/h, lọc bot là giảm được.` : '';
      return `Chi phí lên $${r.costPerHour.toFixed(2)}/h ở ${at}, vượt ngân sách $${budgetOf(content, chassis).toFixed(2)}/h.${where}${egress} Scale cố định cả trận thì tốn tiền cả lúc không cần.`;
    }
  }
}

/** Each node's average $/h (and utilization) over the turns that recorded costs, most expensive first; egress averaged over those turns too. */
export function spendByNode(reports: TurnReport[]): { costs: NodeCost[]; egress: number } {
  const seen = reports.filter((r) => r.costs?.length);
  if (!seen.length) return { costs: [], egress: 0 };
  const acc = new Map<string, NodeCost & { n: number; u: number; un: number }>();
  for (const r of seen)
    for (const c of r.costs!) {
      const a = acc.get(c.node) ?? { ...c, costPerHour: 0, instances: 0, n: 0, u: 0, un: 0 };
      a.costPerHour += c.costPerHour;
      a.instances += c.instances;
      if (c.util !== undefined) {
        a.u += c.util;
        a.un++;
      }
      a.n++;
      acc.set(c.node, a);
    }
  const k = seen.length;
  const costs = [...acc.values()]
    .map(({ n: _n, u, un, ...c }) => {
      const out: NodeCost = { node: c.node, kind: c.kind, label: c.label, instances: Math.round((c.instances / k) * 10) / 10, costPerHour: Math.round((c.costPerHour / k) * 1000) / 1000 };
      if (un) out.util = Math.round((u / un) * 100) / 100;
      return out;
    })
    .sort((a, b) => b.costPerHour - a.costPerHour);
  const egress = Math.round((seen.reduce((s, r) => s + (r.egressPerHour ?? 0), 0) / k) * 100) / 100;
  return { costs, egress };
}

/** What cost the fight its Error Budget, worst first. `deck` (card ids) puts the cards the player has first. */
export function postmortem(content: Content, state: Pick<BattleState, 'reports' | 'chassis'>, deck: string[] = []): Postmortem {
  const have = new Set(deck.map(baseId));
  const byKind = new Map<CauseKind, Cause>();
  const peak = new Map<CauseKind, number>();
  const add = (kind: CauseKind, damage: number, r: TurnReport, hot?: HotNode) => {
    if (damage <= 0) return;
    const cur = byKind.get(kind);
    if (cur) {
      cur.damage += damage;
      if (damage > peak.get(kind)!) {
        peak.set(kind, damage);
        Object.assign(cur, { turn: r.turn, intent: r.intent, node: hot?.node, text: describe(kind, r, hot, content, state) });
      }
      return;
    }
    peak.set(kind, damage);
    const known = ADVICE[kind].filter((id) => content.cards.some((c) => c.id === id));
    const advice = [...known.filter((id) => have.has(id)).map((card) => ({ card, inDeck: true })), ...known.filter((id) => !have.has(id)).map((card) => ({ card, inDeck: false }))];
    byKind.set(kind, { kind, damage, turn: r.turn, intent: r.intent, ...(hot && { node: hot.node }), title: TITLE[kind], text: describe(kind, r, hot, content, state), advice });
  };

  for (const r of state.reports) {
    const d = r.damage;
    add('latency', d.latency, r);
    add('budget', d.budget, r);
    if (d.failed > 0) {
      // the part of the failures caused by bots that got in, the rest to the node that failed
      const leaked = Math.max(0, r.botRps - r.botBlockedRps);
      const botShare = leaked > r.legitRps * 0.5 ? leaked / (leaked + r.legitRps) : 0;
      const bots = Math.round(d.failed * botShare);
      add('bots', bots, r);
      const at = culprit(content, state.chassis, r);
      const rest = d.failed - bots;
      if (at?.hot.down) add('down', rest, r, at.hot);
      else if (at && at.role !== 'lb') add(at.role, rest, r, at.hot);
      else add('errors', rest, r);
    }
  }

  const causes = [...byKind.values()].sort((a, b) => b.damage - a.damage);
  const worst = state.reports.reduce<TurnReport | undefined>((w, r) => (r.damage.total > (w?.damage.total ?? 0) ? r : w), undefined);
  const lost = state.reports.reduce((s, r) => s + r.damage.total, 0);
  const top = causes[0]?.advice[0];
  const text = top && content.cards.find((c) => c.id === top.card)?.lesson;
  return { worst, lost, causes, ...(top && text && { lesson: { card: top.card, text } }) };
}
