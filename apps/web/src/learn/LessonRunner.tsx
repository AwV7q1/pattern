import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Check, Dumbbell, Flame, FlaskConical, Loader2, Wrench, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { compute } from '@/sim/compute';
import type { Card, KnobValue, Lesson, Metric } from './types';
import { SequenceAnim } from './SequenceAnim';
import { FixCard, defaultValues, type Attempt } from './FixCard';
import { applyKnobs, formatMetric, goalMet, goalText, trapsHit } from './fix';
import { GlossaryButton, Glossed, glossify } from './Glossary';

// ---------------------------------------------------------------- markdown-lite

/** `seen`: glossary terms already underlined in this block (each term once). */
function inline(text: string, seen: Set<string>): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') ? (
      <b key={i} className="text-foreground">
        {glossify(part.slice(2, -2), seen)}
      </b>
    ) : part.startsWith('`') ? (
      <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
        {part.slice(1, -1)}
      </code>
    ) : (
      <Fragment key={i}>{glossify(part, seen)}</Fragment>
    ),
  );
}

/** Paragraphs separated by blank lines, `- ` bullets, **bold**, `code`. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const seen = new Set<string>();
  return (
    <div className={cn('grid gap-3 text-[15px] leading-relaxed text-muted-foreground', className)}>
      {text.split('\n\n').map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => l.startsWith('- ')))
          return (
            <ul key={i} className="grid list-disc gap-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2), seen)}</li>
              ))}
            </ul>
          );
        const head = lines.filter((l) => !l.startsWith('- '));
        const bullets = lines.filter((l) => l.startsWith('- '));
        return (
          <div key={i} className="grid gap-1">
            {head.map((l, j) => (
              <p key={j}>{inline(l, seen)}</p>
            ))}
            {bullets.length > 0 && (
              <ul className="grid list-disc gap-1 pl-5">
                {bullets.map((l, j) => (
                  <li key={j}>{inline(l.slice(2), seen)}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function shuffled<T>(items: T[]): T[] {
  if (items.length < 2) return items;
  for (;;) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (a.some((v, i) => v !== items[i])) return a;
  }
}

const METRIC: Record<Metric, (v: number) => string> = {
  p50Ms: (v) => `p50 = ${v.toFixed(1)} ms`,
  p99Ms: (v) => `p99 = ${v.toFixed(1)} ms`,
  errorRate: (v) => `tỉ lệ lỗi = ${(v * 100).toFixed(1)}%`,
  throughputRps: (v) => `throughput = ${Math.round(v)} rps`,
};

type Verdict = { correct: boolean; detail?: string } | null;

function OptionButton({
  children,
  selected,
  state,
  onClick,
  disabled,
}: {
  children: ReactNode;
  selected: boolean;
  state?: 'right' | 'wrong';
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border-2 border-b-4 px-4 py-3 text-left text-[15px] transition-colors',
        'hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent',
        selected && 'border-sky-400 bg-sky-400/10',
        state === 'right' && 'border-emerald-400 bg-emerald-400/10',
        state === 'wrong' && 'border-red-400 bg-red-400/10',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- runner

interface Props {
  lesson: Lesson & { unit: { title: string; color: string } };
  streakDays: number;
  onExit: () => void;
  /** Lesson finished; returns the XP awarded. */
  onComplete: (accuracy: number) => number;
  onBuild: (level: string) => void;
  /** Stable key per card (spaced repetition); defaults to `lessonId#index`. */
  keys?: string[];
  /** First answer to each question card in this session. */
  onAnswer?: (key: string, correct: boolean) => void;
}

/**
 * Plays a lesson one card at a time. Questions answered wrong are queued
 * again at the end (once), like Duolingo; the lesson ends when the queue is
 * empty.
 */
export function LessonRunner({ lesson, streakDays, onExit, onComplete, onBuild, keys, onAnswer }: Props) {
  const [queue, setQueue] = useState(() => lesson.cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [retried, setRetried] = useState<Set<number>>(new Set());
  const [finished, setFinished] = useState<{ xp: number; accuracy: number } | null>(null);
  const [answered, setAnswered] = useState<Set<number>>(new Set());
  // `fix` card state, reset per card
  const [fixValues, setFixValues] = useState<Record<string, KnobValue> | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const banks = useMemo(
    () => lesson.cards.map((c) => (c.type === 'order' ? shuffled(c.items) : [])),
    [lesson],
  );

  const index = queue[pos];
  const card: Card | undefined = lesson.cards[index];
  const questions = lesson.cards.filter((c) => c.type !== 'read' && c.type !== 'build').length;
  const pct = finished ? 100 : (pos / queue.length) * 100;

  const next = () => {
    let q = queue;
    if (verdict && !verdict.correct && !retried.has(index)) {
      q = [...queue, index];
      setRetried(new Set(retried).add(index));
      setQueue(q);
    }
    setVerdict(null);
    setChoice(null);
    setOrder([]);
    setFixValues(null);
    setAttempts([]);
    if (pos + 1 >= q.length) {
      const accuracy = questions ? Math.max(0, (questions - mistakes) / questions) : 1;
      setFinished({ xp: onComplete(accuracy), accuracy });
    } else setPos(pos + 1);
  };

  const judge = (correct: boolean, detail?: string) => {
    if (!correct) setMistakes((m) => m + 1);
    setVerdict({ correct, detail });
    if (!answered.has(index)) {
      setAnswered(new Set(answered).add(index));
      onAnswer?.(keys?.[index] ?? `${lesson.id}#${index}`, correct);
    }
  };

  const values = card?.type === 'fix' ? (fixValues ?? defaultValues(card)) : {};
  /** Run the edited design of a `fix` card and record the attempt. */
  const tryFix = async () => {
    if (card?.type !== 'fix') return null;
    setRunning(true);
    try {
      const summary = await compute.run(applyKnobs(card.sim, card.knobs, values));
      setAttempts((a) => [...a, { values, summary }]);
      return summary;
    } finally {
      setRunning(false);
    }
  };

  const check = async () => {
    if (!card) return;
    if (card.type === 'choice' && choice !== null) judge(choice === card.answer);
    else if (card.type === 'order') judge(order.every((v, i) => v === card.items[i]));
    else if (card.type === 'predict' && choice !== null) {
      setRunning(true);
      try {
        const summary = await compute.run(card.sim);
        const v = summary[card.metric];
        const o = card.options[choice];
        const right = card.options.findIndex((x) => v >= x.min && v < x.max);
        judge(v >= o.min && v < o.max, `Simulator đo được ${METRIC[card.metric](v)}: "${card.options[right]?.label ?? '?'}".`);
      } catch (err) {
        judge(false, `Không chạy được mô phỏng: ${err instanceof Error ? err.message : err}`);
      } finally {
        setRunning(false);
      }
    } else if (card.type === 'fix') {
      try {
        const summary = await tryFix();
        if (!summary) return;
        const m = summary as unknown as Record<string, number>;
        const parts = card.goals.map((g) => `${goalText(g)}: đo được ${formatMetric(g.metric, m[g.metric])} ${goalMet(g, m) ? '✓' : '✗'}`);
        const traps = trapsHit(card.knobs, values);
        if (traps.length) judge(false, `${parts.join(' · ')}. Đạt số liệu nhưng sai thiết kế: ${traps.map((k) => k.trap!.why).join(' ')}`);
        else judge(card.goals.every((g) => goalMet(g, m)), parts.join(' · '));
      } catch (err) {
        judge(false, `Không chạy được mô phỏng: ${err instanceof Error ? err.message : err}`);
      }
    }
  };

  if (finished) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex size-24 items-center justify-center rounded-full bg-warning/15 text-warning">
          <Zap className="size-12 fill-warning" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Hoàn thành bài học!</h2>
          <p className="mt-1 text-muted-foreground">{lesson.title}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Tile label="XP" value={`+${finished.xp}`} tone="text-warning" />
          <Tile label="Chính xác" value={`${Math.round(finished.accuracy * 100)}%`} tone="text-emerald-400" />
          <Tile label="Chuỗi ngày" value={<span className="inline-flex items-center gap-1"><Flame className="size-5 text-orange-400" />{Math.max(1, streakDays)}</span>} tone="text-orange-400" />
        </div>
        <Button size="lg" className="w-56" onClick={onExit}>
          Tiếp tục
        </Button>
      </div>
    );
  }
  if (!card) return null;

  const canCheck =
    (card.type === 'choice' && choice !== null) ||
    (card.type === 'predict' && choice !== null) ||
    (card.type === 'order' && order.length === card.items.length) ||
    card.type === 'fix';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* top bar */}
      <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-6 pt-6">
        <button type="button" onClick={onExit} className="text-muted-foreground hover:text-foreground" title="Thoát">
          <X className="size-6" />
        </button>
        <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        {retried.size > 0 && <span className="text-xs text-muted-foreground">ôn lại {retried.size}</span>}
        <GlossaryButton className="text-muted-foreground hover:text-foreground" />
      </div>

      {/* card */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-3xl gap-5 px-6 py-8">
          <div className="text-xs font-semibold tracking-wide uppercase" style={{ color: lesson.unit.color }}>
            {lesson.unit.title} · {lesson.title}
          </div>

          {card.type === 'read' && (
            <>
              <h2 className="text-2xl font-bold">{card.title}</h2>
              {card.anim && <SequenceAnim spec={card.anim} />}
              <Prose text={card.body} />
            </>
          )}

          {card.type === 'choice' && (
            <>
              <h2 className="text-xl font-bold"><Glossed text={card.question} /></h2>
              {card.anim && <SequenceAnim spec={card.anim} />}
              <div className="grid gap-2">
                {card.options.map((o, i) => (
                  <OptionButton
                    key={i}
                    selected={choice === i}
                    disabled={!!verdict}
                    state={verdict ? (i === card.answer ? 'right' : choice === i ? 'wrong' : undefined) : undefined}
                    onClick={() => setChoice(i)}
                  >
                    {o}
                  </OptionButton>
                ))}
              </div>
            </>
          )}

          {card.type === 'predict' && (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
                <FlaskConical className="size-4" /> Đoán trước, simulator kiểm chứng
              </div>
              <h2 className="text-xl font-bold"><Glossed text={card.question} /></h2>
              <div className="grid grid-cols-2 gap-2">
                {card.options.map((o, i) => (
                  <OptionButton
                    key={i}
                    selected={choice === i}
                    disabled={!!verdict || running}
                    state={verdict && choice === i ? (verdict.correct ? 'right' : 'wrong') : undefined}
                    onClick={() => setChoice(i)}
                  >
                    {o.label}
                  </OptionButton>
                ))}
              </div>
            </>
          )}

          {card.type === 'order' && (
            <>
              <h2 className="text-xl font-bold"><Glossed text={card.question} /></h2>
              <div className="grid min-h-[3.5rem] gap-2 rounded-xl border-2 border-dashed p-2">
                {order.length === 0 && <span className="p-2 text-sm text-muted-foreground">Bấm các bước bên dưới theo thứ tự…</span>}
                {order.map((item, i) => (
                  <button
                    key={item}
                    type="button"
                    disabled={!!verdict}
                    onClick={() => setOrder(order.filter((x) => x !== item))}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border-2 border-b-4 bg-card px-3 py-2 text-left text-sm',
                      verdict && (card.items[i] === item ? 'border-emerald-400' : 'border-red-400'),
                    )}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">{i + 1}</span>
                    {item}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {banks[index]
                  .filter((item) => !order.includes(item))
                  .map((item) => (
                    <button
                      key={item}
                      type="button"
                      disabled={!!verdict}
                      onClick={() => setOrder([...order, item])}
                      className="rounded-lg border-2 border-b-4 px-3 py-2 text-sm hover:bg-muted/50"
                    >
                      {item}
                    </button>
                  ))}
              </div>
            </>
          )}

          {card.type === 'fix' && (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
                <Wrench className="size-4" /> Sửa design, simulator chấm
              </div>
              <h2 className="text-xl font-bold"><Glossed text={card.question} /></h2>
              <FixCard
                card={card}
                values={values}
                onChange={setFixValues}
                attempts={attempts}
                onTry={() => void tryFix().catch(() => {})}
                busy={running}
                locked={!!verdict}
              />
            </>
          )}

          {card.type === 'build' && (
            <div className="grid justify-items-center gap-5 py-6 text-center">
              <div className="flex size-20 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Dumbbell className="size-10" />
              </div>
              <h2 className="text-2xl font-bold">Thực hành trên canvas</h2>
              <p className="max-w-lg text-muted-foreground">
                <Glossed text={card.intro} />
              </p>
              <p className="text-xs text-muted-foreground">Đạt ít nhất 1★ khi chấm điểm để hoàn thành bài này.</p>
              <Button size="lg" onClick={() => onBuild(card.level)}>
                Mở bài thực hành
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* bottom bar */}
      {card.type !== 'build' && (
        <div
          className={cn(
            'border-t-2',
            verdict?.correct === true && 'border-emerald-400/40 bg-emerald-400/10',
            verdict?.correct === false && 'border-red-400/40 bg-red-400/10',
          )}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-6 py-5">
            {verdict ? (
              <div className="flex min-w-0 flex-1 gap-3">
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-full',
                    verdict.correct ? 'bg-emerald-400 text-emerald-950' : 'bg-red-400 text-red-950',
                  )}
                >
                  {verdict.correct ? <Check className="size-6" /> : <X className="size-6" />}
                </span>
                <div className="min-w-0">
                  <div className={cn('font-bold', verdict.correct ? 'text-emerald-400' : 'text-red-400')}>
                    {verdict.correct ? 'Chính xác!' : 'Chưa đúng'}
                  </div>
                  {verdict.detail && <p className="text-sm">{verdict.detail}</p>}
                  {'explain' in card && (
                    <p className="text-sm text-muted-foreground">
                      <Glossed text={card.explain} />
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1" />
            )}
            {card.type === 'read' ? (
              <Button size="lg" className="w-40" onClick={next}>
                Tiếp tục
              </Button>
            ) : verdict ? (
              <Button size="lg" className="w-40" variant={verdict.correct ? 'default' : 'destructive'} onClick={next}>
                Tiếp tục
              </Button>
            ) : (
              <Button size="lg" className="w-40" disabled={!canCheck || running} onClick={check}>
                {running ? <Loader2 className="animate-spin" /> : null}
                {card.type === 'predict' ? (running ? 'Đang chạy…' : 'Chạy mô phỏng') : card.type === 'fix' && running ? 'Đang chạy…' : 'Kiểm tra'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: ReactNode; tone: string }) {
  return (
    <div className="w-28 rounded-xl border-2 p-3">
      <div className="text-[12px] font-semibold text-muted-foreground uppercase">{label}</div>
      <div className={cn('text-2xl font-bold', tone)}>{value}</div>
    </div>
  );
}
