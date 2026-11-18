import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  AlarmClock,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  Cable,
  ChevronRight,
  Cpu,
  DollarSign,
  Gauge,
  GitCompareArrows,
  Hash,
  Hourglass,
  Inbox,
  Info,
  Layers,
  ListOrdered,
  CopyPlus,
  Users,
  Eraser,
  KeyRound,
  Shuffle,
  TrendingDown,
  Lock,
  Network,
  Percent,
  PowerOff,
  Power,
  Recycle,
  Repeat2,
  Rocket,
  Server,
  Sigma,
  Tag,
  Target,
  Timer,
  Trash2,
  TriangleAlert,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { KIND_META, fmt } from '@/lib/meta';
import type { FlowEdgeData, SystemNodeData } from '@/model/flow';
import { DEFAULT_AUTOSCALE, DEFAULT_BREAKER, DEFAULT_CACHE_MODEL, DEFAULT_TARGET_QUEUE_LENGTH, type CacheModel, type Autoscale, type Balance, type EdgePolicy, type ExecModel, type NodeConfig, type Routing } from '@/types';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { swapCandidates, techOf } from '@/tech/catalog';
import { TechLogo } from '@/tech/TechLogo';
import { techUi } from '@/tech/ui-store';

function NumberField({
  label,
  value,
  step = 1,
  min = 0,
  onChange,
  hint,
  icon: Icon,
}: {
  label: string;
  icon?: LucideIcon;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
}) {
  return (
    // Subgrid over 3 parent rows (label / input / hint) so fields side by side
    // keep their inputs on one line even when a label wraps or only one has a hint.
    <div className={FIELD_CELL}>
      <Label className="self-end text-xs leading-snug text-muted-foreground">{label}</Label>
      <div className="relative">
        {Icon && <Icon className={FIELD_ICON} aria-hidden />}
        <Input
          type="number"
          className={Icon ? 'h-8 pl-8 font-mono' : 'h-8 font-mono'}
          step={step}
          min={min}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      {hint ? <p className="text-[12px] leading-snug text-muted-foreground">{hint}</p> : <span />}
    </div>
  );
}

const FIELD_CELL = 'row-span-3 grid grid-rows-subgrid gap-y-1.5';
const FIELD_ICON = 'pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground';

type NumKey = { [K in keyof NodeConfig]-?: NodeConfig[K] extends number ? K : never }[keyof NodeConfig];
type Field = { key: NumKey; label: string; icon: LucideIcon; step: number; kinds?: string[]; hint?: string };

const ROUTING_HELP: Record<Routing, string> = {
  pick: 'Mỗi lần gọi chọn MỘT nhánh, xoay vòng (như load balancer, chia cho các replica).',
  sequence:
    'Gọi LẦN LƯỢT mọi nhánh theo thứ tự ①②③ (await a; await b). Latency = tổng các nhánh. Nhánh cùng số thứ tự chạy cùng lúc.',
  parallel:
    'Gọi CÙNG LÚC mọi nhánh rồi chờ tất cả (Promise.all). Latency = nhánh chậm nhất; một nhánh lỗi là cả request lỗi ngay.',
};

/** How a node with several outgoing edges calls them. */
export function RoutingField({ value, onChange }: { value: Routing; onChange: (r: Routing) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">Gọi các nhánh phía sau</Label>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="w-full"
        value={value}
        onValueChange={(v) => v && onChange(v as Routing)}
      >
        <ToggleGroupItem value="pick" className="text-xs">
          ⇄ Chọn 1
        </ToggleGroupItem>
        <ToggleGroupItem value="sequence" className="text-xs">
          ①② Tuần tự
        </ToggleGroupItem>
        <ToggleGroupItem value="parallel" className="text-xs">
          ∥ Song song
        </ToggleGroupItem>
      </ToggleGroup>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{ROUTING_HELP[value]}</p>
    </div>
  );
}

const COMMON_FIELDS: Field[] = [
  { key: 'instances', label: 'Instances (server)', icon: Server, step: 1 },
  { key: 'callsPerRequest', label: 'Lời gọi xuống / request', icon: Repeat2, step: 1, kinds: ['service', 'database'], hint: 'chế độ Chọn 1: N lần tuần tự, vd. N query' },
  { key: 'errorRate', label: 'Tỉ lệ lỗi (0-1)', icon: TriangleAlert, step: 0.01 },
  { key: 'hitRate', label: 'Hit rate (0-1)', icon: Target, step: 0.05, kinds: ['cache'] },
  { key: 'costPerHour', label: 'Giá / instance / giờ', icon: DollarSign, step: 0.01 },
];
const THREAD_FIELDS: Field[] = [
  { key: 'concurrency', label: 'Slot / instance', icon: Layers, step: 1, hint: 'thread/connection pool' },
  { key: 'queueSize', label: 'Hàng đợi / instance', icon: ListOrdered, step: 10 },
  { key: 'latencyP50Ms', label: 'Xử lý p50 (ms)', icon: Timer, step: 0.5 },
  { key: 'latencyP99Ms', label: 'Xử lý p99 (ms)', icon: Timer, step: 0.5 },
];
const CPU_FIELDS: Field[] = [
  { key: 'cpuLanes', label: 'CPU lane / instance', icon: Cpu, step: 1, hint: 'Node: số process, DB: số core' },
  { key: 'maxInFlight', label: 'Request mở tối đa', icon: Network, step: 100, hint: 'Postgres: max_connections' },
  { key: 'cpuP50Ms', label: 'CPU p50 (ms)', icon: Gauge, step: 0.1 },
  { key: 'cpuP99Ms', label: 'CPU p99 (ms)', icon: Gauge, step: 0.1 },
  { key: 'ioP50Ms', label: 'Chờ I/O p50 (ms)', icon: Hourglass, step: 0.5, hint: 'không chiếm CPU' },
  { key: 'ioP99Ms', label: 'Chờ I/O p99 (ms)', icon: Hourglass, step: 0.5 },
  { key: 'queueSize', label: 'Backlog / instance', icon: Inbox, step: 10 },
];
const ADVANCED_FIELDS: Field[] = [
  { key: 'contention', label: 'USL contention σ', icon: Lock, step: 0.005, hint: 'tranh chấp lock' },
  { key: 'coherency', label: 'USL coherency κ', icon: Sigma, step: 0.0005 },
  { key: 'wakeupMs', label: 'Wake-up (ms)', icon: AlarmClock, step: 0.05, kinds: ['cpu'], hint: 'CPU đánh thức process rảnh' },
  { key: 'gcPauseMs', label: 'GC pause (ms)', icon: Recycle, step: 1, kinds: ['cpu'] },
  { key: 'gcEveryRequests', label: 'GC mỗi N request', icon: Hash, step: 100, kinds: ['cpu'] },
];

interface NodeProps {
  node: SystemNodeData;
  /** Outgoing edges: routing only matters with more than one. */
  outDegree: number;
  /** Game mode: only the instance count is up to the player. */
  game: boolean;
  maxInstances: number;
  /** Queue nodes of the design, for KEDA-style autoscaling. */
  queues?: { id: string; label: string }[];
  onChange: (config: NodeConfig, label: string) => void;
  onToggleDown: () => void;
  /** Keyspace caches: evict every key now (sandbox chaos). */
  onFlush?: () => void;
  onDelete: () => void;
  /** Sandbox: switch the real-world technology (optionally taking its default numbers). */
  onTech?: (tech: string | undefined, applyDefaults: boolean) => void;
}

const NO_TECH = '__none';

/** Which product this node is, with a quick swap to an alternative. */
function TechSection({ node, onTech }: { node: SystemNodeData; onTech: NonNullable<NodeProps['onTech']> }) {
  const tech = techOf(node.tech);
  const [applyDefaults, setApplyDefaults] = useState(true);
  const options = [...(tech ? [tech] : []), ...swapCandidates(tech, node.kind)];
  return (
    <div className="grid gap-2 rounded-md border p-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Công nghệ</Label>
        {tech && (
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost" className="size-6" title="Chi tiết" onClick={() => techUi.openSheet(tech.id)}>
              <Info />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-6"
              title="So sánh với lựa chọn thay thế"
              onClick={() => techUi.compareWith([tech.id, ...tech.alternatives.slice(0, 2)])}
            >
              <GitCompareArrows />
            </Button>
          </div>
        )}
      </div>
      <Select value={tech?.id ?? NO_TECH} onValueChange={(v) => onTech(v === NO_TECH ? undefined : v, applyDefaults)}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TECH}>
            <span className="text-muted-foreground">Chung ({KIND_META[node.kind].name})</span>
          </SelectItem>
          {options.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <TechLogo tech={t} className="size-4" tile={false} />
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tech && <p className="text-[12px] leading-relaxed text-muted-foreground">{tech.summary}</p>}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">Khi đổi, áp số mô phỏng mặc định của công nghệ</span>
        <Switch checked={applyDefaults} onCheckedChange={setApplyDefaults} />
      </div>
    </div>
  );
}

export function NodeInspector({ node, outDegree, game, maxInstances, queues = [], onChange, onToggleDown, onFlush, onDelete, onTech }: NodeProps) {
  const [draft, setDraft] = useState(node.config);
  const [label, setLabel] = useState(node.label);
  useEffect(() => {
    setDraft(node.config);
    setLabel(node.label);
  }, [node.config, node.label, node.index]);
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const dirty = label !== node.label || JSON.stringify(draft) !== JSON.stringify(node.config);
  const [advanced, setAdvanced] = useState(false);
  const field = (f: Field) => (
    <NumberField
      key={f.key}
      label={f.label}
      icon={f.icon}
      step={f.step}
      value={draft[f.key]}
      hint={f.hint}
      onChange={(v) => setDraft({ ...draft, [f.key]: v })}
    />
  );
  const fits = (f: Field) =>
    (!f.kinds || f.kinds.includes(node.kind) || f.kinds.includes(draft.model)) && !(f.key === 'hitRate' && draft.cache);
  const editable = !node.locked;
  const canRoute = outDegree > 1 && node.kind !== 'client' && node.kind !== 'loadBalancer';
  const routing = canRoute && (
    <>
      <RoutingField
        value={draft.routing ?? 'pick'}
        onChange={(r) => {
          const next = { ...draft, routing: r };
          setDraft(next);
          if (game) onChange(next, label);
        }}
      />
      {!game && draft.routing === 'parallel' && (
        <div className="grid grid-cols-2 gap-x-3">
          <NumberField
            label={`Quorum (cần k / ${outDegree} nhánh)`}
            icon={Users}
            value={draft.quorum ?? 0}
            onChange={(v) => setDraft({ ...draft, quorum: Math.max(0, Math.min(outDegree, Math.round(v))) || undefined })}
            hint={draft.quorum ? `trả lời khi ${draft.quorum} nhánh thành công, chịu được ${outDegree - draft.quorum} nhánh lỗi/chậm` : '0 = chờ tất cả'}
          />
        </div>
      )}
    </>
  );

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        {techOf(node.tech) ? (
          <TechLogo tech={techOf(node.tech)!} className="size-8" />
        ) : (
          <span
            className="flex size-7 items-center justify-center rounded-md"
            style={{ background: `${meta.color}26`, color: meta.color }}
          >
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{node.label}</div>
          <div className="text-xs text-muted-foreground">
            {techOf(node.tech) ? `${techOf(node.tech)!.name} · ` : ''}
            {meta.name}
          </div>
        </div>
        {node.locked && <Badge variant="secondary">cố định</Badge>}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{meta.blurb}</p>
      {onTech && !game && node.kind !== 'client' && !node.locked && <TechSection node={node} onTech={onTech} />}

      {node.kind === 'client' ? (
        <p className="text-sm text-muted-foreground">Traffic được điều khiển ở tab Số liệu hoặc theo kịch bản level.</p>
      ) : game ? (
        <div className="grid gap-3">
          {routing}
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
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border bg-muted/30 p-2 font-mono text-[12px]">
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
            <div className="relative">
              <Tag className={FIELD_ICON} aria-hidden />
              <Input className="h-8 pl-8" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
          </div>
          {routing}
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Mô hình thực thi</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="w-full"
              value={draft.model}
              onValueChange={(v) => v && setDraft({ ...draft, model: v as ExecModel })}
            >
              <ToggleGroupItem value="threads" className="text-xs">
                Thread pool
              </ToggleGroupItem>
              <ToggleGroupItem value="cpu" className="text-xs">
                Event loop / CPU
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {draft.model === 'threads'
                ? 'Mỗi request giữ một slot suốt thời gian sống, kể cả lúc chờ downstream (Java, Go với pool, PHP-FPM).'
                : 'Request chỉ cần CPU lúc tính toán; lúc chờ I/O chỉ tính vào số request mở (Node.js, Postgres). CPU xếp hàng = event loop lag.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {(draft.model === 'cpu' ? CPU_FIELDS : THREAD_FIELDS).map(field)}
            {COMMON_FIELDS.filter(fits).map(field)}
          </div>
          {node.kind === 'cache' && (
            <CacheFields value={draft.cache ?? null} onChange={(cache) => setDraft({ ...draft, cache })} />
          )}
          <div className="grid gap-2 rounded-md border p-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Autoscale (Kubernetes HPA / KEDA)</Label>
              <Switch
                checked={!!draft.autoscale}
                onCheckedChange={(on) =>
                  setDraft({
                    ...draft,
                    autoscale: on ? { ...DEFAULT_AUTOSCALE, min: Math.min(DEFAULT_AUTOSCALE.min, draft.instances), max: Math.max(DEFAULT_AUTOSCALE.max, draft.instances) } : null,
                  })
                }
              />
            </div>
            {draft.autoscale ? (
              <AutoscaleFields
                value={draft.autoscale}
                queues={queues}
                onChange={(autoscale) => setDraft({ ...draft, autoscale })}
              />
            ) : (
              <p className="text-[12px] text-muted-foreground">Số instance cố định. Bật để thấy độ trễ của autoscale khi có spike.</p>
            )}
          </div>
          {draft.instances > 1 && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">Chia tải giữa các instance</Label>
              <Select value={draft.balance} onValueChange={(v) => setDraft({ ...draft, balance: v as Balance })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="roundRobin">Round-robin (nginx, ALB mặc định)</SelectItem>
                  <SelectItem value="leastConnections">Least connections</SelectItem>
                  <SelectItem value="random">Ngẫu nhiên</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <button
            type="button"
            className="flex items-center gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronRight className={`size-3 transition-transform ${advanced ? 'rotate-90' : ''}`} />
            Nâng cao: contention, GC, wake-up
          </button>
          {advanced && <div className="grid grid-cols-2 gap-x-3 gap-y-2">{ADVANCED_FIELDS.filter(fits).map(field)}</div>}
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
            {onFlush && node.config.cache && !node.down && (
              <Button size="sm" variant="outline" onClick={onFlush} title="FLUSHALL: xoá mọi key, cache nguội lại">
                <Eraser /> Flush
              </Button>
            )}
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
  /** Game levels decide whether calls may skip waiting. */
  allowFireAndForget?: boolean;
  onChange: (policy: EdgePolicy) => void;
  onDelete: () => void;
}

export function EdgeInspector({ edge, source, target, game, allowFireAndForget = true, onChange, onDelete }: EdgeProps) {
  const [p, setP] = useState(edge.policy);
  useEffect(() => setP(edge.policy), [edge.policy, edge.index]);
  const dirty = JSON.stringify(p) !== JSON.stringify(edge.policy);
  const cb = p.circuitBreaker;
  const m = edge.metrics;
  const routing = edge.view?.routing ?? 'pick';

  return (
    <div className="grid gap-4">
      <div>
        <div className="font-semibold">
          {source} → {target}
        </div>
        <div className="text-xs text-muted-foreground">Chính sách phía caller khi gọi qua edge này</div>
      </div>
      {m && (
        <div className="grid grid-cols-4 gap-1 rounded-md border bg-muted/30 p-2 text-center font-mono text-[12px]">
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

      {routing !== 'pick' && (
        <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/5 p-2.5">
          <div className="text-xs">
            {routing === 'sequence' ? (
              <>
                <b>{source}</b> gọi các nhánh <b>tuần tự</b>. Nhánh này là bước{' '}
                <b className="font-mono">{edge.view?.step}</b>/{edge.view?.steps}.
              </>
            ) : (
              <>
                <b>{source}</b> gọi các nhánh <b>song song</b> và chờ tất cả.
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3">
            {routing === 'sequence' && (
              <NumberField
                label="Thứ tự (nhỏ chạy trước)"
                icon={ListOrdered}
                value={p.order ?? 0}
                onChange={(v) => setP({ ...p, order: Math.max(0, Math.round(v)) })}
                hint="trùng số = chạy cùng lúc"
              />
            )}
            {(!game || allowFireAndForget) && (
              <div className={FIELD_CELL}>
                <Label className="self-end text-xs leading-snug text-muted-foreground">Không chờ trả lời</Label>
                <div className="flex h-8 items-center gap-2">
                  <Switch checked={!!p.fireAndForget} onCheckedChange={(fireAndForget) => setP({ ...p, fireAndForget })} />
                  <span className="text-[12px] text-muted-foreground">fire-and-forget</span>
                </div>
                <span />
              </div>
            )}
          </div>
          {p.fireAndForget && (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Gửi đi rồi làm tiếp ngay (gửi email, bắn event). Nhanh hơn nhưng lỗi ở nhánh này không ai biết: nó được
              đếm vào &ldquo;async&rdquo;, không vào lỗi của request.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {!game && (
          <NumberField
            label="Network latency (ms)"
            icon={Wifi}
            step={0.5}
            value={p.latencyMs}
            onChange={(v) => setP({ ...p, latencyMs: v })}
          />
        )}
        <NumberField
          label="Timeout (ms, 0 = không)"
          icon={AlarmClock}
          step={10}
          value={p.timeoutMs ?? 0}
          onChange={(v) => setP({ ...p, timeoutMs: v > 0 ? v : null })}
        />
        {!game && (
          <NumberField
            label="Hedge sau (ms, 0 = tắt)"
            icon={CopyPlus}
            step={10}
            value={p.hedgeAfterMs ?? 0}
            onChange={(v) => setP({ ...p, hedgeAfterMs: v > 0 ? v : null })}
            hint={p.hedgeAfterMs ? 'quá hạn này thì gửi thêm 1 bản, lấy bản về trước' : undefined}
          />
        )}
        <NumberField
          label="Số lần retry"
          icon={Repeat2}
          value={p.retries}
          onChange={(v) => setP({ ...p, retries: Math.max(0, Math.round(v)) })}
        />
        <NumberField
          label="Backoff (ms)"
          icon={Hourglass}
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
          <p className="text-[12px] text-muted-foreground">Lỗi vượt ngưỡng thì ngắt, trả lỗi ngay không gọi xuống</p>
        </div>
        <Switch
          checked={!!cb}
          onCheckedChange={(on) => setP({ ...p, circuitBreaker: on ? { ...DEFAULT_BREAKER } : null })}
        />
      </div>
      {cb && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <NumberField
            label="Ngưỡng lỗi (0-1)"
            icon={Percent}
            step={0.05}
            value={cb.failureThreshold}
            onChange={(v) => setP({ ...p, circuitBreaker: { ...cb, failureThreshold: v } })}
          />
          <NumberField
            label="Tối thiểu request"
            icon={Hash}
            value={cb.minRequests}
            onChange={(v) => setP({ ...p, circuitBreaker: { ...cb, minRequests: v } })}
          />
          <NumberField
            label="Cửa sổ (ms)"
            icon={CalendarClock}
            step={100}
            value={cb.windowMs}
            onChange={(v) => setP({ ...p, circuitBreaker: { ...cb, windowMs: v } })}
          />
          <NumberField
            label="Mở trong (ms)"
            icon={Timer}
            step={500}
            value={cb.openMs}
            onChange={(v) => setP({ ...p, circuitBreaker: { ...cb, openMs: v } })}
          />
        </div>
      )}
      {!game && (
        <>
          <Separator />
          <div>
            <Label className="text-xs">Payload và băng thông</Label>
            <p className="text-[12px] text-muted-foreground">
              Body lớn thì truyền lâu hơn, và các body xếp hàng nối đuôi nhau trên đường truyền. Particle to hơn khi payload
              lớn.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            <NumberField
              label="Request (KB)"
              icon={ArrowUpFromLine}
              step={1}
              value={p.requestKb ?? 0}
              onChange={(v) => setP({ ...p, requestKb: Math.max(0, v) })}
            />
            <NumberField
              label="Response (KB)"
              icon={ArrowDownToLine}
              step={1}
              value={p.responseKb ?? 0}
              onChange={(v) => setP({ ...p, responseKb: Math.max(0, v) })}
            />
            <NumberField
              label="Băng thông (Mbps)"
              icon={Activity}
              step={100}
              value={p.bandwidthMbps ?? 1000}
              onChange={(v) => setP({ ...p, bandwidthMbps: Math.max(1, v) })}
            />
          </div>
          {(p.requestKb || p.responseKb) ? (
            <p className="font-mono text-[12px] text-muted-foreground">
              truyền: ↑ {fmt.ms(((p.requestKb ?? 0) * 8) / (p.bandwidthMbps ?? 1000))} · ↓{' '}
              {fmt.ms(((p.responseKb ?? 0) * 8) / (p.bandwidthMbps ?? 1000))}
              {m && <> · link bận {fmt.pct(m.bandwidthUtilization ?? 0, 0)}</>}
            </p>
          ) : null}
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Connection pool</Label>
              <p className="text-[12px] text-muted-foreground">
                Mỗi process của caller giữ N kết nối (Prisma, TypeORM, HikariCP). Hết kết nối thì xếp hàng.
              </p>
            </div>
            <Switch checked={!!p.poolSize} onCheckedChange={(on) => setP({ ...p, poolSize: on ? 10 : null })} />
          </div>
          {!!p.poolSize && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <NumberField
                label="Kết nối / process"
                icon={Cable}
                value={p.poolSize}
                onChange={(v) => setP({ ...p, poolSize: Math.max(1, Math.round(v)) })}
              />
              <NumberField
                label="Chờ kết nối tối đa (ms)"
                icon={Hourglass}
                step={500}
                value={p.poolTimeoutMs ?? 10000}
                onChange={(v) => setP({ ...p, poolTimeoutMs: v })}
              />
            </div>
          )}
          {m && !!p.poolSize && (
            <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/30 p-2 text-center font-mono text-[12px]">
              <div className={m.poolUtilization > 0.9 ? 'text-destructive' : ''}>
                <div>{fmt.pct(m.poolUtilization, 0)}</div>
                <div className="text-muted-foreground">pool bận</div>
              </div>
              <div>
                <div>{fmt.ms(m.poolWaitMs)}</div>
                <div className="text-muted-foreground">chờ TB</div>
              </div>
              <div>
                <div>{m.poolTimeouts}</div>
                <div className="text-muted-foreground">hết hạn chờ</div>
              </div>
            </div>
          )}
        </>
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

const SELF_QUEUE = '__self';

/** HPA on utilization, or KEDA on a queue backlog. */
function AutoscaleFields({
  value,
  queues,
  onChange,
}: {
  value: Autoscale;
  queues: { id: string; label: string }[];
  onChange: (a: Autoscale) => void;
}) {
  const onQueue = value.metric === 'queueLength';
  const set = (patch: Partial<Autoscale>) => onChange({ ...value, ...patch });
  const fields: [keyof Autoscale, string, number, LucideIcon][] = [
    ['min', 'Min replica', 1, Server],
    ['max', 'Max replica', 1, Server],
    onQueue ? ['targetQueueLength', 'Backlog / replica', 10, ListOrdered] : ['targetUtilization', 'Mục tiêu (0-1)', 0.05, Target],
    ['evalEveryMs', 'Xét mỗi (ms)', 1000, CalendarClock],
    ['podStartMs', 'Pod khởi động (ms)', 1000, Rocket],
    ['stabilizationMs', 'Ổn định giảm (ms)', 5000, Timer],
  ];
  return (
    <>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="w-full"
        value={onQueue ? 'queueLength' : 'utilization'}
        onValueChange={(v) =>
          v &&
          set(
            v === 'queueLength'
              ? {
                  metric: 'queueLength',
                  queue: value.queue ?? queues[0]?.id ?? null,
                  targetQueueLength: value.targetQueueLength ?? DEFAULT_TARGET_QUEUE_LENGTH,
                }
              : { metric: undefined, queue: undefined, targetQueueLength: undefined },
          )
        }
      >
        <ToggleGroupItem value="utilization" className="text-xs">
          Theo tải (HPA)
        </ToggleGroupItem>
        <ToggleGroupItem value="queueLength" className="text-xs">
          Theo queue (KEDA)
        </ToggleGroupItem>
      </ToggleGroup>
      {onQueue && (
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Queue theo dõi</Label>
          <Select value={value.queue ?? SELF_QUEUE} onValueChange={(v) => set({ queue: v === SELF_QUEUE ? null : v })}>
            <SelectTrigger size="sm" aria-label="Queue theo dõi">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {queues.map((q) => (
                <SelectItem key={q.id} value={q.id}>
                  {q.label}
                </SelectItem>
              ))}
              <SelectItem value={SELF_QUEUE}>Hàng đợi của chính node này</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {fields.map(([k, l, step, icon]) => (
          <NumberField
            key={k}
            label={l}
            icon={icon}
            step={step}
            value={Number(value[k] ?? (k === 'targetQueueLength' ? DEFAULT_TARGET_QUEUE_LENGTH : 0))}
            onChange={(v) => set({ [k]: v })}
          />
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {onQueue
          ? 'Instances ở trên là số replica lúc bắt đầu. Mỗi chu kỳ đọc backlog của queue lúc đó: replica = ⌈backlog / backlog mỗi replica⌉. Queue rỗng nghĩa là "không có việc", nên tải đều nhưng queue luôn rỗng sẽ bị thu nhỏ rồi lại dồn: tăng cửa sổ ổn định để bớt dao động.'
          : 'Instances ở trên là số replica lúc bắt đầu. HPA tính lại mỗi chu kỳ: replica = ⌈ready × tải / mục tiêu⌉. Pod mới chỉ nhận traffic sau thời gian khởi động; giảm replica chờ hết cửa sổ ổn định.'}
      </p>
    </>
  );
}

/** Keyspace cache: hit rate emerges from popularity, TTL and warm-up. */
function CacheFields({ value, onChange }: { value: CacheModel | null; onChange: (c: CacheModel | null) => void }) {
  const set = (patch: Partial<CacheModel>) => onChange({ ...value!, ...patch });
  return (
    <div className="grid gap-2 rounded-md border p-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Mô phỏng keyspace (TTL, warm-up, stampede)</Label>
        <Switch checked={!!value} onCheckedChange={(on) => onChange(on ? { ...DEFAULT_CACHE_MODEL } : null)} aria-label="Mô phỏng keyspace" />
      </div>
      {value ? (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <NumberField label="Số key" icon={KeyRound} step={1000} value={value.keys} onChange={(keys) => set({ keys })} />
            <NumberField label="Độ lệch Zipf (0 = đều)" icon={TrendingDown} step={0.1} value={value.skew} onChange={(skew) => set({ skew })} />
            <NumberField label="TTL (ms, 0 = không hết hạn)" icon={Hourglass} step={5000} value={value.ttlMs} onChange={(ttlMs) => set({ ttlMs })} />
            <NumberField label="Jitter TTL (0-1)" icon={Shuffle} step={0.1} value={value.ttlJitter} onChange={(ttlJitter) => set({ ttlJitter })} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Gộp miss cùng key (singleflight)</Label>
            <Switch checked={value.coalesce} onCheckedChange={(coalesce) => set({ coalesce })} aria-label="Gộp miss cùng key" />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Bắt đầu với cache đầy</Label>
            <Switch checked={value.warm} onCheckedChange={(warm) => set({ warm })} aria-label="Bắt đầu với cache đầy" />
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Mỗi request đọc một key (key nóng được đọc nhiều hơn). Miss thì gọi xuống dưới rồi ghi lại key; key hết hạn sau TTL. Hit rate vì vậy tự
            hình thành: thấp khi cache nguội, sụt khi key cùng hết hạn (thêm jitter để rải ra), và nút Flush cho thấy stampede vào DB.
          </p>
        </>
      ) : (
        <p className="text-[12px] text-muted-foreground">Hit rate cố định. Bật để mô phỏng cache nguội, TTL và thundering herd.</p>
      )}
    </div>
  );
}
