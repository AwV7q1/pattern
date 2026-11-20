// Your system as a diagram: drawn from the fight's design graph, with the
// sockets of its chassis where modules plug in. Requests enter at the
// gateway on the right and flow left; side calls (the partner) sit below.

import { type ReactNode, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, Cloud, Database, Split, TriangleAlert, Handshake, ListPlus, Network, Plus, Server, Swords, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Design, DesignNode } from '@/types';
import { activeCombos, alias, cardDef, chassisOf, currentIntent, designOf, hotfixable, leakNow, insertedNode, moduleOf, modulesAt, modulesOf, nodeOf, socketOf, socketsOf, type Placement } from './rules';
import type { BattleState, CardDef, SocketDef, SocketKind } from './types';
import { CONTENT } from './content';
import { cardIcon } from './cardArt';
import { plainCardText } from './textFormat';
import type { DropTarget } from './Hand';

export type NodeLoad = { util: number; bad: boolean };

/** Short names of socket kinds, for cards and tooltips. */
export const SOCKET_KIND_LABEL: Record<SocketKind, string> = { edge: 'biên', compute: 'xử lý', link: 'đường gọi', front: 'trước DB', storage: 'lưu trữ', async: 'bất đồng bộ', observe: 'quan sát' };

/** A socketed card being dragged: where it can go, and what is under the pointer. */
export type Plug = { def: CardDef; moves: Placement[]; over: DropTarget | null };

/** Elements effects and drops aim at: nodes by id, sockets by id, modules by uid. */
export type InfraRefs = {
  nodes: RefObject<Record<string, HTMLDivElement | null>>;
  sockets: RefObject<Record<string, HTMLElement | null>>;
  mods: RefObject<Record<number, HTMLElement | null>>;
  gate: RefObject<HTMLDivElement | null>;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const keysK = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

/**
 * The diagram's shape: the main path from the entry (each node's first call, by `order`),
 * and the side chains that leave it (the partner, through a queue when there is one).
 */
export function layoutOf(design: Design): { main: string[]; branches: { from: string; chain: string[] }[] } {
  const outs = (id: string) => design.edges.filter((e) => e.source === id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const seen = new Set(['client']);
  const walk = (start?: string) => {
    const chain: string[] = [];
    let cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      chain.push(cur);
      cur = outs(cur).find((e) => !seen.has(e.target))?.target;
    }
    return chain;
  };
  const main = walk(outs('client')[0]?.target);
  const branches: { from: string; chain: string[] }[] = [];
  for (const id of main) for (const e of outs(id)) if (!seen.has(e.target)) branches.push({ from: id, chain: walk(e.target) });
  return { main, branches };
}

/** A drop hint above a target: what letting go here does. */
export function DropTag({ text, tone, className }: { text: string; tone: 'bot' | 'system'; className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-semibold shadow-lg shadow-black/40 [&_svg]:size-4',
        tone === 'bot' ? 'border-rose-400/60 bg-rose-950/90 text-rose-200' : 'border-sky-400/60 bg-sky-950/90 text-sky-200',
        className,
      )}
    >
      {tone === 'bot' ? <Swords /> : <Server />}
      {text}
    </span>
  );
}

/** How a socket looks while a card is dragged: open to it, under the pointer, or the module under the pointer. */
function socketLook(plug: Plug | null, socket: SocketDef) {
  const valid = !!plug?.moves.some((m) => m.socket === socket.id);
  const over = valid && plug?.over?.kind === 'socket' && plug.over.socket === socket.id ? plug.over : null;
  return { dragging: !!plug, valid, over, overMod: over?.replace };
}

/** What dropping here does, for the tag over the socket. */
function dropText(plug: Plug, socket: SocketDef, state: BattleState): string {
  const over = plug.over?.kind === 'socket' ? plug.over : null;
  if (moduleOf(state, plug.def.id)) return `Nâng cấp ${plug.def.name}`;
  if (over?.replace !== undefined) {
    const old = modulesOf(state).find((m) => m.uid === over.replace);
    return `Thay ${old ? cardDef(CONTENT, old.card).name : 'module'} bằng ${plug.def.name}`;
  }
  return `Lắp ${plug.def.name} vào ${socket.label}`;
}

const ring = (look: ReturnType<typeof socketLook>) =>
  look.over
    ? 'outline outline-2 outline-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.5)] bg-sky-500/10'
    : look.valid
      ? 'outline outline-1 outline-dashed outline-sky-400/70 bg-sky-500/[0.06]'
      : look.dragging
        ? 'opacity-50'
        : '';

/** The modules in a socket as chips, its free room dashed. `label` for sockets not drawn on a node (a call). */
function SocketStrip({ socket, state, plug, refs, label, combo }: { socket: SocketDef; state: BattleState; plug: Plug | null; refs: InfraRefs; label?: boolean; combo: Map<number, string> }) {
  const mods = modulesAt(state, socket.id);
  const free = Math.max(0, socket.cap - mods.length);
  const look = socketLook(plug, socket);
  if (socket.cap <= 0) return null;
  return (
    <div
      ref={(el) => void (refs.sockets.current[socket.id] = el)}
      data-socket={socket.id}
      title={`Ổ ${socket.label}: ${mods.length}/${socket.cap}`}
      className={cn('relative flex max-w-full flex-wrap items-center justify-center gap-1 rounded-md px-1 py-0.5 text-[10px] transition-[box-shadow,background-color,opacity] duration-150', ring(look))}
    >
      {label && <span className="whitespace-nowrap text-muted-foreground">{socket.label}</span>}
      {mods.map((m) => {
        const def = cardDef(CONTENT, m.card);
        const Icon = cardIcon(def);
        const hit = look.overMod === m.uid;
        return (
          <span
            key={m.uid}
            ref={(el) => void (refs.mods.current[m.uid] = el)}
            data-module={m.uid}
            title={`${def.name}${m.level > 1 ? ` (cấp ${m.level})` : ''}: ${plainCardText(def.text)}${combo.has(m.uid) ? `\nCombo: ${combo.get(m.uid)}` : ''}`}
            className={cn(
              'flex max-w-[92px] items-center gap-0.5 rounded border px-1 py-0.5 transition-colors',
              hit
                ? 'border-rose-400 bg-rose-500/25 text-rose-100 line-through decoration-rose-300/70'
                : combo.has(m.uid)
                  ? 'border-amber-300/70 bg-amber-400/15 text-amber-100 shadow-[0_0_8px_rgba(251,191,36,0.35)]'
                  : 'border-violet-400/50 bg-violet-500/15 text-violet-200',
            )}
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{def.name}</span>
            {m.level > 1 && <span className="font-mono">×{m.level}</span>}
          </span>
        );
      })}
      {Array.from({ length: free }, (_, i) => (
        <span key={i} className="flex h-4 w-6 items-center justify-center rounded border border-dashed border-muted-foreground/40 text-muted-foreground/50" title="Ổ trống">
          <Plus className="size-2.5" />
        </span>
      ))}
      {look.over && plug && <DropTag tone="system" text={dropText(plug, socket, state)} className="bottom-full mb-2" />}
    </div>
  );
}

/** An empty socket that adds a node (a cache before the DB, a queue on a call): a dashed place in the line. */
function SocketGhost({ socket, state, plug, refs, small }: { socket: SocketDef; state: BattleState; plug: Plug | null; refs: InfraRefs; small?: boolean }) {
  const look = socketLook(plug, socket);
  return (
    <div
      ref={(el) => void (refs.sockets.current[socket.id] = el)}
      data-socket={socket.id}
      title={`Ổ trống: ${socket.label}`}
      className={cn(
        'relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed px-1 text-center text-[10px] leading-tight text-muted-foreground transition-[box-shadow,background-color,opacity,border-color] duration-150',
        small ? 'h-10 w-14 py-0.5' : 'w-11 self-stretch',
        look.over ? 'border-sky-400 bg-sky-500/15 text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.5)]' : look.valid ? 'border-sky-400/70 bg-sky-500/[0.06] text-sky-200' : 'border-muted-foreground/25',
        look.dragging && !look.valid && 'opacity-50',
      )}
    >
      <Plus className="size-3.5" />
      <span className="line-clamp-2">{GHOST_HINT[socket.kind] ?? socket.label}</span>
      {look.over && plug && <DropTag tone="system" text={dropText(plug, socket, state)} className="bottom-full mb-2" />}
    </div>
  );
}

/** What an empty node-adding socket takes, written in its dashed place. */
const GHOST_HINT: Partial<Record<SocketKind, string>> = { front: 'Cache', async: 'Queue', edge: 'Biên' };

/** A connection; requests flow right to left, from the gateway inwards. */
function Pipe({ policy }: { policy?: boolean }) {
  return (
    <div className="flex w-4 shrink-0 items-center self-start rounded-full pt-6">
      <ArrowLeft className={cn('-mr-1 size-3', policy ? 'text-violet-300' : 'text-muted-foreground/60')} />
      <div className={cn('h-px flex-1', policy ? 'bg-violet-400/70' : 'bg-muted-foreground/40')} />
    </div>
  );
}

/** How a node is drawn: icon, title and line under it, from its kind and role. */
function nodeLook(node: DesignNode, design: Design, state: BattleState) {
  const cfg = node.config ?? {};
  const a = chassisOf(CONTENT, state).aliases;
  const role = node.id === a.api ? 'api' : node.id === a.db ? 'db' : node.id === a.ext ? 'ext' : undefined;
  const count = node.kind === 'service' || node.kind === 'database' ? (cfg.instances ?? 1) : undefined;
  const extra = role === 'api' ? state.temp.api : role === 'db' ? state.temp.db : 0;
  switch (node.kind) {
    case 'loadBalancer':
      return { icon: node.id.endsWith('-router') ? <Split /> : <Network />, title: node.label, sub: node.id.endsWith('-router') ? 'chia 2 shard' : 'cổng vào' };
    case 'cache': {
      const cap = cfg.cache?.capacity ?? 0;
      const cold = node.id === 'cache' && (state.cache?.placed ?? 0) >= state.turn;
      return { icon: node.label === 'CDN' ? <Cloud /> : <Zap />, title: node.label, sub: `${keysK(cap)} ${node.label === 'CDN' ? 'trang' : 'key'}${cold ? ' · nguội' : ''}`, accent: 'red' as const };
    }
    case 'queue':
      return { icon: <ListPlus />, title: node.label, sub: `${cfg.concurrency} worker`, accent: 'indigo' as const };
    case 'database':
      return { icon: <Database />, title: node.label === 'PostgreSQL' ? 'Postgres' : node.label, sub: `${cfg.concurrency} conn`, accent: 'indigo' as const, count, extra };
    default: {
      if (role === 'ext') {
        const queued = design.edges.some((e) => e.target === node.id && nodeOf(design, e.source)?.kind === 'queue');
        return { icon: <Handshake />, title: 'Đối tác', sub: queued ? 'bất đồng bộ' : 'đồng bộ' };
      }
      const auto = cfg.autoscale as { max: number; min: number } | undefined;
      return { icon: <Server />, title: node.label, sub: auto ? `HPA +${auto.max - auto.min} pod` : `${cfg.concurrency} slot`, accent: 'sky' as const, count, extra };
    }
  }
}

/** Your system, drawn from its design: nodes with their sockets, empty node sockets as dashed places, call sockets under the line. */
export function InfraLine({ state, loads, refs, plug, bottleneck }: { state: BattleState; loads?: Record<string, NodeLoad>; refs: InfraRefs; plug: Plug | null; bottleneck?: string }) {
  const d = designOf(CONTENT, state);
  const { main, branches } = layoutOf(d);
  const sockets = socketsOf(CONTENT, state);
  const entry = main[0];
  // nodes a module added: their socket and module, so a drop on the node replaces or levels it
  const added = new Map<string, { socket: SocketDef; uid: number }>();
  for (const m of modulesOf(state)) {
    const id = insertedNode(CONTENT, m);
    const socket = socketOf(CONTENT, state, m.socket);
    if (id && socket) added.set(id, { socket, uid: m.uid });
  }
  // modules in an active combo glow, with the combo's name
  const combo = new Map<number, string>();
  for (const c of activeCombos(CONTENT, state)) for (const id of c.needs) for (const m of modulesOf(state)) if (m.card.replace(/\+$/, '') === id) combo.set(m.uid, c.name);
  const threat = threatsOf(state, d);
  const emptyAt = (pred: (s: SocketDef) => boolean) => sockets.filter((s) => pred(s) && s.cap > 0 && modulesAt(state, s.id).length === 0);
  const linkOn = (src: string) => sockets.some((s) => s.kind === 'link' && 'edge' in s.at && s.at.edge[0] === src && modulesAt(state, s.id).length > 0);

  // a crowded line (microservices, a CDN in front) draws its nodes smaller
  const ghosts = sockets.filter((s) => 'before' in s.at && s.cap > 0 && modulesAt(state, s.id).length === 0).length;
  const compact = main.length + ghosts > 4;
  const node = (id: string, small?: boolean) => {
    const n = nodeOf(d, id);
    if (!n) return null;
    const look = nodeLook(n, d, state);
    const own = added.get(id);
    const ownLook = own ? socketLook(plug, own.socket) : null;
    const strips = sockets.filter((s) => (s.kind === 'compute' || s.kind === 'storage' || s.kind === 'observe') && 'node' in s.at && s.at.node === id);
    return (
      <div key={id} className={cn('relative flex min-w-0 flex-col items-center gap-1', small ? 'shrink-0' : 'flex-1')}>
        <InfraNode
          nodeRef={(el) => {
            refs.nodes.current[id] = el;
            if (id === entry) refs.gate.current = el;
            if (own) {
              refs.sockets.current[own.socket.id] = el;
              refs.mods.current[own.uid] = el;
            }
          }}
          {...look}
          load={loads?.[id]}
          threat={loads ? undefined : threat.get(id)}
          hot={!loads && bottleneck === id}
          small={small}
          compact={compact || small}
          className={ownLook ? ring(ownLook) : own && combo.has(own.uid) ? 'shadow-[0_0_14px_rgba(251,191,36,0.45)]' : undefined}
        />
        {own && ownLook?.over && plug && <DropTag tone="system" text={dropText(plug, own.socket, state)} className="bottom-full mb-2" />}
        {strips.map((s) => (
          <SocketStrip key={s.id} socket={s} state={state} plug={plug} refs={refs} combo={combo} />
        ))}
      </div>
    );
  };

  // the main line in path order; flex-row-reverse draws it entry-right
  const line: ReactNode[] = [];
  // a socket in front of a sharded DB sits in front of its router
  const frontOf = (s: SocketDef) => ('before' in s.at ? (main.includes(`${s.at.before}-router`) ? `${s.at.before}-router` : s.at.before) : undefined);
  main.forEach((id, i) => {
    for (const s of emptyAt((s) => frontOf(s) === id)) {
      line.push(<SocketGhost key={`g-${s.id}`} socket={s} state={state} plug={plug} refs={refs} />, <Pipe key={`gp-${s.id}`} />);
    }
    line.push(node(id));
    if (i < main.length - 1) line.push(<Pipe key={`p-${id}`} policy={linkOn(id)} />);
  });

  const links = sockets.filter((s) => s.kind === 'link');
  return (
    <div className="pt-4">
      <div className="flex flex-row-reverse items-stretch gap-0.5">{line}</div>
      {branches.map((b) => (
        <div key={b.from + b.chain[0]} className="mt-2 flex items-center justify-center gap-0.5 text-[11px]">
          <span className="text-muted-foreground">{nodeOf(d, b.from)?.label ?? b.from} gọi</span>
          {b.chain.map((id, i) => {
            const prev = i ? b.chain[i - 1] : b.from;
            const asyncHere = emptyAt((s) => s.kind === 'async' && 'edge' in s.at && s.at.edge[0] === prev && s.at.edge[1] === id);
            return (
              <span key={id} className="flex items-center gap-0.5">
                {asyncHere.map((s) => (
                  <span key={s.id} className="flex items-center gap-0.5">
                    <ArrowRight className="size-3 text-muted-foreground/60" />
                    <SocketGhost socket={s} state={state} plug={plug} refs={refs} small />
                  </span>
                ))}
                <ArrowRight className="size-3 text-muted-foreground/60" />
                {node(id, true)}
              </span>
            );
          })}
        </div>
      ))}
      {links.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {links.map((s) => (
            <SocketStrip key={s.id} socket={s} state={state} plug={plug} refs={refs} label combo={combo} />
          ))}
        </div>
      )}
    </div>
  );
}

/** What this turn's intent does to which node (none when Hotfix cancels it), for a warning on the node. */
function threatsOf(state: BattleState, d: Design): Map<string, string> {
  const out = new Map<string, string>();
  const it = currentIntent(CONTENT, state);
  const add = (id: string, text: string) => out.set(id, out.has(id) ? `${out.get(id)}, ${text}` : text);
  const cancelled = state.temp.hotfix && hotfixable(it);
  if (!cancelled) {
    if (it.chaos) add(alias(CONTENT, state, it.chaos.node), it.chaos.action === 'latency' ? `chậm ×${it.chaos.value}` : `lỗi ${Math.round(it.chaos.value * 100)}%`);
    if (it.squeeze) add(alias(CONTENT, state, it.squeeze.node), `còn ${Math.round(it.squeeze.concurrency * 100)}% slot`);
    if (it.cacheBust || it.cacheTtlMs) for (const n of d.nodes) if (n.kind === 'cache') add(n.id, it.cacheTtlMs ? 'TTL ngắn' : `phá cache ${Math.round((it.cacheBust ?? 0) * 100)}%`);
  }
  if (leakNow(state, it) > 0) add(alias(CONTENT, state, 'api'), `rò rỉ ×${(1 + leakNow(state, it)).toFixed(1)}`);
  if (it.bandwidth) {
    const entry = layoutOf(d).main[0];
    if (entry) add(entry, 'nghẽn băng thông');
  }
  return out;
}

function InfraNode({
  icon,
  title,
  sub,
  count,
  extra = 0,
  accent,
  load,
  nodeRef,
  small,
  compact,
  threat,
  hot,
  className,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  count?: number;
  extra?: number;
  accent?: 'sky' | 'red' | 'indigo';
  /** Live load while a turn plays: a meter at the bottom, red when overloaded. */
  load?: NodeLoad;
  nodeRef?: (el: HTMLDivElement | null) => void;
  /** A side node (partner, queue): fixed width, not stretched along the line. */
  small?: boolean;
  /** A crowded line: smaller text so names fit. */
  compact?: boolean;
  /** What this turn's intent does to the node. */
  threat?: string;
  /** Tracing: the node the forecast says will be the bottleneck. */
  hot?: boolean;
  className?: string;
}) {
  const color =
    accent === 'sky'
      ? 'border-sky-500/50 [&_svg]:text-sky-300'
      : accent === 'red'
        ? 'border-red-500/50 [&_svg]:text-red-300'
        : accent === 'indigo'
          ? 'border-indigo-500/50 [&_svg]:text-indigo-300'
          : 'border-foreground/20 [&_svg]:text-foreground/80';
  return (
    <div
      ref={nodeRef}
      className={cn(
        'relative flex min-w-0 flex-col items-center overflow-visible rounded-xl border-2 bg-card/80 pb-2.5 pt-2 text-center shadow-lg shadow-black/30 backdrop-blur transition-colors',
        small ? 'w-24 shrink-0' : 'w-full',
        compact ? 'px-0.5' : 'px-1.5',
        color,
        load?.bad && 'border-rose-500 bg-rose-950/60',
        hot && 'animate-pulse border-orange-400 shadow-[0_0_16px_rgba(251,146,60,0.55)]',
        className,
      )}
    >
      <span className={compact ? '[&_svg]:size-4' : '[&_svg]:size-5'}>{icon}</span>
      <div className={cn('mt-0.5 max-w-full truncate font-medium', compact ? 'text-[11px]' : 'text-sm')}>{title}</div>
      <div className={cn('max-w-full truncate text-muted-foreground', compact ? 'text-[9px]' : 'text-[11px]', load && 'font-mono', load?.bad && 'text-rose-300')}>
        {load ? `tải ${Math.round(load.util * 100)}%` : sub}
      </div>
      {load && (
        <div className="absolute inset-x-1.5 bottom-1 h-1 overflow-hidden rounded-full bg-muted/60">
          <div
            className={cn('h-full rounded-full transition-[width,background-color] duration-200', load.util > 0.95 || load.bad ? 'bg-rose-500' : load.util > 0.7 ? 'bg-amber-400' : 'bg-emerald-400')}
            style={{ width: `${clamp(load.util, 0, 1) * 100}%` }}
          />
        </div>
      )}
      {hot && (
        <div className="absolute -bottom-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-orange-300/70 bg-orange-600 px-1.5 text-[9px] font-semibold text-white" title="Tracing: node này sẽ là nút cổ chai nếu kết thúc lượt ngay">
          nút cổ chai
        </div>
      )}
      {threat && (
        <div title={`Ý định lượt này: ${threat}`} className="absolute -left-2 -top-2 z-10 flex size-5 items-center justify-center rounded-full border border-rose-300/70 bg-rose-600 text-white shadow-[0_0_10px_rgba(244,63,94,0.6)]">
          <TriangleAlert className="size-3 !text-white" />
        </div>
      )}
      {count !== undefined && (
        <div className="absolute -right-2 -top-2 rounded-full border bg-card px-1.5 font-mono text-xs">
          ×{count}
          {extra > 0 && <span className="text-emerald-300">+{extra}</span>}
        </div>
      )}
    </div>
  );
}

/** The node ids along the request path, entry first (for the traffic animation). */
export const pathOf = (state: BattleState) => layoutOf(designOf(CONTENT, state)).main;

/** The element of a role's node (`api`, `db`, `ext`) in this fight's system. */
export const roleEl = (refs: InfraRefs, state: BattleState, ref: 'api' | 'db' | 'ext') => refs.nodes.current[alias(CONTENT, state, ref)] ?? null;
