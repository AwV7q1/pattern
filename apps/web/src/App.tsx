import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { Download, Gamepad2, Pause, Play, RotateCcw, Shapes } from 'lucide-react';
import { LEVELS, PRESETS } from './presets';
import { SimClient } from './sim/client';
import { clearEdgeGeometry } from './gpu/edgeGeometry';
import {
  BUILDABLE,
  DEFAULT_CONFIG,
  DEFAULT_POLICY,
  type EdgePolicy,
  type NodeConfig,
  type NodeKind,
  type Summary,
  type WindowMetrics,
} from './types';
import {
  reindex,
  toDesign,
  toFlow,
  uniqueId,
  wouldCycle,
  type FlowEdgeType,
  type SystemNodeType,
} from './model/flow';
import { KIND_META, PARTICLE_LEGEND, fmt } from './lib/meta';
import { SystemNode } from './components/SystemNode';
import { FlowEdge } from './components/FlowEdge';
import { ParticleLayer } from './components/ParticleLayer';
import { MetricsPanel } from './components/MetricsPanel';
import { EdgeInspector, NodeInspector } from './components/Inspector';
import { LevelPanel } from './components/LevelPanel';
import { ResultDialog } from './components/ResultDialog';
import { DRAG_MIME, Palette } from './components/Palette';
import { Button } from './components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
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

type Mode = 'sandbox' | 'game';
type Panel = 'metrics' | 'inspect' | 'level';

const bestKey = (id: string) => `pattern.best.${id}`;

export function App() {
  const client = useMemo(() => new SimClient(), []);
  const { screenToFlowPosition } = useReactFlow();
  const [mode, setMode] = useState<Mode>('game');
  const [presetKey, setPresetKey] = useState(Object.keys(PRESETS)[0]);
  const [levelKey, setLevelKey] = useState(Object.keys(LEVELS)[0]);
  const preset = PRESETS[presetKey];
  const level = LEVELS[levelKey];
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
  const [catalog, setCatalog] = useState<Record<string, NodeConfig>>({});
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const [best, setBest] = useState(0);

  // ------------------------------------------------------------------ simulation lifecycle

  const settings = useRef({ mode, level, preset, rps, multiplier, scripted });
  settings.current = { mode, level, preset, rps, multiplier, scripted };

  /** (Re)start the engine from a design. Always call with reindexed nodes/edges. */
  const restart = useCallback(
    (ns: SystemNodeType[], es: FlowEdgeType[], autoplay: boolean) => {
      const s = settings.current;
      setError(null);
      setWindows([]);
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
    setPanel(mode === 'game' ? 'level' : 'metrics');
    load();
  }, [mode, presetKey, levelKey, load]);

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
    return client.onTick((_, ws) => {
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
      const policy: EdgePolicy = { ...DEFAULT_POLICY, latencyMs: fromClient ? 5 : 1 };
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
      const ns = nodesRef.current;
      const id = uniqueId(kind, new Set(ns.map((n) => n.id)));
      const sameKind = ns.filter((n) => n.data.kind === kind).length;
      const position = screenToFlowPosition({ x: e.clientX - 100, y: e.clientY - 30 });
      const node: SystemNodeType = {
        id,
        type: 'system',
        position,
        selected: true,
        data: {
          index: ns.length,
          label: `${KIND_META[kind].name}${sameKind ? ` ${sameKind + 1}` : ''}`,
          kind,
          config: { ...DEFAULT_CONFIG, ...catalog[kind] },
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
  const selectedEdge = selectedNode ? undefined : edges.find((e) => e.selected);
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
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="game">
              <Gamepad2 /> Game
            </TabsTrigger>
            <TabsTrigger value="sandbox">
              <Shapes /> Sandbox
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'game' ? (
          <Select value={levelKey} onValueChange={setLevelKey}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LEVELS).map(([key, l]) => (
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
              {Object.entries(PRESETS).map(([key, p]) => (
                <SelectItem key={key} value={key}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex items-center gap-2">
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

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col gap-4 border-r p-3">
          <Palette kinds={paletteKinds} catalog={catalog} />
          <div className="mt-auto grid gap-1 text-[11px] text-muted-foreground">
            {PARTICLE_LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-2">
                <i className="size-2 rounded-full" style={{ background: l.color }} /> {l.label}
              </span>
            ))}
          </div>
        </aside>

        <main className="relative flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
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
          {error && (
            <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md border border-destructive/50 bg-destructive/15 px-3 py-2 text-sm text-destructive backdrop-blur">
              {error}
            </div>
          )}
        </main>

        <aside className="flex w-[380px] shrink-0 flex-col border-l">
          <Tabs value={panel} onValueChange={(v) => setPanel(v as Panel)} className="min-h-0 flex-1 gap-0">
            <TabsList className="m-3 mb-0 w-[calc(100%-1.5rem)]">
              {mode === 'game' && <TabsTrigger value="level">Level</TabsTrigger>}
              <TabsTrigger value="metrics">Số liệu</TabsTrigger>
              <TabsTrigger value="inspect">Thuộc tính</TabsTrigger>
            </TabsList>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-3">
                {mode === 'game' && (
                  <TabsContent value="level">
                    <LevelPanel
                      level={level}
                      design={() => toDesign(nodesRef.current, edgesRef.current)}
                      onVerify={verify}
                      verifying={verifying}
                      best={best}
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
                <TabsContent value="inspect">
                  {selectedNode ? (
                    <NodeInspector
                      node={selectedNode.data}
                      game={mode === 'game'}
                      maxInstances={level.maxInstances ?? 10}
                      onChange={(config, label) => updateNode(selectedNode.id, config, label)}
                      onToggleDown={() => toggleDown(selectedNode)}
                      onDelete={() => onDelete({ nodes: [selectedNode], edges: [] })}
                    />
                  ) : selectedEdge ? (
                    <EdgeInspector
                      edge={selectedEdge.data!}
                      source={nodes.find((n) => n.id === selectedEdge.source)?.data.label ?? selectedEdge.source}
                      target={nodes.find((n) => n.id === selectedEdge.target)?.data.label ?? selectedEdge.target}
                      game={mode === 'game'}
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
          </div>
        </aside>
      </div>
      <ResultDialog summary={result} onOpenChange={(open) => !open && setResult(null)} />
    </div>
  );
}
