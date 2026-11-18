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
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import { ArrowLeft, Bookmark, ChevronLeft, Download, GraduationCap, History, Maximize2, Sparkles, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import { LEARN_LEVELS, LEVELS } from '@/presets';
import { useProgress } from '@/learn/progress';
import { LESSONS } from '@/learn/curriculum';
import { useSimClient } from '@/app/sim-context';
import { countByTarget, lint, type Finding, type LintDesign } from '@pattern/design-lint';
import { LintPanel } from './LintPanel';
import { CONFLICT_EVENT, setOpenProject, useSync } from '@/projects/sync';
import { idbStore } from '@/projects/store';
import { ShareDialog } from './ShareDialog';
import { Copy, Eye, Share2 } from 'lucide-react';
import { useUi } from '@/app/ui-store';
import { clearEdgeGeometry } from '@/gpu/edgeGeometry';
import {
  BUILDABLE,
  DEFAULT_CONFIG,
  DEFAULT_POLICY,
  type EdgePolicy,
  type NodeConfig,
  type NodeKind,
  type Preset,
  type Summary,
  type TraceEvent,
  type WindowMetrics,
} from '@/types';
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
} from '@/model/flow';
import { KIND_META, fmt } from '@/lib/meta';
import { ParticleLegend } from '@/components/ParticleLegend';
import { TracePanel, type PinnedTrace } from '@/components/TracePanel';
import { SystemNode } from '@/components/SystemNode';
import { FlowEdge } from '@/components/FlowEdge';
import { ParticleLayer } from '@/components/ParticleLayer';
import { MetricsPanel } from '@/components/MetricsPanel';
import { EdgeInspector, NodeInspector } from '@/components/Inspector';
import { LevelPanel } from '@/components/LevelPanel';
import { ResultDialog } from '@/components/ResultDialog';
import { DRAG_MIME, Palette } from '@/components/Palette';
import { GROUP_MIME, TECH_MIME, TechLibrary } from '@/tech/TechLibrary';
import { FrameNode, type FrameNodeType } from '@/components/FrameNode';
import { GROUP_KINDS, childGroups, memberIds, withGroups } from '@/projects/groups';
import { techOf } from '@/tech/catalog';
import { SaveStatus, type SaveState } from '@/projects/SaveStatus';
import { VersionHistory } from '@/projects/VersionHistory';
import { Textarea } from '@/components/ui/textarea';
import { PromptDialog } from '@/prompt/PromptDialog';
import { Input } from '@/components/ui/input';
import {
  download,
  exportJson,
  slug,
  snapshotOf,
  store,
  newId,
  type DesignGroup,
  type Project,
  type RunSnapshot,
  type Version,
} from '@/projects/store';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SidePanel } from '@/components/SidePanel';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const nodeTypes: NodeTypes = { system: SystemNode, frame: FrameNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };
const HISTORY = 120;
const SPEEDS = ['0.25', '0.5', '1', '2', '4', '8'];
const MULTIPLIERS = [1, 2, 3, 5];

type Mode = 'sandbox' | 'game';

export type WorkspaceProps =
  | {
      mode: 'game';
      levelKey: string;
      /** Opened from a lesson of the learning path. */
      lessonId?: string | null;
      onBackToPath?: () => void;
      onLevelChange: (key: string) => void;
    }
  | {
      mode: 'sandbox';
      project: Project;
      onClose: () => void;
      /** Shared link (`/s/:slug`): nothing is saved; the visitor can copy it to their projects. */
      readOnly?: { author: string; onDuplicate: (p: Project) => void };
    };
type Panel = 'metrics' | 'inspect' | 'level' | 'trace' | 'notes' | 'lint';
const AUTO_VERSION_MS = 5 * 60 * 1000;
const projectKey = (id: string) => `project:${id}`;
const MAX_TRACE_EVENTS = 6000;

const bestKey = (id: string) => `pattern.best.${id}`;
const EMPTY_PRESET: Preset = {
  title: '',
  description: '',
  design: { nodes: [], edges: [] },
  scenario: { seed: 1, timeoutMs: 2000, traffic: [{ atMs: 0, rps: 0 }], slo: { p99Ms: 200, errorRate: 0.01 }, windowMs: 1000 },
};
const ALL_LEVELS = { ...LEVELS, ...LEARN_LEVELS };

/** Canvas + simulation + side panel, for a game level or a studio project. */
export function Workspace(props: WorkspaceProps) {
  const client = useSimClient();
  const { screenToFlowPosition } = useReactFlow();
  const mode: Mode = props.mode;
  const readOnly = props.mode === 'sandbox' ? props.readOnly : undefined;
  const [shareOpen, setShareOpen] = useState(false);
  const levelKey = props.mode === 'game' ? props.levelKey : Object.keys(LEVELS)[0];
  /** Practice level opened from a lesson of the learning path. */
  const [practice, setPractice] = useState<{ lessonId: string; level: string; xp?: number } | null>(
    props.mode === 'game' && props.lessonId ? { lessonId: props.lessonId, level: props.levelKey } : null,
  );
  const { complete } = useProgress();
  const [presetKey, setPresetKey] = useState('');
  /** Studio project open on the sandbox canvas. */
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef(project);
  const [reloadTick, setReloadTick] = useState(0);
  const projectPreset = useMemo<Preset | null>(
    () =>
      project
        ? { title: project.name, description: project.description, design: project.design, scenario: project.scenario }
        : null,
    [project],
  );
  const preset: Preset = projectPreset ?? EMPTY_PRESET;
  const level = ALL_LEVELS[levelKey] ?? LEVELS[Object.keys(LEVELS)[0]];
  const scenario = mode === 'game' ? level.scenario : preset.scenario;

  const [nodes, setNodes, onNodesChange] = useNodesState<SystemNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdgeType>([]);
  /** Canvas frames (cluster, namespace, node pool, zone): visual only. */
  const [groups, setGroups] = useState<DesignGroup[]>([]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const [groupSel, setGroupSel] = useState<string | null>(null);
  const dragMembers = useRef(new Map<string, { nodes: Set<string>; groups: Set<string> }>());
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

  const settings = useRef({ mode, level, preset, rps, multiplier, scripted, presetKey });
  settings.current = { mode, level, preset, rps, multiplier, scripted, presetKey };
  /** Preset key and design JSON last put on the canvas by `load` (autosave compares against it). */
  const loaded = useRef({ key: '', design: '' });

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
    const frames = s.mode === 'game' ? [] : ((source.design as { groups?: DesignGroup[] }).groups ?? []);
    setGroups(frames);
    groupsRef.current = frames;
    setGroupSel(null);
    loaded.current = {
      key: s.mode === 'game' ? '' : s.presetKey,
      design: JSON.stringify(withGroups(toDesign(flow.nodes, flow.edges), frames)),
    };
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
    if (mode === 'sandbox' && !presetKey) return; // project not opened yet
    setPanel(mode === 'game' ? 'level' : 'metrics');
    load();
  }, [client, mode, presetKey, levelKey, load, reloadTick]);

  const backToPath = () => {
    setPractice(null);
    if (props.mode === 'game') props.onBackToPath?.();
  };

  // ------------------------------------------------------------------ studio projects

  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [notes, setNotes] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versionRev, setVersionRev] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const saved = useRef({ design: '', notes: '' });
  const lastVersionAt = useRef(0);
  const flushSave = useRef<(() => void) | null>(null);
  projectRef.current = project;

  const showFlash = (text: string) => {
    setFlash(text);
    setTimeout(() => setFlash((f) => (f === text ? null : f)), 2500);
  };

  const firstVersionFor = useRef<string | null>(null);
  const openProject = useCallback((p: Project) => {
    const opened = { ...p, design: { ...autoLayout(p.design), groups: p.design.groups } };
    projectRef.current = opened;
    setProject(opened);
    setNotes(opened.notes);
    saved.current = { design: '', notes: opened.notes };
    setSaveState({ status: 'saved', at: opened.updatedAt });
    setPresetKey(projectKey(opened.id));
    setReloadTick((t) => t + 1);
    setScripted(false);
    settings.current.scripted = false;
    lastVersionAt.current = Date.now();
    if (readOnly) return;
    store.versions(opened.id).then((vs) => {
      if (vs.length) lastVersionAt.current = vs[0].at;
      // a project from the server already has its history elsewhere
      else if (!opened.rev && firstVersionFor.current !== opened.id) {
        firstVersionFor.current = opened.id; // StrictMode runs the open effect twice
        store.addVersion(snapshotOf(opened, 'Tạo dự án')).then(() => setVersionRev((r) => r + 1));
      }
    });
  }, [readOnly]);

  const closeProject = () => {
    flushSave.current?.();
    client.pause();
    setRunning(false);
    if (props.mode === 'sandbox') props.onClose();
  };

  // open the project given by the route
  const initialProject = props.mode === 'sandbox' ? props.project : null;
  useEffect(() => {
    if (!initialProject) return;
    openProject(initialProject);
    // sync must not replace it while it is on the canvas
    setOpenProject(initialProject.id);
    return () => setOpenProject(null);
  }, [initialProject, openProject]);
  // is the open project in the account yet? (the sync engine sets `owner`)
  const lastSync = useSync((s) => s.lastSync);
  const [owned, setOwned] = useState(false);
  useEffect(() => {
    if (initialProject && !readOnly) void idbStore.get(initialProject.id).then((p) => setOwned(!!p?.owner));
  }, [initialProject, readOnly, lastSync]);
  useEffect(() => {
    const onConflict = (e: Event) =>
      showFlash(`“${(e as CustomEvent<{ name: string }>).detail.name}” cũng được sửa ở máy khác: bản đó được giữ trong lịch sử phiên bản`);
    window.addEventListener(CONFLICT_EVENT, onConflict);
    return () => window.removeEventListener(CONFLICT_EVENT, onConflict);
  }, []);

  // leaving the page: stop the engine, save, remember the design for the capacity tools
  const setLastDesign = useUi((s) => s.setLastDesign);
  useEffect(
    () => () => {
      flushSave.current?.();
      client.pause();
      const p = projectRef.current;
      if (p) setLastDesign({ title: p.name, design: toDesign(nodesRef.current, edgesRef.current) });
    },
    [client, setLastDesign],
  );

  /** Write the canvas + notes to IndexedDB now. */
  const persist = useCallback(async (design: string, nextNotes: string) => {
    const current = projectRef.current;
    if (!current) return null;
    const p: Project = {
      ...current,
      design: JSON.parse(design),
      notes: nextNotes,
      updatedAt: Date.now(),
    };
    projectRef.current = p;
    setSaveState({ status: 'saving' });
    try {
      await store.put(p);
      saved.current = { design, notes: nextNotes };
      setProject(p);
      setSaveState({ status: 'saved', at: p.updatedAt });
      if (Date.now() - lastVersionAt.current > AUTO_VERSION_MS) {
        lastVersionAt.current = Date.now();
        await store.addVersion(snapshotOf(p));
        setVersionRev((r) => r + 1);
      }
      return p;
    } catch (e) {
      setSaveState({ status: 'error', message: String((e as Error).message ?? e) });
      return null;
    }
  }, []);

  const designJson = useMemo(
    () => (project && mode === 'sandbox' ? JSON.stringify(withGroups(toDesign(nodes, edges), groups)) : null),
    [project, mode, nodes, edges, groups],
  );

  // design review (studio only: in game levels it would give the answer away)
  const findings = useMemo<Finding[]>(
    () => (designJson ? lint(JSON.parse(designJson) as LintDesign, preset.scenario) : []),
    [designJson, preset.scenario],
  );
  const lintCounts = useMemo(() => countByTarget(findings), [findings]);

  // autosave: debounce edits (drag, config, wiring, notes) 800 ms
  useEffect(() => {
    if (readOnly || !designJson || !project || loaded.current.key !== projectKey(project.id)) return;
    if (!saved.current.design) saved.current.design = loaded.current.design;
    const dirty = designJson !== saved.current.design || notes !== saved.current.notes;
    if (!dirty) {
      flushSave.current = null;
      setSaveState((st) => (st.status === 'saving' ? { status: 'saved', at: projectRef.current?.updatedAt ?? Date.now() } : st));
      return;
    }
    setSaveState({ status: 'saving' });
    const run = () => {
      flushSave.current = null;
      persist(designJson, notes);
    };
    flushSave.current = run;
    const t = setTimeout(run, 800);
    return () => clearTimeout(t);
  }, [designJson, notes, project, persist, readOnly]);

  // do not lose the last 800 ms when the tab closes
  useEffect(() => {
    const flush = () => flushSave.current?.();
    window.addEventListener('pagehide', flush);
    const onVis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const saveNamedVersion = useCallback(async () => {
    const current = projectRef.current;
    if (!current) return;
    const p = (await persist(designJson ?? JSON.stringify(current.design), notes)) ?? current;
    const label = `Phiên bản ${new Date().toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`;
    await store.addVersion(snapshotOf(p, label));
    lastVersionAt.current = Date.now();
    setVersionRev((r) => r + 1);
    showFlash(`Đã lưu “${label}”`);
  }, [designJson, notes, persist]);

  // ⌘S / Ctrl+S: named version
  useEffect(() => {
    if (mode !== 'sandbox' || !project || readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveNamedVersion();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, project, saveNamedVersion, readOnly]);

  const restoreVersion = async (v: Version) => {
    const current = projectRef.current;
    if (!current) return;
    await store.addVersion(snapshotOf(current, 'Trước khi khôi phục'));
    const p: Project = { ...current, design: v.design, scenario: v.scenario, notes: v.notes, updatedAt: Date.now() };
    await store.put(p);
    setVersionRev((r) => r + 1);
    openProject(p);
    showFlash('Đã khôi phục phiên bản');
  };

  const renameProject = async (name: string) => {
    setRenaming(false);
    const current = projectRef.current;
    if (!current || !name.trim() || name === current.name) return;
    const p = { ...current, name: name.trim(), updatedAt: Date.now() };
    projectRef.current = p;
    setProject(p);
    await store.put(p);
  };

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

  // remember how the open project behaved (feeds the agent prompt)
  useEffect(() => {
    const current = projectRef.current;
    if (!current || mode !== 'sandbox' || windows.length < 5 || windows.length % 5 !== 0) return;
    const recent = windows.slice(-10);
    const avg = (f: (w: WindowMetrics) => number) => recent.reduce((s, w) => s + f(w), 0) / recent.length;
    const total = recent.reduce((s, w) => s + w.okCount + w.errorCount, 0);
    const errors = recent.reduce((s, w) => s + w.errorCount, 0);
    const last = recent[recent.length - 1];
    const ns = [...nodesRef.current].sort((a, b) => a.data.index - b.data.index);
    const hot = ns
      .filter((n) => n.data.kind !== 'client')
      .map((n) => ({
        label: n.data.label,
        utilization: avg((w) => w.nodes[n.data.index]?.utilization ?? 0),
        dropped: Math.round(avg((w) => w.nodes[n.data.index]?.rejected ?? 0)),
        queue: last.nodes[n.data.index]?.queue ?? 0,
      }))
      .filter((h) => h.utilization > 0.7 || h.dropped > 0)
      .sort((a, b) => b.utilization - a.utilization)
      .slice(0, 5);
    const lastRun: RunSnapshot = {
      at: Date.now(),
      simSeconds: Math.round(last.tMs / 1000),
      rps: Math.round(avg((w) => w.rps)),
      p50Ms: avg((w) => w.p50Ms),
      p99Ms: avg((w) => w.p99Ms),
      errorRate: total ? errors / total : 0,
      sloOk: recent.filter((w) => w.sloOk).length / recent.length,
      costPerHour: nodesRef.current.reduce(
        (sum, n) => sum + (n.data.kind === 'client' ? 0 : n.data.config.costPerHour * n.data.config.instances),
        0,
      ),
      hot,
    };
    const p = { ...current, lastRun };
    projectRef.current = p;
    setProject(p);
    if (!readOnly) store.put(p).catch(() => {});
  }, [windows, mode, readOnly]);

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
        data: { ...e.data!, lint: lintCounts.edges.get(`${e.source}->${e.target}`) },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: e.selected ? 'var(--primary)' : 'oklch(0.6 0 0)',
        },
      })),
    [nodes, edges, lintCounts],
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
      const frameKind = e.dataTransfer.getData(GROUP_MIME) as DesignGroup['kind'];
      if (frameKind && GROUP_KINDS[frameKind]) {
        const position = screenToFlowPosition({ x: e.clientX - 40, y: e.clientY - 20 });
        const same = groupsRef.current.filter((g) => g.kind === frameKind).length;
        const label = { cluster: 'prod', namespace: 'app', nodePool: 'pool', zone: 'zone-a' }[frameKind] + (same ? `-${same + 1}` : '');
        const g: DesignGroup = { id: `g-${newId().slice(0, 8)}`, kind: frameKind, label, position, size: { width: 560, height: 340 } };
        setGroups((gs) => [...gs, g]);
        setGroupSel(g.id);
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setPanel('inspect');
        return;
      }
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
  const selectedGroup = selectedNode || selectedEdge ? undefined : groups.find((g) => g.id === groupSel);
  const selectionKey = selectedNode?.id ?? selectedEdge?.id ?? selectedGroup?.id;
  useEffect(() => {
    if (selectionKey) setPanel('inspect');
  }, [selectionKey]);

  // ------------------------------------------------------------------ frames

  const frameNodes = useMemo<FrameNodeType[]>(
    () =>
      mode === 'sandbox'
        ? groups.map((g) => {
            const members = memberIds(g, nodes);
            return {
              id: g.id,
              type: 'frame',
              position: g.position,
              width: g.size.width,
              height: g.size.height,
              style: { width: g.size.width, height: g.size.height },
              zIndex: -1,
              selected: groupSel === g.id,
              data: {
                group: g,
                members: members.size,
                down: members.size > 0 && nodes.filter((n) => members.has(n.id)).every((n) => n.data.down),
              },
            };
          })
        : [],
    [mode, groups, groupSel, nodes],
  );
  const canvasNodes = useMemo(
    () =>
      [
        ...frameNodes,
        ...(lintCounts.nodes.size
          ? nodes.map((n) => (lintCounts.nodes.has(n.id) ? { ...n, data: { ...n.data, lint: lintCounts.nodes.get(n.id) } } : n))
          : nodes),
      ] as Node[],
    [frameNodes, nodes, lintCounts],
  );

  const onCanvasNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const ids = new Set(groupsRef.current.map((g) => g.id));
      const isFrame = (c: NodeChange<Node>) => 'id' in c && ids.has(c.id);
      const nodeChanges = changes.filter((c) => !isFrame(c)) as NodeChange<SystemNodeType>[];
      if (nodeChanges.length) onNodesChange(nodeChanges);
      const frameChanges = changes.filter(isFrame);
      if (!frameChanges.length) return;
      let next = groupsRef.current;
      const moves = new Map<string, { dx: number; dy: number }>();
      for (const c of frameChanges) {
        if (c.type === 'select') setGroupSel((s) => (c.selected ? c.id : s === c.id ? null : s));
        if (c.type === 'remove') next = next.filter((g) => g.id !== c.id);
        if (c.type === 'position' && c.position) {
          const g = next.find((x) => x.id === c.id)!;
          const dx = c.position.x - g.position.x;
          const dy = c.position.y - g.position.y;
          if (!dx && !dy) continue;
          if (c.dragging) moves.set(c.id, { dx, dy });
          next = next.map((x) => (x.id === c.id ? { ...x, position: c.position! } : x));
        }
        if (c.type === 'dimensions' && c.dimensions && (c.setAttributes || c.resizing)) {
          next = next.map((x) => (x.id === c.id ? { ...x, size: { width: c.dimensions!.width, height: c.dimensions!.height } } : x));
        }
      }
      // dragging a frame carries its nodes and inner frames along
      moves.forEach(({ dx, dy }, id) => {
        const m = dragMembers.current.get(id);
        if (!m) return;
        next = next.map((x) => (m.groups.has(x.id) ? { ...x, position: { x: x.position.x + dx, y: x.position.y + dy } } : x));
        setNodes((ns) => ns.map((n) => (m.nodes.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)));
      });
      groupsRef.current = next;
      setGroups(next);
    },
    [onNodesChange, setNodes],
  );

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    const g = groupsRef.current.find((x) => x.id === node.id);
    if (!g) return;
    dragMembers.current.set(g.id, {
      nodes: memberIds(g, nodesRef.current),
      groups: new Set(childGroups(g, groupsRef.current).map((x) => x.id)),
    });
  }, []);
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    dragMembers.current.delete(node.id);
  }, []);

  const updateGroup = (id: string, patch: Partial<DesignGroup>) =>
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const removeGroup = (id: string) => {
    setGroups((gs) => gs.filter((g) => g.id !== id));
    setGroupSel(null);
  };
  /** Chaos: lose every node in a frame (a node pool or zone going away). */
  const setGroupDown = (g: DesignGroup, down: boolean) => {
    const members = memberIds(g, nodesRef.current);
    nodesRef.current
      .filter((n) => members.has(n.id) && n.data.kind !== 'client')
      .forEach((n) => client.setNodeDown(n.data.index, down));
    setNodes((ns) => ns.map((n) => (members.has(n.id) && n.data.kind !== 'client' ? { ...n, data: { ...n.data, down } } : n)));
  };

  /** Show a finding's node or edge on the canvas (opens its inspector). */
  const selectFinding = (f: Finding) => {
    const t = f.target;
    if ('design' in t) return;
    setNodes((ns) => ns.map((n) => ({ ...n, selected: 'node' in t && n.id === t.node })));
    setEdges((es) => es.map((e) => ({ ...e, selected: 'edge' in t && e.source === t.edge[0] && e.target === t.edge[1] })));
  };
  /** Apply the one-click fix of a finding and rerun. */
  const applyFix = (f: Finding) => {
    if (!f.fix) return;
    let ns = nodesRef.current;
    let es = edgesRef.current;
    for (const p of f.fix.patches) {
      const t = p.target;
      if ('node' in t)
        ns = ns.map((n) => (n.id === t.node ? { ...n, data: { ...n.data, config: { ...n.data.config, [p.field]: p.value } } } : n));
      else
        es = es.map((e) =>
          e.source === t.edge[0] && e.target === t.edge[1] ? { ...e, data: { ...e.data!, policy: { ...e.data!.policy, [p.field]: p.value } } } : e,
        );
    }
    commit(ns, es);
    showFlash(`Đã áp dụng: ${f.fix.label}`);
  };

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
    const current = projectRef.current;
    if (current) {
      download(`${slug(current.name)}.json`, exportJson({ ...current, design: withGroups(toDesign(nodes, edges), groups), notes }));
      return;
    }
    const data = { title: preset.title, description: preset.description, design: toDesign(nodes, edges), scenario };
    download('design.json', JSON.stringify(data, null, 2));
  };

  // autoscaled nodes cost what is running right now
  const cost = nodes.reduce(
    (sum, n) =>
      sum +
      (n.data.kind === 'client'
        ? 0
        : n.data.config.costPerHour *
          (n.data.config.autoscale ? (n.data.metrics?.instances ?? 0) + (n.data.metrics?.starting ?? 0) || n.data.config.instances : n.data.config.instances)),
    0,
  );
  const simSeconds = (windows.at(-1)?.tMs ?? 0) / 1000;
  const duration = (level.scenario.durationMs ?? 0) / 1000;
  const paletteKinds = mode === 'game' ? level.palette : BUILDABLE;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        {mode === 'game' ? (
          <Select
            value={levelKey}
            onValueChange={(v) => {
              setPractice(null);
              if (props.mode === 'game') props.onLevelChange(v);
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
        ) : project && readOnly ? (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Eye className="size-4 text-muted-foreground" />
            <span className="max-w-72 truncate font-medium">{project.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              chỉ xem · của {readOnly.author} · sửa thử thoải mái, không lưu
            </span>
          </div>
        ) : project ? (
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={closeProject}>
              <ChevronLeft /> Dự án
            </Button>
            <span className="text-muted-foreground">/</span>
            {renaming ? (
              <Input
                autoFocus
                defaultValue={project.name}
                className="h-7 w-56 text-sm"
                onBlur={(e) => renameProject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') renameProject((e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
            ) : (
              <button
                className="max-w-64 truncate rounded px-1.5 py-0.5 font-medium hover:bg-accent"
                title="Bấm để đổi tên"
                onClick={() => setRenaming(true)}
              >
                {project.name}
              </button>
            )}
            <span className="ml-2">
              {flash ? <span className="text-xs text-success">{flash}</span> : <SaveStatus state={saveState} owned={owned} />}
            </span>
          </div>
        ) : null}

        <div className={mode === 'sandbox' && !project ? 'hidden' : 'ml-auto flex items-center gap-2'}>
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
          {readOnly && (
            <Button
              size="sm"
              onClick={() =>
                project && readOnly.onDuplicate({ ...project, design: withGroups(toDesign(nodes, edges), groups), notes })
              }
            >
              <Copy /> Nhân bản vào dự án của tôi
            </Button>
          )}
          {mode === 'sandbox' && !readOnly && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setShareOpen(true)}>
                <Share2 /> Chia sẻ
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPromptOpen(true)}>
                <Sparkles /> Prompt
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" onClick={saveNamedVersion} aria-label="Lưu phiên bản">
                    <Bookmark />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Lưu phiên bản có tên (⌘/Ctrl+S)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" onClick={() => setHistoryOpen(true)} aria-label="Lịch sử phiên bản">
                    <History />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Lịch sử phiên bản</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" onClick={exportDesign} aria-label="Tải JSON">
                    <Download />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Tải design JSON (chạy được bằng `pnpm sim`)</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </header>

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
            nodes={canvasNodes}
            edges={viewEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onCanvasNodesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            elevateNodesOnSelect={false}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDelete={({ nodes: dn, edges: de }) =>
              onDelete({ nodes: dn.filter((n) => n.type === 'system') as SystemNodeType[], edges: de as FlowEdgeType[] })
            }
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
              <TabsList className={cn('min-w-0 flex-1 justify-start overflow-x-auto', panelFull && 'mx-auto max-w-xl')}>
                {mode === 'game' && <TabsTrigger value="level">Level</TabsTrigger>}
                <TabsTrigger value="metrics">Số liệu</TabsTrigger>
                <TabsTrigger value="trace">Trace</TabsTrigger>
                <TabsTrigger value="inspect">Thuộc tính</TabsTrigger>
                {mode === 'sandbox' && (
                  <TabsTrigger value="lint" className="gap-1">
                    Kiểm tra
                    {findings.some((f) => f.severity !== 'info') && (
                      <span
                        className={cn(
                          'rounded-full px-1.5 font-mono text-[10px] leading-4 text-white',
                          findings.some((f) => f.severity === 'error') ? 'bg-destructive' : 'bg-warning text-black',
                        )}
                      >
                        {findings.filter((f) => f.severity !== 'info').length}
                      </span>
                    )}
                  </TabsTrigger>
                )}
                {mode === 'sandbox' && project && <TabsTrigger value="notes">Ghi chú</TabsTrigger>}
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
                  <MetricsPanel
                    windows={windows}
                    scenario={scenario}
                    cost={cost}
                    replicas={nodes
                      .filter((n) => n.data.config.autoscale)
                      .map((n) => ({ index: n.data.index, label: n.data.label }))}
                  />
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
                {mode === 'sandbox' && project && (
                  <TabsContent value="notes" className="grid max-w-2xl gap-2">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Mục tiêu, yêu cầu nghiệp vụ, ràng buộc (ngân sách, đội ngũ, hạ tầng hiện có…). Ghi chú được lưu tự
                      động và đưa vào prompt cho agent triển khai.
                    </p>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={'Ví dụ:\n- Đồng bộ user từ Authentik sang DB nội bộ trong < 5 giây\n- Không mất event khi worker chết\n- Team 3 dev NestJS, chạy trên K8s on-prem'}
                      className="min-h-72 font-mono text-xs leading-relaxed"
                    />
                    {project.lastRun && (
                      <p className="text-[12px] text-muted-foreground">
                        Lần mô phỏng gần nhất: {project.lastRun.rps} rps · p99 {fmt.ms(project.lastRun.p99Ms)} · lỗi{' '}
                        {fmt.pct(project.lastRun.errorRate)}
                      </p>
                    )}
                  </TabsContent>
                )}
                {mode === 'sandbox' && (
                  <TabsContent value="lint" className="max-w-2xl">
                    <LintPanel findings={findings} onSelect={selectFinding} onFix={applyFix} />
                  </TabsContent>
                )}
                <TabsContent value="inspect" className="max-w-2xl">
                  {selectedNode ? (
                    <NodeInspector
                      node={selectedNode.data}
                      queues={nodes
                        .filter((n) => n.type === 'system' && (n as SystemNodeType).data.kind === 'queue')
                        .map((n) => ({ id: n.id, label: (n as SystemNodeType).data.label }))}
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
                  ) : selectedGroup ? (
                    <div className="grid gap-3">
                      <div className="flex items-center gap-2">
                        <span className="size-3 rounded-sm" style={{ background: GROUP_KINDS[selectedGroup.kind].color }} />
                        <span className="font-semibold">{GROUP_KINDS[selectedGroup.kind].name}</span>
                        <span className="text-xs text-muted-foreground">{GROUP_KINDS[selectedGroup.kind].hint}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">Tên</Label>
                          <Input
                            className="h-8"
                            value={selectedGroup.label}
                            onChange={(e) => updateGroup(selectedGroup.id, { label: e.target.value })}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">Loại</Label>
                          <Select
                            value={selectedGroup.kind}
                            onValueChange={(v) => updateGroup(selectedGroup.id, { kind: v as DesignGroup['kind'] })}
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(GROUP_KINDS) as DesignGroup['kind'][]).map((k) => (
                                <SelectItem key={k} value={k}>
                                  {GROUP_KINDS[k].name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs text-muted-foreground">Bên trong khung</Label>
                        <p className="text-sm">
                          {nodes
                            .filter((n) => memberIds(selectedGroup, [n]).size)
                            .map((n) => n.data.label)
                            .join(', ') || 'Chưa có node. Kéo node vào trong khung.'}
                        </p>
                      </div>
                      {(() => {
                        const members = memberIds(selectedGroup, nodes);
                        const down = members.size > 0 && nodes.filter((n) => members.has(n.id)).every((n) => n.data.down);
                        return (
                          <Button
                            variant={down ? 'default' : 'outline'}
                            size="sm"
                            disabled={!members.size}
                            onClick={() => setGroupDown(selectedGroup, !down)}
                          >
                            {down ? 'Khôi phục cả khung' : `Giả lập mất ${GROUP_KINDS[selectedGroup.kind].name.toLowerCase()} (tắt mọi node bên trong)`}
                          </Button>
                        );
                      })()}
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        Khung chỉ để tổ chức và sinh manifest Kubernetes trong prompt, không ảnh hưởng mô phỏng. Kéo khung sẽ
                        kéo theo mọi node bên trong.
                      </p>
                      <Button variant="ghost" size="sm" className="justify-self-start text-destructive" onClick={() => removeGroup(selectedGroup.id)}>
                        Xoá khung (giữ node)
                      </Button>
                    </div>
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
          <div className="border-t px-3 py-2 font-mono text-[12px] text-muted-foreground">
            {nodes.length} node · {edges.length} edge · {fmt.money(cost)}/h
            {panelFull && running && <span className="ml-2 text-success">· mô phỏng vẫn đang chạy phía sau</span>}
          </div>
        </SidePanel>
      </div>
      <PromptDialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        project={
          project && promptOpen
            ? { ...project, design: withGroups(toDesign(nodes, edges), groups), notes }
            : null
        }
      />
      {project && !readOnly && <ShareDialog project={project} open={shareOpen} onOpenChange={setShareOpen} />}
      {project && !readOnly && (
        <VersionHistory
          projectId={project.id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          onRestore={restoreVersion}
          onSaveNamed={saveNamedVersion}
          revision={versionRev}
        />
      )}
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
