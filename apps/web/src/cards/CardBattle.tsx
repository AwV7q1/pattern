import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bug,
  Database,
  Dices,
  Heart,
  HeartPulse,
  Hourglass,
  Info,
  Layers,
  LoaderCircle,
  Network,
  Radar,
  Repeat,
  RotateCcw,
  Server,
  Shield,
  Skull,
  Trophy,
  Turtle,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { compute } from '@/sim/compute';
import { cn } from '@/lib/utils';
import type { Design } from '@/types';
import cardsData from './data/cards.json';
import enemiesData from './data/enemies.json';
import battleData from './data/battle.json';
import {
  apiOut,
  botCutNow,
  botRpsNow,
  canPlay,
  cardDef,
  currentIntent,
  newBattle,
  nodeOf,
  planTurn,
  playCard,
  resolveTurn,
} from './rules';
import type { BattleState, CardDef, CardType, Content, Intent, TurnReport } from './types';

const CONTENT = { cards: cardsData, enemies: enemiesData, battle: battleData } as unknown as Content;

const TYPE_STYLE: Record<CardType, { label: string; ring: string; head: string; chip: string }> = {
  infra: { label: 'Hạ tầng', ring: 'border-sky-500/60', head: 'from-sky-500/25', chip: 'bg-sky-500/20 text-sky-300' },
  policy: { label: 'Chính sách', ring: 'border-violet-500/60', head: 'from-violet-500/25', chip: 'bg-violet-500/20 text-violet-300' },
  action: { label: 'Hành động', ring: 'border-emerald-500/60', head: 'from-emerald-500/25', chip: 'bg-emerald-500/20 text-emerald-300' },
  attack: { label: 'Phản công', ring: 'border-rose-500/60', head: 'from-rose-500/25', chip: 'bg-rose-500/20 text-rose-300' },
  curse: { label: 'Lời nguyền', ring: 'border-zinc-600', head: 'from-zinc-500/20', chip: 'bg-zinc-500/20 text-zinc-400' },
};

const INTENT_ICON: Record<Intent['icon'], typeof Zap> = {
  probe: Radar,
  spike: Zap,
  retry: Repeat,
  slow: Turtle,
  debt: Bug,
  heal: HeartPulse,
};

const randomSeed = () => Math.floor(Math.random() * 1_000_000) + 1;
const n0 = (v: number) => Math.round(v).toLocaleString('vi-VN');

/** $/h of a design with this turn's temporary instances. */
function costOf(design: Design, temp: BattleState['temp']) {
  return design.nodes.reduce((sum, node) => {
    const extra = node.id === 'api' ? temp.api : node.id === 'db' ? temp.db : 0;
    return sum + ((node.config?.instances ?? 1) + extra) * (node.config?.costPerHour ?? 0);
  }, 0);
}

/**
 * Card battle prototype: defend a small system against a botnet. Each turn
 * the player plays cards that change the topology or this turn's defences,
 * then the real engine runs 10 simulated seconds of traffic and its numbers
 * decide the damage on both sides. Rules live in `rules.ts` (pure, seeded).
 */
export function CardBattle() {
  const [seed, setSeed] = useState(randomSeed);
  const [state, setState] = useState(() => newBattle(CONTENT, seed));
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ key: number; player: number; enemy: number } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const busy = useRef(false);

  const restart = (s: number) => {
    setSeed(s);
    setState(newBattle(CONTENT, s));
    setError(null);
    setFlash(null);
  };

  const play = useCallback((uid: number) => {
    setState((s) => {
      const next = playCard(CONTENT, s, uid);
      if (next !== s && next.enemy.hp < s.enemy.hp) setFlash({ key: Date.now(), player: 0, enemy: s.enemy.hp - next.enemy.hp });
      return next;
    });
  }, []);

  const endTurn = useCallback(async () => {
    if (busy.current || state.phase !== 'player') return;
    busy.current = true;
    setResolving(true);
    setError(null);
    try {
      const plan = planTurn(CONTENT, state);
      const [summary] = await Promise.all([compute.run(plan.input), new Promise((r) => setTimeout(r, 700))]);
      const next = resolveTurn(CONTENT, state, plan, summary);
      const r = next.reports.at(-1)!;
      setFlash({ key: Date.now(), player: r.damage.total, enemy: r.enemyDamage });
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy.current = false;
      setResolving(false);
    }
  }, [state]);

  // keyboard: 1-9 play a card, E / Space end the turn
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[1-9]$/.test(e.key)) {
        const card = state.hand[Number(e.key) - 1];
        if (card) play(card.uid);
      } else if (e.key === 'e' || e.key === 'E') {
        void endTurn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.hand, play, endTurn]);

  const intent = currentIntent(CONTENT, state);
  const enemy = CONTENT.enemies.find((e) => e.id === state.enemy.id)!;
  const lastReport = state.reports.at(-1);
  const over = state.phase === 'won' || state.phase === 'lost';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.07),transparent_60%)]">
      {/* top bar */}
      <div className="flex items-center gap-3 border-b px-4 py-2 text-sm">
        <span className="font-semibold">{CONTENT.battle.title}</span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">Prototype</span>
        <span className="text-muted-foreground">Lượt {state.turn}</span>
        <span className="font-mono text-xs text-muted-foreground">seed {seed}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowRules((v) => !v)}>
            <Info /> Luật chơi
          </Button>
          <Button size="sm" variant="ghost" onClick={() => restart(seed)}>
            <RotateCcw /> Chơi lại
          </Button>
          <Button size="sm" variant="ghost" onClick={() => restart(randomSeed())}>
            <Dices /> Seed mới
          </Button>
        </div>
      </div>

      {showRules && <RulesPanel onClose={() => setShowRules(false)} />}

      <div className="flex min-h-0 flex-1 gap-4 overflow-auto p-4">
        {/* left: player */}
        <div className="flex w-64 shrink-0 flex-col gap-3">
          <PlayerPanel state={state} flash={flash} />
          <TurnLog reports={state.reports} />
        </div>

        {/* center: board + last turn */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Board state={state} />
          {lastReport ? <ReportCard report={lastReport} /> : <FirstTurnHint />}
          {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
        </div>

        {/* right: enemy */}
        <div className="w-72 shrink-0">
          <EnemyPanel state={state} name={enemy.name} description={enemy.description} intent={intent} flash={flash} />
        </div>
      </div>

      {/* hand */}
      <div className="border-t bg-background/80 px-4 pb-3 pt-2 backdrop-blur">
        <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
          <OpsPips ops={state.ops} max={CONTENT.battle.opsPerTurn} />
          <span>
            <Layers className="mr-1 inline size-3.5" />
            Bộ rút {state.drawPile.length}
          </span>
          <span>Bỏ {state.discard.length}</span>
          {state.exhausted.length > 0 && <span>Tiêu hao {state.exhausted.length}</span>}
          <span className="hidden md:inline">Phím 1–9 để đánh, E để kết thúc lượt</span>
          <Button className="ml-auto" disabled={state.phase !== 'player' || resolving} onClick={() => void endTurn()}>
            {resolving ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
            Kết thúc lượt
          </Button>
        </div>
        <div className="flex min-h-56 items-end justify-center gap-3 overflow-x-auto pb-1">
          {state.hand.map((inst, i) => (
            <CardView
              key={inst.uid}
              def={cardDef(CONTENT, inst.id)}
              index={i + 1}
              playable={canPlay(CONTENT, state, inst.uid) && !resolving}
              onPlay={() => play(inst.uid)}
            />
          ))}
          {state.hand.length === 0 && <p className="self-center text-sm text-muted-foreground">Hết bài trên tay. Kết thúc lượt.</p>}
        </div>
      </div>

      {resolving && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
          <div className="flex items-center gap-3 rounded-lg border bg-card px-5 py-4 shadow-xl">
            <LoaderCircle className="size-5 animate-spin text-sky-400" />
            <div>
              <div className="font-medium">Engine đang chạy {CONTENT.battle.turnMs / 1000} giây traffic…</div>
              <div className="text-xs text-muted-foreground">
                {n0(CONTENT.battle.legitRps)} người dùng/s + bot {n0(intent.botRps)} rps ({intent.label})
              </div>
            </div>
          </div>
        </div>
      )}

      {over && <EndScreen state={state} seed={seed} onRetry={() => restart(seed)} onNew={() => restart(randomSeed())} />}
    </div>
  );
}

// ---------------------------------------------------------------- panels

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full transition-all duration-500', className)} style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

function DamagePop({ flash, value, side }: { flash: { key: number } | null; value: number; side: 'player' | 'enemy' }) {
  if (!flash || value <= 0) return null;
  return (
    <span
      key={`${flash.key}-${side}`}
      className="pointer-events-none absolute right-3 top-8 animate-out fade-out slide-out-to-top-6 fill-mode-forwards text-2xl font-bold text-rose-400 duration-[1400ms]"
    >
      −{value}
    </span>
  );
}

function PlayerPanel({ state, flash }: { state: BattleState; flash: { key: number; player: number } | null }) {
  return (
    <div className="relative rounded-lg border bg-card p-3">
      <DamagePop flash={flash} value={flash?.player ?? 0} side="player" />
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Heart className="size-4 text-rose-400" /> Error Budget
        <span className="ml-auto font-mono">
          {state.hp}/{state.maxHp}
        </span>
      </div>
      <Bar value={state.hp} max={state.maxHp} className="bg-rose-500" />
      <p className="mt-2 text-xs text-muted-foreground">
        Mất máu khi người dùng thật gặp lỗi, khi p99 vượt SLO {CONTENT.battle.sloP99Ms}ms, hoặc khi vượt ngân sách.
      </p>
      {state.headroom > 0 && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-sky-500/10 px-2 py-1 text-sm text-sky-300">
          <Shield className="size-4" /> Headroom {state.headroom}
        </div>
      )}
    </div>
  );
}

function OpsPips({ ops, max }: { ops: number; max: number }) {
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
      Ops
      {Array.from({ length: Math.max(ops, max) }, (_, i) => (
        <span
          key={i}
          className={cn('size-3.5 rounded-full border', i < ops ? 'border-amber-300 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'border-muted-foreground/40')}
        />
      ))}
      <span className="font-mono text-xs text-muted-foreground">
        {ops}/{max}
      </span>
    </span>
  );
}

function EnemyPanel({
  state,
  name,
  description,
  intent,
  flash,
}: {
  state: BattleState;
  name: string;
  description: string;
  intent: Intent;
  flash: { key: number; enemy: number } | null;
}) {
  const Icon = INTENT_ICON[intent.icon];
  const raw = botRpsNow(CONTENT, state);
  const cut = botCutNow(state);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative rounded-lg border border-rose-500/30 bg-card p-3">
        <DamagePop flash={flash} value={flash?.enemy ?? 0} side="enemy" />
        <div className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Skull className="size-4 text-rose-400" /> {name}
          <span className="ml-auto font-mono">
            {state.enemy.hp}/{state.enemy.maxHp}
          </span>
        </div>
        <Bar value={state.enemy.hp} max={state.enemy.maxHp} className="bg-gradient-to-r from-rose-600 to-orange-500" />
        <p className="mt-2 text-xs text-muted-foreground">{description}</p>
      </div>

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amber-300/80">Ý định lượt này</div>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Icon className="size-5 text-amber-300" /> {intent.label}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{intent.text}</p>
        <div className="mt-3 space-y-1 font-mono text-xs">
          <Row label="Bot dự kiến" value={`${n0(raw)} rps`} />
          <Row label="Bị lọc (WAF + rate limit)" value={`${Math.round(cut * 100)}%`} good={cut > 0} />
          <Row label="Lọt vào hệ thống" value={`${n0(raw * (1 - cut))} rps`} />
          <Row label="Người dùng thật" value={`${n0(CONTENT.battle.legitRps)} rps`} />
          {state.temp.hotfix && (intent.chaos || intent.clientRetries || intent.cacheHitScale !== undefined) && (
            <div className="pt-1 text-emerald-300">Hotfix: hiệu ứng sự cố bị huỷ</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={good ? 'text-emerald-300' : undefined}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- board

function Board({ state }: { state: BattleState }) {
  const d = state.design;
  const api = nodeOf(d, 'api')!.config!;
  const db = nodeOf(d, 'db')!.config!;
  const cache = nodeOf(d, 'cache');
  const out = apiOut(d)!;
  const cost = costOf(d, state.temp);
  const budget = CONTENT.battle.budgetPerHour;
  const policies = [
    out.timeoutMs ? `timeout ${out.timeoutMs}ms` : null,
    out.retries ? `retry ×${out.retries}` : null,
    out.circuitBreaker ? 'breaker' : null,
  ].filter(Boolean) as string[];
  const shields = [
    state.waf > 0 ? `WAF ${Math.round(state.waf * 100)}%` : null,
    state.temp.botCut > 0 ? `rate limit ${Math.round(state.temp.botCut * 100)}%` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        Hệ thống của bạn
        <span className={cn('ml-auto flex items-center gap-1 font-mono text-xs', cost > budget + 0.001 ? 'text-rose-400' : 'text-muted-foreground')}>
          <Wallet className="size-3.5" /> ${cost.toFixed(2)}/h · ngân sách ${budget.toFixed(2)}/h
        </span>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto pb-1 pr-2 pt-6">
        <BoardNode icon={<Users />} title="Client" sub="người dùng + bot" />
        <Link label={shields.join(' · ')} shield={shields.length > 0} />
        <BoardNode icon={<Network />} title="Nginx" sub="load balancer" />
        <Link />
        <BoardNode
          icon={<Server />}
          title="API"
          sub={`${api.concurrency} slot/instance`}
          count={api.instances ?? 1}
          extra={state.temp.api}
          accent="sky"
        />
        <Link label={policies.join(' · ')} policy={policies.length > 0} />
        {cache && (
          <>
            <BoardNode icon={<Zap />} title="Redis" sub={`hit ${Math.round((cache.config?.hitRate ?? 0) * 100)}%`} accent="red" />
            <Link />
          </>
        )}
        <BoardNode icon={<Database />} title="PostgreSQL" sub={`${db.concurrency} connection`} count={db.instances ?? 1} extra={state.temp.db} accent="indigo" />
      </div>
    </div>
  );
}

function BoardNode({
  icon,
  title,
  sub,
  count,
  extra = 0,
  accent,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  count?: number;
  extra?: number;
  accent?: 'sky' | 'red' | 'indigo';
}) {
  const color = accent === 'sky' ? 'border-sky-500/50' : accent === 'red' ? 'border-red-500/50' : accent === 'indigo' ? 'border-indigo-500/50' : 'border-border';
  return (
    <div className={cn('relative min-w-24 shrink-0 rounded-md border-2 bg-background px-2.5 py-2', color)}>
      <div className="flex items-center gap-1.5 text-sm font-medium [&_svg]:size-4">
        {icon}
        {title}
      </div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
      {count !== undefined && (
        <div className="absolute -right-2 -top-2 rounded-full border bg-card px-1.5 font-mono text-xs">
          ×{count}
          {extra > 0 && <span className="text-emerald-300">+{extra}</span>}
        </div>
      )}
    </div>
  );
}

function Link({ label, shield, policy }: { label?: string; shield?: boolean; policy?: boolean }) {
  return (
    <div className="relative flex min-w-8 flex-1 flex-col items-center">
      {label ? (
        <span
          className={cn(
            'absolute -top-5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[10px]',
            shield && 'bg-emerald-500/15 text-emerald-300',
            policy && 'bg-violet-500/15 text-violet-300',
          )}
        >
          {label}
        </span>
      ) : null}
      <div className="flex w-full items-center">
        <div className="h-px flex-1 bg-muted-foreground/40" />
        <ArrowRight className="-ml-1 size-3 text-muted-foreground/60" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- reports

function FirstTurnHint() {
  return (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      <p className="mb-1 font-medium text-foreground">Lượt đầu tiên</p>
      Đánh bài để chuẩn bị (mỗi lá tốn Ops), rồi bấm <b>Kết thúc lượt</b>. Engine sẽ chạy 10 giây traffic thật lên hệ thống: người dùng thật lỗi thì
      bạn mất máu, bot bị lọc thì botnet mất máu. Nhìn <b>Ý định</b> bên phải để biết lượt này địch định làm gì.
    </div>
  );
}

function ReportCard({ report: r }: { report: TurnReport }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium">
        Kết quả lượt {r.turn}: {r.intent}
        <span className="ml-auto text-xs text-muted-foreground">10 giây mô phỏng</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Lỗi" value={`${(r.errorRate * 100).toFixed(1)}%`} bad={r.errorRate > 0.01} />
        <Stat label="p99" value={`${Math.round(r.p99Ms)}ms`} bad={r.damage.latency > 0} />
        <Stat label="Bot bị chặn" value={`${n0(r.botBlockedRps)}/${n0(r.botRps)} rps`} />
        <Stat label="Chi phí" value={`$${r.costPerHour.toFixed(2)}/h`} bad={r.damage.budget > 0} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-rose-300">Bạn mất {r.damage.total} máu</div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {r.damage.failed > 0 && <li>Người dùng gặp lỗi: −{r.damage.failed}</li>}
            {r.damage.latency > 0 && <li>Vượt SLO latency: −{r.damage.latency}</li>}
            {r.damage.budget > 0 && <li>Vượt ngân sách: −{r.damage.budget}</li>}
            {r.damage.absorbed > 0 && <li className="text-sky-300">Headroom đỡ: +{r.damage.absorbed}</li>}
            {r.damage.capped > 0 && <li>Giới hạn {CONTENT.battle.maxDamagePerTurn}/lượt: +{r.damage.capped}</li>}
            {r.damage.total === 0 && r.damage.absorbed === 0 && <li className="text-emerald-300">Hệ thống trụ vững</li>}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-emerald-300">Botnet mất {r.enemyDamage} máu (từ bot bị lọc)</div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {r.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('font-mono', bad ? 'text-rose-400' : 'text-foreground')}>{value}</div>
    </div>
  );
}

function TurnLog({ reports }: { reports: TurnReport[] }) {
  if (reports.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        <Hourglass className="size-4" /> Diễn biến
      </div>
      <ol className="space-y-1 font-mono text-[11px]">
        {reports
          .slice()
          .reverse()
          .map((r) => (
            <li key={r.turn} className="flex gap-2">
              <span className="w-6 text-muted-foreground">T{r.turn}</span>
              <span className="flex-1 truncate">{r.intent}</span>
              <span className={r.damage.total ? 'text-rose-400' : 'text-muted-foreground'}>−{r.damage.total}</span>
              <span className={r.enemyDamage ? 'text-emerald-300' : 'text-muted-foreground'}>⚔{r.enemyDamage}</span>
            </li>
          ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- cards

function CardView({ def, index, playable, onPlay }: { def: CardDef; index: number; playable: boolean; onPlay: () => void }) {
  const style = TYPE_STYLE[def.type];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          disabled={!playable}
          onClick={onPlay}
          className={cn(
            'group relative flex h-56 w-40 shrink-0 flex-col overflow-hidden rounded-xl border-2 bg-card text-left shadow-lg transition-all duration-150',
            style.ring,
            playable ? 'cursor-pointer hover:-translate-y-3 hover:shadow-2xl' : 'cursor-not-allowed opacity-50 saturate-50',
          )}
        >
          <div className={cn('bg-gradient-to-b to-transparent px-3 pb-2 pt-3', style.head)}>
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border-2 font-mono text-sm font-bold',
                  def.unplayable ? 'border-zinc-600 text-zinc-500' : 'border-amber-300 bg-amber-400/20 text-amber-200',
                )}
              >
                {def.unplayable ? '–' : def.cost}
              </span>
              <span className="text-sm font-semibold leading-tight">{def.name}</span>
            </div>
            <span className={cn('mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium', style.chip)}>{style.label}</span>
          </div>
          <p className="flex-1 px-3 text-xs leading-snug">{def.text}</p>
          {def.exhaust && <p className="px-3 text-[10px] text-amber-300/80">Tiêu hao</p>}
          <p className="border-t px-3 py-2 text-[10px] italic leading-snug text-muted-foreground">{def.lesson}</p>
          <span className="absolute bottom-1 right-2 font-mono text-[10px] text-muted-foreground/60">{index}</span>
        </button>
      </TooltipTrigger>
      {!playable && !def.unplayable && <TooltipContent>Không đủ Ops</TooltipContent>}
    </Tooltip>
  );
}

// ---------------------------------------------------------------- overlays

function EndScreen({ state, seed, onRetry, onNew }: { state: BattleState; seed: number; onRetry: () => void; onNew: () => void }) {
  const won = state.phase === 'won';
  const failed = state.reports.reduce((s, r) => s + r.legitFailed, 0);
  const blocked = state.reports.reduce((s, r) => s + r.botBlockedRps * (CONTENT.battle.turnMs / 1000), 0);
  const peakCost = Math.max(0, ...state.reports.map((r) => r.costPerHour));
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="w-[420px] rounded-xl border bg-card p-6 shadow-2xl">
        <div className="mb-2 flex items-center gap-2 text-2xl font-bold">
          {won ? <Trophy className="size-7 text-amber-300" /> : <Skull className="size-7 text-rose-400" />}
          {won ? 'Botnet đã rút lui' : 'Hết Error Budget'}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {won
            ? `Bạn giữ hệ thống sống qua ${state.turn} lượt và còn ${state.hp}/${state.maxHp} Error Budget.`
            : `Hệ thống không đạt SLO quá nhiều lần ở lượt ${state.turn}. Xem lại Diễn biến để biết lượt nào mất máu nhiều nhất.`}
        </p>
        <div className="mb-5 grid grid-cols-2 gap-2">
          <Stat label="Request người dùng lỗi" value={n0(failed)} bad={failed > 0} />
          <Stat label="Request bot bị chặn" value={n0(blocked)} />
          <Stat label="Chi phí cao nhất" value={`$${peakCost.toFixed(2)}/h`} />
          <Stat label="Seed" value={String(seed)} />
        </div>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onNew}>
            <Dices /> Trận mới
          </Button>
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw /> Chơi lại seed này
          </Button>
        </div>
      </div>
    </div>
  );
}

function RulesPanel({ onClose }: { onClose: () => void }) {
  const items = useMemo(
    () => [
      ['Mỗi lượt', `Rút ${CONTENT.battle.handSize} lá, có ${CONTENT.battle.opsPerTurn} Ops. Đánh bài rồi bấm Kết thúc lượt.`],
      ['Engine quyết định', `Hệ thống chạy ${CONTENT.battle.turnMs / 1000}s mô phỏng thật: ${CONTENT.battle.legitRps} người dùng/s cộng với bot lọt qua bộ lọc.`],
      ['Bạn mất máu', `1 máu cho mỗi ${CONTENT.battle.failedPerDamage} request người dùng lỗi, ${CONTENT.battle.latencyDamage} máu nếu p99 > ${CONTENT.battle.sloP99Ms}ms, và khi chi phí vượt $${CONTENT.battle.budgetPerHour}/h.`],
      ['Botnet mất máu', `Từ lá Phản công, và 1 máu cho mỗi ${CONTENT.battle.blockedPerDamage} request bot bị WAF hoặc rate limit chặn. Botnet yếu thì gửi ít traffic hơn.`],
      ['Thẻ bài', 'Hạ tầng và Chính sách tồn tại cả trận (nhưng tốn tiền mỗi giờ). Hành động chỉ có tác dụng trong lượt.'],
    ],
    [],
  );
  return (
    <div className="border-b bg-muted/30 px-4 py-3 text-sm">
      <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
        {items.map(([k, v]) => (
          <p key={k}>
            <b>{k}:</b> <span className="text-muted-foreground">{v}</span>
          </p>
        ))}
      </div>
      <button className="mt-1 text-xs text-muted-foreground underline" onClick={onClose}>
        Đóng
      </button>
    </div>
  );
}
