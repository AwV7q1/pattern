import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, FlaskConical, Play, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compute } from '@/sim/compute';
import { cn } from '@/lib/utils';
import { CONTENT } from './content';
import { cardIcon } from './cardArt';
import { INTENT_ICON } from './CardBattle';
import { InfraLine, SOCKET_KIND_LABEL, type InfraRefs, type NodeLoad } from './Infra';
import { PostmortemPanel } from './Postmortem';
import { CostBreakdown } from './Cost';
import { baseId, budgetOf, cardDef, chassisDef, currentIntent, forceIntent, hotNodes, intentsNow, nodeCosts, modulesOf, newBattle, placementsOf, planTurn, playCard, resolveTurn, socketOf } from './rules';
import type { BattleState, CardDef, TurnReport } from './types';

/** Cards that change the system without a socket and stay for the fight. */
const UNSOCKETED = new Set(['scale_api', 'waf', 'swr', 'cache_key', 'tarpit']);
const PALETTE = CONTENT.cards.filter((c) => c.fits || UNSOCKETED.has(c.id));
/** Enough of both that nothing ends while experimenting. */
const SANDBOX_HP = 9999;

/** One step of the build: a card played, into a socket, taking out the module of `replace` (a card id). */
type Step = { card: string; socket?: string; replace?: string };

/** The fight the build is tried in: chassis, enemy and floor, with the steps replayed in order. */
function build(chassis: string, enemy: string, act: number, steps: Step[], warm: boolean): BattleState {
  const { actScale, fight } = CONTENT.run;
  let s = newBattle(CONTENT, 1, {
    chassis,
    enemy,
    deck: [],
    hp: SANDBOX_HP,
    maxHp: SANDBOX_HP,
    enemyScale: { hp: 100, rps: fight.rps * (1 + actScale.rps * (act - 1)) },
    ...(act > 1 && { legitScale: 1 + (actScale.legit ?? 0) * (act - 1) }),
  });
  for (const step of steps) s = play(s, step) ?? s;
  if (warm && s.cache) s = { ...s, cache: { ...s.cache, placed: 0 } };
  return s;
}

/** Play one card of the build: a fresh hand of just that card and all the Ops it needs. */
function play(state: BattleState, step: Step): BattleState | null {
  const s = structuredClone(state);
  const uid = s.nextUid++;
  s.hand = [{ uid, id: step.card }];
  s.ops = 99;
  const replace = step.replace ? modulesOf(s).find((m) => baseId(m.card) === step.replace)?.uid : undefined;
  const next = playCard(CONTENT, s, uid, { ...(step.socket && { socket: step.socket }), ...(replace !== undefined && { replace }) });
  if (next === s) return null;
  return { ...next, hand: [], discard: [], exhausted: [] };
}

/** Try builds against any attack, one turn at a time, without a run or a deck. */
export function CardSandbox() {
  const [params] = useSearchParams();
  const [chassis, setChassis] = useState(() => chassisDef(CONTENT, params.get('chassis') ?? undefined).id);
  const [enemy, setEnemy] = useState(CONTENT.enemies[0].id);
  const [intent, setIntent] = useState(0);
  const [act, setAct] = useState(1);
  const [warm, setWarm] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [pending, setPending] = useState<{ card: string; options: { socket: string; replace: string }[] } | null>(null);
  const [reports, setReports] = useState<TurnReport[]>([]);
  const [loads, setLoads] = useState<Record<string, NodeLoad> | undefined>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = useMemo(() => {
    const s = build(chassis, enemy, act, steps, warm);
    return forceIntent(CONTENT, s, Math.min(intent, intentsNow(CONTENT, s).length - 1));
  }, [chassis, enemy, act, steps, warm, intent]);

  const nodes = useRef<Record<string, HTMLDivElement | null>>({});
  const sockets = useRef<Record<string, HTMLElement | null>>({});
  const mods = useRef<Record<number, HTMLElement | null>>({});
  const gate = useRef<HTMLDivElement | null>(null);
  const refs = useMemo<InfraRefs>(() => ({ nodes, sockets, mods, gate }), []);

  // a new build or attack: the old numbers no longer apply
  const reset = (fn: () => void) => {
    fn();
    setPending(null);
    setLoads(undefined);
  };

  const add = (def: CardDef) => {
    setPending(null);
    if (!def.fits) return reset(() => setSteps((x) => [...x, { card: def.id }]));
    const moves = placementsOf(CONTENT, state, def.id);
    const free = moves.find((m) => m.replace === undefined);
    if (free) return reset(() => setSteps((x) => [...x, { card: def.id, socket: free.socket }]));
    const options = moves.flatMap((m) => {
      const out = modulesOf(state).find((x) => x.uid === m.replace);
      return out ? [{ socket: m.socket, replace: baseId(out.card) }] : [];
    });
    if (options.length) setPending({ card: def.id, options });
  };
  const remove = (card: string) => reset(() => setSteps((x) => x.filter((s) => baseId(s.card) !== card && s.replace !== card)));

  const runTurn = async () => {
    setRunning(true);
    setError(null);
    try {
      const plan = planTurn(CONTENT, state);
      const { summary, windows } = await compute.runDetailed(plan.input);
      const next = resolveTurn(CONTENT, state, plan, summary, hotNodes(plan.input.design, windows), nodeCosts(plan.input.design, windows));
      const r = { ...next.reports.at(-1)!, turn: reports.length + 1 };
      setReports((x) => [...x, r]);
      // each node at its worst second of the turn
      const ids = plan.input.design.nodes.map((n) => n.id);
      const peak: Record<string, NodeLoad> = {};
      for (const w of windows)
        w.nodes.forEach((nw, k) => {
          const id = ids[k];
          if (!id || id === 'client') return;
          const cur = peak[id] ?? { util: 0, bad: false };
          peak[id] = { util: Math.max(cur.util, nw.utilization), bad: cur.bad || nw.down || nw.rejected > 0 || nw.utilization > 0.95 };
        });
      setLoads(peak);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const it = currentIntent(CONTENT, state);
  const intents = intentsNow(CONTENT, state);
  const installed = modulesOf(state);
  const unsocketed = steps.filter((s) => !cardDef(CONTENT, s.card).fits);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <Button size="sm" variant="ghost" asChild>
          <Link to="/cards">
            <ArrowLeft /> Về tháp
          </Link>
        </Button>
        <FlaskConical className="size-5 text-sky-300" />
        <h1 className="text-base font-semibold">Sandbox hạ tầng</h1>
        <span className="text-sm text-muted-foreground">Lắp module tuỳ ý, chọn đòn tấn công, chạy thử từng lượt. Không mất máu, không cần bài.</span>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* chassis */}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kiến trúc">
            {CONTENT.chassis.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={chassis === c.id}
                onClick={() => reset(() => (setChassis(c.id), setSteps([]), setReports([])))}
                className={cn('rounded-full border px-3 py-1 text-sm', chassis === c.id ? 'border-sky-400 bg-sky-500/15 text-sky-100' : 'text-muted-foreground hover:text-foreground')}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* the system */}
          <div className="rounded-2xl border border-sky-500/30 bg-card/60 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="uppercase tracking-wider">Hệ thống</span>
              {loads && <span className="text-sky-300">tải cao nhất của lượt vừa chạy</span>}
              <span className="ml-auto font-mono">ngân sách ${budgetOf(CONTENT, state).toFixed(2)}/h</span>
            </div>
            <InfraLine state={state} loads={loads} refs={refs} plug={null} />
          </div>

          {/* what is in */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Đã lắp:</span>
            {installed.length + unsocketed.length === 0 && <span className="text-muted-foreground">chưa có gì</span>}
            {installed.map((m) => {
              const def = cardDef(CONTENT, m.card);
              const Icon = cardIcon(def);
              return (
                <span key={m.uid} className="flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/10 py-0.5 pl-2 pr-1 text-violet-100">
                  <Icon className="size-3.5" /> {def.name}
                  {m.level > 1 && <span className="font-mono text-xs">×{m.level}</span>}
                  <span className="text-xs text-violet-300/70">· {socketOf(CONTENT, state, m.socket)?.label}</span>
                  <button type="button" aria-label={`Gỡ ${def.name}`} onClick={() => remove(baseId(m.card))} className="rounded-full p-0.5 hover:bg-violet-400/20">
                    <X className="size-3.5" />
                  </button>
                </span>
              );
            })}
            {[...new Set(unsocketed.map((s) => s.card))].map((id) => {
              const def = cardDef(CONTENT, id);
              const n = unsocketed.filter((s) => s.card === id).length;
              return (
                <span key={id} className="flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1">
                  {def.name}
                  {n > 1 && <span className="font-mono text-xs">×{n}</span>}
                  <button type="button" aria-label={`Bỏ ${def.name}`} onClick={() => remove(id)} className="rounded-full p-0.5 hover:bg-muted">
                    <X className="size-3.5" />
                  </button>
                </span>
              );
            })}
            {steps.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => reset(() => setSteps([]))}>
                <Trash2 /> Gỡ hết
              </Button>
            )}
          </div>

          {pending && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-2 text-sm">
              <span>Ổ đầy. {cardDef(CONTENT, pending.card).name} thay cho:</span>
              {pending.options.map((o) => (
                <Button key={o.socket + o.replace} size="sm" variant="outline" onClick={() => reset(() => setSteps((x) => [...x, { card: pending.card, socket: o.socket, replace: o.replace }]))}>
                  {cardDef(CONTENT, o.replace).name} ({socketOf(CONTENT, state, o.socket)?.label})
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                Huỷ
              </Button>
            </div>
          )}

          {/* the parts */}
          <div>
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Linh kiện (bấm để lắp, bấm lại để nâng cấp)</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {PALETTE.map((def) => {
                const Icon = cardIcon(def);
                const moves = def.fits ? placementsOf(CONTENT, state, def.id) : [];
                const blocked = !!def.fits && moves.length === 0;
                return (
                  <button
                    key={def.id}
                    type="button"
                    disabled={blocked}
                    onClick={() => add(def)}
                    title={def.text}
                    className="flex items-start gap-2 rounded-lg border bg-card/60 p-2 text-left text-sm transition-colors hover:border-sky-400/60 disabled:opacity-40"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-sky-300" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{def.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {def.fits ? `ổ ${def.fits.map((k) => SOCKET_KIND_LABEL[k]).join(', ')}` : 'không cần ổ'}
                        {blocked && ' · khung này không có ổ'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* the attack and the results */}
        <aside className="flex min-w-0 flex-col gap-3">
          <div className="space-y-2 rounded-xl border bg-card/60 p-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">Botnet</span>
              <select className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" value={enemy} onChange={(e) => reset(() => (setEnemy(e.target.value), setIntent(0), setReports([])))}>
                {CONTENT.enemies.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">Đòn</span>
              <select className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" value={intent} onChange={(e) => reset(() => setIntent(Number(e.target.value)))}>
                {intents.map((x, i) => (
                  <option key={x.id} value={i}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">Tầng</span>
              <select className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" value={act} onChange={(e) => reset(() => setAct(Number(e.target.value)))}>
                {Array.from({ length: CONTENT.run.acts }, (_, i) => (
                  <option key={i} value={i + 1}>
                    Tầng {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              <input type="checkbox" checked={warm} onChange={(e) => reset(() => setWarm(e.target.checked))} /> Cache đã ấm (bỏ lượt khởi động)
            </label>
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <div className="flex items-center gap-1.5 font-medium text-amber-200">
                {(() => {
                  const I = INTENT_ICON[it.icon];
                  return <I className="size-4" />;
                })()}
                {it.label}
                {it.tag && <span className="text-[11px] font-normal text-amber-300/80">· {it.tag}</span>}
              </div>
              <p className="mt-0.5 text-xs text-amber-100/80">{it.text}</p>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={runTurn} disabled={running}>
                <Play /> {running ? 'Đang chạy…' : 'Chạy 1 lượt'}
              </Button>
              <Button variant="outline" size="icon" aria-label="Xoá kết quả" onClick={() => reset(() => setReports([]))} disabled={!reports.length}>
                <RotateCcw />
              </Button>
            </div>
            {error && <p className="text-xs text-rose-300">{error}</p>}
          </div>

          {reports.length > 0 && (
            <div className="rounded-xl border bg-card/60 p-3">
              <table className="mb-3 w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="font-normal">#</th>
                    <th className="font-normal">Đòn</th>
                    <th className="text-right font-normal">p99</th>
                    <th className="text-right font-normal">Lỗi</th>
                    <th className="text-right font-normal">$/h</th>
                    <th className="text-right font-normal">Mất</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {reports.map((r) => (
                    <tr key={r.turn} className="border-t border-border/50">
                      <td>{r.turn}</td>
                      <td className="max-w-[110px] truncate font-sans">{r.intent}</td>
                      <td className="text-right">{Math.round(r.p99Ms)}ms</td>
                      <td className="text-right">{(r.errorRate * 100).toFixed(1)}%</td>
                      <td className="text-right">{r.costPerHour.toFixed(2)}</td>
                      <td className={cn('text-right', r.damage.total > 0 ? 'text-rose-300' : 'text-emerald-300')}>−{r.damage.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reports.at(-1)!.costs && (
                <div className="mb-3 rounded-lg border bg-background/40 p-2">
                  <div className="mb-1 text-[11px] text-muted-foreground">Tiền đi đâu (lượt {reports.at(-1)!.turn})</div>
                  <CostBreakdown costs={reports.at(-1)!.costs!} egress={reports.at(-1)!.egressPerHour} budget={budgetOf(CONTENT, state)} />
                </div>
              )}
              <PostmortemPanel reports={reports} chassis={chassis} deck={PALETTE.map((c) => c.id)} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
