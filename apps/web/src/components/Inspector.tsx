import { useEffect, useState } from 'react';
import type { NodeConfig } from '../types';
import { KIND_META, type SystemNodeData } from './SystemNode';

interface Props {
  node: SystemNodeData;
  onApply: (config: NodeConfig) => void;
  onToggleDown: () => void;
}

const FIELDS: Array<{ key: keyof NodeConfig; label: string; step: number; kinds?: string[] }> = [
  { key: 'instances', label: 'Instances', step: 1 },
  { key: 'concurrency', label: 'Concurrency / instance', step: 1 },
  { key: 'queueSize', label: 'Queue / instance', step: 10 },
  { key: 'latencyP50Ms', label: 'Latency p50 (ms)', step: 0.5 },
  { key: 'latencyP99Ms', label: 'Latency p99 (ms)', step: 0.5 },
  { key: 'errorRate', label: 'Error rate (0-1)', step: 0.01 },
  { key: 'hitRate', label: 'Hit rate (0-1)', step: 0.05, kinds: ['cache'] },
  { key: 'costPerHour', label: 'Cost / instance / h', step: 0.01 },
];

export function Inspector({ node, onApply, onToggleDown }: Props) {
  const [draft, setDraft] = useState<NodeConfig>(node.config);
  useEffect(() => setDraft(node.config), [node.config, node.index]);

  if (node.kind === 'client') {
    return <p className="muted">Client sinh traffic, điều chỉnh RPS ở phần Traffic.</p>;
  }
  const dirty = FIELDS.some((f) => draft[f.key] !== node.config[f.key]);

  return (
    <div className="inspector">
      <div className="inspector-title">
        <span className="sys-tag" style={{ background: KIND_META[node.kind].color }}>{KIND_META[node.kind].tag}</span>
        {node.label}
      </div>
      {FIELDS.filter((f) => !f.kinds || f.kinds.includes(node.kind)).map((f) => (
        <label key={f.key} className="field">
          <span>{f.label}</span>
          <input
            type="number"
            step={f.step}
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <div className="row">
        <button disabled={!dirty} onClick={() => onApply(draft)}>Áp dụng & chạy lại</button>
        <button className={node.down ? 'ok' : 'danger'} onClick={onToggleDown}>
          {node.down ? 'Khôi phục node' : 'Chaos: tắt node'}
        </button>
      </div>
    </div>
  );
}
