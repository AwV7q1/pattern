import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowUp, CircleHelp, Coffee, Coins, Crown, HeartPulse, LibraryBig, Medal, Plus, RotateCcw, Skull, Store, Trash2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUi } from '@/app/ui-store';
import { CONTENT, loadBest, loadRun, recordRun, saveRun } from './content';
import type { Best } from './content';
import {
  actHealOf,
  battleSeed,
  battleSetup,
  battleTitle,
  bossOf,
  buy,
  canRemove,
  chooseEvent,
  chooseNode,
  currentEvent,
  currentNode,
  finishBattle,
  leaveShop,
  newRun,
  nextAct,
  pickReward,
  removePriceOf,
  rest,
  shopRemove,
  stepsPerAct,
} from './run';
import { canUpgrade, cardDef } from './rules';
import type { FloorResult, RestChoice, RunState } from './types';
import { CardBattle } from './CardBattle';
import { CardFace } from './Hand';
import { CardLibrary } from './CardLibrary';
import { NetBackdrop } from './NetBackdrop';
import { RelicBar, RelicTile } from './Relics';
import { NODE_INFO, TowerMap } from './TowerMap';

const randomSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

/**
 * A run: climbing the tower floor by floor (`run.ts`, `map.ts`). The player
 * picks a path on each floor's map; the run is saved in localStorage.
 */
export function CardRun() {
  const [run, setRun] = useState<RunState>(() => loadRun() ?? newRun(CONTENT, randomSeed()));
  useEffect(() => saveRun(run), [run]);

  // count a finished run once, and keep the records shown on screen
  const [best, setBest] = useState<{ best: Best; record: boolean }>(() => ({ best: loadBest(), record: false }));
  useEffect(() => {
    if (run.phase === 'won' || run.phase === 'lost') setBest(recordRun(run));
  }, [run]);

  // a game screen: the app's tab bar steps aside
  const setImmersive = useUi((s) => s.setImmersive);
  useEffect(() => {
    setImmersive(true);
    return () => setImmersive(false);
  }, [setImmersive]);

  const startNew = () => setRun(newRun(CONTENT, randomSeed()));
  const node = currentNode(CONTENT, run);

  if (run.phase === 'battle' && node) {
    const boss = node.kind === 'boss';
    return (
      <CardBattle
        key={`${run.seed}:${run.act}:${run.climbed}`}
        seed={battleSeed(run)}
        setup={battleSetup(CONTENT, run)}
        title={battleTitle(CONTENT, run)}
        progress={<Progress run={run} />}
        deck={run.deck}
        continueLabel={boss ? (run.act >= CONTENT.run.acts ? 'Hoàn thành tháp' : 'Lên tầng') : 'Nhận thưởng'}
        onFinish={(battle) => setRun((r) => finishBattle(CONTENT, r, battle))}
        onAbandon={startNew}
      />
    );
  }

  return (
    <RunScreen run={run} best={best.best} onNew={startNew}>
      {run.phase === 'map' && <TowerMap content={CONTENT} run={run} onChoose={(id) => setRun((r) => chooseNode(CONTENT, r, id))} />}
      {run.phase === 'reward' && <RewardScreen run={run} onPick={(id) => setRun((r) => pickReward(CONTENT, r, id))} />}
      {run.phase === 'rest' && <RestScreen run={run} onChoose={(c) => setRun((r) => rest(CONTENT, r, c))} />}
      {run.phase === 'shop' && <ShopScreen run={run} setRun={setRun} />}
      {run.phase === 'event' && <EventScreen run={run} onChoose={(o, i) => setRun((r) => chooseEvent(CONTENT, r, o, i))} />}
      {run.phase === 'cleared' && <ActClear run={run} onClimb={(relic) => setRun((r) => nextAct(CONTENT, r, relic))} />}
      {(run.phase === 'won' || run.phase === 'lost') && <RunEnd run={run} best={best.best} record={best.record} onNew={startNew} />}
    </RunScreen>
  );
}

// ---------------------------------------------------------------- shell

function RunScreen({ run, best, onNew, children }: { run: RunState; best: Best; onNew: () => void; children: React.ReactNode }) {
  const [showLibrary, setShowLibrary] = useState(false);
  const over = run.phase === 'won' || run.phase === 'lost';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowLibrary(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-clip">
      <NetBackdrop />
      <div className="relative z-30 flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <Button size="sm" variant="ghost" asChild>
          <Link to="/play">
            <ArrowLeft /> Thoát
          </Link>
        </Button>
        <span className="font-semibold">{CONTENT.run.title}</span>
        <Progress run={run} />
        {best.runs > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" title={`${best.runs} ca đã chơi, xa nhất ${best.bestClimbed} bậc`}>
            <Medal className="size-3.5 text-amber-300" /> Thắng tháp {best.wins}/{best.runs}
          </span>
        )}
        <RelicBar relics={CONTENT.relics} ids={run.relics} />
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1 text-yellow-300" title="Vàng: tiêu ở cửa hàng">
            <Coins className="size-4" /> {run.gold}
          </span>
          <span className="flex items-center gap-1 text-rose-300">
            <HeartPulse className="size-4" /> {run.hp}/{run.maxHp}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setShowLibrary(true)}>
            <LibraryBig /> Bộ bài ({run.deck.length})
          </Button>
          {!over && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (window.confirm('Bỏ ca trực này và bắt đầu ca mới? Tiến độ hiện tại sẽ mất.')) onNew();
              }}
            >
              <RotateCcw /> Ca mới
            </Button>
          )}
        </div>
      </div>
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
      {showLibrary && <CardLibrary cards={CONTENT.cards} deck={run.deck} onClose={() => setShowLibrary(false)} />}
    </div>
  );
}

/** "Tầng 2/3 · Bậc 4/9", with a tag for elites and bosses. */
function Progress({ run }: { run: RunState }) {
  const node = currentNode(CONTENT, run);
  const step = node ? node.row + 1 : 0;
  const tagged = node && (node.kind === 'elite' || node.kind === 'boss') ? node : null;
  const Icon = tagged ? NODE_INFO[tagged.kind].icon : null;
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground" aria-label="Tiến độ leo tháp">
      <span className="font-medium text-foreground">
        Tầng {run.act}/{CONTENT.run.acts}
      </span>
      <span>·</span>
      <span>
        Bậc {step}/{stepsPerAct(CONTENT)}
      </span>
      {tagged && Icon && (
        <span className={cn('flex items-center gap-0.5 rounded-full border px-1.5', NODE_INFO[tagged.kind].tone)}>
          <Icon className="size-3" /> {tagged.kind === 'boss' ? 'Trùm' : 'Tinh anh'}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- reward

function RewardScreen({ run, onPick }: { run: RunState; onPick: (id: string | null) => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const last = run.history.at(-1);
  const fromEvent = last?.kind === 'event';
  const enemy = CONTENT.enemies.find((e) => e.id === last?.enemy);
  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center gap-6">
      <div className="text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-2xl font-bold">
          <Trophy className="size-6 text-amber-300" /> {fromEvent ? 'Chọn công cụ mới' : `Thắng ${last?.kind === 'elite' ? 'tinh anh ' : ''}${enemy?.name ?? 'trận'}`}
        </div>
        <p className="text-sm text-muted-foreground">
          {last && !fromEvent ? `${last.turns} lượt, mất ${last.hpLost} Error Budget${last.gold ? `, +${last.gold} vàng` : ''}. ` : ''}
          {last?.kind === 'elite' ? `+${CONTENT.run.elite.maxHp} Error Budget tối đa. ` : ''}
          Chọn 1 lá thêm vào bộ bài, hoặc bỏ qua để giữ bộ bài gọn.
        </p>
      </div>
      {last?.relic && !fromEvent && (() => {
        const relic = CONTENT.relics.find((r) => r.id === last.relic);
        return relic ? (
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-amber-300">Nhận relic</span>
            <RelicTile relic={relic} />
          </div>
        ) : null;
      })()}
      <div className="flex flex-wrap justify-center gap-5">
        {run.reward.map((id) => {
          const def = cardDef(CONTENT, id);
          const owned = run.deck.filter((d) => d === id).length;
          const on = chosen === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => setChosen(on ? null : id)}
              className={cn('flex flex-col items-center gap-2 rounded-2xl outline-none transition-transform duration-200 focus-visible:ring-2 focus-visible:ring-amber-300', on ? '-translate-y-2' : 'hover:-translate-y-1')}
            >
              <div className={cn('h-[300px] w-[176px] rounded-2xl', on && 'ring-2 ring-amber-300 ring-offset-2 ring-offset-background')}>
                <CardFace def={def} playable glowing={on} lesson />
              </div>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px]', owned ? 'bg-amber-400/15 text-amber-200' : 'bg-muted text-muted-foreground')}>
                {owned ? `Đang có ×${owned}` : 'Lá mới'}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
          <Plus /> Thêm vào bộ
        </Button>
        <Button variant="outline" onClick={() => onPick(null)}>
          Bỏ qua
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rest

/** Pick one card of the deck to remove (rest stops, events) or to upgrade (rest stops: the chosen card shows its upgrade). */
function DeckPicker({
  run,
  title,
  text,
  upgrade,
  onConfirm,
  onBack,
}: {
  run: RunState;
  title: string;
  text: string;
  upgrade?: boolean;
  onConfirm: (index: number) => void;
  onBack: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of run.deck) if (!upgrade || canUpgrade(CONTENT, id)) m.set(id, (m.get(id) ?? 0) + 1);
    return [...m.entries()].map(([id, n]) => ({ def: cardDef(CONTENT, id), n })).sort((a, b) => a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name, 'vi'));
  }, [run.deck, upgrade]);
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col items-center gap-5">
      <div className="text-center">
        <div className="mb-1 text-xl font-bold">{title}</div>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(160px,1fr))] justify-items-center gap-4">
        {groups.map(({ def, n }) => {
          const on = chosen === def.id;
          return (
            <button
              key={def.id}
              type="button"
              aria-pressed={on}
              onClick={() => setChosen(on ? null : def.id)}
              className={cn('flex flex-col items-center gap-1.5 rounded-2xl outline-none transition-transform focus-visible:ring-2 focus-visible:ring-rose-300', on ? '-translate-y-1' : 'hover:-translate-y-0.5')}
            >
              <div className={cn('h-[224px] w-[160px] rounded-2xl', on && (upgrade ? 'ring-2 ring-emerald-400' : 'ring-2 ring-rose-400'), on && 'ring-offset-2 ring-offset-background')}>
                {upgrade ? <CardFace def={on ? cardDef(CONTENT, `${def.id}+`) : def} playable glowing={on} /> : <CardFace def={def} playable={!on} />}
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">×{n}</span>
            </button>
          );
        })}
      </div>
      <div className="sticky bottom-0 flex gap-2 rounded-xl border bg-card/90 p-2 backdrop-blur">
        {upgrade ? (
          <Button disabled={!chosen} onClick={() => chosen && onConfirm(run.deck.indexOf(chosen))}>
            <ArrowUp /> Nâng cấp {chosen ? cardDef(CONTENT, chosen).name : 'lá đã chọn'}
          </Button>
        ) : (
          <Button variant="destructive" disabled={!chosen} onClick={() => chosen && onConfirm(run.deck.indexOf(chosen))}>
            <Trash2 /> Bỏ {chosen ? cardDef(CONTENT, chosen).name : 'lá đã chọn'}
          </Button>
        )}
        <Button variant="outline" onClick={onBack}>
          Quay lại
        </Button>
      </div>
    </div>
  );
}

function RestScreen({ run, onChoose }: { run: RunState; onChoose: (c: RestChoice) => void }) {
  const [removing, setRemoving] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const upgradable = run.deck.some((id) => canUpgrade(CONTENT, id));
  const heal = Math.min(run.maxHp - run.hp, Math.ceil(run.maxHp * CONTENT.run.restHeal));
  const removable = canRemove(CONTENT, run, 0);
  const beforeBoss = currentNode(CONTENT, run)?.row === CONTENT.run.map.rows - 1;

  if (upgrading)
    return (
      <DeckPicker
        run={run}
        upgrade
        title="Nâng cấp 1 lá"
        text="Chọn một lá để xem bản nâng cấp. Bản nâng cấp giữ nguyên tới hết run."
        onConfirm={(i) => onChoose({ upgrade: i })}
        onBack={() => setUpgrading(false)}
      />
    );

  if (removing)
    return (
      <DeckPicker
        run={run}
        title="Bỏ 1 lá khỏi bộ bài"
        text="Bộ bài gọn hơn thì rút được lá mạnh thường xuyên hơn."
        onConfirm={(i) => onChoose({ remove: i })}
        onBack={() => setRemoving(false)}
      />
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 pt-6">
      <div className="text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-2xl font-bold">
          <Coffee className="size-6 text-amber-300" /> Nghỉ giữa ca
        </div>
        <p className="text-sm text-muted-foreground">{beforeBoss ? 'Trùm của tầng ở ngay phía trên. Chọn một việc.' : 'Chọn một việc trước khi leo tiếp.'}</p>
      </div>
      <div className="grid w-full gap-4 sm:grid-cols-3">
        <RestOption
          icon={<HeartPulse className="size-7 text-rose-300" />}
          title={`Hồi ${heal} Error Budget`}
          text={`Ngủ một giấc: ${run.hp} → ${run.hp + heal}/${run.maxHp}.`}
          disabled={heal === 0}
          onClick={() => onChoose({ heal: true })}
        />
        <RestOption
          icon={<Trash2 className="size-7 text-sky-300" />}
          title="Bỏ bớt 1 lá"
          text={removable ? 'Dọn bộ bài: bỏ một lá yếu hoặc Tech Debt.' : `Bộ bài cần ít nhất ${CONTENT.battle.handSize + 1} lá.`}
          disabled={!removable}
          onClick={() => setRemoving(true)}
        />
        <RestOption
          icon={<ArrowUp className="size-7 text-emerald-300" />}
          title="Nâng cấp 1 lá"
          text={upgradable ? 'Viết lại cho tốt hơn: lá mạnh hơn hoặc rẻ hơn.' : 'Mọi lá đã được nâng cấp.'}
          disabled={!upgradable}
          onClick={() => setUpgrading(true)}
        />
      </div>
    </div>
  );
}

function RestOption({ icon, title, text, disabled, onClick }: { icon: React.ReactNode; title: string; text: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border bg-card/80 p-6 text-center transition-colors hover:border-amber-300/60 hover:bg-card disabled:pointer-events-none disabled:opacity-50"
    >
      {icon}
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{text}</span>
    </button>
  );
}

// ---------------------------------------------------------------- shop

function ShopScreen({ run, setRun }: { run: RunState; setRun: React.Dispatch<React.SetStateAction<RunState>> }) {
  const [removing, setRemoving] = useState(false);
  const shop = run.shop;
  if (!shop) return null;
  const removePrice = removePriceOf(CONTENT, run);
  const canPayRemove = !shop.removed && removePrice <= run.gold && canRemove(CONTENT, run, 0);

  if (removing)
    return (
      <DeckPicker
        run={run}
        title={`Bỏ 1 lá khỏi bộ bài (${removePrice} vàng)`}
        text="Mỗi cửa hàng chỉ bỏ được 1 lá, và giá tăng sau mỗi lần dùng."
        onConfirm={(i) => {
          setRun((r) => shopRemove(CONTENT, r, i));
          setRemoving(false);
        }}
        onBack={() => setRemoving(false)}
      />
    );

  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
      <div className="text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-2xl font-bold">
          <Store className="size-6 text-yellow-300" /> Cửa hàng công cụ
        </div>
        <p className="text-sm text-muted-foreground">
          Bạn có <span className="font-mono text-yellow-200">{run.gold}</span> vàng. Mua lá, relic, hoặc trả tiền để bỏ bớt 1 lá.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-4">
        {shop.cards.map((c, i) => (
          <button
            key={`${c.id}:${i}`}
            type="button"
            disabled={c.sold || c.price > run.gold}
            onClick={() => setRun((r) => buy(CONTENT, r, { card: i }))}
            className="flex flex-col items-center gap-2 rounded-2xl outline-none transition-transform enabled:hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-yellow-300 disabled:cursor-not-allowed"
          >
            <div className={cn('h-[260px] w-[160px]', c.sold && 'opacity-30')}>
              <CardFace def={cardDef(CONTENT, c.id)} playable={!c.sold && c.price <= run.gold} />
            </div>
            <Price price={c.price} gold={run.gold} sold={c.sold} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-start justify-center gap-4">
        {shop.relics.map((r, i) => (
          <button
            key={r.id}
            type="button"
            disabled={r.sold || r.price > run.gold}
            onClick={() => setRun((x) => buy(CONTENT, x, { relic: i }))}
            className={cn('rounded-2xl outline-none transition-transform enabled:hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-yellow-300 disabled:cursor-not-allowed', r.sold && 'opacity-40')}
          >
            <RelicTile relic={CONTENT.relics.find((x) => x.id === r.id)!}>
              <Price price={r.price} gold={run.gold} sold={r.sold} />
            </RelicTile>
          </button>
        ))}
        <button
          type="button"
          disabled={!canPayRemove}
          onClick={() => setRemoving(true)}
          className="flex w-[220px] flex-col items-center gap-2 self-stretch rounded-2xl border bg-card/85 p-4 text-center outline-none transition-transform enabled:hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-yellow-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex size-14 items-center justify-center rounded-full border-2 border-sky-400/60 bg-background/70 text-sky-300">
            <Trash2 className="size-7" />
          </span>
          <span className="font-semibold">Dọn bộ bài</span>
          <span className="text-sm">{shop.removed ? 'Đã dùng ở cửa hàng này.' : 'Bỏ 1 lá khỏi bộ bài.'}</span>
          {!shop.removed && <Price price={removePrice} gold={run.gold} />}
        </button>
      </div>
      <Button size="lg" variant="outline" onClick={() => setRun((r) => leaveShop(CONTENT, r))}>
        <ArrowUp /> Rời cửa hàng
      </Button>
    </div>
  );
}

function Price({ price, gold, sold }: { price: number; gold: number; sold?: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs',
        sold ? 'bg-muted text-muted-foreground' : price <= gold ? 'bg-yellow-400/15 text-yellow-200' : 'bg-rose-500/10 text-rose-300',
      )}
    >
      {sold ? (
        'Đã mua'
      ) : (
        <>
          <Coins className="size-3" /> {price}
        </>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- event

function EventScreen({ run, onChoose }: { run: RunState; onChoose: (option: number, removeIndex?: number) => void }) {
  const [removingFor, setRemovingFor] = useState<number | null>(null);
  const event = currentEvent(CONTENT, run);
  if (!event) return null;

  if (removingFor !== null)
    return (
      <DeckPicker
        run={run}
        title={event.title}
        text={event.options[removingFor].label}
        onConfirm={(i) => onChoose(removingFor, i)}
        onBack={() => setRemovingFor(null)}
      />
    );

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 pt-6">
      <div className="text-center">
        <div className="mb-2 flex items-center justify-center gap-2 text-2xl font-bold">
          <CircleHelp className="size-6 text-violet-300" /> {event.title}
        </div>
        <p className="text-sm text-muted-foreground">{event.text}</p>
      </div>
      <div className="flex w-full flex-col gap-2">
        {event.options.map((o, i) => {
          const removes = o.effects.some((e) => e.op === 'removeCard');
          const blocked = removes && !canRemove(CONTENT, run, 0);
          return (
            <button
              key={i}
              type="button"
              disabled={blocked}
              onClick={() => (removes ? setRemovingFor(i) : onChoose(i))}
              className="rounded-xl border bg-card/80 px-4 py-3 text-left text-sm transition-colors hover:border-violet-300/60 hover:bg-card disabled:pointer-events-none disabled:opacity-50"
            >
              {o.label}
              {blocked && <span className="block text-xs text-muted-foreground">Bộ bài cần ít nhất {CONTENT.battle.handSize + 1} lá.</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- floor cleared

function ActClear({ run, onClimb }: { run: RunState; onClimb: (relic: string | null) => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const fights = run.history.filter((h) => h.act === run.act && h.turns > 0);
  const lost = fights.reduce((s, h) => s + h.hpLost, 0);
  const heal = actHealOf(CONTENT, run);
  const next = CONTENT.enemies.find((e) => e.id === bossOf(CONTENT, run.act + 1));
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 pt-8 text-center">
      <Crown className="size-12 text-amber-300" />
      <div>
        <div className="text-2xl font-bold">Vượt tầng {run.act}</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {fights.length} trận, mất tổng {lost} Error Budget. Đổi ca: hồi {heal} Error Budget ({run.hp} → {run.hp + heal}/{run.maxHp}).
        </p>
        <p className="mt-2 text-sm">
          Tầng {run.act + 1}: địch khoẻ hơn, trùm là <span className="font-semibold text-amber-200">{next?.name}</span>.
        </p>
      </div>
      {run.relicOffer.length > 0 && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">Phần thưởng trùm: chọn 1 relic mang theo tới hết run.</p>
          <div className="flex flex-wrap items-start justify-center gap-4">
            {run.relicOffer.map((id) => {
              const relic = CONTENT.relics.find((r) => r.id === id)!;
              const on = chosen === id;
              return (
                <button key={id} type="button" aria-pressed={on} onClick={() => setChosen(on ? null : id)} className="rounded-2xl outline-none transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-amber-300">
                  <RelicTile relic={relic} selected={on} />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <Button size="lg" disabled={run.relicOffer.length > 0 && !chosen} onClick={() => onClimb(chosen)}>
        <ArrowUp /> {chosen ? `Nhận ${CONTENT.relics.find((r) => r.id === chosen)?.name} và leo lên tầng ${run.act + 1}` : `Leo lên tầng ${run.act + 1}`}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- end of run

/** "Redis Cache, CDN, bỏ Buffer" */
const shopDetail = (h: FloorResult) =>
  [...(h.bought ?? []).map((id) => CONTENT.relics.find((r) => r.id === id)?.name ?? cardDef(CONTENT, id).name), h.removed && `bỏ ${cardDef(CONTENT, h.removed).name}`]
    .filter(Boolean)
    .join(', ') || 'không mua gì';

function HistoryRow({ h }: { h: FloorResult }) {
  const info = NODE_INFO[h.kind];
  const fell = h.turns > 0 && !h.won;
  const Icon = fell ? Skull : info.icon;
  const name =
    h.kind === 'rest'
      ? 'Nghỉ'
      : h.kind === 'shop'
        ? 'Cửa hàng'
        : h.kind === 'event'
          ? (CONTENT.events.find((e) => e.id === h.enemy)?.title ?? 'Sự cố')
          : (CONTENT.enemies.find((e) => e.id === h.enemy)?.name ?? h.enemy);
  const detail =
    h.kind === 'rest'
      ? h.healed !== undefined
        ? `+${h.healed} máu`
        : h.removed
          ? `bỏ ${cardDef(CONTENT, h.removed).name}`
          : h.upgraded
            ? `nâng cấp ${cardDef(CONTENT, h.upgraded).name}`
            : ''
      : h.kind === 'shop'
        ? shopDetail(h)
        : h.kind === 'event'
          ? (h.option ?? '')
          : `${h.kind === 'elite' ? 'tinh anh · ' : h.kind === 'boss' ? 'trùm · ' : ''}${h.turns} lượt · −${h.hpLost}`;
  return (
    <li className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5">
      <Icon className={cn('size-4 shrink-0', fell ? 'text-rose-400' : info.tone.split(' ')[0])} />
      <span className="shrink-0 font-medium">{name}</span>
      <span className="truncate text-muted-foreground" title={detail}>
        {detail}
      </span>
      {h.relic && <span className="ml-auto shrink-0 text-xs text-sky-200">relic {CONTENT.relics.find((r) => r.id === h.relic)?.name}</span>}
      {h.picked && <span className={cn('shrink-0 text-xs text-amber-200', !h.relic && 'ml-auto')}>+ {cardDef(CONTENT, h.picked).name}</span>}
    </li>
  );
}

function RunEnd({ run, best, record, onNew }: { run: RunState; best: Best; record: boolean; onNew: () => void }) {
  const won = run.phase === 'won';
  const fights = run.history.filter((h) => h.turns > 0);
  const turns = fights.reduce((s, h) => s + h.turns, 0);
  const added = run.deck.length - CONTENT.battle.startingDeck.length;
  const node = currentNode(CONTENT, run);
  const acts = [...new Set(run.history.map((h) => h.act))];
  return (
    <div className="mx-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-2xl">
      <div className="mb-2 flex items-center gap-2 text-2xl font-bold">
        {won ? <Trophy className="size-7 text-amber-300" /> : <Skull className="size-7 text-rose-400" />}
        {won ? `Chinh phục ${CONTENT.run.title}` : 'Ca trực thất bại'}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {won
          ? `Bạn vượt ${CONTENT.run.acts} tầng, ${fights.length} trận trong ${turns} lượt, còn ${run.hp}/${run.maxHp} Error Budget.`
          : `Hết Error Budget ở tầng ${run.act}, bậc ${node ? node.row + 1 : 0}. Mỗi ca mới là một seed mới: bản đồ, phần thưởng và bài trên tay đều khác.`}
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-amber-200">
          <Medal className="size-3.5" /> Thắng tháp {best.wins}/{best.runs} ca
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Xa nhất: {best.bestClimbed} bậc</span>
        {record && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">Kỷ lục mới!</span>}
      </div>
      <div className="mb-5 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
        {acts.map((a) => (
          <div key={a}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tầng {a}</div>
            <ol className="space-y-1 text-sm">
              {run.history
                .filter((h) => h.act === a)
                .map((h, i) => (
                  <HistoryRow key={i} h={h} />
                ))}
            </ol>
          </div>
        ))}
      </div>
      <div className="mb-4 flex justify-between text-xs text-muted-foreground">
        <span>
          Bộ bài cuối: {run.deck.length} lá ({added >= 0 ? '+' : ''}
          {added})
        </span>
        <span className="font-mono">seed {run.seed}</span>
      </div>
      <Button className="w-full" onClick={onNew}>
        <RotateCcw /> Ca trực mới
      </Button>
    </div>
  );
}
