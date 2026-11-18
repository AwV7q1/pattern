import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Lock, PowerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KIND_META, fmt, utilColor } from '@/lib/meta';
import type { SystemNodeType } from '@/model/flow';
import { techOf } from '@/tech/catalog';
import { TechLogo } from '@/tech/TechLogo';

const n2 = (v: number) => +v.toFixed(2);

export const SystemNode = memo(function SystemNode({ data }: NodeProps<SystemNodeType>) {
  const meta = KIND_META[data.kind];
  const Icon = meta.icon;
  const tech = techOf(data.tech);
  const m = data.metrics;
  const util = m?.utilization ?? 0;
  const isClient = data.kind === 'client';
  const c = data.config;
  const rejected = m?.rejected ?? 0;
  const replicas = c.autoscale ? (m?.instances ?? c.instances) : c.instances;
  const hot = !isClient && (util > 0.85 || rejected > 0);
  // cpu nodes: the bar shows CPU; "q" counts both backlog and CPU queue

  return (
    <div
      className={cn(
        'sys-node relative w-[200px] rounded-lg border bg-card/95 px-3 py-2 text-card-foreground shadow-md backdrop-blur transition-[border-color,box-shadow]',
        hot && 'border-destructive/80 shadow-[0_0_24px_-4px] shadow-destructive/60',
        data.down && 'border-dashed opacity-60',
      )}
    >
      {!isClient && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2">
        {tech ? (
          <span className="relative">
            <TechLogo tech={tech} className="size-7" />
            <span
              className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-sm border border-card"
              style={{ background: meta.color }}
              title={meta.name}
            >
              <Icon className="size-2.5 text-black/70" />
            </span>
          </span>
        ) : (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-md"
            style={{ background: `${meta.color}26`, color: meta.color }}
          >
            <Icon className="size-3.5" />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm leading-tight font-semibold">{data.label}</div>
          {tech && tech.name !== data.label && (
            <div className="truncate text-[11px] leading-tight text-muted-foreground">{tech.name}</div>
          )}
        </div>
        {data.locked && <Lock className="ml-auto size-3 shrink-0 text-muted-foreground" />}
      </div>
      {isClient ? (
        <div className="mt-1 text-[12px] text-muted-foreground">nguồn traffic</div>
      ) : (
        <>
          <div className="mt-1 truncate text-[12px] text-muted-foreground">
            {c.model === 'cpu'
              ? `${replicas}×${c.cpuLanes} CPU · ${n2(c.cpuP50Ms)}ms CPU${c.ioP50Ms ? ` + ${n2(c.ioP50Ms)}ms I/O` : ''}`
              : `${replicas}×${c.concurrency} slot · p50 ${n2(c.latencyP50Ms)}ms`}
            {c.callsPerRequest > 1 && (data.kind === 'service' || data.kind === 'database') && ` · ${c.callsPerRequest} call`}
            {data.kind === 'cache' &&
              (c.cache
                ? ` · hit ${Math.round((m?.hitRatio ?? 0) * 100)}% · TTL ${c.cache.ttlMs ? `${n2(c.cache.ttlMs / 1000)}s` : '∞'}${c.cache.coalesce ? ' · 1⇢' : ''}`
                : ` · hit ${Math.round(c.hitRate * 100)}%`)}
            {c.routing === 'sequence' && data.kind !== 'loadBalancer' && ' · ①② tuần tự'}
            {c.routing === 'parallel' && data.kind !== 'loadBalancer' && ' · ∥ song song'}
            {c.routing === 'hedge' && data.kind !== 'loadBalancer' && ` · ⧗ hedge ${n2(c.hedgeAfterMs)}ms`}
            {c.routing === 'quorum' && data.kind !== 'loadBalancer' && ` · quorum${c.quorum ? ` ${c.quorum}` : ''}`}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full transition-[width,background-color] duration-300"
              style={{ width: `${Math.round(util * 100)}%`, background: utilColor(util) }}
            />
          </div>
          <div className="mt-1 flex gap-2 font-mono text-[11px] text-muted-foreground">
            <span>{Math.round(util * 100)}%</span>
            <span>{fmt.rps(m?.arrivals ?? 0)}/s</span>
            <span>q {(m?.queue ?? 0) + (m?.cpuQueue ?? 0)}</span>
            {c.model === 'cpu' && (m?.lagMs ?? 0) >= 0.1 && (
              <span className={cn((m?.lagMs ?? 0) > 20 && 'text-warning')}>lag {fmt.ms(m!.lagMs)}</span>
            )}
            {rejected > 0 && <span className="text-destructive">drop {fmt.rps(rejected)}/s</span>}
            {c.autoscale && (
              <span
                className="ml-auto text-primary"
                title={
                  c.autoscale.metric === 'queueLength'
                    ? `KEDA ${c.autoscale.min}–${c.autoscale.max}, ${c.autoscale.targetQueuePerInstance ?? 100} message/replica`
                    : `HPA ${c.autoscale.min}–${c.autoscale.max}, mục tiêu ${Math.round(c.autoscale.targetUtilization * 100)}%`
                }
              >
                {c.autoscale.metric === 'queueLength' ? 'KEDA' : 'HPA'} {replicas}
                {(m?.starting ?? 0) > 0 && `+${m!.starting}`}
              </span>
            )}
          </div>
        </>
      )}
      {data.lint && (
        <span
          className={cn(
            'absolute -top-2.5 left-2 rounded px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold',
            data.lint.worst === 'error' ? 'bg-destructive text-white' : data.lint.worst === 'warn' ? 'bg-warning text-black' : 'bg-muted text-muted-foreground',
          )}
          title={`${data.lint.count} ghi chú ở tab Kiểm tra`}
        >
          {data.lint.worst === 'info' ? 'i' : '!'} {data.lint.count}
        </span>
      )}
      {data.down && (
        <span className="absolute -top-2.5 right-2 flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[11px] font-semibold text-white">
          <PowerOff className="size-2.5" /> DOWN
        </span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
