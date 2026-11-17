import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Dumbbell, Flame, Lock, RotateCcw, Star, Target, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { LESSONS, UNITS, lessonXp } from './curriculum';
import { DAILY_GOAL, isUnlocked, nextLesson, streak, today, useProgress } from './progress';
import { LessonRunner } from './LessonRunner';

/** Horizontal offsets of the winding path, in px. */
const ZIGZAG = [0, 44, 72, 44, 0, -44, -72, -44];

interface Props {
  /** Open a practice level on the canvas for `lessonId`. */
  onBuild: (level: string, lessonId: string) => void;
  /** Lesson to open right away (coming back from a practice). */
  openLesson?: string | null;
  onOpened?: () => void;
}

/**
 * Duolingo-style learning path: units from beginner to advanced, lessons as
 * a winding trail (done / current / locked), daily goal and streak. Lessons
 * mix explanations with animated sequence diagrams, quizzes, ordering tasks,
 * predictions checked by the engine, and practice levels on the canvas.
 */
export function LearnPage({ onBuild, openLesson, onOpened }: Props) {
  const { progress, complete, setUnlockAll, reset } = useProgress();
  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const current = nextLesson(progress);
  const days = streak(progress);
  const todayXp = progress.days[today()] ?? 0;
  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openLesson) {
      setActive(openLesson);
      onOpened?.();
    }
  }, [openLesson, onOpened]);
  useEffect(() => {
    if (!active) currentRef.current?.scrollIntoView({ block: 'center' });
  }, [active]);

  const lesson = LESSONS.find((l) => l.id === active);
  if (lesson) {
    return (
      <LessonRunner
        key={lesson.id}
        lesson={lesson}
        streakDays={days || 1}
        onExit={() => setActive(null)}
        onComplete={(accuracy) => complete(lesson.id, accuracy === 1 && lesson.kind === 'learn' ? 5 : 0)}
        onBuild={(level) => onBuild(level, lesson.id)}
      />
    );
  }

  const done = LESSONS.filter((l) => progress.done[l.id]).length;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={() => setPicked(null)}>
        <div className="mx-auto grid max-w-xl gap-10 px-6 py-8">
          {UNITS.map((unit, u) => {
            const unitDone = unit.lessons.filter((l) => progress.done[l.id]).length;
            return (
              <section key={unit.id} className="grid gap-12">
                <div className="rounded-2xl border-b-4 p-4 text-white" style={{ background: unit.color, borderColor: 'rgb(0 0 0 / 0.25)' }}>
                  <div className="flex items-center justify-between text-xs font-bold tracking-wide uppercase opacity-90">
                    <span>
                      Phần {u + 1} · {unit.tier}
                    </span>
                    <span>
                      {unitDone}/{unit.lessons.length}
                    </span>
                  </div>
                  <h2 className="mt-1 text-xl font-bold [text-shadow:0_1px_2px_rgb(0_0_0/0.3)]">{unit.title}</h2>
                  <p className="mt-1 text-sm opacity-95 [text-shadow:0_1px_2px_rgb(0_0_0/0.3)]">{unit.description}</p>
                </div>
                <div className="grid justify-items-center gap-5">
                  {unit.lessons.map((l, i) => {
                    const isDone = !!progress.done[l.id];
                    const isCurrent = current?.id === l.id;
                    const open = isUnlocked(progress, l.id);
                    const Icon = l.kind === 'practice' ? Dumbbell : isDone ? Check : l.cards.some((c) => c.type === 'predict') ? Target : BookOpen;
                    return (
                      <div
                        key={l.id}
                        ref={isCurrent ? currentRef : undefined}
                        className={cn('relative flex flex-col items-center', picked === l.id && 'z-20')}
                        style={{ transform: `translateX(${ZIGZAG[i % ZIGZAG.length]}px)` }}
                      >
                        {isCurrent && picked !== l.id && (
                          <div className="absolute -top-9 animate-bounce rounded-lg border-2 bg-card px-3 py-1 text-xs font-bold whitespace-nowrap uppercase" style={{ color: unit.color }}>
                            {done === 0 ? 'Bắt đầu' : 'Tiếp tục'}
                          </div>
                        )}
                        <button
                          type="button"
                          aria-label={l.title}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPicked(picked === l.id ? null : l.id);
                          }}
                          className={cn(
                            'relative flex size-[68px] items-center justify-center rounded-full border-b-[6px] transition-transform active:translate-y-1 active:border-b-2',
                            !open && 'bg-muted text-muted-foreground',
                            isCurrent && 'ring-4 ring-offset-4 ring-offset-background',
                          )}
                          style={
                            open
                              ? {
                                  background: isDone || isCurrent ? unit.color : 'transparent',
                                  borderColor: 'rgb(0 0 0 / 0.3)',
                                  color: isDone || isCurrent ? 'white' : unit.color,
                                  boxShadow: isDone || isCurrent ? undefined : `inset 0 0 0 3px ${unit.color}`,
                                  ['--tw-ring-color' as string]: `${unit.color}66`,
                                }
                              : { borderColor: 'rgb(0 0 0 / 0.3)' }
                          }
                        >
                          {open ? <Icon className="size-7" strokeWidth={2.5} /> : <Lock className="size-6" />}
                          {isDone && (progress.done[l.id] ?? 0) > 1 && (
                            <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-black">
                              {progress.done[l.id]}
                            </span>
                          )}
                        </button>
                        <span className="mt-1.5 max-w-36 text-center text-xs text-muted-foreground">{l.title}</span>
                        {picked === l.id && (
                          <div
                            className="absolute top-[92px] z-10 w-64 rounded-xl border-2 bg-card p-4 shadow-xl"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="font-bold">{l.title}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {l.kind === 'practice'
                                ? 'Thực hành trên canvas, chấm điểm bằng engine'
                                : `${l.cards.length} thẻ · ${l.cards.filter((c) => c.type !== 'read').length} câu hỏi`}
                              {' · '}+{isDone ? Math.ceil(lessonXp(l.kind) / 3) : lessonXp(l.kind)} XP
                            </div>
                            {open ? (
                              <Button className="mt-3 w-full" style={{ background: unit.color }} onClick={() => setActive(l.id)}>
                                {isDone ? 'Ôn lại' : l.kind === 'practice' ? 'Vào thực hành' : 'Bắt đầu'}
                              </Button>
                            ) : (
                              <p className="mt-3 text-xs text-muted-foreground">Hoàn thành bài trước để mở khoá.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <div className="pb-16 text-center text-sm text-muted-foreground">
            Hết lộ trình. Tiếp theo: tự thiết kế trong <b>Sandbox</b>, hoặc đo hệ thống thật ở tab <b>Công suất</b>.
          </div>
        </div>
      </div>

      <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l p-5 lg:flex">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border-2 p-3">
            <div className="flex items-center gap-1.5 text-2xl font-bold text-orange-400">
              <Flame className={cn('size-6', days > 0 ? 'fill-orange-400' : 'opacity-40')} />
              {days}
            </div>
            <div className="text-xs text-muted-foreground">ngày liên tiếp</div>
          </div>
          <div className="rounded-xl border-2 p-3">
            <div className="flex items-center gap-1.5 text-2xl font-bold text-warning">
              <Zap className="size-6 fill-warning" />
              {progress.xp}
            </div>
            <div className="text-xs text-muted-foreground">tổng XP</div>
          </div>
        </div>
        <div className="rounded-xl border-2 p-4">
          <div className="flex items-center justify-between text-sm font-bold">
            <span>Mục tiêu hôm nay</span>
            <span className="font-mono text-xs text-muted-foreground">
              {Math.min(todayXp, DAILY_GOAL)}/{DAILY_GOAL} XP
            </span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-warning transition-[width]" style={{ width: `${Math.min(100, (todayXp / DAILY_GOAL) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {todayXp >= DAILY_GOAL ? 'Đạt mục tiêu rồi! Giữ chuỗi ngày vào ngày mai.' : 'Khoảng 2–3 bài là đủ cho hôm nay.'}
          </p>
        </div>
        {current && (
          <Button size="lg" onClick={() => setActive(current.id)}>
            <Star /> {done === 0 ? 'Bắt đầu học' : `Tiếp tục: ${current.title}`}
          </Button>
        )}
        <div className="rounded-xl border-2 p-4 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-2 text-sm font-bold text-foreground">
            Tiến độ: {done}/{LESSONS.length} bài
          </div>
          {(['Cơ bản', 'Trung cấp', 'Nâng cao'] as const).map((tier) => {
            const ls = UNITS.filter((u) => u.tier === tier).flatMap((u) => u.lessons);
            const d = ls.filter((l) => progress.done[l.id]).length;
            return (
              <div key={tier} className="mb-1.5">
                <div className="flex justify-between">
                  <span>{tier}</span>
                  <span className="font-mono">
                    {d}/{ls.length}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${(d / ls.length) * 100}%` }} />
                </div>
              </div>
            );
          })}
          <p className="mt-3">
            Mỗi bài gồm giải thích có hoạt hình, câu hỏi, sắp xếp thứ tự và <b>dự đoán</b>: bạn đoán kết quả, simulator chạy
            thật để kiểm chứng. Bài <Dumbbell className="inline size-3" /> là thực hành trên canvas, chấm điểm bằng đúng engine
            của Game.
          </p>
        </div>
        <div className="flex items-center justify-between rounded-xl border-2 p-3">
          <Label htmlFor="unlock-all" className="text-xs">
            Tôi biết rồi, mở khoá tất cả
          </Label>
          <Switch id="unlock-all" checked={progress.unlockAll} onCheckedChange={setUnlockAll} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => confirm('Xoá toàn bộ tiến độ học?') && reset()}
        >
          <RotateCcw /> Học lại từ đầu
        </Button>
      </aside>
    </div>
  );
}
