import { fmt } from '@/lib/meta';
import type { Scenario, WindowMetrics } from '@/types';
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
  /** Cache nodes, for the hit-ratio chart. */
  caches?: { index: number; label: string }[];
}

const REPLICA_COLORS = ['#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fbbf24'];

export function MetricsPanel({ windows, scenario, cost, replicas = [], caches = [] }: Props) {
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
        {caches.length > 0 && windows.some((w) => caches.some((c) => w.nodes[c.index]?.hitRatio !== undefined)) && (
          <Chart
            title="Cache hit ratio"
            unit="%"
            series={caches.slice(0, 5).map((c, i) => ({
              label: c.label,
              color: REPLICA_COLORS[i],
              values: windows.map((w) => (w.nodes[c.index]?.hitRatio ?? 0) * 100),
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
