import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodeConfig, NodeKind, NodeWindow } from '../types';

export type SystemNodeData = {
  index: number;
  label: string;
  kind: NodeKind;
  config: NodeConfig;
  metrics?: NodeWindow;
  down: boolean;
};
export type SystemNodeType = Node<SystemNodeData, 'system'>;

export const KIND_META: Record<NodeKind, { tag: string; color: string; name: string }> = {
  client: { tag: 'USR', color: '#a78bfa', name: 'Client' },
  loadBalancer: { tag: 'LB', color: '#60a5fa', name: 'Load balancer' },
  service: { tag: 'SVC', color: '#34d399', name: 'Service' },
  cache: { tag: 'CACHE', color: '#f472b6', name: 'Cache' },
  database: { tag: 'DB', color: '#fbbf24', name: 'Database' },
  queue: { tag: 'QUEUE', color: '#22d3ee', name: 'Queue' },
};

function utilColor(u: number) {
  if (u < 0.6) return '#34d399';
  if (u < 0.85) return '#fbbf24';
  return '#f87171';
}

export function SystemNode({ data, selected }: NodeProps<SystemNodeType>) {
  const meta = KIND_META[data.kind];
  const m = data.metrics;
  const util = m?.utilization ?? 0;
  const isClient = data.kind === 'client';
  const c = data.config;
  const hot = !isClient && (util > 0.85 || (m?.rejected ?? 0) > 0);

  return (
    <div className={`sys-node${selected ? ' selected' : ''}${data.down ? ' down' : ''}${hot ? ' hot' : ''}`}>
      {!isClient && <Handle type="target" position={Position.Left} />}
      <div className="sys-node-head">
        <span className="sys-tag" style={{ background: meta.color }}>{meta.tag}</span>
        <span className="sys-label">{data.label}</span>
      </div>
      {isClient ? (
        <div className="sys-sub">traffic source</div>
      ) : (
        <>
          <div className="sys-sub">
            {c.instances}×{c.concurrency} slots · p50 {c.latencyP50Ms}ms
            {data.kind === 'cache' && ` · hit ${Math.round(c.hitRate * 100)}%`}
          </div>
          <div className="sys-bar">
            <div style={{ width: `${Math.round(util * 100)}%`, background: utilColor(util) }} />
          </div>
          <div className="sys-stats">
            <span>{Math.round(util * 100)}%</span>
            <span>queue {m?.queue ?? 0}</span>
            {(m?.rejected ?? 0) > 0 && <span className="bad">rejected {m!.rejected}/s</span>}
          </div>
        </>
      )}
      {data.down && <div className="sys-down">DOWN</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
