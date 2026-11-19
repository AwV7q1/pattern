import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CheckCircle2, CircleAlert, Loader2, Rocket, Star, Wrench } from 'lucide-react';
import { api, ApiError } from '@/app/api';
import { useAuth } from '@/app/auth-store';
import { compute } from '@/sim/compute';
import { KIND_META } from '@/lib/meta';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BackLink } from '@/components/BackLink';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BUILDABLE, type Design, type Level, type NodeKind, type Scenario } from '@/types';
import { useDesignSources, type DesignSource } from '@/features/compare/sources';
import { ScenarioEditor } from './ScenarioEditor';

interface Draft {
  title: string;
  brief: string;
  hint: string;
  locked: string[];
  palette: NodeKind[];
  maxInstances: number;
  allowFireAndForget: boolean;
  scenario: Scenario;
}

type Check = { start: number; solution: number; error?: string } | null;

/** Engine-facing level JSON (crates/engine/src/level.rs) plus the web fields. */
function buildLevel(d: Draft, start: Design): Omit<Level, 'id' | 'description'> & { id?: string } {
  return {
    title: d.title.trim(),
    brief: d.brief.trim(),
    hint: d.hint.trim() || undefined,
    palette: d.palette,
    maxInstances: d.maxInstances,
    allowFireAndForget: d.allowFireAndForget,
    locked: ['client', ...d.locked.filter((id) => id !== 'client')],
    design: start,
    scenario: { ...d.scenario, durationMs: d.scenario.durationMs ?? 60_000 },
  };
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex text-warning">
      {[1, 2, 3].map((i) => (
        <Star key={i} className="size-3.5" fill={i <= n ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

/**
 * `/levels/new?from=<projectId>` and `/levels/:id/edit`: turn a studio design
 * into a game level. The starting design must lose (below 3★) and the
 * reference solution must win (3★), checked by the engine here and again by
 * the server on publish.
 */
export function LevelEditor() {
  const { id: editId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const fromProject = params.get('from');
  const [existing, setExisting] = useState<{ level: Level; solution: Design } | null>(null);
  const extra = useMemo<DesignSource[]>(
    () =>
      existing
        ? [
            { key: 'saved-start', group: 'extra', title: 'Design ban đầu đang lưu của level', design: existing.level.design, scenario: existing.level.scenario },
            { key: 'saved-solution', group: 'extra', title: 'Lời giải đang lưu của level', design: existing.solution, scenario: existing.level.scenario },
          ]
        : [],
    [existing],
  );
  const { project, sources } = useDesignSources(fromProject, extra);
  const [startKey, setStartKey] = useState<string>('');
  const [solutionKey, setSolutionKey] = useState<string>('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [check, setCheck] = useState<Check>(null);
  const [busy, setBusy] = useState<'check' | 'publish' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // editing: load the level with its solution
  useEffect(() => {
    if (!editId) return;
    api<{ level: Level; solution: Design }>(`/levels/${editId}/edit`)
      .then((r) => {
        setExisting(r);
        setStartKey('saved-start');
        setSolutionKey('saved-solution');
        setDraft({
          title: r.level.title,
          brief: r.level.brief,
          hint: r.level.hint ?? '',
          locked: r.level.locked,
          palette: r.level.palette,
          maxInstances: r.level.maxInstances ?? 10,
          allowFireAndForget: !!r.level.allowFireAndForget,
          scenario: r.level.scenario,
        });
      })
      .catch((e) => setError(String(e.message)));
  }, [editId]);

  // new level from a project: sensible defaults
  useEffect(() => {
    if (editId || !project || draft) return;
    setStartKey('current');
    const nodes = project.design.nodes;
    setDraft({
      title: project.name,
      brief: project.description,
      hint: '',
      locked: nodes.filter((n) => n.kind === 'database' || n.kind === 'client').map((n) => n.id),
      palette: [...new Set(nodes.filter((n) => n.kind !== 'client').map((n) => n.kind))] as NodeKind[],
      maxInstances: 10,
      allowFireAndForget: false,
      scenario: { ...project.scenario, durationMs: project.scenario.durationMs ?? 60_000 },
    });
  }, [editId, project, draft]);

  const start = sources.get(startKey);
  const solution = sources.get(solutionKey);
  useEffect(() => setCheck(null), [startKey, solutionKey, draft]);
  // the player must be allowed to add what the reference solution adds
  useEffect(() => {
    if (!solution || !start) return;
    const startIds = new Set(start.design.nodes.map((n) => n.id));
    const needed = solution.design.nodes.filter((n) => !startIds.has(n.id) && n.kind !== 'client').map((n) => n.kind);
    setDraft((d) => (d && needed.some((k) => !d.palette.includes(k)) ? { ...d, palette: [...new Set([...d.palette, ...needed])] } : d));
  }, [solution, start]);

  if (auth.status === 'anonymous')
    return (
      <div className="p-6 text-sm">
        <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} className="text-primary underline">
          Đăng nhập
        </Link>{' '}
        để tạo level cộng đồng.
      </div>
    );
  if (error && !draft) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!fromProject && !editId)
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-3 p-6 text-sm">
        <BackLink to="/play" label="Game" className="-ml-3 justify-self-start" />
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Wrench className="size-5" /> Tạo level
        </h1>
        <p className="text-muted-foreground">
          Level được dựng từ một dự án trong Studio: design của dự án là đề bài, một phiên bản đã sửa làm lời giải. Chọn dự án:
        </p>
        {[...sources.values()]
          .filter((s) => s.group === 'project')
          .map((s) => (
            <Link key={s.key} to={`/levels/new?from=${s.key.slice(2)}`} className="rounded-md border px-3 py-2 hover:bg-accent">
              {s.title.replace(/^Dự án: /, '')}
            </Link>
          ))}
        <Link to="/studio" className="text-primary underline">
          Hoặc tạo dự án mới trong Studio
        </Link>
      </div>
    );
  if (!draft || (!editId && !project)) return <div className="p-6 text-sm text-muted-foreground">Đang tải…</div>;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const startDesign = start?.design;
  const lockable = startDesign?.nodes.filter((n) => n.kind !== 'client') ?? [];

  const runCheck = async (): Promise<Check> => {
    if (!startDesign || !solution) return null;
    setBusy('check');
    setError(null);
    try {
      const level = { ...buildLevel(draft, startDesign), id: 'u-draft' };
      const a = await compute.playLevel(level, startDesign);
      const b = await compute.playLevel(level, solution.design);
      const r = { start: a.stars, solution: b.stars };
      setCheck(r);
      return r;
    } catch (e) {
      const msg = String((e as Error).message ?? e)
        .replace(/'(\w+)' is not available in this level/, 'lời giải dùng "$1" nhưng loại này chưa được cho phép thêm')
        .replace(/locked node '([^']+)' was removed/, 'lời giải thiếu node bị khoá "$1"');
      const r = { start: 0, solution: 0, error: msg };
      setCheck(r);
      return r;
    } finally {
      setBusy(null);
    }
  };

  const publish = async (publishNow: boolean) => {
    if (!startDesign || !solution) return;
    const r = check ?? (await runCheck());
    if (publishNow && (!r || r.error || r.start >= 3 || r.solution < 3)) return;
    setBusy('publish');
    setError(null);
    try {
      const body = { level: buildLevel(draft, startDesign), solution: solution.design, publish: publishNow };
      const res = editId
        ? await api<{ id: string }>(`/levels/${editId}`, { method: 'PUT', body })
        : await api<{ id: string }>('/levels', { body });
      navigate(`/play/${res.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const picker = (value: string, onChange: (k: string) => void, placeholder: string) => {
    const groups: [DesignSource['group'], string][] = [
      ['extra', 'Level đang sửa'],
      ['current', 'Dự án'],
      ['version', 'Phiên bản'],
      ['project', 'Dự án khác'],
    ];
    return (
      <Select value={sources.has(value) ? value : undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {groups.map(([g, label]) => {
            const items = [...sources.values()].filter((s) => s.group === g);
            if (!items.length) return null;
            return (
              <SelectGroup key={g}>
                <SelectLabel>{label}</SelectLabel>
                {items.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    );
  };

  const valid = check && !check.error && check.start < 3 && check.solution === 3;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-4xl gap-6 px-6 py-8">
        <BackLink to="/play" label="Game" className="-mb-4 -ml-3 justify-self-start" />
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Wrench className="size-5" /> {editId ? 'Sửa level' : 'Tạo level từ dự án'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Người chơi nhận design ban đầu và phải sửa cho đạt 3★. Node không khoá dùng thông số chuẩn của game theo loại, người chơi chỉ
            chọn kiến trúc, số instance và chính sách gọi.
          </p>
        </div>

        <section className="grid gap-3 rounded-lg border p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Tên level</Label>
            <Input id="title" value={draft.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="brief">Đề bài (bối cảnh, sự cố, mục tiêu)</Label>
            <Textarea id="brief" rows={4} value={draft.brief} onChange={(e) => set({ brief: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hint">Gợi ý (ẩn cho tới khi người chơi bấm xem)</Label>
            <Input id="hint" value={draft.hint} onChange={(e) => set({ hint: e.target.value })} />
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Design ban đầu (phải dưới 3★)</Label>
            {picker(startKey, setStartKey, 'Chọn design ban đầu')}
          </div>
          <div className="grid gap-1.5">
            <Label>Lời giải tham khảo (phải đạt 3★, không lộ cho người chơi)</Label>
            {picker(solutionKey, setSolutionKey, 'Chọn lời giải: một phiên bản hoặc dự án khác')}
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Mẹo: lưu phiên bản (⌘S) cho design lỗi, sửa design cho tới khi đạt rồi lưu thêm một phiên bản làm lời giải. Lời giải phải giữ
            nguyên các node bị khoá.
          </p>
        </section>

        <section className="grid gap-3 rounded-lg border p-4">
          <Label>Node bị khoá (người chơi không xoá, không đổi thông số)</Label>
          <div className="flex flex-wrap gap-2">
            {lockable.map((n) => {
              const on = draft.locked.includes(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => set({ locked: on ? draft.locked.filter((x) => x !== n.id) : [...draft.locked, n.id] })}
                  className={cn('rounded-md border px-2 py-1 text-sm', on ? 'border-primary bg-primary/10' : 'text-muted-foreground')}
                >
                  {n.label}
                </button>
              );
            })}
          </div>
          <Label className="mt-2">Thành phần người chơi được thêm</Label>
          <div className="flex flex-wrap gap-2">
            {BUILDABLE.map((k) => {
              const on = draft.palette.includes(k);
              const Icon = KIND_META[k].icon;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ palette: on ? draft.palette.filter((x) => x !== k) : [...draft.palette, k] })}
                  className={cn('flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm', on ? 'border-primary bg-primary/10' : 'text-muted-foreground')}
                >
                  <Icon className="size-3.5" /> {KIND_META[k].name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Label htmlFor="maxi" className="text-sm">
                Instance tối đa mỗi node
              </Label>
              <Input id="maxi" type="number" className="h-8 w-20" min={1} max={50} value={draft.maxInstances} onChange={(e) => set({ maxInstances: Math.max(1, Number(e.target.value)) })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={draft.allowFireAndForget} onCheckedChange={(v) => set({ allowFireAndForget: v })} />
              <span className="text-sm">Cho phép gọi không chờ (fire-and-forget)</span>
            </div>
          </div>
        </section>

        <section className="grid gap-3 rounded-lg border p-4">
          <Label>Kịch bản chấm điểm</Label>
          {startDesign && <ScenarioEditor value={draft.scenario} design={startDesign} onChange={(scenario) => set({ scenario })} />}
        </section>

        <section className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={!startDesign || !solution || !!busy} onClick={() => void runCheck()}>
            {busy === 'check' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Kiểm tra bằng engine
          </Button>
          {check &&
            (check.error ? (
              <span className="flex items-center gap-1 text-sm text-destructive">
                <CircleAlert className="size-4" /> {check.error}
              </span>
            ) : (
              <span className="flex items-center gap-3 text-sm">
                <span className={check.start < 3 ? 'text-success' : 'text-destructive'}>
                  Ban đầu <Stars n={check.start} />
                </span>
                <span className={check.solution === 3 ? 'text-success' : 'text-destructive'}>
                  Lời giải <Stars n={check.solution} />
                </span>
              </span>
            ))}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" disabled={!startDesign || !solution || !!busy || !draft.title.trim()} onClick={() => void publish(false)}>
              Lưu nháp
            </Button>
            <Button disabled={!valid || !!busy || !draft.title.trim() || !draft.brief.trim()} onClick={() => void publish(true)}>
              {busy === 'publish' ? <Loader2 className="animate-spin" /> : <Rocket />} Đăng level
            </Button>
          </div>
        </section>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
