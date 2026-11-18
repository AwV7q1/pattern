import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Database,
  Dices,
  Heart,
  HeartPulse,
  Info,
  ScrollText,
  X,
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
  Wallet,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { compute } from '@/sim/compute';
import { cn } from '@/lib/utils';
import { useUi } from '@/app/ui-store';
import type { Design } from '@/types';
import cardsData from './data/cards.json';
import enemiesData from './data/enemies.json';
import battleData from './data/battle.json';
import { apiOut, botCutNow, botRpsNow, canPlay, cardDef, currentIntent, newBattle, nodeOf, planTurn, playCard, resolveTurn } from './rules';
import type { BattleState, CardDef, Content, Intent, TurnPlan, TurnReport } from './types';
import { BotAvatar } from './BotAvatar';
import { CARD_SIZE, CardFace, Hand } from './Hand';
import { absorb, anchor, bolts, floatText, glow, infuse, pulse, ring, shake, wait, wave } from './fx';

const CONTENT = { cards: cardsData, enemies: enemiesData, battle: battleData } as unknown as Content;

const INTENT_ICON: Record<Intent['icon'], typeof Zap> = {
  probe: Radar,
  spike: Zap,
  retry: Repeat,
  slow: Turtle,
  debt: Bug,
  heal: HeartPulse,
};

/** Spark color of each card type, matching the card frames. */
const TYPE_FX: Record<CardDef['type'], string> = {
  infra: '#38bdf8',
  policy: '#a78bfa',
  action: '#34d399',
  attack: '#fb7185',
  curse: '#a1a1aa',
};

const randomSeed = () => Math.floor(Math.random() * 1_000_000) + 1;
const n0 = (v: number) => Math.round(v).toLocaleString('vi-VN');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** $/h of a design with this turn's temporary instances. */
function costOf(design: Design, temp: BattleState['temp']) {
  return design.nodes.reduce((sum, node) => {
    const extra = node.id === 'api' ? temp.api : node.id === 'db' ? temp.db : 0;
    return sum + ((node.config?.instances ?? 1) + extra) * (node.config?.costPerHour ?? 0);
  }, 0);
}

type Flash = { key: number; player: number; enemy: number };

/**
 * Card battle prototype: defend a small system against a botnet. Your
 * infrastructure faces the bot across the arena; cards are dragged from the
 * fanned hand onto the arena to play them. When the turn ends the real engine
 * runs 10 simulated seconds of traffic while the bot's requests fly at your
 * gateway, and the engine's numbers decide the damage on both sides. Rules
 * live in `rules.ts` (pure, seeded); `fx.ts` only illustrates them.
 */
export function CardBattle() {
  const [seed, setSeed] = useState(randomSeed);
  const [state, setState] = useState(() => newBattle(CONTENT, seed));
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showLog, setShowLog] = useState(false);
  /** How many turn reports the player has looked at (the rest light the badge). */
  const [seenReports, setSeenReports] = useState(0);
  const [dragState, setDragState] = useState<'idle' | 'dragging' | 'over'>('idle');
  const [splash, setSplash] = useState<{ key: number; def: CardDef; x: number; y: number } | null>(null);
  const busy = useRef(false);

  const arenaRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const infraRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const shieldRef = useRef<HTMLDivElement>(null);
  const opsRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLSpanElement>(null);
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({});

  // a game screen: the app's tab bar steps aside
  const setImmersive = useUi((s) => s.setImmersive);
  useEffect(() => {
    setImmersive(true);
    return () => setImmersive(false);
  }, [setImmersive]);

  const restart = (s: number) => {
    setSeed(s);
    setState(newBattle(CONTENT, s));
    setError(null);
    setFlash(null);
    setSeenReports(0);
  };

  /** Green bolts from your gateway into the bot. */
  const counterFx = useCallback(async (damage: number) => {
    const layer = fxRef.current;
    const bot = botRef.current;
    const source = shieldRef.current ?? gateRef.current;
    if (!layer || !bot || !source) return;
    await bolts(layer, anchor(source, layer), anchor(bot, layer, 0.5, 0.5), damage, () => {
      shake(bot, 9);
      glow(bot, 'rgba(110,231,183,0.6)', 320);
    });
  }, []);

  /** What a card touches in your system, and the label shown there. */
  const targetsOf = (def: CardDef, next: BattleState) => {
    const nodes = nodeEls.current;
    const hits: { el: HTMLElement | null; label?: string }[] = [];
    for (const e of def.effects) {
      switch (e.op) {
        case 'scale':
          hits.push({ el: nodes[e.node], label: `+${e.n} instance${e.temp ? ' (lượt này)' : ''}` });
          break;
        case 'cache': {
          const rate = nodeOf(next.design, 'cache')?.config?.hitRate ?? e.hitRate;
          hits.push({ el: nodes.cache, label: `cache hit ${Math.round(rate * 100)}%` });
          break;
        }
        case 'edge': {
          const p = e.patch;
          const label = p.timeoutMs ? `timeout ${p.timeoutMs}ms` : p.retries ? `retry ×${p.retries} + backoff` : p.circuitBreaker ? 'circuit breaker' : 'policy';
          hits.push({ el: nodes.policy, label });
          break;
        }
        case 'rateLimit':
          hits.push({ el: shieldRef.current, label: `rate limit −${Math.round(e.cut * 100)}% bot` });
          break;
        case 'waf':
          hits.push({ el: shieldRef.current, label: `WAF ${Math.round(next.waf * 100)}%` });
          break;
        case 'attack':
          hits.push({ el: shieldRef.current ?? gateRef.current });
          break;
        case 'headroom':
          hits.push({ el: infraRef.current, label: `+${e.n} headroom` });
          break;
        case 'hotfix':
          hits.push({ el: nodes.api, label: 'hotfix' }, { el: nodes.db });
          break;
        case 'draw':
          hits.push({ el: deckRef.current, label: `+${e.n} lá` });
          break;
        case 'ops':
          hits.push({ el: opsRef.current, label: `+${e.n} Ops` });
          break;
      }
    }
    return hits.filter((h, i): h is { el: HTMLElement; label?: string } => !!h.el && hits.findIndex((k) => k.el === h.el) === i);
  };

  /** The played card's energy flies into the parts of the system it changes. */
  const cardFx = async (def: CardDef, at: { x: number; y: number }, next: BattleState) => {
    // wait for the new state to be laid out: a cache or shield may have just appeared
    await wait(150);
    const layer = fxRef.current;
    if (!layer) return;
    const l = layer.getBoundingClientRect();
    const from = { x: at.x - l.left, y: at.y - l.top };
    const color = TYPE_FX[def.type];
    await Promise.all(
      targetsOf(def, next).map(async (h, i) => {
        await wait(i * 110);
        const to = anchor(h.el, layer);
        await infuse(layer, from, to, color);
        absorb(h.el, color, h.el === infraRef.current ? 1.03 : 1.12);
        ring(layer, to, color, h.el === infraRef.current ? 160 : 70);
        if (h.label) floatText(layer, anchor(h.el, layer, 0.5, 0), h.label, color);
      }),
    );
  };

  const play = (uid: number, at?: { x: number; y: number }) => {
    if (resolving || state.phase !== 'player') return;
    const inst = state.hand.find((c) => c.uid === uid);
    const next = playCard(CONTENT, state, uid);
    if (!inst || next === state) return;
    const def = cardDef(CONTENT, inst.id);
    const arena = arenaRef.current?.getBoundingClientRect();
    const pos = at ?? (arena ? { x: arena.left + arena.width / 2, y: arena.bottom - 320 } : { x: 0, y: 0 });
    setSplash({ key: Date.now(), def, x: pos.x, y: pos.y });
    setState(next);
    const dmg = state.enemy.hp - next.enemy.hp;
    // the system takes the card in first; an attack card then fires from it
    void cardFx(def, pos, next).then(async () => {
      if (dmg > 0) {
        await counterFx(dmg);
        setFlash({ key: Date.now(), player: 0, enemy: dmg });
      }
    });
  };

  /** The bot winds up and its requests (and your users') stream into the gateway. */
  const attackFx = async (plan: TurnPlan) => {
    const layer = fxRef.current;
    const bot = botRef.current;
    const gate = gateRef.current;
    if (!layer || !bot || !gate) return wait(700);
    pulse(bot, 1.14, 420);
    await wait(260);
    const from = anchor(bot, layer, 0.22, 0.55);
    const to = anchor(gate, layer, 0.92, 0.5);
    const stopX = shieldRef.current ? anchor(shieldRef.current, layer).x : undefined;
    const onHit = () => glow(gate, 'rgba(251,113,133,0.75)', 240);
    const usersFrom = { x: (from.x + to.x) / 2, y: -12 };
    await Promise.all([
      wave(layer, {
        from,
        to,
        count: clamp(Math.round(plan.botRps / 60), 10, 48),
        blocked: plan.botRps > 0 ? plan.botBlockedRps / plan.botRps : 0,
        stopX,
        kind: 'bot',
        window: 1500,
        flight: 780,
        spreadFrom: 34,
        onHit,
      }),
      wave(layer, {
        from: usersFrom,
        to,
        count: clamp(Math.round(plan.legitRps / 45), 3, 10),
        kind: 'user',
        window: 1500,
        flight: 900,
        spreadFrom: 0,
        arc: 0,
      }),
    ]);
  };

  /** Hits land: your system shakes for the damage you took, then it hits back. */
  const impactFx = async (r: TurnReport) => {
    if (r.damage.total > 0) {
      shake(infraRef.current, Math.min(12, 4 + r.damage.total));
      const red = 'rgba(244,63,94,0.8)';
      if (r.errorRate > 0.01 || r.damage.latency > 0) {
        glow(nodeEls.current.api, red, 500);
        glow(nodeEls.current.db, red, 500);
      }
      await wait(380);
    }
    if (r.enemyDamage > 0) await counterFx(r.enemyDamage);
    else await wait(200);
  };

  const endTurn = async () => {
    if (busy.current || state.phase !== 'player') return;
    busy.current = true;
    setResolving(true);
    setError(null);
    try {
      const plan = planTurn(CONTENT, state);
      const engine = compute.run(plan.input);
      engine.catch(() => undefined); // awaited below; avoid an unhandled rejection meanwhile
      await attackFx(plan);
      const summary = await engine;
      const next = resolveTurn(CONTENT, state, plan, summary);
      const r = next.reports.at(-1)!;
      await impactFx(r);
      setFlash({ key: Date.now(), player: r.damage.total, enemy: r.enemyDamage });
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy.current = false;
      setResolving(false);
    }
  };

  // keyboard: 1-9 play a card, E ends the turn
  const keys = useRef({ play, endTurn });
  keys.current = { play, endTurn };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[1-9]$/.test(e.key)) {
        const card = state.hand[Number(e.key) - 1];
        if (card) keys.current.play(card.uid);
      } else if (e.key === 'e' || e.key === 'E') {
        void keys.current.endTurn();
      } else if (e.key === 'l' || e.key === 'L') {
        setShowLog((v) => !v);
      } else if (e.key === 'Escape') {
        setShowLog(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.hand]);

  // an open log counts as read
  useEffect(() => {
    if (showLog) setSeenReports(state.reports.length);
  }, [showLog, state.reports.length]);
  const unseen = showLog ? 0 : state.reports.length - seenReports;

  const intent = currentIntent(CONTENT, state);
  const enemy = CONTENT.enemies.find((e) => e.id === state.enemy.id)!;
  const over = state.phase === 'won' || state.phase === 'lost';
  const hand = state.hand.map((inst) => ({
    uid: inst.uid,
    def: cardDef(CONTENT, inst.id),
    playable: canPlay(CONTENT, state, inst.uid) && !resolving,
  }));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_80%_45%,rgba(244,63,94,0.10),transparent_45%),radial-gradient(ellipse_at_22%_45%,rgba(56,189,248,0.09),transparent_50%)]">
      {/* top bar */}
      <div className="relative z-30 flex items-center gap-3 px-4 py-2 text-sm">
        <Button size="sm" variant="ghost" asChild>
          <Link to="/play">
            <ArrowLeft /> Thoát
          </Link>
        </Button>
        <span className="font-semibold">{CONTENT.battle.title}</span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">Prototype</span>
        <span className="text-muted-foreground">Lượt {state.turn}</span>
        <span className="font-mono text-xs text-muted-foreground">seed {seed}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant={showLog ? 'secondary' : 'ghost'} className="relative" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
            <ScrollText /> Nhật ký
            {unseen > 0 && (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-400 font-mono text-[10px] font-bold text-black">{unseen}</span>
            )}
          </Button>
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

      <div ref={arenaRef} className="relative min-h-0 flex-1">
        {/* the two sides face each other across the arena */}
        <div className="absolute inset-0 grid grid-cols-[minmax(0,1.5fr)_minmax(140px,0.55fr)_minmax(260px,0.75fr)] gap-6 overflow-y-auto px-6 pb-[200px] pt-2">
          <div className="flex min-w-0 flex-col justify-center gap-4">
            <SystemPanel state={state} flash={flash} panelRef={infraRef} gateRef={gateRef} shieldRef={shieldRef} nodeEls={nodeEls} hit={resolving} />
            {state.reports.length === 0 && <FirstTurnHint />}
            {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
          </div>

          <div className="flex min-w-0 flex-col items-center justify-center gap-4">
            {resolving ? (
              <div className="text-center text-xs text-muted-foreground">
                <LoaderCircle className="mx-auto mb-1 size-5 animate-spin text-sky-400" />
                Engine đang chạy {CONTENT.battle.turnMs / 1000} giây traffic
                <div className="mt-2 flex justify-center gap-3">
                  <Legend color="bg-rose-400" label="bot" />
                  <Legend color="bg-sky-300" label="người dùng" />
                  <Legend color="bg-emerald-400" label="bị chặn" />
                </div>
              </div>
            ) : (
              <span className="select-none font-black italic tracking-tighter text-foreground/10 [font-size:64px]">VS</span>
            )}
          </div>

          <div className="flex min-w-0 flex-col items-center justify-center">
            <BotSide state={state} name={enemy.name} description={enemy.description} intent={intent} flash={flash} botRef={botRef} attacking={resolving} />
          </div>
        </div>

        {/* drop target while a card is dragged */}
        {dragState !== 'idle' && (
          <div
            className={cn(
              'pointer-events-none absolute inset-x-6 bottom-[150px] top-2 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed transition-colors',
              dragState === 'over' ? 'border-amber-300/70 bg-amber-300/5' : 'border-foreground/15',
            )}
          >
            <span className={cn('rounded-full bg-background/80 px-3 py-1 text-sm', dragState === 'over' ? 'text-amber-200' : 'text-muted-foreground')}>
              {dragState === 'over' ? 'Thả để đánh lá này' : 'Kéo lên vùng chơi'}
            </span>
          </div>
        )}

        <div ref={fxRef} className="pointer-events-none absolute inset-0 z-[15] overflow-hidden" />

        {/* bottom corners: resources and the end-turn button, either side of the hand */}
        <div className="absolute bottom-4 left-6 z-30 flex flex-col gap-1.5 text-xs text-muted-foreground">
          <div ref={opsRef} className="w-fit rounded-full">
            <OpsPips ops={state.ops} max={CONTENT.battle.opsPerTurn} />
          </div>
          <div className="flex gap-3">
            <span ref={deckRef} className="inline-block rounded">
              <Layers className="mr-1 inline size-3.5" />
              Bộ rút {state.drawPile.length}
            </span>
            <span>Bỏ {state.discard.length}</span>
            {state.exhausted.length > 0 && <span>Tiêu hao {state.exhausted.length}</span>}
          </div>
          <span className="hidden lg:inline">Kéo bài lên để đánh · phím 1–9 · E kết thúc lượt</span>
        </div>
        <div className="absolute bottom-6 right-6 z-30">
          <Button size="lg" className="h-12 rounded-full px-6 shadow-lg shadow-black/40" disabled={state.phase !== 'player' || resolving} onClick={() => void endTurn()}>
            {resolving ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
            Kết thúc lượt
          </Button>
        </div>

        <LogDrawer open={showLog} reports={state.reports} onClose={() => setShowLog(false)} />

        <Hand cards={hand} dropRef={arenaRef} onPlay={play} onDragChange={setDragState} />
        {hand.length === 0 && !over && (
          <p className="absolute bottom-10 left-1/2 z-20 -translate-x-1/2 text-sm text-muted-foreground">Hết bài trên tay. Kết thúc lượt.</p>
        )}
      </div>

      {splash && <PlayedSplash key={splash.key} def={splash.def} x={splash.x} y={splash.y} onDone={() => setSplash(null)} />}

      {over && <EndScreen state={state} seed={seed} onLog={() => setShowLog(true)} onRetry={() => restart(seed)} onNew={() => restart(randomSeed())} />}
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('size-2 rounded-full', color)} />
      {label}
    </span>
  );
}

/** A played card flares up where it was dropped and fades into the arena. */
function PlayedSplash({ def, x, y, onDone }: { def: CardDef; x: number; y: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anim = el.animate(
      [
        { transform: 'scale(1.08)', opacity: 1, filter: 'brightness(1.4)' },
        { transform: 'scale(1.15)', opacity: 1, filter: 'brightness(1.1)', offset: 0.35 },
        { transform: 'scale(0.6) translateY(-40px)', opacity: 0, filter: 'brightness(1)' },
      ],
      { duration: 650, easing: 'ease-out', fill: 'forwards' },
    );
    anim.onfinish = () => done.current();
    return () => anim.cancel();
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50"
      style={{ left: x - CARD_SIZE.w / 2, top: y - CARD_SIZE.h / 2, width: CARD_SIZE.w, height: CARD_SIZE.h }}
    >
      <CardFace def={def} playable glowing />
    </div>
  );
}

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
      className="pointer-events-none absolute -top-2 right-2 animate-out fade-out slide-out-to-top-6 fill-mode-forwards text-3xl font-black text-rose-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] duration-[1400ms]"
    >
      −{value}
    </span>
  );
}

/**
 * Your whole system as one object facing the bot: a framed unit with its
 * Error Budget on top and the request path inside. Headroom wraps it in a
 * blue barrier, the WAF / rate-limit shield stands in front of its gateway.
 */
function SystemPanel({
  state,
  flash,
  panelRef,
  gateRef,
  shieldRef,
  nodeEls,
  hit,
}: {
  state: BattleState;
  flash: Flash | null;
  panelRef: React.RefObject<HTMLDivElement | null>;
  gateRef: React.RefObject<HTMLDivElement | null>;
  shieldRef: React.RefObject<HTMLDivElement | null>;
  nodeEls: React.RefObject<Record<string, HTMLDivElement | null>>;
  hit: boolean;
}) {
  const cost = costOf(state.design, state.temp);
  const budget = CONTENT.battle.budgetPerHour;
  const ratio = state.hp / state.maxHp;
  const status = ratio > 0.5 ? 'ok' : ratio > 0.25 ? 'warn' : 'crit';
  const shields = [state.waf > 0 ? `WAF ${Math.round(state.waf * 100)}%` : null, state.temp.botCut > 0 ? `rate limit ${Math.round(state.temp.botCut * 100)}%` : null].filter(
    Boolean,
  ) as string[];
  return (
    <div className="flex items-stretch gap-3">
      <div
        ref={panelRef}
        className={cn(
          'relative min-w-0 flex-1 rounded-3xl border-2 bg-[linear-gradient(160deg,rgba(14,165,233,0.10),rgba(9,9,11,0.55)_55%)] p-4 shadow-2xl shadow-black/50 backdrop-blur transition-[border-color,box-shadow] duration-300',
          status === 'ok' ? 'border-sky-500/35' : status === 'warn' ? 'border-amber-500/45' : 'animate-pulse border-rose-500/60',
          state.headroom > 0 && 'shadow-[0_0_0_4px_rgba(56,189,248,0.25),0_0_36px_6px_rgba(56,189,248,0.3)]',
          hit && 'border-sky-400/60',
        )}
      >
        {/* faint grid: a rack, not a card */}
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:18px_18px]" />

        <div className="relative">
          <DamagePop flash={flash} value={flash?.player ?? 0} side="player" />
          <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
            <span className="flex gap-1">
              {(['ok', 'warn', 'crit'] as const).map((s) => (
                <span
                  key={s}
                  className={cn(
                    'size-2 rounded-full',
                    s !== status
                      ? 'bg-muted-foreground/25'
                      : s === 'ok'
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]'
                        : s === 'warn'
                          ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]'
                          : 'animate-pulse bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]',
                  )}
                />
              ))}
            </span>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Hệ thống của bạn</span>
            {state.headroom > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">
                <Shield className="size-3.5" /> {state.headroom}
              </span>
            )}
            <span className={cn('ml-auto flex items-center gap-1 font-mono text-xs', cost > budget + 0.001 ? 'text-rose-400' : 'text-muted-foreground')}>
              <Wallet className="size-3.5" /> ${cost.toFixed(2)}/${budget.toFixed(2)}/h
            </span>
          </div>
          <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
            <Heart className="size-4 text-rose-400" /> Error Budget
            <span className="font-mono">
              {state.hp}/{state.maxHp}
            </span>
          </div>
          <Bar value={state.hp} max={state.maxHp} className="bg-gradient-to-r from-rose-600 to-rose-400" />
          <InfraLine state={state} gateRef={gateRef} nodeEls={nodeEls} />
        </div>
      </div>

      {/* the shield stands outside the system, between it and the bot */}
      <div className="relative flex w-6 shrink-0 items-center justify-center">
        {shields.length > 0 && (
          <>
            <div ref={shieldRef} className="h-3/4 w-1.5 rounded-full bg-emerald-400/80 shadow-[0_0_16px_4px_rgba(52,211,153,0.45)]" />
            <span className="absolute left-[calc(50%+7px)] top-1/2 -translate-y-1/2 rotate-180 whitespace-nowrap rounded [writing-mode:vertical-rl] bg-emerald-500/15 px-1 text-[10px] text-emerald-300">
              {shields.join(' · ')}
            </span>
          </>
        )}
      </div>
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
          className={cn('size-4 rounded-full border', i < ops ? 'border-amber-300 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'border-muted-foreground/40')}
        />
      ))}
      <span className="font-mono text-xs text-muted-foreground">
        {ops}/{max}
      </span>
    </span>
  );
}

function BotSide({
  state,
  name,
  description,
  intent,
  flash,
  botRef,
  attacking,
}: {
  state: BattleState;
  name: string;
  description: string;
  intent: Intent;
  flash: Flash | null;
  botRef: React.RefObject<HTMLDivElement | null>;
  attacking: boolean;
}) {
  const Icon = INTENT_ICON[intent.icon];
  const raw = botRpsNow(CONTENT, state);
  const cut = botCutNow(state);
  return (
    <div className="flex w-full max-w-[300px] flex-col items-center gap-3">
      {/* what it is about to do, said out loud */}
      <div className="relative rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center">
        <div className="flex items-center justify-center gap-1.5 font-semibold">
          <Icon className="size-4 text-amber-300" /> {intent.label}
        </div>
        <div className="font-mono text-xs text-amber-200/80">{n0(raw * (1 - cut))} rps lọt vào</div>
        <span className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r border-amber-500/40 bg-[color-mix(in_oklab,var(--background)_88%,#f59e0b)]" />
      </div>

      <BotAvatar ref={botRef} hpRatio={state.enemy.hp / state.enemy.maxHp} className={cn('rounded-full', attacking && 'drop-shadow-[0_0_24px_rgba(244,63,94,0.55)]')} />

      <div className="relative w-full">
        <DamagePop flash={flash} value={flash?.enemy ?? 0} side="enemy" />
        <div className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Skull className="size-4 text-rose-400" /> <span title={description}>{name}</span>
          <span className="ml-auto font-mono">
            {state.enemy.hp}/{state.enemy.maxHp}
          </span>
        </div>
        <Bar value={state.enemy.hp} max={state.enemy.maxHp} className="bg-gradient-to-r from-rose-600 to-orange-500" />
      </div>

      <div className="w-full rounded-lg bg-card/60 p-3 text-xs backdrop-blur">
        <p className="mb-2 text-muted-foreground">{intent.text}</p>
        <div className="space-y-1 font-mono">
          <Row label="Bot dự kiến" value={`${n0(raw)} rps`} />
          <Row label="Bị lọc (WAF + rate limit)" value={`${Math.round(cut * 100)}%`} good={cut > 0} />
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

// ---------------------------------------------------------------- your infrastructure

/**
 * Your system, drawn facing the bot: requests enter at Nginx on the right and
 * flow left to the database, behind the WAF / rate-limit shield.
 */
function InfraLine({
  state,
  gateRef,
  nodeEls,
}: {
  state: BattleState;
  gateRef: React.RefObject<HTMLDivElement | null>;
  nodeEls: React.RefObject<Record<string, HTMLDivElement | null>>;
}) {
  const d = state.design;
  const api = nodeOf(d, 'api')!.config!;
  const db = nodeOf(d, 'db')!.config!;
  const cache = nodeOf(d, 'cache');
  const out = apiOut(d)!;
  const policies = [out.timeoutMs ? `timeout ${out.timeoutMs}ms` : null, out.retries ? `retry ×${out.retries}` : null, out.circuitBreaker ? 'breaker' : null].filter(
    Boolean,
  ) as string[];
  const set = (id: string) => (el: HTMLDivElement | null) => {
    nodeEls.current[id] = el;
  };

  return (
    <div className="flex items-center gap-1 pt-8">
      <InfraNode nodeRef={set('db')} icon={<Database />} title="PostgreSQL" sub={`${db.concurrency} connection`} count={db.instances ?? 1} extra={state.temp.db} accent="indigo" />
      {cache && (
        <>
          <Pipe />
          <InfraNode nodeRef={set('cache')} icon={<Zap />} title="Redis" sub={`hit ${Math.round((cache.config?.hitRate ?? 0) * 100)}%`} accent="red" />
        </>
      )}
      <Pipe label={policies.join(' · ')} policy={policies.length > 0} pipeRef={set('policy')} />
      <InfraNode nodeRef={set('api')} icon={<Server />} title="API" sub={`${api.concurrency} slot/instance`} count={api.instances ?? 1} extra={state.temp.api} accent="sky" />
      <Pipe />
      <InfraNode nodeRef={(el) => { gateRef.current = el; set('lb')(el); }} icon={<Network />} title="Nginx" sub="cổng vào" />
    </div>
  );
}

function InfraNode({
  icon,
  title,
  sub,
  count,
  extra = 0,
  accent,
  nodeRef,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  count?: number;
  extra?: number;
  accent?: 'sky' | 'red' | 'indigo';
  nodeRef?: (el: HTMLDivElement | null) => void;
}) {
  const color =
    accent === 'sky'
      ? 'border-sky-500/50 [&_svg]:text-sky-300'
      : accent === 'red'
        ? 'border-red-500/50 [&_svg]:text-red-300'
        : accent === 'indigo'
          ? 'border-indigo-500/50 [&_svg]:text-indigo-300'
          : 'border-foreground/20 [&_svg]:text-foreground/80';
  return (
    <div ref={nodeRef} className={cn('relative min-w-[92px] shrink-0 rounded-xl border-2 bg-card/80 px-2.5 py-2 shadow-lg shadow-black/30 backdrop-blur', color)}>
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

/** A connection; requests flow right to left, from the gateway inwards. */
function Pipe({ label, policy, pipeRef }: { label?: string; policy?: boolean; pipeRef?: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={pipeRef} className="relative flex min-w-6 flex-1 flex-col items-center rounded-full">
      {label ? (
        <span className={cn('absolute -top-5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[10px]', policy && 'bg-violet-500/15 text-violet-300')}>
          {label}
        </span>
      ) : null}
      <div className="flex w-full items-center">
        <ArrowLeft className="-mr-1 size-3 text-muted-foreground/60" />
        <div className="h-px flex-1 bg-muted-foreground/40" />
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

function ReportCard({ report: r, onCollapse }: { report: TurnReport; onCollapse?: () => void }) {
  return (
    <div className="rounded-lg border bg-background/60 p-3 text-sm">
      <button type="button" onClick={onCollapse} className="mb-2 flex w-full items-center gap-2 text-left font-medium">
        <span className="font-mono text-xs text-muted-foreground">T{r.turn}</span>
        <span className="flex-1">{r.intent}</span>
        <span className="text-xs font-normal text-muted-foreground">10 giây mô phỏng</span>
      </button>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Lỗi" value={`${(r.errorRate * 100).toFixed(1)}%`} bad={r.errorRate > 0.01} />
        <Stat label="p99" value={`${Math.round(r.p99Ms)}ms`} bad={r.damage.latency > 0} />
        <Stat label="Bot bị chặn" value={`${n0(r.botBlockedRps)}/${n0(r.botRps)} rps`} />
        <Stat label="Chi phí" value={`$${r.costPerHour.toFixed(2)}/h`} bad={r.damage.budget > 0} />
      </div>
      <div className="mt-3 grid gap-3">
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

/**
 * The battle log: a drawer on the right edge, closed by default so the
 * arena stays clear. Newest turn first and opened in full; older turns
 * collapse to one line and expand on click.
 */
function LogDrawer({ open, reports, onClose }: { open: boolean; reports: TurnReport[]; onClose: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const latest = reports.at(-1)?.turn;
  // a new turn comes in: show it in full
  useEffect(() => setExpanded(latest ?? null), [latest]);
  return (
    <aside
      aria-label="Nhật ký trận"
      aria-hidden={!open}
      inert={!open}
      className={cn(
        'absolute bottom-[150px] right-4 top-2 z-40 flex w-[min(440px,calc(100%-2rem))] flex-col rounded-2xl border bg-card/95 shadow-2xl shadow-black/60 backdrop-blur transition-[transform,opacity] duration-300 ease-out',
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[calc(100%+2rem)] opacity-0',
      )}
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <ScrollText className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Nhật ký</span>
        <span className="text-xs text-muted-foreground">{reports.length} lượt · phím L</span>
        <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label="Đóng nhật ký" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {reports.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">Chưa có lượt nào. Kết quả mỗi lượt sẽ hiện ở đây sau khi bạn bấm Kết thúc lượt.</p>
        )}
        {reports
          .slice()
          .reverse()
          .map((r) =>
            expanded === r.turn ? (
              <ReportCard key={r.turn} report={r} onCollapse={() => setExpanded(null)} />
            ) : (
              <button
                key={r.turn}
                type="button"
                onClick={() => setExpanded(r.turn)}
                className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-left font-mono text-xs hover:bg-muted/60"
              >
                <span className="w-7 text-muted-foreground">T{r.turn}</span>
                <span className="flex-1 truncate font-sans">{r.intent}</span>
                <span className={r.damage.total ? 'text-rose-400' : 'text-muted-foreground'}>−{r.damage.total}</span>
                <span className={r.enemyDamage ? 'text-emerald-300' : 'text-muted-foreground'}>⚔{r.enemyDamage}</span>
              </button>
            ),
          )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- overlays

function EndScreen({ state, seed, onLog, onRetry, onNew }: { state: BattleState; seed: number; onLog: () => void; onRetry: () => void; onNew: () => void }) {
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
            : `Hệ thống không đạt SLO quá nhiều lần ở lượt ${state.turn}. Mở Nhật ký để biết lượt nào mất máu nhiều nhất.`}
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
          <Button variant="outline" size="icon" aria-label="Mở nhật ký" onClick={onLog}>
            <ScrollText />
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
