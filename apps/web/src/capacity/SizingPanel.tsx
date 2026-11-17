import { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Server, Trash2, X } from 'lucide-react';
import { compute } from '@/sim/compute';
import type { Plan, SizingCandidate, SizingReport, SizingSpec } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { Num, Section, Stat, ms, pct, usd } from './fields';

const STORE = 'pattern.sizing.spec';

type Props = {
  onOpen: (report: SizingReport, title: string) => void;
  onReport: (report: SizingReport | null) => void;
};

export function SizingPanel({ onOpen, onReport }: Props) {
  const [spec, setSpec] = useState<SizingSpec | null>(null);
  const [report, setReport] = useState<SizingReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [byUsers, setByUsers] = useState(false);

  useEffect(() => {
    compute.defaults().then((d) => {
      const saved = localStorage.getItem(STORE);
      const s = saved ? { ...d, ...JSON.parse(saved) } : d;
      setSpec(s);
      setByUsers(s.traffic.peakRps <= 0);
    });
  }, []);
  if (!spec) return <p className="p-6 text-sm text-muted-foreground">Đang tải engine…</p>;

  const set = (patch: (s: SizingSpec) => SizingSpec) => setSpec((s) => (s ? patch(structuredClone(s)) : s));
  const peak =
    spec.traffic.peakRps > 0 && !byUsers
      ? spec.traffic.peakRps
      : (spec.traffic.dailyActiveUsers * spec.traffic.requestsPerUser * spec.traffic.peakFactor) / 86400;

  const run = async () => {
    setBusy(true);
    setError(null);
    const s = structuredClone(spec);
    if (byUsers) s.traffic.peakRps = 0;
    localStorage.setItem(STORE, JSON.stringify(s));
    try {
      const r = await compute.size(s);
      setReport(r);
      onReport(r);
    } catch (e) {
      setReport(null);
      onReport(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setPlan = (i: number, p: Partial<Plan>) => set((s) => ((s.plans[i] = { ...s.plans[i], ...p }), s));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(380px,460px)_1fr] gap-0">
      <div className="min-h-0 overflow-y-auto border-r p-4">
        <div className="grid gap-4">
          <Section title="1. Tải mục tiêu" desc="Lấy từ nghiệp vụ hoặc analytics, chưa cần server.">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={byUsers ? 'users' : 'rps'}
              onValueChange={(v) => v && setByUsers(v === 'users')}
            >
              <ToggleGroupItem value="rps" className="text-xs">
                Biết rps cao điểm
              </ToggleGroupItem>
              <ToggleGroupItem value="users" className="text-xs">
                Tính từ số người dùng
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="grid grid-cols-2 gap-3">
              {byUsers ? (
                <>
                  <Num label="Người dùng / ngày" step={1000} value={spec.traffic.dailyActiveUsers} onChange={(v) => set((s) => ((s.traffic.dailyActiveUsers = v), s))} />
                  <Num label="Request / người" value={spec.traffic.requestsPerUser} onChange={(v) => set((s) => ((s.traffic.requestsPerUser = v), s))} />
                  <Num label="Hệ số giờ cao điểm" step={0.5} value={spec.traffic.peakFactor} onChange={(v) => set((s) => ((s.traffic.peakFactor = v), s))} hint="cao điểm / trung bình ngày, thường 5–10" />
                </>
              ) : (
                <Num label="RPS cao điểm" step={50} value={spec.traffic.peakRps} onChange={(v) => set((s) => ((s.traffic.peakRps = v), s))} />
              )}
              <Num label="Đột biến ×" step={0.1} value={spec.traffic.burstFactor} onChange={(v) => set((s) => ((s.traffic.burstFactor = v), s))} hint="khuyến mãi, retry dồn" />
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              → cao điểm {peak.toFixed(0)} rps, thiết kế cho {(peak * spec.traffic.burstFactor).toFixed(0)} rps
            </p>
          </Section>

          <Section
            title="2. Ứng dụng (NestJS / Node)"
            desc={
              <>
                Đo trên máy bạn bằng <code className="text-foreground">tools/k6/cpu-per-request.sh</code>. Node chạy 1 process mỗi vCPU (cluster/PM2).
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Num label="CPU / request p50" step={0.5} suffix="ms" value={spec.app.cpuMsP50} onChange={(v) => set((s) => ((s.app.cpuMsP50 = v), s))} />
              <Num label="CPU / request p99" step={0.5} suffix="ms" value={spec.app.cpuMsP99} onChange={(v) => set((s) => ((s.app.cpuMsP99 = v), s))} />
              <Num label="Query DB / request" value={spec.app.queriesPerRequest} onChange={(v) => set((s) => ((s.app.queriesPerRequest = Math.round(v)), s))} hint="tuần tự (await nối tiếp)" />
              <Num label="Pool / process" value={spec.app.poolPerProcess} onChange={(v) => set((s) => ((s.app.poolPerProcess = Math.round(v)), s))} hint="Prisma connection_limit" />
              <Num label="RAM / process" step={50} suffix="MB" value={spec.app.ramMbPerProcess} onChange={(v) => set((s) => ((s.app.ramMbPerProcess = v), s))} />
              <Num label="Tốc độ vCPU / máy đo" step={0.05} value={spec.cpuSpeedRatio} onChange={(v) => set((s) => ((s.cpuSpeedRatio = v), s))} hint="laptop thường nhanh 1.5–2× vCPU cloud → 0.5–0.7" />
            </div>
          </Section>

          <Section title="3. Database (PostgreSQL)" desc="Thời gian query ở tải thấp: pg_stat_statements hoặc log của ORM.">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Query p50" step={0.5} suffix="ms" value={spec.db.queryMsP50} onChange={(v) => set((s) => ((s.db.queryMsP50 = v), s))} />
              <Num label="Query p99" step={0.5} suffix="ms" value={spec.db.queryMsP99} onChange={(v) => set((s) => ((s.db.queryMsP99 = v), s))} />
              <Num label="Phần CPU (0–1)" step={0.1} value={spec.db.cpuFraction} onChange={(v) => set((s) => ((s.db.cpuFraction = v), s))} hint="còn lại là chờ đĩa / lock" />
              <Num label="max_connections" step={10} value={spec.db.maxConnections} onChange={(v) => set((s) => ((s.db.maxConnections = Math.round(v)), s))} />
              <Num label="Dữ liệu nóng" step={1} suffix="GB" value={spec.db.hotDataGb} onChange={(v) => set((s) => ((s.db.hotDataGb = v), s))} hint="phải nằm vừa RAM" />
            </div>
          </Section>

          <Section title="4. Yêu cầu">
            <div className="grid grid-cols-2 gap-3">
              <Num label="SLO p99" step={50} suffix="ms" value={spec.slo.p99Ms} onChange={(v) => set((s) => ((s.slo.p99Ms = v), s))} />
              <Num label="SLO tỉ lệ lỗi" step={0.005} value={spec.slo.errorRate} onChange={(v) => set((s) => ((s.slo.errorRate = v), s))} />
              <Num label="Response" step={1} suffix="KB" value={spec.responseKb} onChange={(v) => set((s) => ((s.responseKb = v), s))} />
              <Num label="Latency mạng tới user" step={5} suffix="ms" value={spec.clientLatencyMs} onChange={(v) => set((s) => ((s.clientLatencyMs = v), s))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Chịu được mất 1 app server (N+1)</Label>
                <p className="text-[11px] text-muted-foreground">Ít nhất 2 server, kiểm tra cả kịch bản mất 1 máy</p>
              </div>
              <Switch checked={spec.redundancy} onCheckedChange={(v) => set((s) => ((s.redundancy = v), s))} />
            </div>
          </Section>

          <Section
            title="5. Bảng giá VPS"
            desc="Giá tham khảo chung chung, hãy sửa theo nhà cung cấp của bạn. vCPU dùng chung bị trừ ~15% hiệu năng và có đuôi latency dày hơn."
          >
            <div className="grid gap-1.5">
              <div className="grid grid-cols-[1fr_48px_56px_60px_28px_24px] gap-1.5 text-[10px] text-muted-foreground">
                <span>Tên</span>
                <span>vCPU</span>
                <span>RAM GB</span>
                <span>$/tháng</span>
                <span title="dedicated">Ded.</span>
                <span />
              </div>
              {spec.plans.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_48px_56px_60px_28px_24px] items-center gap-1.5">
                  <Input className="h-7 text-xs" value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} />
                  <Input className="h-7 px-1.5 font-mono text-xs" type="number" value={p.vcpu} onChange={(e) => setPlan(i, { vcpu: Number(e.target.value) })} />
                  <Input className="h-7 px-1.5 font-mono text-xs" type="number" value={p.ramGb} onChange={(e) => setPlan(i, { ramGb: Number(e.target.value) })} />
                  <Input className="h-7 px-1.5 font-mono text-xs" type="number" value={p.pricePerMonth} onChange={(e) => setPlan(i, { pricePerMonth: Number(e.target.value) })} />
                  <Switch className="scale-75" checked={p.dedicated} onCheckedChange={(v) => setPlan(i, { dedicated: v })} />
                  <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => set((s) => (s.plans.splice(i, 1), s))}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => set((s) => (s.plans.push({ name: 'Gói mới', vcpu: 4, ramGb: 8, pricePerMonth: 30, dedicated: false }), s))}
              >
                <Plus /> Thêm gói
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Num label="Load balancer" suffix="$/th" value={spec.loadBalancerPerMonth} onChange={(v) => set((s) => ((s.loadBalancerPerMonth = v), s))} />
              <Num label="Chi phí vận hành / server" suffix="$/th" value={spec.opsPerServerMonth} onChange={(v) => set((s) => ((s.opsPerServerMonth = v), s))} hint="monitoring, backup, công sức" />
            </div>
          </Section>
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Server />}
            {busy ? 'Đang mô phỏng các phương án…' : 'Tính và mô phỏng'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Ước tính bằng công thức, rồi mô phỏng từng phương án rẻ nhất (Node cluster + Postgres) ở cao điểm, đột biến, mất 1
            server và DB chậm.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          {report ? <Result report={report} spec={spec} onOpen={onOpen} /> : !error && <Intro />}
        </div>
      </div>
    </div>
  );
}

function Intro() {
  return (
    <div className="mx-auto grid max-w-xl gap-3 pt-10 text-sm text-muted-foreground">
      <p className="text-foreground">Chọn server bằng tính toán, rồi kiểm chứng bằng mô phỏng.</p>
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>Ước tính tải cao điểm từ nghiệp vụ.</li>
        <li>Đo CPU mỗi request và thời gian query trên máy bạn (k6 ở tải thấp).</li>
        <li>Wizard tính số core cần theo utilization law, lọc các tổ hợp gói vừa RAM.</li>
        <li>Mô phỏng từng tổ hợp từ rẻ nhất: chọn phương án đầu tiên đạt SLO ở mọi kịch bản bắt buộc.</li>
        <li>Thuê thử theo giờ và chạy <code className="text-foreground">tools/k6/step-load.js</code> để xác nhận.</li>
      </ol>
    </div>
  );
}

function Result({ report, spec, onOpen }: { report: SizingReport; spec: SizingSpec; onOpen: Props['onOpen'] }) {
  const a = report.analytic;
  const rec = report.recommended !== null ? report.candidates[report.recommended] : null;
  const rule = report.ruleOfThumb !== null ? report.candidates[report.ruleOfThumb] : null;
  const simulated = report.candidates.filter((c) => c.simulated);
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-4 gap-2">
        <Stat label="App: core bận lúc cao điểm" value={a.appCoresBusy.toFixed(1)} sub={`${a.appCpuMs.toFixed(2)} ms CPU/request trên vCPU đích`} />
        <Stat label={`App: vCPU cần ở ${pct(spec.targetUtilization)}`} value={a.appCoresNeeded.toFixed(1)} sub="tính cả đột biến" />
        <Stat label="DB: core bận / cần" value={`${a.dbCoresBusy.toFixed(1)} / ${a.dbCoresNeeded.toFixed(1)}`} sub={`${a.dbConnectionsBusy.toFixed(1)} kết nối bận trung bình`} />
        <Stat label="Mạng lúc đột biến" value={`${a.bandwidthMbps.toFixed(0)} Mbps`} sub={`~${a.monthlyTrafficGb.toFixed(0)} GB/tháng`} />
      </div>

      {rec ? (
        <div className="grid gap-3 rounded-lg border border-success/50 bg-success/5 p-4">
          <div className="flex items-start gap-3">
            <div className="grid flex-1 gap-1">
              <div className="text-xs text-success">Đề xuất (rẻ nhất đạt mọi kiểm tra bắt buộc)</div>
              <div className="text-lg font-semibold">
                {rec.appServers}× {rec.appPlan.name} <span className="text-muted-foreground">+</span> DB {rec.dbPlan.name}
              </div>
              <div className="font-mono text-sm text-muted-foreground">
                {usd(rec.monthlyCost)}/tháng · {rec.appServers * rec.appPlan.vcpu} process Node · pool {rec.poolPerProcess}/process ={' '}
                {rec.poolPerProcess * rec.appServers * rec.appPlan.vcpu} kết nối
              </div>
            </div>
            <Button variant="outline" onClick={() => onOpen(report, `Sizing: ${rec.appServers}× ${rec.appPlan.name}`)}>
              Mở trong Sandbox
            </Button>
          </div>
          {rule && rule !== rec && (
            <p className="text-xs text-muted-foreground">
              Chỉ theo công thức ({pct(spec.targetUtilization)} tải) sẽ chọn {rule.appServers}× {rule.appPlan.name} + DB {rule.dbPlan.name} (
              {usd(rule.monthlyCost)}/tháng){rule.monthlyCost > rec.monthlyCost ? ': mô phỏng cho thấy rẻ hơn vẫn đạt.' : '.'}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">Chưa tìm được phương án đạt mọi kiểm tra.</div>
      )}

      {report.notes.length > 0 && (
        <ul className="grid gap-1.5 text-sm">
          {report.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="text-muted-foreground">•</span>
              {n}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">Các phương án đã mô phỏng ({simulated.length})</h3>
        {simulated.map((c, i) => (
          <CandidateCard key={i} c={c} recommended={c === rec} />
        ))}
      </div>
    </div>
  );
}

function CandidateCard({ c, recommended }: { c: SizingCandidate; recommended: boolean }) {
  return (
    <div className={cn('rounded-lg border p-3', recommended && 'border-success/60')}>
      <div className="flex items-center gap-2 text-sm">
        {c.pass ? <Check className="size-4 text-success" /> : <X className="size-4 text-destructive" />}
        <span className="font-medium">
          {c.appServers}× {c.appPlan.name} + DB {c.dbPlan.name}
        </span>
        {recommended && <Badge className="bg-success text-white">đề xuất</Badge>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {usd(c.monthlyCost)}/th · CPU app {pct(c.appUtilization)} · DB {pct(c.dbUtilization)}
        </span>
      </div>
      <table className="mt-2 w-full font-mono text-[11px]">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="font-normal">Kịch bản</th>
            <th className="text-right font-normal">rps</th>
            <th className="text-right font-normal">p50</th>
            <th className="text-right font-normal">p99</th>
            <th className="text-right font-normal">lỗi</th>
            <th className="text-right font-normal">CPU app</th>
            <th className="text-right font-normal">CPU DB</th>
            <th className="text-right font-normal">pool</th>
            <th className="text-right font-normal">lag</th>
          </tr>
        </thead>
        <tbody>
          {c.checks.map((k) => (
            <tr key={k.name} className={cn(!k.pass && k.required && 'text-destructive', !k.required && 'text-muted-foreground')}>
              <td className="py-0.5 font-sans">
                {k.pass ? '✔' : '✘'} {k.name}
                {!k.required && ' (tham khảo)'}
              </td>
              <td className="text-right">{k.rps.toFixed(0)}</td>
              <td className="text-right">{ms(k.p50Ms)}</td>
              <td className="text-right">{ms(k.p99Ms)}</td>
              <td className="text-right">{(k.errorRate * 100).toFixed(2)}%</td>
              <td className="text-right">{pct(k.appUtilization)}</td>
              <td className="text-right">{pct(k.dbUtilization)}</td>
              <td className="text-right">{pct(k.poolUtilization)}</td>
              <td className="text-right">{ms(k.eventLoopLagMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
