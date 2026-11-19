import { useMemo, useState, type ChangeEvent } from 'react';
import { FileUp, Gauge, Loader2, Plus, Trash2, X } from 'lucide-react';
import { compute } from '@/sim/compute';
import type { CalibrationResult, Design, Measurement, Predicted } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Num, Section, Stat, ms, pct } from './fields';

// Real measurements of this repo's NestJS server (see docs/CALIBRATION.md).
const raw = import.meta.glob<string>('../../../../examples/calibration/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const file = (name: string) => raw[`../../../../examples/calibration/${name}`];

export type DesignSource = { key: string; label: string; design: Design; slo?: { p99Ms: number; errorRate: number } };

type Obs = { node: string; metric: 'utilization' | 'inFlight' | 'lagMs'; rps: number; value: number };

const EXAMPLE: DesignSource = (() => {
  const v = JSON.parse(file('nest-server.json'));
  return { key: 'example', label: 'Ví dụ: NestJS server của repo (số đo thật)', design: v.design, slo: v.scenario?.slo };
})();
const EXAMPLE_FILES = [{ name: 'measured-low.json', json: file('measured-low.json') }];
// CPU per request was measured at high load (0.3 ms p50); only the effects
// that latency reveals are fitted: wake-up cost and GC pauses.
const EXAMPLE_FIT = 'api.wakeup=0.05:3 api.gcPause=1:100 api.gcEvery=100:20000';
const EXAMPLE_OBS: Obs[] = [
  { node: 'api', metric: 'utilization', rps: 200, value: 0.18 },
  { node: 'api', metric: 'utilization', rps: 900, value: 0.49 },
  { node: 'api', metric: 'utilization', rps: 1500, value: 0.71 },
];

export function CalibratePanel({
  sources,
  onApply,
}: {
  sources: DesignSource[];
  onApply: (design: Design, title: string, slo?: { p99Ms: number; errorRate: number }) => void;
}) {
  const all = useMemo(() => [EXAMPLE, ...sources], [sources]);
  const [sourceKey, setSourceKey] = useState('example');
  const [uploaded, setUploaded] = useState<DesignSource | null>(null);
  const source = uploaded && sourceKey === 'upload' ? uploaded : (all.find((s) => s.key === sourceKey) ?? EXAMPLE);
  const [files, setFiles] = useState(EXAMPLE_FILES);
  const [fit, setFit] = useState(EXAMPLE_FIT);
  const [obs, setObs] = useState<Obs[]>(EXAMPLE_OBS);
  const [maxVus, setMaxVus] = useState(0);
  const [slo, setSlo] = useState(EXAMPLE.slo ?? { p99Ms: 100, errorRate: 0.01 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationResult | null>(null);

  const nodeIds = source.design.nodes.filter((n) => n.kind !== 'client').map((n) => n.id);

  const pickSource = (key: string) => {
    setSourceKey(key);
    setResult(null);
    if (key === 'example') {
      setFiles(EXAMPLE_FILES);
      setObs(EXAMPLE_OBS);
      setFit(EXAMPLE_FIT);
      setSlo(EXAMPLE.slo!);
    } else {
      setObs([]);
      setFit('');
      const s = all.find((x) => x.key === key);
      if (s?.slo) setSlo(s.slo);
    }
  };

  const readFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    const read = await Promise.all(list.map(async (f) => ({ name: f.name, json: await f.text() })));
    setFiles((prev) => [...prev.filter((p) => !read.some((r) => r.name === p.name)), ...read]);
    e.target.value = '';
  };

  const readDesign = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const v = JSON.parse(await f.text());
      setUploaded({ key: 'upload', label: f.name, design: v.design ?? v, slo: v.scenario?.slo });
      setSourceKey('upload');
      setObs([]);
      setResult(null);
    } catch {
      setError(`${f.name}: không đọc được JSON`);
    }
    e.target.value = '';
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await compute.calibrate(source.design, {
        summaries: files,
        fit: fit
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        observe: obs.map((o) => `${o.node}.${o.metric}@${o.rps}=${o.value}`),
        maxVus: maxVus > 0 ? maxVus : null,
        slo,
      });
      setResult(r);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(380px,460px)_1fr]">
      <div className="min-h-0 overflow-y-auto border-r p-4 pb-28">
        <div className="grid gap-4">
          <Section title="1. Design cần hiệu chỉnh" desc="Cấu trúc phải đúng (ai gọi ai, số process, pool). Các con số sẽ được fit.">
            <Select value={sourceKey} onValueChange={pickSource}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {all.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
                {uploaded && <SelectItem value="upload">{uploaded.label}</SelectItem>}
              </SelectContent>
            </Select>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
              <FileUp className="size-3.5" /> Hoặc tải file design JSON
              <input type="file" accept=".json" className="hidden" onChange={readDesign} />
            </label>
            <p className="font-mono text-[12px] text-muted-foreground">
              {source.design.nodes.length} node: {source.design.nodes.map((n) => n.id).join(', ')}
            </p>
          </Section>

          <Section
            title="2. Kết quả k6"
            desc={
              <>
                File từ <code className="text-foreground">k6 run --summary-export=… tools/k6/step-load.js</code>. Mỗi bước tải là một
                mức; nên có 2–3 mức <b>dưới</b> điểm gãy.
              </>
            }
          >
            <div className="grid gap-1">
              {files.map((f) => (
                <div key={f.name} className="flex items-center gap-2 rounded border px-2 py-1 font-mono text-xs">
                  <span className="truncate">{f.name}</span>
                  <Button size="icon-sm" variant="ghost" className="ml-auto size-6" onClick={() => setFiles(files.filter((x) => x !== f))}>
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed py-2 text-xs text-muted-foreground hover:text-foreground">
              <FileUp className="size-3.5" /> Thêm file summary
              <input type="file" accept=".json" multiple className="hidden" onChange={readFiles} />
            </label>
            <Num label="maxVUs của k6 (0 = không giới hạn)" value={maxVus} onChange={setMaxVus} />
          </Section>

          <Section
            title="3. Số đo từng node (rất nên có)"
            desc="CPU của process lúc chạy từng mức (top, Prometheus, cpu-per-request.sh). Chỉ từ latency, mô hình không phân biệt được p99 cao vì CPU đầy hay vì GC pause: giới hạn dự đoán có thể lệch 2×."
          >
            {obs.map((o, i) => (
              <div key={i} className="grid grid-cols-[1fr_104px_64px_64px_24px] items-end gap-1.5">
                <Select value={o.node} onValueChange={(v) => setObs(obs.map((x, j) => (j === i ? { ...x, node: v } : x)))}>
                  <SelectTrigger size="sm" className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {nodeIds.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={o.metric} onValueChange={(v) => setObs(obs.map((x, j) => (j === i ? { ...x, metric: v as Obs['metric'] } : x)))}>
                  <SelectTrigger size="sm" className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="utilization">CPU (0–1)</SelectItem>
                    <SelectItem value="inFlight">đang mở</SelectItem>
                    <SelectItem value="lagMs">loop lag ms</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="h-7 px-1.5 font-mono text-xs" type="number" title="ở mức rps" value={o.rps} onChange={(e) => setObs(obs.map((x, j) => (j === i ? { ...x, rps: Number(e.target.value) } : x)))} />
                <Input className="h-7 px-1.5 font-mono text-xs" type="number" step={0.01} title="giá trị" value={o.value} onChange={(e) => setObs(obs.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} />
                <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => setObs(obs.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
            {obs.length > 0 && <p className="text-[11px] text-muted-foreground">node · số đo · ở mức rps · giá trị</p>}
            <Button
              size="sm"
              variant="outline"
              disabled={!nodeIds.length}
              onClick={() => setObs([...obs, { node: nodeIds[0], metric: 'utilization', rps: 100, value: 0.2 }])}
            >
              <Plus /> Thêm số đo
            </Button>
          </Section>

          <Section
            title="4. Tham số cần fit"
            desc={
              <>
                Để trống: tự chọn núm công suất của tài nguyên bận nhất + hệ số latency chung. Ví dụ:{' '}
                <code className="text-foreground">api.cpu api.gcPause api.gcEvery *.latency api-&gt;db.pool</code>
              </>
            }
          >
            <Input className="h-8 font-mono text-xs" placeholder="tự động" value={fit} onChange={(e) => setFit(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Num label="SLO p99 (để tính giới hạn)" suffix="ms" value={slo.p99Ms} onChange={(v) => setSlo({ ...slo, p99Ms: v })} />
              <Num label="SLO lỗi" step={0.005} value={slo.errorRate} onChange={(v) => setSlo({ ...slo, errorRate: v })} />
            </div>
          </Section>
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Button onClick={run} disabled={busy || !files.length}>
            {busy ? <Loader2 className="animate-spin" /> : <Gauge />}
            {busy ? 'Đang fit…' : 'Hiệu chỉnh'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Mô phỏng lại đúng bài test k6 (arrival đều, cùng thời lượng) và tìm tham số khớp throughput, lỗi, p50/p95/p99.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-28">
          {error && <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          {result ? (
            <CalibrationView r={result} design={source.design} onApply={() => onApply(result.report.design, `Hiệu chỉnh: ${source.label}`, result.slo)} hasObs={obs.some((o) => o.metric === 'utilization')} />
          ) : (
            !error && (
              <div className="mx-auto max-w-xl pt-10 text-sm text-muted-foreground">
                <p>
                  Ví dụ có sẵn là số đo thật của server NestJS trong repo (1 process, endpoint chấm điểm chạy engine WASM) ở 200, 900
                  và 1500 rps. CPU mỗi request đã đo trực tiếp ở tải cao (0.3 ms), chỉ fit chi phí wake-up và GC pause.
                </p>
                <p className="mt-2">
                  Đo thật ở mức cao hơn (không dùng để fit): p99 vượt 100 ms quanh 2000–2500 rps, sập ở ~3000 rps. Bấm{' '}
                  <b className="text-foreground">Hiệu chỉnh</b> để xem mô hình dự đoán được gì chỉ từ 3 mức tải thấp.
                </p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function delta(sim: number, meas: number | null) {
  if (meas == null || meas <= 0) return null;
  const d = sim / meas - 1;
  return (
    <span className={cn('ml-1 text-[11px]', Math.abs(d) < 0.15 ? 'text-success' : Math.abs(d) < 0.35 ? 'text-warning' : 'text-destructive')}>
      {d >= 0 ? '+' : ''}
      {Math.round(d * 100)}%
    </span>
  );
}

function Row({ label, p, m, muted }: { label: string; p: Predicted | Measurement; m?: Measurement; muted?: boolean }) {
  const cell = (v: number | null, meas: number | null | undefined) => (
    <td className="text-right">
      {ms(v)}
      {m && v != null && delta(v, meas ?? null)}
    </td>
  );
  return (
    <tr className={cn(muted && 'text-muted-foreground')}>
      <td className="py-0.5 font-sans">{label}</td>
      <td className="text-right">
        {p.okRps.toFixed(0)}
        {m && delta(p.okRps, m.okRps)}
      </td>
      <td className="text-right">{(p.errorRate * 100).toFixed(2)}%</td>
      {cell(p.p50Ms, m?.p50Ms)}
      {cell(p.p95Ms, m?.p95Ms)}
      {cell(p.p99Ms, m?.p99Ms)}
    </tr>
  );
}

function CalibrationView({ r, design, onApply, hasObs }: { r: CalibrationResult; design: Design; onApply: () => void; hasObs: boolean }) {
  const rep = r.report;
  const worst = Math.max(
    ...rep.levels.flatMap((l) =>
      [
        [l.after.p50Ms, l.measured.p50Ms],
        [l.after.p99Ms, l.measured.p99Ms],
        [l.after.okRps, l.measured.okRps],
      ]
        .filter(([, m]) => m != null && m > 0)
        .map(([s, m]) => Math.abs(s! / m! - 1)),
    ),
  );
  const nodes = design.nodes.map((n, i) => ({ id: n.id, i })).filter((n) => design.nodes[n.i].kind !== 'client');
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-2">
        <Stat label={`Giới hạn ước tính (p99 ≤ ${r.slo.p99Ms}ms)`} value={`~${Math.round(r.capacityRps)} rps`} sub="traffic thật (Poisson)" />
        <Stat label="Lệch lớn nhất sau fit" value={pct(worst)} tone={worst < 0.15 ? 'ok' : worst > 0.35 ? 'bad' : undefined} sub={worst < 0.15 ? 'tốt' : worst < 0.35 ? 'tạm được' : 'mô hình còn thiếu yếu tố'} />
        <Stat label="Sai số tổng" value={`${rep.lossBefore.toFixed(2)} → ${rep.lossAfter.toFixed(2)}`} sub={`${rep.evaluations} lần mô phỏng`} />
        <div className="flex items-center justify-center">
          <Button onClick={onApply}>Mở design đã hiệu chỉnh trong Sandbox</Button>
        </div>
      </div>
      {!hasObs && (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs">
          Chưa có số đo CPU: giới hạn dự đoán có thể lệch tới 2×. Thêm CPU của process ở từng mức tải (mục 3).
        </div>
      )}

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">Tham số đã fit</h3>
        <div className="grid grid-cols-3 gap-2">
          {rep.params.map((p) => (
            <div key={p.key} className={cn('rounded-md border p-2 font-mono text-xs', p.atBound && 'border-warning/60')}>
              <div className="text-muted-foreground">{p.key}</div>
              <div className="text-sm">{p.multiplier ? `×${p.after.toFixed(3)}` : p.after.toFixed(3)}</div>
              {!p.multiplier && <div className="text-[11px] text-muted-foreground">trước: {p.before.toFixed(3)}</div>}
              {p.atBound && <div className="text-[11px] text-warning">chạm biên khoảng tìm kiếm</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">Đo bằng k6 và mô phỏng</h3>
        <table className="w-full font-mono text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="font-normal" />
              <th className="text-right font-normal">ok rps</th>
              <th className="text-right font-normal">lỗi</th>
              <th className="text-right font-normal">p50</th>
              <th className="text-right font-normal">p95</th>
              <th className="text-right font-normal">p99</th>
            </tr>
          </thead>
          {rep.levels.map((l) => (
            <tbody key={l.measured.name} className="border-t">
              <tr>
                <td colSpan={6} className="pt-2 pb-0.5 font-sans text-[12px] text-muted-foreground">
                  {l.measured.name} · {l.measured.offeredRps.toFixed(0)} rps · {(l.measured.durationMs / 1000).toFixed(0)}s · util sau fit:{' '}
                  {nodes.map((n) => `${n.id} ${pct(l.after.nodeUtilization[n.i])}`).join(', ')}
                </td>
              </tr>
              <Row label="k6 (đo)" p={l.measured} />
              <Row label="trước" p={l.before} m={l.measured} muted />
              <Row label="sau fit" p={l.after} m={l.measured} />
            </tbody>
          ))}
        </table>
      </div>
      <Label className="text-[12px] font-normal leading-relaxed text-muted-foreground">
        Fit tốt trên các mức đã đo chưa chắc dự đoán đúng điểm gãy: hãy chạy thêm một bước k6 gần mức giới hạn ước tính để xác
        nhận trước khi dùng con số này.
      </Label>
    </div>
  );
}
