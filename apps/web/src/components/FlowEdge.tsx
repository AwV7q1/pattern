import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { bezierFor, bezierPath, setEdgeGeometry } from '@/gpu/edgeGeometry';
import type { FlowEdgeType } from '@/model/flow';
import { cn } from '@/lib/utils';

/** Draws the edge, its policy badges, and publishes the exact bezier so particles follow it. */
export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<FlowEdgeType>) {
  const b = bezierFor(sourceX, sourceY, targetX, targetY);
  if (data) setEdgeGeometry(data.index, b); // idempotent, cheap
  const p = data?.policy;
  const breaker = data?.metrics?.breaker ?? 'closed';
  const stroke =
    breaker === 'open'
      ? 'var(--destructive)'
      : breaker === 'halfOpen'
        ? 'var(--warning)'
        : selected
          ? 'var(--primary)'
          : undefined;

  const badges: string[] = [];
  if (p?.timeoutMs) badges.push(`⏱ ${p.timeoutMs}ms`);
  if (p?.retries) badges.push(`↻ ${p.retries}`);
  if (p?.circuitBreaker) badges.push(breaker === 'closed' ? 'CB' : `CB ${breaker === 'open' ? 'OPEN' : 'half'}`);

  // midpoint of the cubic bezier (t = 0.5)
  const mx = (b[0] + 3 * b[2] + 3 * b[4] + b[6]) / 8;
  const my = (b[1] + 3 * b[3] + 3 * b[5] + b[7]) / 8;

  return (
    <>
      <BaseEdge
        id={id}
        path={bezierPath(b)}
        interactionWidth={16}
        style={{
          stroke,
          strokeWidth: selected || breaker !== 'closed' ? 2 : 1.5,
          strokeDasharray: breaker === 'open' ? '6 4' : undefined,
        }}
      />
      {badges.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute flex gap-1"
            style={{ transform: `translate(-50%, -150%) translate(${mx}px, ${my}px)`, zIndex: 2 }}
          >
            {badges.map((t) => (
              <span
                key={t}
                className={cn(
                  'rounded border bg-background/90 px-1 font-mono text-[9px] leading-4 text-muted-foreground',
                  t.includes('OPEN') && 'border-destructive text-destructive',
                )}
              >
                {t}
              </span>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
