import { useEffect, useState, type ReactNode } from 'react';
import { PowerOff, Power, Trash2 } from 'lucide-react';
import { KIND_META, fmt } from '@/lib/meta';
import type { FlowEdgeData, SystemNodeData } from '@/model/flow';
import { DEFAULT_BREAKER, type EdgePolicy, type NodeConfig } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

function NumberField({
  label,
  value,
  step = 1,
  min = 0,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        className="h-8 font-mono"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const NODE_FIELDS: Array<{ key: keyof NodeConfig; label: string; step: number; kinds?: string[] }> = [
  { key: 'instances', label: 'Instances', step: 1 },
  { key: 'concurrency', label: 'Slot / instance', step: 1 },
  { key: 'queueSize', label: 'Hàng đợi / instance', step: 10 },
  { key: 'latencyP50Ms', label: 'Latency p50 (ms)', step: 0.5 },
  { key: 'latencyP99Ms', label: 'Latency p99 (ms)', step: 0.5 },
  { key: 'errorRate', label: 'Tỉ lệ lỗi (0-1)', step: 0.01 },
  { key: 'hitRate', label: 'Hit rate (0-1)', step: 0.05, kinds: ['cache'] },
  { key: 'costPerHour', label: 'Giá / instance / giờ', step: 0.01 },
];

interface NodeProps {
  node: SystemNodeData;
  /** Game mode: only the instance count is up to the player. */
  game: boolean;
  maxInstances: number;
  onChange: (config: NodeConfig, label: string) => void;
  onToggleDown: () => void;
  onDelete: () => void;
}

export function NodeInspector({ node, game, maxInstances, onChange, onToggleDown, onDelete }: NodeProps) {
  const [draft, setDraft] = useState(node.config);
  const [label, setLabel] = useState(node.label);
  useEffect(() => {
    setDraft(node.config);
    setLabel(node.label);
  }, [node.config, node.label, node.index]);
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const dirty = label !== node.label || NODE_FIELDS.some((f) => draft[f.key] !== node.config[f.key]);
  const editable = !node.locked;

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <span
          className="flex size-7 items-center justify-center rounded-md"
          style={{ background: `${meta.color}26`, color: meta.color }}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{node.label}</div>
          <div className="text-xs text-muted-foreground">{meta.name}</div>
        </div>
        {node.locked && <Badge variant="secondary">cố định</Badge>}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{meta.blurb}</p>

      {node.kind === 'client' ? (
        <p className="text-sm text-muted-foreground">Traffic được điều khiển ở tab Số liệu hoặc theo kịch bản level.</p>
      ) : game ? (
        <div className="grid gap-3">
          {editable ? (
            <div className="grid gap-2">
              <div className="flex justify-between text-xs">
                <Label className="text-muted-foreground">Instances</Label>
                <span className="font-mono">
                  {draft.instances} × {fmt.money(node.config.costPerHour)} ={' '}
                  {fmt.money(draft.instances * node.config.costPerHour)}/h
                </span>
              </div>
              <Slider
                min={1}
                max={maxInstances}
                step={1}
                value={[draft.instances]}
                onValueChange={([v]) => setDraft({ ...draft, instances: v })}
                onValueCommit={([v]) => onChange({ ...draft, instances: v }, label)}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Node của level, không chỉnh được.</p>
          )}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
            <dt className="text-muted-foreground">slot / inst</dt>
            <dd>{node.config.concurrency}</dd>
            <dt className="text-muted-foreground">hàng đợi</dt>
            <dd>{node.config.queueSize}</dd>
            <dt className="text-muted-foreground">p50 / p99</dt>
            <dd>
              {node.config.latencyP50Ms} / {node.config.latencyP99Ms} ms
            </dd>
            {node.kind === 'cache' && (
              <>
                <dt className="text-muted-foreground">hit rate</dt>
                <dd>{fmt.pct(node.config.hitRate, 0)}</dd>
              </>
            )}
          </dl>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Tên</Label>
            <Input className="h-8" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {NODE_FIELDS.filter((f) => !f.kinds || f.kinds.includes(node.kind)).map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                step={f.step}
                value={draft[f.key]}
                onChange={(v) => setDraft({ ...draft, [f.key]: v })}
              />
            ))}
          </div>
          <Button size="sm" disabled={!dirty} onClick={() => onChange(draft, label)}>
            Áp dụng và chạy lại
          </Button>
        </div>
      )}

      {node.kind !== 'client' && (
        <>
          <Separator />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={node.down ? 'secondary' : 'outline'}
              className="flex-1"
              onClick={onToggleDown}
            >
              {node.down ? <Power /> : <PowerOff />}
              {node.down ? 'Khôi phục' : 'Chaos: tắt node'}
            </Button>
            {editable && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
                <Trash2 />
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface EdgeProps {
  edge: FlowEdgeData;
  source: string;
  target: string;
  game: boolean;
  onChange: (policy: EdgePolicy) => void;
  onDelete: () => void;
}

export function EdgeInspector({ edge, source, target, game, onChange, onDelete }: EdgeProps) {
  const [p, setP] = useState(edge.policy);
  useEffect(() => setP(edge.policy), [edge.policy, edge.index]);
  const dirty = JSON.stringify(p) !== JSON.stringify(edge.policy);
  const cb = p.circuitBreaker;
  const m = edge.metrics;

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-semibold">
          {source} → {target}
        </div>
        <div className="text-xs text-muted-foreground">Chính sách phía caller khi gọi qua edge này</div>
      </div>
      {m && (
        <div className="grid grid-cols-4 gap-1 rounded-md border bg-muted/30 p-2 text-center font-mono text-[11px]">
          <div>
            <div>{fmt.rps(m.calls)}</div>
            <div className="text-muted-foreground">call/s</div>
          </div>
          <div>
            <div>{m.retries}</div>
            <div className="text-muted-foreground">retry</div>
          </div>
          <div>
            <div>{m.timeouts}</div>
            <div className="text-muted-foreground">timeout</div>
          </div>
          <div className={m.breaker === 'open' ? 'text-destructive' : ''}>
            <div>{m.breaker}</div>
            <div className="text-muted-foreground">CB</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {!game && (
          <NumberField
            label="Network latency (ms)"
            step={0.5}
            value={p.latencyMs}
            onChange={(v) => setP({ ...p, latencyMs: v })}
          />
        )}
        <NumberField
          label="Timeout (ms, 0 = không)"
          step={10}
          value={p.timeoutMs ?? 0}
          onChange={(v) => setP({ ...p, timeoutMs: v > 0 ? v : null })}
        />
        <NumberField
          label="Số lần retry"
          value={p.retries}
          onChange={(v) => setP({ ...p, retries: Math.max(0, Math.round(v)) })}
        />
        <NumberField
          label="Backoff (ms)"
          step={10}
          value={p.backoffMs}
          onChange={(v) => setP({ ...p, backoffMs: v })}
          hint="lần n chờ backoff × 2ⁿ⁻¹"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">Jitter (ngẫu nhiên hoá backoff)</Label>
        <Switch checked={p.jitter} onCheckedChange={(jitter) => setP({ ...p, jitter })} />
      </div>
      <Separator />
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs">Circuit breaker</Label>
          <p className="text-[11px] text-muted-foreground">Lỗi vượt ngưỡng thì ngắt, trả lỗi ngay không gọi xuống</p>
        </div>
        <Switch
          checked={!!cb}
          onCheckedChange={(on) => setP({ ...p, circuitBreaker: on ? { ...DEFAULT_BREAKER } : null })}
        />
      </div>
      {cb && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Ngưỡng lỗi (0-1)"
            step={0.05}
            value={cb.failureThreshold}
            onChange={(v) => setP({ ...p, circuitBreaker: { ...cb, failureThreshold: v } })}
          />
          <NumberField
            label="Tối thiểu request"
            value={cb.minRequests}
            onChange={(v) => setP({ ...p, circuitBreaker: { ...cb, minRequests: v } })}
          />
          <NumberField
            label="Cửa sổ (ms)"
            step={100}
            value={cb.windowMs}
            onChange={(v) => setP({ ...p, circuitBreaker: { ...cb, windowMs: v } })}
          />
          <NumberField
            label="Mở trong (ms)"
            step={500}
            value={cb.openMs}
            onChange={(v) => setP({ ...p, circuitBreaker: { ...cb, openMs: v } })}
          />
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" disabled={!dirty} onClick={() => onChange(p)}>
          Áp dụng và chạy lại
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
