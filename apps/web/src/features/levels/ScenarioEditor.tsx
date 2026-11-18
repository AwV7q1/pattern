import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ChaosAction, ChaosEvent, Design, Scenario } from '@/types';

const ACTIONS: Record<ChaosAction, string> = {
  down: 'Sập',
  up: 'Hồi phục',
  latency: 'Chậm × lần',
  errors: 'Tỉ lệ lỗi',
  flush: 'Mất cache',
  partition: 'Đứt mạng (edge)',
  heal: 'Nối mạng (edge)',
};

function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">
        {label}
        {suffix && <span className="ml-1">({suffix})</span>}
      </Label>
      <Input type="number" className="h-8 font-mono" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/** Edit a scenario: duration, traffic steps, SLO, budget and scripted chaos. */
export function ScenarioEditor({ value, onChange, design }: { value: Scenario; onChange: (s: Scenario) => void; design: Design }) {
  const set = (patch: Partial<Scenario>) => onChange({ ...value, ...patch });
  const events = value.events ?? [];
  const setEvent = (i: number, patch: Partial<ChaosEvent>) => set({ events: events.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const nodes = design.nodes.filter((n) => n.kind !== 'client');
  const edges = design.edges;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Num label="Thời lượng" suffix="giây" value={(value.durationMs ?? 60_000) / 1000} onChange={(v) => set({ durationMs: Math.round(v * 1000) })} />
        <Num label="SLO p99" suffix="ms" value={value.slo.p99Ms} onChange={(v) => set({ slo: { ...value.slo, p99Ms: v } })} />
        <Num label="SLO lỗi tối đa" suffix="0-1" step={0.005} value={value.slo.errorRate} onChange={(v) => set({ slo: { ...value.slo, errorRate: v } })} />
        <Num
          label="Ngân sách / giờ"
          step={0.05}
          value={value.budgetPerHour ?? 0}
          onChange={(v) => set({ budgetPerHour: v > 0 ? v : null })}
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Traffic theo thời gian</Label>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => {
              const last = value.traffic.at(-1);
              set({ traffic: [...value.traffic, { atMs: (last?.atMs ?? 0) + 10_000, rps: last?.rps ?? 100 }] });
            }}
          >
            <Plus /> Bậc
          </Button>
        </div>
        {value.traffic.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Num label="Từ giây" value={t.atMs / 1000} onChange={(v) => set({ traffic: value.traffic.map((x, j) => (j === i ? { ...x, atMs: Math.round(v * 1000) } : x)) })} />
            <Num label="RPS" step={50} value={t.rps} onChange={(v) => set({ traffic: value.traffic.map((x, j) => (j === i ? { ...x, rps: v } : x)) })} />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Xoá bậc"
              disabled={value.traffic.length <= 1}
              onClick={() => set({ traffic: value.traffic.filter((_, j) => j !== i) })}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Sự cố theo kịch bản (chaos)</Label>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={!nodes.length}
            onClick={() => set({ events: [...events, { atMs: 20_000, node: nodes[0]?.id ?? '', action: 'down' }] })}
          >
            <Plus /> Sự cố
          </Button>
        </div>
        {events.length === 0 && <p className="text-xs text-muted-foreground">Không có sự cố nào.</p>}
        {events.map((e, i) => {
          const onEdge = e.action === 'partition' || e.action === 'heal';
          return (
            <div key={i} className="grid grid-cols-[80px_1fr_1fr_90px_auto] items-end gap-2">
              <Num label="Giây" value={e.atMs / 1000} onChange={(v) => setEvent(i, { atMs: Math.round(v * 1000) })} />
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">Sự cố</Label>
                <Select
                  value={e.action}
                  onValueChange={(v) => {
                    const action = v as ChaosAction;
                    const edgeAction = action === 'partition' || action === 'heal';
                    setEvent(
                      i,
                      edgeAction
                        ? { action, node: '', edge: edges[0] ? { source: edges[0].source, target: edges[0].target } : null }
                        : { action, edge: null, node: e.node || nodes[0]?.id },
                    );
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTIONS) as ChaosAction[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        {ACTIONS[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">{onEdge ? 'Edge' : 'Node'}</Label>
                {onEdge ? (
                  <Select
                    value={e.edge ? `${e.edge.source}->${e.edge.target}` : undefined}
                    onValueChange={(v) => {
                      const [source, target] = v.split('->');
                      setEvent(i, { edge: { source, target } });
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue placeholder="Chọn edge" />
                    </SelectTrigger>
                    <SelectContent>
                      {edges.map((x) => (
                        <SelectItem key={`${x.source}->${x.target}`} value={`${x.source}->${x.target}`}>
                          {x.source} → {x.target}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={e.node || undefined} onValueChange={(v) => setEvent(i, { node: v })}>
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue placeholder="Chọn node" />
                    </SelectTrigger>
                    <SelectContent>
                      {nodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {e.action === 'latency' || e.action === 'errors' ? (
                <Num label="Giá trị" step={e.action === 'errors' ? 0.05 : 0.5} value={e.value ?? 0} onChange={(v) => setEvent(i, { value: v })} />
              ) : (
                <span />
              )}
              <Button size="icon-sm" variant="ghost" aria-label="Xoá sự cố" onClick={() => set({ events: events.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
