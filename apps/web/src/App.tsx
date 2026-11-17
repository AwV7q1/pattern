import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  MarkerType,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { ArrowLeft, Download, Gamepad2, Gauge, GraduationCap, Maximize2, Minimize2, Pause, Play, RotateCcw, Shapes } from 'lucide-react';
import { LEARN_LEVELS, LEVELS, PRESETS } from './presets';
import { LearnPage } from './learn/LearnPage';
import { useProgress } from './learn/progress';
import { LESSONS } from './learn/curriculum';
import { SimClient } from './sim/client';
import { clearEdgeGeometry } from './gpu/edgeGeometry';
import {
  BUILDABLE,
  DEFAULT_CONFIG,
  DEFAULT_POLICY,
  type Design,
  type EdgePolicy,
  type NodeConfig,
  type NodeKind,
  type Preset,
  type SizingReport,
  type Summary,
  type TraceEvent,
  type WindowMetrics,
} from './types';
import { CapacityPage } from './capacity/CapacityPage';
import {
  autoLayout,
  decorateEdges,
  reindex,
  toDesign,
  toFlow,
  uniqueId,
  wouldCycle,
  type FlowEdgeType,
  type SystemNodeType,
} from './model/flow';
import { KIND_META, fmt } from './lib/meta';
import { ParticleLegend } from './components/ParticleLegend';
import { TracePanel, type PinnedTrace } from './components/TracePanel';
import { SystemNode } from './components/SystemNode';
import { FlowEdge } from './components/FlowEdge';
import { ParticleLayer } from './components/ParticleLayer';
import { MetricsPanel } from './components/MetricsPanel';
import { EdgeInspector, NodeInspector } from './components/Inspector';
import { LevelPanel } from './components/LevelPanel';
import { ResultDialog } from './components/ResultDialog';
import { DRAG_MIME, Palette } from './components/Palette';
import { TECH_MIME, TechLibrary } from './tech/TechLibrary';
import { TechDialogs } from './tech/TechDialogs';
import { techOf } from './tech/catalog';
import { Button } from './components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { SidePanel } from './components/SidePanel';
import { cn } from './lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Slider } from './components/ui/slider';
import { Switch } from './components/ui/switch';
import { Label } from './components/ui/label';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { ScrollArea } from './components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip';

const nodeTypes: NodeTypes = { system: SystemNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };
const HISTORY = 120;
const SPEEDS = ['0.25', '0.5', '1', '2', '4', '8'];
const MULTIPLIERS = [1, 2, 3, 5];

type Mode = 'learn' | 'sandbox' | 'game' | 'capacity';
type Panel = 'metrics' | 'inspect' | 'level' | 'trace';
const MAX_TRACE_EVENTS = 6000;

const bestKey = (id: string) => `pattern.best.${id}`;
const ALL_LEVELS = { ...LEVELS, ...LEARN_LEVELS };

export function App() {
  const client = useMemo(() => new SimClient(), []);
  const { screenToFlowPosition } = useReactFlow();
  const [mode, setMode] = useState<Mode>('learn');
  /** Practice level opened from a lesson of the learning path. */
  const [practice, setPractice] = useState<{ lessonId: string; level: string; xp?: number } | null>(null);
  const { complete } = useProgress();
  const [presetKey, setPresetKey] = useState(Object.keys(PRESETS)[0]);
  const [levelKey, setLevelKey] = useState(Object.keys(LEVELS)[0]);
  const [custom, setCustom] = useState<Record<string, Preset>>({});
  const presets = useMemo(() => ({ ...PRESETS, ...custom }), [custom]);
  const preset = presets[presetKey] ?? PRESETS[Object.keys(PRESETS)[0]];
  const [sandboxDesign, setSandboxDesign] = useState<Design | null>(null);
  const level = ALL_LEVELS[levelKey] ?? LEVELS[Object.keys(LEVELS)[0]];
  const scenario = mode === 'game' ? level.scenario : preset.scenario;

  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdgeType>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const [windows, setWindows] = useState<WindowMetrics[]>([]);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [scripted, setScripted] = useState(false);
  const [rps, setRps] = useState(preset.scenario.traffic[0].rps);
  const [multiplier, setMultiplier] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('level');
  const [panelFull, setPanelFull] = useState(false);
  const exitPanelFull = useCallback(() => setPanelFull(false), []);
  const [catalog, setCatalog] = useState<Record<string, NodeConfig>>({});
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const [best, setBest] = useState(0);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [autoTrace, setAutoTrace] = useState(false);
  const [pinnedTrace, setPinnedTrace] = useState<PinnedTrace | null>(null);

  // ------------------------------------------------------------------ simulation lifecycle

  const settings = useRef({ mode, level, preset, rps, multiplier, scripted });
  settings.current = { mode, level, preset, rps, multiplier, scripted };

  /** (Re)start the engine from a design. Always call with reindexed nodes/edges. */
  const restart = useCallback(
    (ns: SystemNodeType[], es: FlowEdgeType[], autoplay: boolean) => {
      const s = settings.current;
      setError(null);
      setWindows([]);
      setTraceEvents([]);
      const design = toDesign(ns, es);
      if (s.mode === 'game') {
        client.initLevel(s.level, design);
      } else {
        const sc = { ...s.preset.scenario, durationMs: undefined };
        client.init({ design, scenario: sc }, s.scripted ? null : s.rps, s.multiplier);
      }
      if (autoplay) client.play();
      setRunning(autoplay);
    },
    [client],
  );

  const load = useCallback(() => {
    const s = settings.current;
    const source = s.mode === 'game' ? s.level : s.preset;
    const flow = toFlow(source.design, s.mode === 'game' ? s.level.locked : ['client'], client.catalog);
    clearEdgeGeometry();
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setMultiplier(1);
    settings.current.multiplier = 1;
    if (s.mode === 'sandbox') {
      setRps(s.preset.scenario.traffic[0].rps);
      settings.current.rps = s.preset.scenario.traffic[0].rps;
    } else {
      setBest(Number(localStorage.getItem(bestKey(s.level.id)) ?? 0));
    }
    restart(flow.nodes, flow.edges, false);
  }, [client, restart, setEdges, setNodes]);

  useEffect(() => {
    if (mode === 'capacity' || mode === 'learn') {
      client.pause();
      setRunning(false);
      return;
    }
    setPanel(mode === 'game' ? 'level' : 'metrics');
    load();
  }, [client, mode, presetKey, levelKey, custom, load]);

  const switchMode = (next: Mode) => {
    if (mode === 'sandbox') setSandboxDesign(toDesign(nodesRef.current, edgesRef.current));
    if (next !== 'game') setPractice(null);
    // learning-path levels are only reachable from their lesson
    if (next === 'game' && !practice && levelKey.startsWith('learn/')) setLevelKey(Object.keys(LEVELS)[0]);
    setMode(next);
  };

  /** A lesson asks for its practice level on the canvas. */
  const openPractice = (levelId: string, lessonId: string) => {
    if (!ALL_LEVELS[levelId]) return;
    setPractice({ lessonId, level: levelId });
    setLevelKey(levelId);
    setMode('game');
  };
  const backToPath = () => {
    setPractice(null);
    setLevelKey(Object.keys(LEVELS)[0]);
    setMode('learn');
  };

  /** Load a generated design (sizing, calibration) into the sandbox. */
  const openInSandbox = (key: string, p: Preset) => {
    setCustom((c) => ({ ...c, [key]: { ...p, design: autoLayout(p.design) } }));
    setPresetKey(key);
    setScripted(false);
    settings.current.scripted = false;
    setMode('sandbox');
  };
  const openSizing = (r: SizingReport, title: string) => {
    if (!r.input) return;
    const t = r.input.scenario.traffic;
    openInSandbox('custom-sizing', {
      title,
      description: `Đề xuất của Sizing wizard: Node cluster (1 process/vCPU) + Postgres, pool mỗi process. Cao điểm ${Math.round(t[0].rps)} rps; bật "Traffic theo kịch bản" để có đột biến ${Math.round(t[1]?.rps ?? 0)} rps ở giây 30–40. Thử tắt app server hoặc làm chậm DB.`,
      design: r.input.design,
      scenario: r.input.scenario,
    });
  };
  const openCalibrated = (design: Design, title: string, slo?: { p99Ms: number; errorRate: number }) =>
    openInSandbox('custom-calibrated', {
      title,
      description: 'Design đã hiệu chỉnh từ số đo k6. Kéo RPS để xem hệ thống phản ứng thế nào quanh giới hạn dự đoán.',
      design,
      scenario: {
        seed: 1,
        timeoutMs: 60000,
        traffic: [{ atMs: 0, rps: 500 }],
        slo: slo ?? { p99Ms: 200, errorRate: 0.01 },
        windowMs: 1000,
      },
    });

  // worker events
  useEffect(() => {
    client.onError = setError;
    client.onStop = () => setRunning(false);
    client.onReady = () => {
      setCatalog(client.catalog);
      // show the numbers the engine really uses (catalog applied in game mode)
      const effective = new Map(client.input?.design.nodes.map((n) => [n.id, n.config]));
      setNodes((ns) =>
        ns.map((n) => {
          const config = effective.get(n.id);
          return config && JSON.stringify(config) !== JSON.stringify(n.data.config)
            ? { ...n, data: { ...n.data, config: { ...DEFAULT_CONFIG, ...config } } }
            : n;
        }),
      );
    };
    return client.onTick((_, ws, _done, traces) => {
      if (traces.length) setTraceEvents((prev) => [...prev, ...traces].slice(-MAX_TRACE_EVENTS));
      if (!ws.length) return;
      setWindows((prev) => [...prev, ...ws].slice(-HISTORY));
      const last = ws[ws.length - 1];
      setNodes((ns) =>
        ns.map((n) => ({
          ...n,
          data: { ...n.data, metrics: last.nodes[n.data.index], down: last.nodes[n.data.index]?.down ?? n.data.down },
        })),
      );
      setEdges((es) => es.map((e) => ({ ...e, data: { ...e.data!, metrics: last.edges[e.data!.index] } })));
    });
  }, [client, setEdges, setNodes]);

  // follow one request every 2 s of wall time
  useEffect(() => {
    if (!autoTrace || !running) return;
    client.trace(1);
    const id = setInterval(() => client.trace(1), 2000);
    return () => clearInterval(id);
  }, [autoTrace, running, client]);

  /** Edges as drawn: fanned out, numbered, with an arrow at the callee. */
  const viewEdges = useMemo(
    () =>
      decorateEdges(nodes, edges).map((e) => ({
        ...e,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: e.selected ? 'var(--primary)' : 'oklch(0.6 0 0)',
        },
      })),
    [nodes, edges],
  );

  // ------------------------------------------------------------------ editing

  const commit = useCallback(
    (ns: SystemNodeType[], es: FlowEdgeType[]) => {
      const r = reindex(ns, es);
      clearEdgeGeometry();
      setNodes(r.nodes);
      setEdges(r.edges);
      restart(r.nodes, r.edges, client.running);
    },
    [client, restart, setEdges, setNodes],
  );

  const isValidConnection = useCallback((c: Connection | FlowEdgeType) => {
    if (!c.source || !c.target || c.source === c.target) return false;
    const target = nodesRef.current.find((n) => n.id === c.target);
    if (!target || target.data.kind === 'client') return false;
    if (edgesRef.current.some((e) => e.source === c.source && e.target === c.target)) return false;
    return !wouldCycle(edgesRef.current, c.source, c.target);
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      const fromClient = nodesRef.current.find((n) => n.id === c.source)?.data.kind === 'client';
      const targetTech = techOf(nodesRef.current.find((n) => n.id === c.target)?.data.tech);
      const policy: EdgePolicy = { ...DEFAULT_POLICY, latencyMs: fromClient ? 5 : 1, ...targetTech?.edgeDefaults };
      const edge: FlowEdgeType = {
        id: `e-${c.source}-${c.target}`,
        source: c.source,
        target: c.target,
        type: 'flow',
        data: { index: edgesRef.current.length, policy },
      };
      commit(nodesRef.current, addEdge(edge, edgesRef.current));
    },
    [commit],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData(DRAG_MIME) as NodeKind;
      if (!kind) return;
      const tech = techOf(e.dataTransfer.getData(TECH_MIME));
      const ns = nodesRef.current;
      const id = uniqueId(tech?.id ?? kind, new Set(ns.map((n) => n.id)));
      const sameKind = ns.filter((n) => (tech ? n.data.tech === tech.id : n.data.kind === kind)).length;
      const baseName = tech?.name ?? KIND_META[kind].name;
      const position = screenToFlowPosition({ x: e.clientX - 100, y: e.clientY - 30 });
      const node: SystemNodeType = {
        id,
        type: 'system',
        position,
        selected: true,
        data: {
          index: ns.length,
          label: `${baseName}${sameKind ? ` ${sameKind + 1}` : ''}`,
          kind,
          config: { ...DEFAULT_CONFIG, ...catalog[kind], ...tech?.config },
          tech: tech?.id,
          down: false,
          locked: false,
        },
      };
      commit([...ns.map((n) => ({ ...n, selected: false })), node], edgesRef.current);
      setPanel('inspect');
    },
    [catalog, commit, screenToFlowPosition],
  );

  const onDelete = useCallback(
    ({ nodes: dn, edges: de }: { nodes: SystemNodeType[]; edges: FlowEdgeType[] }) => {
      const goneNodes = new Set(dn.map((n) => n.id));
      const goneEdges = new Set(de.map((e) => e.id));
      commit(
        nodesRef.current.filter((n) => !goneNodes.has(n.id)),
        edgesRef.current.filter(
          (e) => !goneEdges.has(e.id) && !goneNodes.has(e.source) && !goneNodes.has(e.target),
        ),
      );
    },
    [commit],
  );

  const selectedNode = nodes.find((n) => n.selected);
  const selectedEdge = selectedNode ? undefined : viewEdges.find((e) => e.selected);
  const selectionKey = selectedNode?.id ?? selectedEdge?.id;
  useEffect(() => {
    if (selectionKey) setPanel('inspect');
  }, [selectionKey]);

  const updateNode = (id: string, config: NodeConfig, label: string) =>
    commit(
      nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config, label } } : n)),
      edges,
    );
  const updateEdge = (id: string, policy: EdgePolicy) =>
    commit(
      nodes,
      edges.map((e) => (e.id === id ? { ...e, data: { ...e.data!, policy } } : e)),
    );
  /** Switch a node's real-world technology, optionally with its default numbers. */
  const setTech = (id: string, techId: string | undefined, applyDefaults: boolean) => {
    const tech = techOf(techId);
    commit(
      nodes.map((n) => {
        if (n.id !== id) return n;
        const old = techOf(n.data.tech);
        const label = old && n.data.label.startsWith(old.name) && tech ? n.data.label.replace(old.name, tech.name) : n.data.label;
        const config =
          applyDefaults && tech ? { ...DEFAULT_CONFIG, ...catalog[n.data.kind], ...tech.config, routing: n.data.config.routing } : n.data.config;
        return { ...n, data: { ...n.data, tech: tech?.id, config, label } };
      }),
      edges,
    );
  };
  const toggleDown = (n: SystemNodeType) => {
    const down = !n.data.down;
    client.setNodeDown(n.data.index, down);
    setNodes((ns) => ns.map((x) => (x.id === n.id ? { ...x, data: { ...x.data, down } } : x)));
  };

  // ------------------------------------------------------------------ game

  const verify = async () => {
    setVerifying(true);
    const { summary, error: err } = await client.verify(level, toDesign(nodes, edges));
    setVerifying(false);
    if (err || !summary) {
      setError(err ?? 'verify failed');
      return null;
    }
    if (practice && practice.level === levelKey && summary.stars >= 1 && practice.xp === undefined) {
      setPractice({ ...practice, xp: complete(practice.lessonId, summary.stars * 5) });
    }
    setResult(summary);
    if (summary.stars > best) {
      setBest(summary.stars);
      localStorage.setItem(bestKey(level.id), String(summary.stars));
    }
    return summary;
  };

  const exportDesign = () => {
    const data = { title: preset.title, description: preset.description, design: toDesign(nodes, edges), scenario };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'design.json' });
    a.click();
    URL.revokeObjectURL(url);
  };

  const cost = nodes.reduce(
    (sum, n) => sum + (n.data.kind === 'client' ? 0 : n.data.config.costPerHour * n.data.config.instances),
    0,
  );
  const simSeconds = (windows.at(-1)?.tMs ?? 0) / 1000;
  const duration = (level.scenario.durationMs ?? 0) / 1000;
  const paletteKinds = mode === 'game' ? level.palette : BUILDABLE;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Shapes className="size-4" />
          </span>
          Pattern
        </div>
        <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="learn">
              <GraduationCap /> Học
            </TabsTrigger>
            <TabsTrigger value="game">
              <Gamepad2 /> Game
            </TabsTrigger>
            <TabsTrigger value="sandbox">
              <Shapes /> Sandbox
            </TabsTrigger>
            <TabsTrigger value="capacity">
              <Gauge /> Công suất
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'capacity' || mode === 'learn' ? null : mode === 'game' ? (
          <Select
            value={levelKey}
            onValueChange={(v) => {
              setPractice(null);
              setLevelKey(v);
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(practice ? { ...LEVELS, [levelKey]: level } : LEVELS).map(([key, l]) => (
                <SelectItem key={key} value={key}>
                  {l.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={presetKey} onValueChange={setPresetKey}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(presets).map(([key, p]) => (
                <SelectItem key={key} value={key}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className={mode === 'capacity' || mode === 'learn' ? 'hidden' : 'ml-auto flex items-center gap-2'}>
          {mode === 'game' && (
            <div className="flex w-40 items-center gap-2 font-mono text-xs text-muted-foreground">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (simSeconds / duration) * 100)}%` }} />
              </div>
              {Math.round(simSeconds)}/{duration}s
            </div>
          )}
          {mode === 'sandbox' && <span className="font-mono text-xs text-muted-foreground">t = {Math.round(simSeconds)}s</span>}
          <Button
            size="sm"
            className="w-24"
            disabled={mode === 'game' && simSeconds >= duration}
            onClick={() => {
              if (running) client.pause();
              else client.play();
              setRunning(!running);
            }}
          >
            {running ? <Pause /> : <Play />}
            {running ? 'Dừng' : 'Chạy'}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="outline" onClick={() => commit(nodes, edges)}>
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chạy lại từ đầu</TooltipContent>
          </Tooltip>
          <Select
            value={speed}
            onValueChange={(v) => {
              setSpeed(v);
              client.setSpeed(Number(v));
            }}
          >
            <SelectTrigger size="sm" className="w-20 font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEEDS.map((s) => (
                <SelectItem key={s} value={s} className="font-mono">
                  {s}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mode === 'sandbox' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={exportDesign}>
                  <Download />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tải design JSON (chạy được bằng `pnpm sim`)</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      {mode === 'learn' ? (
        <LearnPage onBuild={openPractice} />
      ) : mode === 'capacity' ? (
        <CapacityPage sandboxDesign={sandboxDesign} onOpenSizing={openSizing} onOpenCalibrated={openCalibrated} />
      ) : (
      <div className="relative flex min-h-0 flex-1">
        {mode === 'sandbox' ? (
          <aside className="flex w-60 shrink-0 flex-col gap-3 border-r p-3">
            <TechLibrary />
          </aside>
        ) : (
          <aside className="flex w-56 shrink-0 flex-col gap-4 border-r p-3">
            <Palette kinds={paletteKinds} catalog={catalog} />
            <ParticleLegend className="mt-auto" />
          </aside>
        )}

        <main className="relative flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={viewEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDelete={onDelete}
            isValidConnection={isValidConnection}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={24} color="oklch(1 0 0 / 6%)" />
            <ParticleLayer client={client} />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
          {practice && mode === 'game' && (
            <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-primary/40 bg-background/90 py-1 pr-1 pl-4 text-xs shadow-lg backdrop-blur">
              <GraduationCap className="size-4 text-primary" />
              <span>
                Bài học: <b>{LESSONS.find((l) => l.id === practice.lessonId)?.title}</b>
                {practice.xp === undefined ? ' · đạt ≥ 1★ khi chấm điểm để hoàn thành' : ` · đã hoàn thành (+${practice.xp} XP)`}
              </span>
              <Button size="sm" variant="secondary" className="h-7 rounded-full" onClick={backToPath}>
                <ArrowLeft /> Lộ trình
              </Button>
            </div>
          )}
          {error && (
            <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md border border-destructive/50 bg-destructive/15 px-3 py-2 text-sm text-destructive backdrop-blur">
              {error}
            </div>
          )}
        </main>

        <SidePanel full={panelFull} onExitFull={exitPanelFull}>
          <Tabs value={panel} onValueChange={(v) => setPanel(v as Panel)} className="min-h-0 flex-1 gap-0">
            <div className="m-3 mb-0 flex items-center gap-2">
              <TabsList className={cn('flex-1', panelFull && 'mx-auto max-w-xl')}>
                {mode === 'game' && <TabsTrigger value="level">Level</TabsTrigger>}
                <TabsTrigger value="metrics">Số liệu</TabsTrigger>
                <TabsTrigger value="trace">Trace</TabsTrigger>
                <TabsTrigger value="inspect">Thuộc tính</TabsTrigger>
              </TabsList>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                aria-label={panelFull ? 'Thu nhỏ panel' : 'Mở rộng panel'}
                title={panelFull ? 'Thu nhỏ (Esc)' : 'Mở rộng toàn màn hình'}
                onClick={() => setPanelFull((v) => !v)}
              >
                {panelFull ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className={cn('p-3', panelFull && 'mx-auto max-w-6xl px-6 py-4')}>
                {mode === 'game' && (
                  <TabsContent value="level" className="max-w-2xl">
                    <LevelPanel
                      level={level}
                      design={() => toDesign(nodesRef.current, edgesRef.current)}
                      onVerify={verify}
                      verifying={verifying}
                      best={best}
                      online={!levelKey.startsWith('learn/')}
                    />
                  </TabsContent>
                )}
                <TabsContent value="metrics" className="grid gap-3">
                  {mode === 'sandbox' && (
                    <div className="grid gap-3 rounded-lg border p-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">{preset.description}</p>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Traffic theo kịch bản</Label>
                        <Switch
                          checked={scripted}
                          onCheckedChange={(v) => {
                            setScripted(v);
                            settings.current.scripted = v;
                            commit(nodes, edges);
                          }}
                        />
                      </div>
                      {!scripted && (
                        <div className="grid gap-2">
                          <div className="flex justify-between text-xs">
                            <Label className="text-muted-foreground">Base RPS</Label>
                            <span className="font-mono">{rps}</span>
                          </div>
                          <Slider
                            min={0}
                            max={8000}
                            step={100}
                            value={[rps]}
                            onValueChange={([v]) => {
                              setRps(v);
                              client.setRps(v);
                            }}
                          />
                        </div>
                      )}
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        value={String(multiplier)}
                        onValueChange={(v) => {
                          if (!v) return;
                          setMultiplier(Number(v));
                          client.setMultiplier(Number(v));
                        }}
                      >
                        {MULTIPLIERS.map((m) => (
                          <ToggleGroupItem key={m} value={String(m)} className="font-mono text-xs">
                            {m === 1 ? 'Bình thường' : `Spike ×${m}`}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  )}
                  <MetricsPanel windows={windows} scenario={scenario} cost={cost} />
                </TabsContent>
                <TabsContent value="trace">
                  <TracePanel
                    events={traceEvents}
                    nodeLabel={(i) => nodes.find((n) => n.data.index === i)?.data.label ?? `#${i}`}
                    edgeEnds={(i) => {
                      const e = edges.find((x) => x.data?.index === i);
                      if (!e) return undefined;
                      const name = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? id;
                      return { source: name(e.source), target: name(e.target) };
                    }}
                    running={running}
                    auto={autoTrace}
                    onAuto={setAutoTrace}
                    onTrace={() => client.trace(1)}
                    pinned={pinnedTrace}
                    onPin={setPinnedTrace}
                    pinNote={() => {
                      const ROUTING = { sequence: 'tuần tự', parallel: 'song song' } as const;
                      const parts = nodes
                        .filter((n) => n.data.config.routing !== 'pick' && edges.filter((e) => e.source === n.id).length > 1)
                        .map((n) => `${n.data.label} ${ROUTING[n.data.config.routing as keyof typeof ROUTING]}`);
                      const ff = edges.filter((e) => e.data?.policy.fireAndForget).length;
                      if (ff) parts.push(`${ff} lời gọi không chờ`);
                      return parts.join(', ');
                    }}
                    onSlow={() => {
                      setSpeed('0.25');
                      client.setSpeed(0.25);
                    }}
                  />
                </TabsContent>
                <TabsContent value="inspect" className="max-w-2xl">
                  {selectedNode ? (
                    <NodeInspector
                      node={selectedNode.data}
                      outDegree={edges.filter((e) => e.source === selectedNode.id).length}
                      game={mode === 'game'}
                      maxInstances={level.maxInstances ?? 10}
                      onChange={(config, label) => updateNode(selectedNode.id, config, label)}
                      onToggleDown={() => toggleDown(selectedNode)}
                      onDelete={() => onDelete({ nodes: [selectedNode], edges: [] })}
                      onTech={mode === 'sandbox' ? (t, apply) => setTech(selectedNode.id, t, apply) : undefined}
                    />
                  ) : selectedEdge ? (
                    <EdgeInspector
                      edge={selectedEdge.data!}
                      source={nodes.find((n) => n.id === selectedEdge.source)?.data.label ?? selectedEdge.source}
                      target={nodes.find((n) => n.id === selectedEdge.target)?.data.label ?? selectedEdge.target}
                      game={mode === 'game'}
                      allowFireAndForget={mode !== 'game' || !!level.allowFireAndForget}
                      onChange={(p) => updateEdge(selectedEdge.id, p)}
                      onDelete={() => onDelete({ nodes: [], edges: [selectedEdge] })}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Chọn một node hoặc một edge trên canvas để chỉnh cấu hình, chính sách retry/timeout/circuit
                      breaker, hoặc giả lập sự cố.
                    </p>
                  )}
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
          <div className="border-t px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {nodes.length} node · {edges.length} edge · {fmt.money(cost)}/h
            {panelFull && running && <span className="ml-2 text-success">· mô phỏng vẫn đang chạy phía sau</span>}
          </div>
        </SidePanel>
      </div>
      )}
      <TechDialogs />
      <ResultDialog
        summary={result}
        onOpenChange={(open) => !open && setResult(null)}
        action={
          practice?.xp !== undefined && result && result.stars >= 1 ? (
            <Button
              onClick={() => {
                setResult(null);
                backToPath();
              }}
            >
              <GraduationCap /> Về lộ trình (+{practice.xp} XP)
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
