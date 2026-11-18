import { fmt } from '@/lib/meta';
import type { RequestType, Scenario, WindowMetrics } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Chart } from '@/components/Chart';
import { cn } from '@/lib/utils';

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <div
        className={cn(
          'font-mono text-base font-semibold tabular-nums',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

interface Props {
  windows: WindowMetrics[];
  scenario: Scenario;
  cost: number;
  /** Autoscaled nodes: engine index and label, for the replica chart. */
  replicas?: { index: number; label: string }[];
  /** Endpoint names of the design, for the request mix. */
  endpoints?: string[];
  /** Saved projects: edit the request mix (restarts the run). */
  onRequestsChange?: (requests: RequestType[]) => void;
}

const TYPE_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#22d3ee'];
const NO_EP = '__none';

/** Request types drawn by weight, each entering through one endpoint. */
function RequestMix({
  scenario,
  windows,
  endpoints,
  onChange,
}: {
  scenario: Scenario;
  windows: WindowMetrics[];
  endpoints: string[];
  onChange?: (r: RequestType[]) => void;
}) {
  const types = scenario.requests ?? [];
  const total = types.reduce((s, t) => s + Math.max(0, t.weight), 0);
  const recent = windows.slice(-5);
  const set = (i: number, patch: Partial<RequestType>) => onChange?.(types.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  if (!types.length && (!onChange || !endpoints.length)) return null;
  return (
    <div className="grid gap-2 rounded-md border p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Loại request (traffic mix)</span>
        {onChange && endpoints.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => {
              let k = types.length + 1;
              while (types.some((t) => t.name === `type-${k}`)) k++;
              onChange([...types, { name: `type-${k}`, weight: 1, endpoint: endpoints[0] }]);
            }}
          >
            + Thêm
          </Button>
        )}
      </div>
      {!types.length ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Mọi request giống nhau. Thêm loại (vd. 90% xem sản phẩm, 10% checkout) để mỗi loại đi một đường riêng qua các
          endpoint và có p99 / lỗi riêng: thấy được luồng ít nhưng nặng làm chậm luồng nhiều mà nhẹ.
        </p>
      ) : (
        <div className="grid gap-1.5">
          {types.map((t, i) => {
            const ok = recent.reduce((s, w) => s + (w.requests?.[i]?.rps ?? 0), 0) / Math.max(1, recent.length);
            const err = recent.reduce((s, w) => s + (w.requests?.[i]?.errorRps ?? 0), 0) / Math.max(1, recent.length);
            const p99 = windows.at(-1)?.requests?.[i]?.p99Ms ?? 0;
            const errRate = ok + err > 0 ? err / (ok + err) : 0;
            const share = fmt.pct(total ? Math.max(0, t.weight) / total : 0, 0);
            return (
              <div key={i} className="grid gap-0.5">
                <div className="flex items-center gap-1.5 text-[12px]">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
                  {onChange ? (
                    <>
                      <Input
                        className="h-6 min-w-0 flex-1 px-1 font-mono text-xs"
                        value={t.name}
                        onChange={(e) => set(i, { name: e.target.value })}
                      />
                      <Input
                        type="number"
                        min={0}
                        title="tỉ lệ (trọng số)"
                        className="h-6 w-14 px-1 font-mono text-xs"
                        value={t.weight}
                        onChange={(e) => set(i, { weight: Math.max(0, Number(e.target.value)) })}
                      />
                      <Select value={t.endpoint ?? NO_EP} onValueChange={(v) => set(i, { endpoint: v === NO_EP ? null : v })}>
                        <SelectTrigger size="sm" className="h-6 w-32 font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_EP}>(mặc định)</SelectItem>
                          {endpoints.map((n) => (
                            <SelectItem key={n} value={n} className="font-mono">
                              /{n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => onChange(types.filter((_, j) => j !== i))}>
                        ✕
                      </Button>
                    </>
                  ) : (
                    <span className="font-mono">
                      {t.name} <span className="text-muted-foreground">→ {t.endpoint ? `/${t.endpoint}` : 'mặc định'}</span>
                    </span>
                  )}
                </div>
                <div className="pl-3.5 font-mono text-[11px] text-muted-foreground">
                  {share} · {fmt.rps(ok)} ok/s ·{' '}
                  <span className={cn(errRate > scenario.slo.errorRate && 'text-destructive')}>lỗi {fmt.pct(errRate)}</span> ·{' '}
                  <span className={cn(p99 > scenario.slo.p99Ms && 'text-destructive')}>p99 {fmt.ms(p99)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const REPLICA_COLORS = ['#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fbbf24'];

export function MetricsPanel({ windows, scenario, cost, replicas = [], endpoints = [], onRequestsChange }: Props) {
  const types = scenario.requests ?? [];
  const loopDropped = windows.reduce((s, w) => s + (w.loopDropped ?? 0), 0);
  const last = windows.at(-1);
  const count = last ? last.okCount + last.errorCount : 0;
  const errRate = last && count ? last.errorCount / count : 0;
  const withTraffic = windows.filter((w) => w.okCount + w.errorCount > 0);
  const sloRatio = withTraffic.length ? withTraffic.filter((w) => w.sloOk).length / withTraffic.length : null;
  const budget = scenario.budgetPerHour;

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2 @3xl:grid-cols-6">
        <Stat label="ok / giây" value={fmt.rps(last?.rps ?? 0)} />
        <Stat label="lỗi" value={fmt.pct(errRate)} tone={errRate > scenario.slo.errorRate ? 'bad' : undefined} />
        <Stat
          label="p99"
          value={fmt.ms(last?.p99Ms ?? 0)}
          tone={(last?.p99Ms ?? 0) > scenario.slo.p99Ms ? 'bad' : undefined}
        />
        <Stat label="retry / giây" value={fmt.rps(last?.retries ?? 0)} tone={last?.retries ? 'bad' : undefined} />
        <Stat label="timeout / giây" value={fmt.rps(last?.timeoutCount ?? 0)} />
        <Stat
          label={budget ? `/giờ (≤ ${fmt.money(budget)})` : 'chi phí / giờ'}
          value={fmt.money(cost)}
          tone={budget ? (cost <= budget + 1e-9 ? 'good' : 'bad') : undefined}
        />
      </div>
      <div className="flex items-baseline justify-between rounded-md border px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Thời gian đạt SLO (p99 ≤ {scenario.slo.p99Ms}ms, lỗi ≤ {fmt.pct(scenario.slo.errorRate, 0)})
        </span>
        <span
          className={cn(
            'font-mono text-lg font-semibold',
            sloRatio === null ? 'text-muted-foreground' : sloRatio >= 0.98 ? 'text-success' : 'text-destructive',
          )}
        >
          {sloRatio === null ? '–' : fmt.pct(sloRatio, 0)}
        </span>
      </div>
      <RequestMix scenario={scenario} windows={windows} endpoints={endpoints} onChange={onRequestsChange} />
      {loopDropped > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-[12px] leading-relaxed">
          <b className="text-destructive">Vòng lặp sự kiện:</b> {loopDropped.toLocaleString()} message bị bỏ vì vượt{' '}
          {scenario.maxAsyncHops ?? 16} bước async (A bắn event → B bắn event → A…). Ngoài đời vòng này chạy mãi và nhân
          tải lên; hãy cho handler cuối vòng không bắn event nữa (tách endpoint) hoặc thêm điều kiện dừng.
        </div>
      )}
      <div className="grid gap-3 @3xl:grid-cols-2">
        <Chart
          title="Throughput"
          unit="/s"
          series={[
            { label: 'ok', color: '#34d399', values: windows.map((w) => w.rps) },
            { label: 'err', color: '#f87171', values: windows.map((w) => w.errorRps) },
            { label: 'retry', color: '#ff9e26', values: windows.map((w) => w.retries) },
          ]}
        />
        <Chart
          title="Latency"
          unit="ms"
          threshold={{ value: scenario.slo.p99Ms, label: 'SLO' }}
          series={[
            { label: 'p50', color: '#60a5fa', values: windows.map((w) => w.p50Ms) },
            { label: 'p99', color: '#fbbf24', values: windows.map((w) => w.p99Ms) },
          ]}
        />
        {types.length > 0 && windows.some((w) => w.requests?.length) && (
          <Chart
            title="p99 theo loại request"
            unit="ms"
            threshold={{ value: scenario.slo.p99Ms, label: 'SLO' }}
            series={types.slice(0, TYPE_COLORS.length).map((t, i) => ({
              label: t.name,
              color: TYPE_COLORS[i],
              values: windows.map((w) => w.requests?.[i]?.p99Ms ?? 0),
            }))}
          />
        )}
        {replicas.length > 0 && (
          <Chart
            title="Replica (HPA)"
            unit=""
            series={replicas.slice(0, 5).map((r, i) => ({
              label: r.label,
              color: REPLICA_COLORS[i],
              values: windows.map((w) => w.nodes[r.index]?.instances ?? 0),
            }))}
          />
        )}
        {windows.some((w) => w.asyncOk > 0) && (
          <Chart
            title="Xử lý bất đồng bộ"
            unit="/s"
            series={[{ label: 'done', color: '#22d3ee', values: windows.map((w) => w.asyncOk) }]}
          />
        )}
      </div>
    </div>
  );
}
