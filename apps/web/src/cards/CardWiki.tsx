import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, BookOpen, Bot, Crown, Flame, Gem, HeartPulse, Layers, RotateCcw, Shield, Skull, Sparkles, Swords, Users, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CONTENT } from './content';
import type { CardDef, CardType, EnemyDef, Intent, MinionDef, Scale } from './types';
import { BotAvatar, MinionAvatar, type BotRank, type BotStance } from './BotAvatar';
import { botHit, botJab, botStrike, botSummon, minionDieClass, minionHit, minionStrike, type BotTier } from './botMotion';
import { INTENT_ICON } from './CardBattle';
import { CardFace, RARITY_STYLE, TYPE_STYLE } from './Hand';
import { TYPE_ICON } from './cardArt';
import { RelicTile } from './Relics';
import { cardDef } from './rules';

// ---------------------------------------------------------------- where each enemy shows up

type Kind = 'warmup' | 'battle' | 'elite' | 'boss';

interface Sighting {
  kind: Kind;
  act: number;
  scale: Scale;
}

const KIND: Record<Kind, { label: string; tone: string }> = {
  warmup: { label: 'Khởi động', tone: 'text-emerald-300 border-emerald-400/50' },
  battle: { label: 'Thường', tone: 'text-zinc-200 border-zinc-400/50' },
  elite: { label: 'Tinh anh', tone: 'text-amber-300 border-amber-400/60' },
  boss: { label: 'Boss tầng', tone: 'text-rose-300 border-rose-400/60' },
};

/** Same formula as `scaleOf` in run.ts. */
function scaleFor(kind: Kind, act: number): Scale {
  const { actScale, fight, elite, boss } = CONTENT.run;
  const k = kind === 'elite' ? elite : kind === 'boss' ? boss : fight;
  const up = act - 1;
  return { hp: k.hp * (1 + actScale.hp * up), rps: k.rps * (1 + actScale.rps * up) };
}

function sightingsOf(id: string): Sighting[] {
  const r = CONTENT.run;
  const out: Sighting[] = [];
  if (r.warmup.includes(id)) out.push({ kind: 'warmup', act: 1, scale: scaleFor('warmup', 1) });
  for (let a = 0; a < r.acts; a++) {
    const act = a + 1;
    if (r.normal[a % r.normal.length]?.includes(id)) out.push({ kind: 'battle', act, scale: scaleFor('battle', act) });
    if (r.elites[a % r.elites.length]?.includes(id)) out.push({ kind: 'elite', act, scale: scaleFor('elite', act) });
    if (r.bosses[a % r.bosses.length] === id) out.push({ kind: 'boss', act, scale: scaleFor('boss', act) });
  }
  return out;
}

const tierOfKind = (k: Kind): { rank: BotRank; mini: boolean; tier: BotTier } =>
  k === 'warmup' ? { rank: 'normal', mini: true, tier: 'mini' } : k === 'elite' ? { rank: 'elite', mini: false, tier: 'elite' } : k === 'boss' ? { rank: 'boss', mini: false, tier: 'boss' } : { rank: 'normal', mini: false, tier: 'normal' };

/** Enemies grouped the way the tower meets them. */
function enemyGroups(): { title: string; ids: string[] }[] {
  const r = CONTENT.run;
  const groups = [
    { title: 'Khởi động (mini bot)', ids: r.warmup },
    ...r.normal.map((ids, a) => ({ title: `Tầng ${a + 1} · thường`, ids })),
    { title: 'Tinh anh', ids: r.elites.flat() },
    { title: 'Boss tầng', ids: r.bosses },
  ];
  const seen = new Set(groups.flatMap((g) => g.ids));
  const rest = CONTENT.enemies.map((e) => e.id).filter((id) => !seen.has(id));
  return rest.length ? [...groups, { title: 'Khác', ids: rest }] : groups;
}

/** Who brings or calls in each minion. */
function mastersOf(minionId: string): { enemy: EnemyDef; how: string }[] {
  const out: { enemy: EnemyDef; how: string }[] = [];
  for (const e of CONTENT.enemies) {
    const start = (e.minions ?? []).filter((m) => m === minionId).length;
    if (start) out.push({ enemy: e, how: `có sẵn ×${start}` });
    for (const it of [...e.intents, ...(e.phase2?.intents ?? [])]) {
      if (it.summon?.minion === minionId) out.push({ enemy: e, how: `gọi ×${it.summon.n} (${it.label})` });
    }
  }
  return out;
}

const n0 = (n: number) => Math.round(n).toLocaleString('vi-VN');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const enemyById = (id: string) => CONTENT.enemies.find((e) => e.id === id);
const minionById = (id: string) => CONTENT.minions.find((m) => m.id === id);

// ---------------------------------------------------------------- page

type Tab = 'bots' | 'minions' | 'cards' | 'relics';

const TABS: { id: Tab; label: string; icon: typeof Bot; count: number }[] = [
  { id: 'bots', label: 'Bot', icon: Bot, count: CONTENT.enemies.length },
  { id: 'minions', label: 'Lính', icon: Users, count: CONTENT.minions.length },
  { id: 'cards', label: 'Thẻ bài', icon: Layers, count: CONTENT.cards.length },
  { id: 'relics', label: 'Bảo vật', icon: Gem, count: CONTENT.relics.length },
];

/** Read-only encyclopedia of the card game: enemies, minions (with their animations), cards and relics. */
export function CardWiki() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'bots') as Tab;
  const id = params.get('id');
  const go = (t: Tab, next?: string) => setParams(next ? { tab: t, id: next } : { tab: t });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <Button size="sm" variant="ghost" asChild>
          <Link to="/cards">
            <ArrowLeft /> Về tháp
          </Link>
        </Button>
        <BookOpen className="size-5 text-amber-300" />
        <h1 className="text-base font-semibold">Wiki · {CONTENT.run.title}</h1>
        <nav className="flex flex-wrap gap-1.5 md:ml-4" aria-label="Mục wiki">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                tab === t.id ? 'border-amber-300/70 bg-amber-400/15 text-amber-200' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="size-3.5" />
              {t.label}
              <span className="font-mono text-xs opacity-60">{t.count}</span>
            </button>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'bots' && <BotsTab id={id && enemyById(id) ? id : CONTENT.enemies[0].id} onPick={(x) => go('bots', x)} onMinion={(x) => go('minions', x)} />}
        {tab === 'minions' && <MinionsTab id={id && minionById(id) ? id : CONTENT.minions[0].id} onPick={(x) => go('minions', x)} onEnemy={(x) => go('bots', x)} />}
        {tab === 'cards' && <CardsTab onCard={(x) => go('cards', x)} selected={id} />}
        {tab === 'relics' && <RelicsTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shared layout

function Split({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid h-full min-h-0 md:grid-cols-[260px_1fr]">
      <aside className="max-h-[40vh] overflow-y-auto border-b p-3 md:max-h-none md:border-b-0 md:border-r">{list}</aside>
      <main className="min-h-0 overflow-y-auto p-4 sm:p-6">{children}</main>
    </div>
  );
}

function ListItem({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on}
      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors', on ? 'bg-amber-400/15 text-amber-100' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}
    >
      {children}
    </button>
  );
}

function Stat({ icon: Icon, label, value, hint, tone }: { icon: typeof Bot; label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className={cn('size-3.5', tone)} />
        {label}
      </div>
      <div className="mt-0.5 font-mono text-lg font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ActButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------- bots

function BotsTab({ id, onPick, onMinion }: { id: string; onPick: (id: string) => void; onMinion: (id: string) => void }) {
  const groups = useMemo(enemyGroups, []);
  return (
    <Split
      list={groups.map((g) => (
        <div key={g.title} className="mb-3">
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</div>
          {g.ids.map((eid) => {
            const e = enemyById(eid);
            return (
              e && (
                <ListItem key={eid} on={eid === id} onClick={() => onPick(eid)}>
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto font-mono text-[11px] opacity-60">{e.hp}</span>
                </ListItem>
              )
            );
          })}
        </div>
      ))}
    >
      <BotDetail key={id} enemy={enemyById(id)!} onMinion={onMinion} />
    </Split>
  );
}

const extras = (it: Intent): string[] => {
  const out: string[] = [];
  if (it.chaos) out.push(`${it.chaos.node.toUpperCase()} ${it.chaos.action === 'latency' ? `chậm ×${it.chaos.value}` : `lỗi ${pct(it.chaos.value)}`}`);
  if (it.clientRetries) out.push(`retry ×${it.clientRetries}`);
  if (it.cacheHitScale !== undefined) out.push(`cache hit ×${it.cacheHitScale}`);
  if (it.bypass) out.push(`lách lọc ${pct(it.bypass)}`);
  if (it.heal) out.push(`hồi ${it.heal} máu`);
  if (it.drainOps) out.push(`-${it.drainOps} Ops lượt sau`);
  if (it.wafStrip) out.push(`WAF -${pct(it.wafStrip)}`);
  if (it.addCards) out.push(`+${it.addCards.n} ${cardDef(CONTENT, it.addCards.card).name}`);
  if (it.weight !== undefined) out.push(`tỉ trọng ${it.weight}`);
  return out;
};

function BotDetail({ enemy, onMinion }: { enemy: EnemyDef; onMinion: (id: string) => void }) {
  const sightings = useMemo(() => sightingsOf(enemy.id), [enemy.id]);
  const [at, setAt] = useState(0);
  const seen: Sighting = sightings[at] ?? { kind: 'battle', act: 1, scale: { hp: 1, rps: 1 } };
  const { rank, mini, tier } = tierOfKind(seen.kind);
  const ref = useRef<HTMLDivElement>(null);
  const [stance, setStance] = useState<BotStance>(enemy.intents[0]?.icon ?? 'probe');
  const [enraged, setEnraged] = useState(false);
  const [dead, setDead] = useState(false);
  const [life, setLife] = useState(0);
  const reset = () => {
    setDead(false);
    setEnraged(false);
    setLife((n) => n + 1);
  };
  const summons = [...enemy.intents, ...(enemy.phase2?.intents ?? [])].some((i) => i.summon);
  const hp = Math.round(enemy.hp * seen.scale.hp);
  const minionScale = seen.scale.hp > 1 ? seen.scale.hp : 1;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* stage */}
        <div className="grid gap-3">
          <div className="relative flex h-[300px] items-center justify-center overflow-hidden rounded-2xl border bg-gradient-to-b from-zinc-900 to-zinc-950">
            <BotAvatar
              key={`${life}:${rank}:${mini}`}
              ref={ref}
              enemyId={enemy.id}
              stance={stance}
              hpRatio={dead ? 0 : 0.8}
              rank={rank}
              mini={mini}
              enraged={enraged}
              defeated={dead}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ActButton disabled={dead} onClick={() => void botStrike(ref.current, enemy.id, tier)}>
              <Swords /> Ra đòn
            </ActButton>
            <ActButton disabled={dead} onClick={() => botJab(ref.current, tier)}>
              <Zap /> Đòn nhẹ
            </ActButton>
            <ActButton disabled={dead} onClick={() => botHit(ref.current, tier)}>
              <Shield /> Trúng đòn
            </ActButton>
            {summons && (
              <ActButton disabled={dead} onClick={() => void botSummon(ref.current, tier)}>
                <Users /> Triệu hồi
              </ActButton>
            )}
            {enemy.phase2 && (
              <ActButton disabled={dead || enraged} onClick={() => setEnraged(true)}>
                <Flame /> Nổi giận
              </ActButton>
            )}
            <ActButton disabled={dead} onClick={() => setDead(true)}>
              <Skull /> Bị hạ
            </ActButton>
            <ActButton onClick={reset}>
              <RotateCcw /> Đặt lại
            </ActButton>
          </div>
          <p className="text-xs text-muted-foreground">Bấm một chiêu ở bảng bên phải để xem tư thế của chiêu đó.</p>
        </div>

        {/* info */}
        <div className="grid content-start gap-4">
          <div>
            <h2 className="text-2xl font-bold">{enemy.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{enemy.description}</p>
          </div>
          {sightings.length > 0 && (
            <Section title="Gặp ở">
              <div className="flex flex-wrap gap-1.5">
                {sightings.map((s, i) => (
                  <button
                    key={`${s.kind}${s.act}`}
                    type="button"
                    onClick={() => {
                      setAt(i);
                      reset();
                    }}
                    aria-pressed={i === at}
                    className={cn('rounded-full border px-2.5 py-0.5 text-xs', KIND[s.kind].tone, i === at ? 'bg-white/10 ring-1 ring-current' : 'opacity-70 hover:opacity-100')}
                  >
                    Tầng {s.act} · {KIND[s.kind].label}
                  </button>
                ))}
              </div>
            </Section>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat icon={HeartPulse} tone="text-rose-300" label="Máu" value={hp} hint={`gốc ${enemy.hp} × ${seen.scale.hp.toFixed(2)}`} />
            <Stat icon={Zap} tone="text-amber-300" label="Hệ số traffic" value={`×${seen.scale.rps.toFixed(2)}`} hint="nhân vào rps mỗi chiêu" />
            <Stat icon={Sparkles} tone="text-violet-300" label="Leo thang" value={`+${pct(enemy.escalation)}`} hint="traffic mỗi vòng chiêu" />
            <Stat icon={Bot} tone="text-sky-300" label="Kiểu ra chiêu" value={enemy.pattern === 'weighted' ? 'Ngẫu nhiên' : 'Lần lượt'} hint={enemy.pattern === 'weighted' ? 'theo tỉ trọng, ≤2 lần liền' : 'theo thứ tự, lặp lại'} />
          </div>
          {enemy.passive && (
            <div className="rounded-lg border border-violet-400/40 bg-violet-500/10 px-3 py-2 text-sm">
              <span className="font-semibold text-violet-200">Nội tại · {enemy.passive.label}:</span> {enemy.passive.text}
            </div>
          )}
          {enemy.minions?.length ? (
            <Section title="Lính có sẵn">
              <div className="flex flex-wrap gap-2">
                {enemy.minions.map((m, i) => {
                  const def = minionById(m);
                  return (
                    def && (
                      <button key={i} type="button" onClick={() => onMinion(m)} className="flex items-center gap-2 rounded-lg border bg-card/60 px-2 py-1 text-sm hover:border-amber-300/60">
                        <MinionAvatar minionId={m} hpRatio={1} index={i} className="size-8" />
                        {def.name}
                        <span className="font-mono text-xs text-muted-foreground">{Math.round(def.hp * minionScale)} máu</span>
                      </button>
                    )
                  );
                })}
              </div>
            </Section>
          ) : null}
        </div>
      </div>

      <Section title={`Chiêu thức (${enemy.intents.length})`}>
        <IntentTable intents={enemy.intents} rps={seen.scale.rps} stance={stance} onStance={setStance} onMinion={onMinion} />
      </Section>
      {enemy.phase2 && (
        <Section title={`Pha 2 · dưới ${pct(enemy.phase2.at)} máu`}>
          <div className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm">
            <span className="font-semibold text-rose-200">{enemy.phase2.label}:</span> {enemy.phase2.text}
          </div>
          <IntentTable
            intents={enemy.phase2.intents}
            rps={seen.scale.rps}
            stance={stance}
            onStance={(s) => {
              setStance(s);
              setEnraged(true);
            }}
            onMinion={onMinion}
          />
        </Section>
      )}
    </div>
  );
}

function IntentTable({ intents, rps, stance, onStance, onMinion }: { intents: Intent[]; rps: number; stance: BotStance; onStance: (s: BotStance) => void; onMinion: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5">Chiêu</th>
            <th className="px-3 py-1.5">Mô tả</th>
            <th className="px-3 py-1.5 text-right">Bot rps</th>
            <th className="px-3 py-1.5">Hiệu ứng</th>
          </tr>
        </thead>
        <tbody>
          {intents.map((it) => {
            const Icon = INTENT_ICON[it.icon];
            const summoned = it.summon && minionById(it.summon.minion);
            return (
              <tr key={it.id} onClick={() => onStance(it.icon)} className={cn('cursor-pointer border-t transition-colors hover:bg-accent/40', stance === it.icon && 'bg-amber-400/5')}>
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Icon className="size-4 text-amber-300" />
                    {it.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{it.text}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                  {n0(it.botRps * rps)}
                  {rps !== 1 && <span className="block text-[10px] text-muted-foreground">gốc {n0(it.botRps)}</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {extras(it).map((x) => (
                      <span key={x} className="rounded-full bg-muted px-1.5 py-px text-[10px]">
                        {x}
                      </span>
                    ))}
                    {summoned && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMinion(summoned.id);
                        }}
                        className="rounded-full bg-rose-500/15 px-1.5 py-px text-[10px] text-rose-200 hover:bg-rose-500/30"
                      >
                        gọi {it.summon!.n} {summoned.name}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- minions

function MinionsTab({ id, onPick, onEnemy }: { id: string; onPick: (id: string) => void; onEnemy: (id: string) => void }) {
  return (
    <Split
      list={CONTENT.minions.map((m, i) => (
        <ListItem key={m.id} on={m.id === id} onClick={() => onPick(m.id)}>
          <MinionAvatar minionId={m.id} hpRatio={1} index={i} className="size-6" />
          <span className="truncate">{m.name}</span>
          <span className="ml-auto font-mono text-[11px] opacity-60">{m.hp}</span>
        </ListItem>
      ))}
    >
      <MinionDetail key={id} minion={minionById(id)!} onEnemy={onEnemy} />
    </Split>
  );
}

function MinionDetail({ minion, onEnemy }: { minion: MinionDef; onEnemy: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dead, setDead] = useState(false);
  const [life, setLife] = useState(0);
  const masters = useMemo(() => mastersOf(minion.id), [minion.id]);
  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[320px_1fr]">
      <div className="grid content-start gap-3">
        <div className="flex h-[300px] items-center justify-center rounded-2xl border bg-gradient-to-b from-zinc-900 to-zinc-950">
          <div key={life} className={cn('rounded-xl border bg-card/60 p-3', dead && minionDieClass(minion.id))}>
            <MinionAvatar ref={ref} minionId={minion.id} hpRatio={dead ? 0 : 1} className="size-40" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ActButton disabled={dead} onClick={() => minionStrike(ref.current, minion.id)}>
            <Swords /> Ra đòn
          </ActButton>
          <ActButton disabled={dead} onClick={() => minionHit(ref.current)}>
            <Shield /> Trúng đòn
          </ActButton>
          <ActButton disabled={dead} onClick={() => setDead(true)}>
            <Skull /> Bị hạ
          </ActButton>
          <ActButton
            onClick={() => {
              setDead(false);
              setLife((n) => n + 1);
            }}
          >
            <RotateCcw /> Đặt lại
          </ActButton>
        </div>
        <p className="text-xs text-muted-foreground">Trong trận, ô lính chỉ khoảng 40px; ở đây phóng to để xem rõ.</p>
      </div>
      <div className="grid content-start gap-4">
        <div>
          <h2 className="text-2xl font-bold">{minion.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{minion.text}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat icon={HeartPulse} tone="text-rose-300" label="Máu gốc" value={minion.hp} hint="tinh anh / boss nhân thêm" />
          <Stat icon={Zap} tone="text-amber-300" label="Bot rps" value={`+${n0(minion.botRps)}`} hint="mỗi lượt, không yếu đi" />
          <Stat icon={Shield} tone="text-sky-300" label="Che chắn" value={minion.guard ? pct(minion.guard) : '–'} hint="chủ bớt sát thương" />
          <Stat icon={HeartPulse} tone="text-emerald-300" label="Hồi cho chủ" value={minion.heal ? `+${minion.heal}` : '–'} hint="cuối mỗi lượt" />
        </div>
        <div className="rounded-lg border bg-card/40 px-3 py-2 text-sm text-muted-foreground">
          Đánh trúng lính thì nó nhận hết sát thương (phần dư mất). Tối đa 3 lính cùng lúc. Chủ bị hạ thì lính bỏ chạy.
        </div>
        <Section title="Đi theo">
          {masters.length ? (
            <div className="grid gap-1.5">
              {masters.map(({ enemy, how }, i) => (
                <button key={i} type="button" onClick={() => onEnemy(enemy.id)} className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-1.5 text-left text-sm hover:border-amber-300/60">
                  <Crown className="size-4 text-amber-300" />
                  <span className="font-medium">{enemy.name}</span>
                  <span className="text-muted-foreground">· {how}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có bot nào mang theo.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- cards

const TYPE_ORDER: CardType[] = ['infra', 'policy', 'action', 'attack', 'curse'];

function CardsTab({ selected, onCard }: { selected: string | null; onCard: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | CardType>('all');
  const [upgraded, setUpgraded] = useState(false);
  const sorted = useMemo(
    () => [...CONTENT.cards].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.cost - b.cost || a.name.localeCompare(b.name, 'vi')),
    [],
  );
  const shown = sorted.filter((c) => filter === 'all' || c.type === filter);
  const pick = selected ? CONTENT.cards.find((c) => c.id === selected) : undefined;
  const face = (c: CardDef) => (upgraded && c.upgrade ? cardDef(CONTENT, `${c.id}+`) : c);

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
      <div className="mx-auto grid max-w-[1400px] gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', ...TYPE_ORDER] as const).map((t) => {
            const Icon = t === 'all' ? null : TYPE_ICON[t];
            const n = t === 'all' ? CONTENT.cards.length : CONTENT.cards.filter((c) => c.type === t).length;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                aria-pressed={filter === t}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                  filter === t ? 'border-amber-300/70 bg-amber-400/15 text-amber-200' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {Icon && <Icon className="size-3" />}
                {t === 'all' ? 'Tất cả' : TYPE_STYLE[t].label}
                <span className="font-mono opacity-60">{n}</span>
              </button>
            );
          })}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={upgraded} onChange={(e) => setUpgraded(e.target.checked)} className="accent-emerald-400" />
            Xem bản nâng cấp
          </label>
        </div>

        {pick && <CardDetail def={pick} />}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] justify-items-center gap-x-4 gap-y-6">
          {shown.map((c) => (
            <button key={c.id} type="button" onClick={() => onCard(c.id)} className={cn('flex flex-col items-center gap-2 rounded-2xl p-1', pick?.id === c.id && 'ring-2 ring-amber-300/70')}>
              <div className="h-[300px] w-[176px] transition-transform duration-200 hover:-translate-y-1">
                <CardFace def={face(c)} playable lesson />
              </div>
              <span className={cn('text-[11px]', c.rarity ? RARITY_STYLE[c.rarity].text : 'text-zinc-400')}>
                {c.rarity ? RARITY_STYLE[c.rarity].label : 'Lá nguyền'}
                {c.upgrade ? ' · nâng cấp được' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CardDetail({ def }: { def: CardDef }) {
  const up = def.upgrade ? cardDef(CONTENT, `${def.id}+`) : null;
  const inDeck = CONTENT.battle.startingDeck.filter((id) => id === def.id).length;
  const usedBy = CONTENT.enemies.filter((e) => [...e.intents, ...(e.phase2?.intents ?? [])].some((i) => i.addCards?.card === def.id));
  return (
    <div className="grid gap-4 rounded-2xl border bg-card/60 p-4 md:grid-cols-[auto_auto_1fr]">
      <div className="h-[300px] w-[176px]">
        <CardFace def={def} playable lesson />
      </div>
      {up && (
        <div className="h-[300px] w-[176px]">
          <CardFace def={up} playable lesson />
        </div>
      )}
      <div className="grid content-start gap-2 text-sm">
        <h2 className="text-xl font-bold">{def.name}</h2>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className={cn('rounded-full px-2 py-0.5', TYPE_STYLE[def.type].chip)}>{TYPE_STYLE[def.type].label}</span>
          {def.rarity && <span className={cn('rounded-full bg-muted px-2 py-0.5', RARITY_STYLE[def.rarity].text)}>{RARITY_STYLE[def.rarity].label}</span>}
          <span className="rounded-full bg-muted px-2 py-0.5">{def.unplayable ? 'Không đánh được' : `${def.cost} Ops`}</span>
          {def.exhaust && <span className="rounded-full bg-muted px-2 py-0.5 text-amber-200">Tiêu hao</span>}
          {inDeck > 0 && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-amber-200">Bộ bài đầu ×{inDeck}</span>}
        </div>
        <p>{def.text}</p>
        <p className="italic text-muted-foreground">{def.lesson}</p>
        {def.upgrade && (
          <p>
            <span className="font-semibold text-emerald-300">Nâng cấp{def.upgrade.cost !== undefined ? ` (${def.upgrade.cost} Ops)` : ''}:</span> {def.upgrade.text}
          </p>
        )}
        {usedBy.length > 0 && <p className="text-muted-foreground">Bị nhét vào bởi: {usedBy.map((e) => e.name).join(', ')}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- relics

function RelicsTab() {
  const order = ['common', 'uncommon', 'rare', 'boss'];
  const relics = [...CONTENT.relics].sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name, 'vi'));
  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-wrap justify-center gap-4">
        {relics.map((r) => (
          <RelicTile key={r.id} relic={r} />
        ))}
      </div>
    </div>
  );
}
