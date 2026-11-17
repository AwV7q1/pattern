import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { PRESETS } from './presets';
import { SimClient } from './sim/client';
import { clearEdgeGeometry } from './gpu/edgeGeometry';
import { DEFAULT_CONFIG, type NodeConfig, type Preset, type WindowMetrics } from './types';
import { SystemNode, type SystemNodeType } from './components/SystemNode';
import { FlowEdge, type FlowEdgeType } from './components/FlowEdge';
import { ParticleLayer } from './components/ParticleLayer';
import { Chart } from './components/Chart';
import { Inspector } from './components/Inspector';

const nodeTypes: NodeTypes = { system: SystemNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };
const HISTORY = 120;
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
const MULTIPLIERS = [1, 2, 3, 5];

function toFlow(preset: Preset): { nodes: SystemNodeType[]; edges: FlowEdgeType[] } {
  return {
    nodes: preset.design.nodes.map((n, index) => ({
      id: n.id,
      type: 'system',
      position: n.position,
      data: { index, label: n.label, kind: n.kind, config: { ...DEFAULT_CONFIG, ...n.config }, down: false },
    })),
    edges: preset.design.edges.map((e, index) => ({
      id: `e${index}`,
      source: e.source,
      target: e.target,
      type: 'flow',
      data: { index, latencyMs: e.latencyMs ?? 1 },
    })),
  };
}

/** Builds the engine input from the current canvas state. */
function toEngineInput(nodes: SystemNodeType[], edges: FlowEdgeType[], preset: Preset) {
  const ordered = [...nodes].sort((a, b) => a.data.index - b.data.index);
  const orderedEdges = [...edges].sort((a, b) => a.data!.index - b.data!.index);
  return {
    design: {
      nodes: ordered.map((n) => ({ id: n.id, kind: n.data.kind, config: n.data.config })),
      edges: orderedEdges.map((e) => ({ source: e.source, target: e.target, latencyMs: e.data!.latencyMs })),
    },
    scenario: { ...preset.scenario, durationMs: undefined },
  };
}

export function App() {
  const client = useMemo(() => new SimClient(), []);
  const [presetKey, setPresetKey] = useState('no-cache');
  const preset = PRESETS[presetKey];
  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdgeType>([]);
  const [windows, setWindows] = useState<WindowMetrics[]>([]);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [rps, setRps] = useState(preset.scenario.traffic[0].rps);
  const [multiplier, setMultiplier] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const restart = useCallback(
    (ns: SystemNodeType[], es: FlowEdgeType[], autoplay: boolean) => {
      setError(null);
      setWindows([]);
      client.init(toEngineInput(ns, es, preset), rps, multiplier);
      if (autoplay) client.play();
      setRunning(autoplay);
    },
    [client, preset, rps, multiplier],
  );

  // load preset
  useEffect(() => {
    const flow = toFlow(preset);
    clearEdgeGeometry();
    setNodes(flow.nodes);
    setEdges(flow.edges);
    const base = preset.scenario.traffic[0].rps;
    setRps(base);
    setMultiplier(1);
    setError(null);
    setWindows([]);
    client.init(toEngineInput(flow.nodes, flow.edges, preset), base, 1);
    setRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  // metrics from the worker
  useEffect(() => {
    client.onError = setError;
    return client.onTick((_, ws) => {
      if (!ws.length) return;
      setWindows((prev) => [...prev, ...ws].slice(-HISTORY));
      const last = ws[ws.length - 1];
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, metrics: last.nodes[n.data.index] } })));
    });
  }, [client, setNodes]);

  const selected = nodes.find((n) => n.selected);
  const last = windows.at(-1);
  const sloWindows = windows.filter((w) => w.sloOk).length;
  const cost = nodes.reduce((sum, n) => sum + n.data.config.costPerHour * n.data.config.instances, 0);

  const applyConfig = (config: NodeConfig) => {
    if (!selected) return;
    const ns = nodes.map((n) =>
      n.id === selected.id ? { ...n, data: { ...n.data, config } } : { ...n, data: { ...n.data, down: false } },
    );
    setNodes(ns);
    restart(ns, edges, running);
  };

  const toggleDown = () => {
    if (!selected) return;
    const down = !selected.data.down;
    client.setNodeDown(selected.data.index, down);
    setNodes((ns) => ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, down } } : n)));
  };

  return (
    <div className="app">
      <main className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodesConnectable={false}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
        >
          <Background gap={24} color="#1b2234" />
          <ParticleLayer client={client} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="legend">
          <span><i style={{ background: '#4db3ff' }} /> request</span>
          <span><i style={{ background: '#4df28c' }} /> response OK</span>
          <span><i style={{ background: '#ff4747' }} /> error</span>
        </div>
      </main>

      <aside className="panel">
        <h1>Pattern Simulator</h1>
        <select value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
          {Object.entries(PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.title}</option>
          ))}
        </select>
        <p className="muted">{preset.description}</p>

        <section>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                if (running) client.pause();
                else client.play();
                setRunning(!running);
              }}
            >
              {running ? 'Tạm dừng' : 'Chạy'}
            </button>
            <button onClick={() => restart(nodes.map((n) => ({ ...n, data: { ...n.data, down: false } })), edges, false)}>
              Reset
            </button>
            <select
              value={speed}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpeed(v);
                client.setSpeed(v);
              }}
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>
        </section>

        <section>
          <h2>Traffic</h2>
          <label className="field">
            <span>Base RPS: {rps}</span>
            <input
              type="range"
              min={0}
              max={6000}
              step={100}
              value={rps}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRps(v);
                client.setRps(v);
              }}
            />
          </label>
          <div className="row">
            {MULTIPLIERS.map((m) => (
              <button
                key={m}
                className={m === multiplier ? 'active' : ''}
                onClick={() => {
                  setMultiplier(m);
                  client.setMultiplier(m);
                }}
              >
                {m === 1 ? 'Bình thường' : `Spike ×${m}`}
              </button>
            ))}
          </div>
        </section>

        <section className="stats">
          <div><b>{Math.round(last?.rps ?? 0)}</b><span>ok rps</span></div>
          <div>
            <b className={(last?.errorRps ?? 0) > 0 ? 'bad' : ''}>
              {last ? ((last.errorCount / Math.max(1, last.okCount + last.errorCount)) * 100).toFixed(1) : '0.0'}%
            </b>
            <span>lỗi</span>
          </div>
          <div><b>{Math.round(last?.p99Ms ?? 0)}</b><span>p99 ms</span></div>
          <div><b>${cost.toFixed(2)}</b><span>/ giờ</span></div>
          <div className="wide">
            <b className={last && !last.sloOk ? 'bad' : 'good'}>
              {windows.length ? `${Math.round((sloWindows / windows.length) * 100)}%` : '–'}
            </b>
            <span>thời gian đạt SLO (p99 ≤ {preset.scenario.slo.p99Ms}ms, lỗi ≤ {preset.scenario.slo.errorRate * 100}%)</span>
          </div>
        </section>

        <Chart
          title="Throughput"
          unit="/s"
          series={[
            { label: 'ok', color: '#34d399', values: windows.map((w) => w.rps) },
            { label: 'err', color: '#f87171', values: windows.map((w) => w.errorRps) },
          ]}
        />
        <Chart
          title="Latency"
          unit="ms"
          threshold={{ value: preset.scenario.slo.p99Ms, label: 'SLO' }}
          series={[
            { label: 'p50', color: '#60a5fa', values: windows.map((w) => w.p50Ms) },
            { label: 'p99', color: '#fbbf24', values: windows.map((w) => w.p99Ms) },
          ]}
        />

        <section>
          <h2>Node</h2>
          {selected ? (
            <Inspector node={selected.data} onApply={applyConfig} onToggleDown={toggleDown} />
          ) : (
            <p className="muted">Chọn một node trên canvas để chỉnh cấu hình hoặc giả lập sự cố.</p>
          )}
        </section>
        {error && <p className="error">{error}</p>}
      </aside>
    </div>
  );
}
