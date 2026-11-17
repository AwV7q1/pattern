import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Lock, PowerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KIND_META, fmt, utilColor } from '@/lib/meta';
import type { SystemNodeType } from '@/model/flow';

export const SystemNode = memo(function SystemNode({ data }: NodeProps<SystemNodeType>) {
  const meta = KIND_META[data.kind];
  const Icon = meta.icon;
  const m = data.metrics;
  const util = m?.utilization ?? 0;
  const isClient = data.kind === 'client';
  const c = data.config;
  const rejected = m?.rejected ?? 0;
  const hot = !isClient && (util > 0.85 || rejected > 0);

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
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-md"
          style={{ background: `${meta.color}26`, color: meta.color }}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="truncate text-sm font-semibold">{data.label}</span>
        {data.locked && <Lock className="ml-auto size-3 shrink-0 text-muted-foreground" />}
      </div>
      {isClient ? (
        <div className="mt-1 text-[11px] text-muted-foreground">nguồn traffic</div>
      ) : (
        <>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {c.instances}×{c.concurrency} slot · p50 {c.latencyP50Ms}ms
            {data.kind === 'cache' && ` · hit ${Math.round(c.hitRate * 100)}%`}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full transition-[width,background-color] duration-300"
              style={{ width: `${Math.round(util * 100)}%`, background: utilColor(util) }}
            />
          </div>
          <div className="mt-1 flex gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{Math.round(util * 100)}%</span>
            <span>{fmt.rps(m?.arrivals ?? 0)}/s</span>
            <span>q {m?.queue ?? 0}</span>
            {rejected > 0 && <span className="text-destructive">drop {fmt.rps(rejected)}/s</span>}
          </div>
        </>
      )}
      {data.down && (
        <span className="absolute -top-2.5 right-2 flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <PowerOff className="size-2.5" /> DOWN
        </span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
