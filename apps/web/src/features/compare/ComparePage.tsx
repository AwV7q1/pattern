import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, GitCompareArrows, Loader2, Minus, Pencil, Play, Plus, Star } from 'lucide-react';
import { lint } from '@pattern/design-lint';
import { compute } from '@/sim/compute';
import { store, type Project, type Version } from '@/projects/store';
import { Chart } from '@/components/Chart';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmt } from '@/lib/meta';
import { cn } from '@/lib/utils';
import type { Design, Scenario, Summary, WindowMetrics } from '@/types';
import { diffDesigns, STRESS, stressScenario, type StressKind } from './diff';

interface Side {
  key: string;
  title: string;
  design: Design;
  scenario: Scenario;
}

interface Run {
  summary: Summary;
  windows: WindowMetrics[];
  findings: number;
}

const A_COLOR = '#60a5fa';
const B_COLOR = '#f59e0b';

const when = (t: number) => new Date(t).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

/** Rows of the summary table: value, formatter, and whether lower is better. */
const ROWS: { label: string; get: (s: Summary, r: Run) => number; fmt: (v: number) => string; lower: boolean }[] = [
  { label: 'Throughput OK', get: (s) => s.throughputRps, fmt: (v) => `${fmt.rps(v)}/s`, lower: false },
  { label: 'p50', get: (s) => s.p50Ms, fmt: fmt.ms, lower: true },
  { label: 'p99', get: (s) => s.p99Ms, fmt: fmt.ms, lower: true },
  { label: 'Tỉ lệ lỗi', get: (s) => s.errorRate, fmt: (v) => fmt.pct(v), lower: true },
  { label: 'Thời gian đạt SLO', get: (s) => s.sloWindowRatio, fmt: (v) => fmt.pct(v, 0), lower: false },
  { label: 'Retry', get: (s) => s.retries, fmt: (v) => String(Math.round(v)), lower: true },
  { label: 'Chi phí', get: (s) => s.costPerHour, fmt: (v) => `${fmt.money(v)}/h`, lower: true },
  { label: 'Ghi chú lint (lỗi + cảnh báo)', get: (_, r) => r.findings, fmt: (v) => String(v), lower: true },
];

function Delta({ a, b, lower, format }: { a: number; b: number; lower: boolean; format: (v: number) => string }) {
  if (Math.abs(a - b) < 1e-9) return <span className="text-muted-foreground">=</span>;
  const better = lower ? b < a : b > a;
  const pct = a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null;
  return (
    <span className={better ? 'text-success' : 'text-destructive'}>
      {b > a ? '+' : '−'}
      {format(Math.abs(b - a))}
      {pct !== null && Math.abs(pct) >= 1 && <span className="ml-1 text-xs">({pct > 0 ? '+' : ''}{Math.round(pct)}%)</span>}
    </span>
  );
}

/** `/studio/:projectId/compare?a=&b=`: two designs, same scenario and seed, side by side. */
export function ComparePage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [others, setOthers] = useState<Project[]>([]);
  const [stress, setStress] = useState<StressKind>((params.get('stress') as StressKind) || 'project');
  const [killNode, setKillNode] = useState<string>('');
  const [runs, setRuns] = useState<{ a: Run; b: Run } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const p = (await store.get(projectId)) ?? null;
      setProject(p);
      if (!p) return;
      setVersions(await store.versions(projectId));
      setOthers((await store.list()).filter((x) => x.id !== projectId));
    })();
  }, [projectId]);

  const sides = useMemo(() => {
    const m = new Map<string, Side>();
    if (!project) return m;
    m.set('current', { key: 'current', title: `Bản hiện tại · ${project.name}`, design: project.design, scenario: project.scenario });
    for (const v of versions)
      m.set(`v:${v.id}`, { key: `v:${v.id}`, title: `${v.label ?? 'Tự động'} · ${when(v.at)}`, design: v.design, scenario: v.scenario });
    for (const o of others) m.set(`p:${o.id}`, { key: `p:${o.id}`, title: `Dự án: ${o.name}`, design: o.design, scenario: o.scenario });
    return m;
  }, [project, versions, others]);

  const aKey = params.get('a') ?? 'current';
  const bKey = params.get('b') ?? (versions[0] ? `v:${versions[0].id}` : 'current');
  const A = sides.get(aKey);
  const B = sides.get(bKey);
  const setSide = (which: 'a' | 'b', key: string) => {
    const next = new URLSearchParams(params);
    next.set(which, key);
    setParams(next, { replace: true });
    setRuns(null);
  };

  const killable = useMemo(() => {
    if (!A || !B) return [];
    const inB = new Set(B.design.nodes.map((n) => n.id));
    return A.design.nodes.filter((n) => n.kind !== 'client' && inB.has(n.id));
  }, [A, B]);
  useEffect(() => {
    if (!killNode && killable.length) setKillNode(killable.find((n) => n.kind === 'database')?.id ?? killable[0].id);
  }, [killable, killNode]);

  const run = async () => {
    if (!A || !B || !project) return;
    setBusy(true);
    setError(null);
    try {
      // the same scenario (the project's) and seed for both sides: only the design differs
      const one = async (s: Side): Promise<Run> => {
        const scenario = stressScenario(project.scenario, s.design, stress, killNode);
        const r = await compute.runDetailed({ design: s.design, scenario });
        const findings = lint(s.design, scenario).filter((f) => f.severity !== 'info').length;
        return { ...r, findings };
      };
      const a = await one(A);
      const b = await one(B);
      setRuns({ a, b });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const diff = useMemo(() => (A && B ? diffDesigns(A.design, B.design) : []), [A, B]);

  if (!project) return <div className="p-6 text-sm text-muted-foreground">Đang tải dự án…</div>;

  const picker = (which: 'a' | 'b', value: string, color: string) => (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color }}>
        <span className="size-2 rounded-full" style={{ background: color }} /> {which.toUpperCase()}
      </span>
      <Select value={sides.has(value) ? value : undefined} onValueChange={(v) => setSide(which, v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Chọn bản để so sánh" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="current">{sides.get('current')?.title}</SelectItem>
          {versions.length > 0 && (
            <SelectGroup>
              <SelectLabel>Phiên bản</SelectLabel>
              {versions.map((v) => (
                <SelectItem key={v.id} value={`v:${v.id}`}>
                  {sides.get(`v:${v.id}`)?.title}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {others.length > 0 && (
            <SelectGroup>
              <SelectLabel>Dự án khác</SelectLabel>
              {others.map((o) => (
                <SelectItem key={o.id} value={`p:${o.id}`}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );

  const series = (get: (w: WindowMetrics) => number) =>
    runs
      ? [
          { label: 'A', color: A_COLOR, values: runs.a.windows.map(get) },
          { label: 'B', color: B_COLOR, values: runs.b.windows.map(get) },
        ]
      : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-6">
        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link to={`/studio/${projectId}`}>
              <ArrowLeft /> {project.name}
            </Link>
          </Button>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <GitCompareArrows className="size-5" /> So sánh A/B
          </h1>
        </div>
        <p className="-mt-3 text-sm text-muted-foreground">
          Hai design chạy cùng kịch bản và cùng seed, nên mọi khác biệt đến từ design, không phải do ngẫu nhiên.
        </p>

        <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-[1fr_1fr_auto]">
          {picker('a', aKey, A_COLOR)}
          {picker('b', bKey, B_COLOR)}
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Kịch bản</span>
            <div className="flex gap-2">
              <Select value={stress} onValueChange={(v) => (setStress(v as StressKind), setRuns(null))}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STRESS) as StressKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {STRESS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {stress === 'kill' && (
                <Select value={killNode} onValueChange={(v) => (setKillNode(v), setRuns(null))}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Node" />
                  </SelectTrigger>
                  <SelectContent>
                    {killable.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button disabled={!A || !B || busy} onClick={() => void run()}>
                {busy ? <Loader2 className="animate-spin" /> : <Play />} Chạy
              </Button>
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {runs && (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Số liệu</th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: A_COLOR }}>
                      A
                    </th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: B_COLOR }}>
                      B
                    </th>
                    <th className="px-3 py-2 text-right font-medium">B so với A</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {ROWS.map((r) => {
                    const a = r.get(runs.a.summary, runs.a);
                    const b = r.get(runs.b.summary, runs.b);
                    return (
                      <tr key={r.label} className="border-t">
                        <td className="px-3 py-1.5 font-sans">{r.label}</td>
                        <td className="px-3 py-1.5 text-right">{r.fmt(a)}</td>
                        <td className="px-3 py-1.5 text-right">{r.fmt(b)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <Delta a={a} b={b} lower={r.lower} format={r.fmt} />
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t">
                    <td className="px-3 py-1.5 font-sans">Sao (theo SLO, ngân sách, độ bền)</td>
                    {[runs.a, runs.b].map((x, i) => (
                      <td key={i} className="px-3 py-1.5 text-right">
                        <span className="inline-flex text-warning">
                          {[1, 2, 3].map((k) => (
                            <Star key={k} className="size-3.5" fill={k <= x.summary.stars ? 'currentColor' : 'none'} />
                          ))}
                        </span>
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Chart title="p99" unit="ms" threshold={{ value: project.scenario.slo.p99Ms, label: 'SLO' }} series={series((w) => w.p99Ms)} />
              <Chart title="Lỗi" unit="/s" series={series((w) => w.errorRps)} />
              <Chart title="Throughput OK" unit="/s" series={series((w) => w.rps)} />
              <Chart title="Retry" unit="/s" series={series((w) => w.retries)} />
            </div>
          </>
        )}

        <section className="grid gap-2">
          <h2 className="text-sm font-medium">Khác nhau giữa A và B ({diff.length})</h2>
          {diff.length === 0 ? (
            <p className="text-sm text-muted-foreground">Hai design giống hệt nhau.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {diff.map((d, i) => {
                const Icon = d.kind === 'added' ? Plus : d.kind === 'removed' ? Minus : Pencil;
                return (
                  <li key={i} className="flex items-start gap-2">
                    <Icon
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0',
                        d.kind === 'added' ? 'text-success' : d.kind === 'removed' ? 'text-destructive' : 'text-warning',
                      )}
                    />
                    <span>
                      <b>{d.what}</b>
                      {d.detail && <span className="text-muted-foreground"> · {d.detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
