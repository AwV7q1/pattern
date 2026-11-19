import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Clock, FolderOpen, Loader2, MessagesSquare, Play, RotateCcw, Send } from 'lucide-react';
import type { InterviewPrompt } from '@pattern/design-lint';
import { INTERVIEWS } from '@/presets';
import { api } from '@/app/api';
import { useAuth } from '@/app/auth-store';
import { Workspace } from '@/features/workspace/Workspace';
import { autoLayout } from '@/model/flow';
import { projectFromPreset, store } from '@/projects/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Design } from '@/types';
import { gradeLocally, levelOf, type Graded } from './grade';
import { Report, VERDICT } from './Report';

const DIFFICULTY_CLASS: Record<InterviewPrompt['difficulty'], string> = {
  Dễ: 'text-success',
  'Trung bình': 'text-warning',
  Khó: 'text-destructive',
};

interface AttemptRow {
  id: string;
  promptId: string;
  total: number;
  durationMs: number;
  createdAt: string;
}

function useAttempts() {
  const signedIn = useAuth((s) => s.status === 'signed-in');
  const [rows, setRows] = useState<AttemptRow[]>([]);
  useEffect(() => {
    if (signedIn) api<AttemptRow[]>('/interviews/attempts/mine').then(setRows).catch(() => setRows([]));
  }, [signedIn]);
  return rows;
}

/** `/interview`: the prompts, with your best score on each. */
export function InterviewList() {
  const attempts = useAttempts();
  const best = (id: string) => Math.max(-1, ...attempts.filter((a) => a.promptId === id).map((a) => a.total));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <MessagesSquare className="size-5" /> Phỏng vấn system design
          </h1>
          <p className="text-sm text-muted-foreground">
            Đọc đề, thiết kế trên canvas trong thời gian giới hạn, rồi nộp. Engine chạy design qua tải bình thường, cao điểm và sự cố; bộ
            luật kiểm tra thiết kế; điểm gồm SLO, khả năng chịu lỗi, chi phí và độ sạch. Không có nhận xét bằng AI: mọi con số đều đo được.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {INTERVIEWS.map((p) => {
            const b = best(p.id);
            return (
              <Link key={p.id} to={`/interview/${p.id}`} className="grid gap-2 rounded-lg border p-4 transition-colors hover:bg-accent/50">
                <div className="flex items-center gap-2">
                  <span className="mr-auto font-medium">{p.title}</span>
                  {b >= 0 && <Badge variant="secondary">tốt nhất {b}</Badge>}
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{p.brief}</p>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span className={DIFFICULTY_CLASS[p.difficulty]}>{p.difficulty}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" /> {p.timeMinutes} phút
                  </span>
                  <span>{p.grading.length} kịch bản chấm</span>
                </div>
              </Link>
            );
          })}
        </div>
        {attempts.length > 0 && (
          <section className="grid gap-2">
            <h2 className="text-sm font-medium">Lịch sử bài làm</h2>
            <ul className="grid gap-1 text-sm">
              {attempts.slice(0, 20).map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="w-10 text-right font-mono">{a.total}</span>
                  <span className="flex-1">{INTERVIEWS.find((p) => p.id === a.promptId)?.title ?? a.promptId}</span>
                  <span className="text-muted-foreground">{Math.round(a.durationMs / 60000)} phút</span>
                  <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Side panel during the interview: clock, requirements, hand in. */
function InterviewPanel({ prompt, startedAt, onSubmit, busy }: { prompt: InterviewPrompt; startedAt: number; onSubmit: () => void; busy: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = prompt.timeMinutes * 60_000 - (now - startedAt);
  return (
    <div className="grid gap-4">
      <div className={cn('flex items-center gap-2 font-mono text-2xl', left < 5 * 60_000 && 'text-warning', left <= 0 && 'text-destructive')}>
        <Clock className="size-5" /> {left > 0 ? mmss(left) : `+${mmss(-left)}`}
      </div>
      <p className="text-sm leading-relaxed">{prompt.brief}</p>
      <ul className="grid list-disc gap-1 pl-5 text-sm">
        {prompt.requirements.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Thành phần dùng thông số chuẩn theo loại; bạn chọn kiến trúc, số instance và chính sách gọi (timeout, retry, circuit breaker…).
        Chạy thử với nút Chạy và tab Số liệu trước khi nộp. Kiểm tra thiết kế chỉ hiện sau khi nộp.
      </p>
      <Button disabled={busy} onClick={onSubmit}>
        {busy ? <Loader2 className="animate-spin" /> : <Send />} Nộp bài
      </Button>
    </div>
  );
}

/** `/interview/:promptId`: brief → design against the clock → graded report. */
export function InterviewRoute() {
  const { promptId = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const prompt = INTERVIEWS.find((p) => p.id === promptId);
  const [phase, setPhase] = useState<'brief' | 'design' | 'report'>('brief');
  const [startedAt, setStartedAt] = useState(0);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [referenceScore, setReferenceScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef<Design | null>(null);
  const level = useMemo(() => (prompt ? levelOf(prompt) : null), [prompt]);

  if (!prompt || !level) return <Navigate to="/interview" replace />;

  const submit = async (design: Design) => {
    setBusy(true);
    setError(null);
    submitted.current = design;
    try {
      const duration = Date.now() - startedAt;
      const result =
        auth.status === 'signed-in'
          ? await api<Graded>(`/interviews/${prompt.id}/attempts`, { body: { design, durationMs: duration } })
          : await gradeLocally(prompt, design);
      setGraded(result);
      setPhase('report');
      // the reference, graded the same way, for scale
      void gradeLocally(prompt, prompt.reference as unknown as Design).then((r) => setReferenceScore(r.score.total));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const openInStudio = async (design: Design, name: string) => {
    const p = projectFromPreset(
      { title: name, description: prompt.brief, design: autoLayout(design), scenario: { ...prompt.level.scenario, windowMs: 1000 } as never },
      name,
      `interview:${prompt.id}`,
    );
    p.notes = prompt.requirements.map((r) => `- ${r}`).join('\n');
    await store.put(p);
    navigate(`/studio/${p.id}`);
  };

  if (phase === 'design')
    return (
      <Workspace
        key={`${prompt.id}:${round}`}
        mode="game"
        level={level}
        levelKey={level.id}
        onLevelChange={() => {}}
        title={
          <div className="flex items-center gap-2 text-sm">
            <MessagesSquare className="size-4" /> <span className="font-medium">{prompt.title}</span>
            <span className={cn('text-xs', DIFFICULTY_CLASS[prompt.difficulty])}>{prompt.difficulty}</span>
          </div>
        }
        panelLabel="Đề bài"
        panel={(design) => (
          <>
            <InterviewPanel prompt={prompt} startedAt={startedAt} busy={busy} onSubmit={() => void submit(design())} />
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </>
        )}
      />
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-3xl gap-6 px-6 py-8">
        <Button asChild size="sm" variant="ghost" className="justify-self-start">
          <Link to="/interview">
            <ArrowLeft /> Các đề
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{prompt.title}</h1>
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            <span className={DIFFICULTY_CLASS[prompt.difficulty]}>{prompt.difficulty}</span>
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> {prompt.timeMinutes} phút
            </span>
          </div>
        </div>
        {phase === 'brief' ? (
          <>
            <p className="leading-relaxed">{prompt.brief}</p>
            <section className="grid gap-2">
              <h2 className="text-sm font-medium">Yêu cầu</h2>
              <ul className="grid list-disc gap-1 pl-5 text-sm">
                {prompt.requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
            <section className="grid gap-2">
              <h2 className="text-sm font-medium">Design sẽ được chạy qua</h2>
              <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
                {prompt.grading.map((g) => (
                  <li key={g.name}>{g.name}</li>
                ))}
              </ul>
            </section>
            {auth.status !== 'signed-in' && (
              <p className="text-xs text-muted-foreground">
                Chưa đăng nhập: bài vẫn được chấm ngay trong trình duyệt, nhưng không lưu lịch sử điểm.
              </p>
            )}
            <Button
              className="justify-self-start"
              onClick={() => {
                setStartedAt(Date.now());
                setGraded(null);
                setPhase('design');
              }}
            >
              <Play /> Bắt đầu ({prompt.timeMinutes} phút)
            </Button>
          </>
        ) : graded ? (
          <>
            <Report graded={graded} reference={referenceScore} talkingPoints={prompt.talkingPoints} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => submitted.current && void openInStudio(submitted.current, `Bài làm: ${prompt.title}`)}>
                <FolderOpen /> Mở bài làm trong Studio
              </Button>
              <Button variant="outline" onClick={() => void openInStudio(prompt.reference as unknown as Design, `Lời giải tham khảo: ${prompt.title}`)}>
                <FolderOpen /> Mở lời giải tham khảo
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setRound((r) => r + 1);
                  setPhase('brief');
                }}
              >
                <RotateCcw /> Làm lại
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Kết quả: <span className={VERDICT[graded.score.verdict].className}>{VERDICT[graded.score.verdict].label}</span>. Mở cả hai trong
              Studio rồi dùng So sánh A/B để xem khác nhau ở đâu.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
