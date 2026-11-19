import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Check, Coffee, Crown, HeartPulse, LibraryBig, Plus, RotateCcw, Skull, Swords, Trash2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUi } from '@/app/ui-store';
import { CONTENT, loadRun, saveRun } from './content';
import { battleSeed, battleSetup, currentFloor, finishBattle, newRun, pickReward, rest } from './run';
import { cardDef } from './rules';
import type { RunState } from './types';
import { CardBattle } from './CardBattle';
import { CardFace } from './Hand';
import { CardLibrary } from './CardLibrary';
import { NetBackdrop } from './NetBackdrop';

const randomSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

/**
 * A run ("ca trực"): fights chained by `run.ts`, with a reward after each won
 * fight and a rest stop. The run is saved in localStorage between screens.
 */
export function CardRun() {
  const [run, setRun] = useState<RunState>(() => loadRun() ?? newRun(CONTENT, randomSeed()));
  useEffect(() => saveRun(run), [run]);

  // a game screen: the app's tab bar steps aside
  const setImmersive = useUi((s) => s.setImmersive);
  useEffect(() => {
    setImmersive(true);
    return () => setImmersive(false);
  }, [setImmersive]);

  const startNew = () => setRun(newRun(CONTENT, randomSeed()));
  const floor = currentFloor(CONTENT, run);

  if (run.phase === 'battle' && floor?.kind === 'battle') {
    const last = run.floor === CONTENT.run.floors.length - 1;
    return (
      <CardBattle
        key={`${run.seed}:${run.floor}`}
        seed={battleSeed(run)}
        setup={battleSetup(CONTENT, run)}
        title={floor.title}
        progress={<RunMap run={run} compact />}
        deck={run.deck}
        continueLabel={last ? 'Kết thúc ca trực' : 'Nhận thưởng'}
        onFinish={(battle) => setRun((r) => finishBattle(CONTENT, r, battle))}
        onAbandon={startNew}
      />
    );
  }

  return (
    <RunScreen run={run} onNew={startNew}>
      {run.phase === 'reward' && <RewardScreen run={run} onPick={(id) => setRun((r) => pickReward(CONTENT, r, id))} />}
      {run.phase === 'rest' && <RestScreen run={run} onChoose={(c) => setRun((r) => rest(CONTENT, r, c))} />}
      {(run.phase === 'won' || run.phase === 'lost') && <RunEnd run={run} onNew={startNew} />}
    </RunScreen>
  );
}

// ---------------------------------------------------------------- shell

function RunScreen({ run, onNew, children }: { run: RunState; onNew: () => void; children: React.ReactNode }) {
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
        <RunMap run={run} />
        <div className="ml-auto flex items-center gap-2">
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
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
      {showLibrary && <CardLibrary cards={CONTENT.cards} deck={run.deck} onClose={() => setShowLibrary(false)} />}
    </div>
  );
}

/** The run's floors as a row of steps: done, current, coming. */
function RunMap({ run, compact }: { run: RunState; compact?: boolean }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Tiến độ ca trực">
      {CONTENT.run.floors.map((f, i) => {
        const done = i < run.floor || (i === run.floor && (run.phase === 'reward' || run.phase === 'won'));
        const now = i === run.floor && !done;
        const lostHere = now && run.phase === 'lost';
        const Icon = f.kind === 'rest' ? Coffee : f.kind === 'battle' && f.boss ? Crown : Swords;
        const name = f.kind === 'battle' ? (CONTENT.enemies.find((e) => e.id === f.enemy)?.name ?? f.title) : f.title;
        return (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span className={cn('h-px w-3', i <= run.floor ? 'bg-amber-300/60' : 'bg-border')} />}
            <span
              title={name}
              aria-current={now ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]',
                lostHere
                  ? 'border-rose-400/60 bg-rose-500/15 text-rose-300'
                  : now
                    ? 'border-amber-300/70 bg-amber-400/15 text-amber-200'
                    : done
                      ? 'border-emerald-400/40 text-emerald-300'
                      : 'border-border text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3" /> : <Icon className="size-3" />}
              {!compact && <span className="max-w-[9rem] truncate">{name}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- reward

function RewardScreen({ run, onPick }: { run: RunState; onPick: (id: string | null) => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const last = run.history.at(-1);
  const enemy = CONTENT.enemies.find((e) => e.id === last?.enemy);
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6">
      <div className="text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-2xl font-bold">
          <Trophy className="size-6 text-amber-300" /> Thắng {enemy?.name ?? 'trận'}
        </div>
        <p className="text-sm text-muted-foreground">
          {last ? `${last.turns} lượt, mất ${last.hpLost} Error Budget. ` : ''}Chọn 1 lá thêm vào bộ bài, hoặc bỏ qua để giữ bộ bài gọn.
        </p>
      </div>
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

function RestScreen({ run, onChoose }: { run: RunState; onChoose: (c: { heal: true } | { remove: number }) => void }) {
  const [mode, setMode] = useState<'pick' | 'remove'>('pick');
  const [chosen, setChosen] = useState<string | null>(null);
  const heal = Math.min(run.maxHp - run.hp, Math.ceil(run.maxHp * CONTENT.run.restHeal));
  const canRemove = run.deck.length > CONTENT.battle.handSize;
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of run.deck) m.set(id, (m.get(id) ?? 0) + 1);
    return [...m.entries()].map(([id, n]) => ({ def: cardDef(CONTENT, id), n })).sort((a, b) => a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name, 'vi'));
  }, [run.deck]);

  if (mode === 'remove') {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col items-center gap-5">
        <div className="text-center">
          <div className="mb-1 text-xl font-bold">Bỏ 1 lá khỏi bộ bài</div>
          <p className="text-sm text-muted-foreground">Bộ bài gọn hơn thì rút được lá mạnh thường xuyên hơn.</p>
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
                <div className={cn('h-[224px] w-[160px] rounded-2xl', on && 'ring-2 ring-rose-400 ring-offset-2 ring-offset-background')}>
                  <CardFace def={def} playable={!on} />
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">×{n}</span>
              </button>
            );
          })}
        </div>
        <div className="sticky bottom-0 flex gap-2 rounded-xl border bg-card/90 p-2 backdrop-blur">
          <Button variant="destructive" disabled={!chosen} onClick={() => chosen && onChoose({ remove: run.deck.indexOf(chosen) })}>
            <Trash2 /> Bỏ {chosen ? cardDef(CONTENT, chosen).name : 'lá đã chọn'}
          </Button>
          <Button variant="outline" onClick={() => setMode('pick')}>
            Quay lại
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 pt-6">
      <div className="text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-2xl font-bold">
          <Coffee className="size-6 text-amber-300" /> Nghỉ giữa ca
        </div>
        <p className="text-sm text-muted-foreground">Trận cuối sắp tới. Chọn một việc.</p>
      </div>
      <div className="grid w-full gap-4 sm:grid-cols-2">
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
          text={canRemove ? 'Dọn bộ bài: bỏ một lá yếu hoặc không hợp với trận cuối.' : `Bộ bài cần ít nhất ${CONTENT.battle.handSize + 1} lá.`}
          disabled={!canRemove}
          onClick={() => setMode('remove')}
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

// ---------------------------------------------------------------- end of run

function RunEnd({ run, onNew }: { run: RunState; onNew: () => void }) {
  const won = run.phase === 'won';
  const fights = run.history.filter((h) => h.enemy);
  const turns = fights.reduce((s, h) => s + h.turns, 0);
  const added = run.deck.length - CONTENT.battle.startingDeck.length;
  return (
    <div className="mx-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-2xl">
      <div className="mb-2 flex items-center gap-2 text-2xl font-bold">
        {won ? <Trophy className="size-7 text-amber-300" /> : <Skull className="size-7 text-rose-400" />}
        {won ? 'Hết ca trực, hệ thống vẫn sống' : 'Ca trực thất bại'}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        {won
          ? `Bạn qua ${fights.length} trận trong ${turns} lượt và còn ${run.hp}/${run.maxHp} Error Budget.`
          : `Hết Error Budget ở trận ${fights.length}. Mỗi ca mới là một seed mới: bộ bài, phần thưởng và bài trên tay đều khác.`}
      </p>
      <ol className="mb-5 space-y-1.5 text-sm">
        {run.history.map((h, i) => {
          const enemy = CONTENT.enemies.find((e) => e.id === h.enemy);
          return (
            <li key={i} className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5">
              {h.enemy ? (
                <>
                  {h.won ? <Check className="size-4 text-emerald-300" /> : <Skull className="size-4 text-rose-400" />}
                  <span className="font-medium">{enemy?.name ?? h.enemy}</span>
                  <span className="text-muted-foreground">
                    {h.turns} lượt · −{h.hpLost}
                  </span>
                  {h.picked && <span className="ml-auto text-xs text-amber-200">+ {cardDef(CONTENT, h.picked).name}</span>}
                </>
              ) : (
                <>
                  <Coffee className="size-4 text-amber-300" />
                  <span className="font-medium">Nghỉ</span>
                  <span className="text-muted-foreground">{h.healed !== undefined ? `+${h.healed} máu` : h.removed ? `bỏ ${cardDef(CONTENT, h.removed).name}` : ''}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
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
