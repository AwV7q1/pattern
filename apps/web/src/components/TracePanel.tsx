import { useMemo, useState } from 'react';
import { Crosshair, Repeat } from 'lucide-react';
import type { TraceEvent } from '@/types';
import { fmt } from '@/lib/meta';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

/** One call over one edge, rebuilt from trace events. */
export interface Span {
  id: number;
  parent: number;
  edge: number | null;
  /** Node that serves the span (target of the edge). */
  node: number;
  attempt: number;
  fireAndForget: boolean;
  waitMs: number;
  send: number;
  arrive?: number;
  start?: number;
  reply?: number;
  recv?: number;
  timeout?: number;
  rejected?: boolean;
  ok?: boolean;
  depth: number;
}

export interface Trace {
  id: number;
  begin: number;
  end?: number;
  ok?: boolean;
  /** Spans in display order (depth first, by send time). */
  spans: Span[];
}

export function buildTraces(events: TraceEvent[]): Trace[] {
  const byTrace = new Map<number, TraceEvent[]>();
  for (const e of events) byTrace.set(e.trace, [...(byTrace.get(e.trace) ?? []), e]);
  const out: Trace[] = [];
  byTrace.forEach((evs, id) => {
    const begin = evs.find((e) => e.ev === 'begin');
    if (!begin) return;
    const end = evs.find((e) => e.ev === 'end');
    const spans = new Map<number, Span>();
    for (const e of evs) {
      if (e.ev === 'send') {
        spans.set(e.span, {
          id: e.span,
          parent: e.parent,
          edge: e.edge,
          node: e.node,
          attempt: e.attempt,
          fireAndForget: e.fireAndForget,
          waitMs: e.waitMs,
          send: e.tMs,
          depth: 0,
        });
      }
    }
    for (const e of evs) {
      const s = spans.get(e.span);
      if (!s) continue;
      if (e.ev === 'arrive') s.arrive ??= e.tMs;
      else if (e.ev === 'start') s.start ??= e.tMs;
      else if (e.ev === 'reject') s.rejected = true;
      else if (e.ev === 'reply') {
        s.reply ??= e.tMs;
        s.ok ??= e.ok;
      } else if (e.ev === 'recv') {
        s.recv = e.tMs;
        s.ok = e.ok;
      } else if (e.ev === 'timeout') {
        s.timeout = e.tMs;
        s.ok = false;
      }
    }
    // depth-first order, children by send time
    const children = new Map<number, Span[]>();
    spans.forEach((s) => children.set(s.parent, [...(children.get(s.parent) ?? []), s]));
    const ordered: Span[] = [];
    const walk = (parent: number, depth: number) => {
      for (const s of (children.get(parent) ?? []).sort((a, b) => a.send - b.send || a.id - b.id)) {
        s.depth = depth;
        ordered.push(s);
        walk(s.id, depth + 1);
      }
    };
    walk(begin.span, 0);
    out.push({ id, begin: begin.tMs, end: end?.tMs, ok: end?.ok, spans: ordered });
  });
  return out.sort((a, b) => a.id - b.id);
}

/** End of a span as seen by its caller. */
const spanEnd = (s: Span) => s.recv ?? s.timeout ?? s.reply ?? s.arrive ?? s.send;

/** Plain-language explanation of what happened, in time order. */
export function narrate(t: Trace, label: (s: Span) => { from: string; to: string }): string[] {
  const lines: { t: number; text: string }[] = [];
  const parallel = new Map<string, Span[]>();
  for (const s of t.spans) {
    const key = `${s.parent}@${s.send.toFixed(3)}`;
    parallel.set(key, [...(parallel.get(key) ?? []), s]);
  }
  const seen = new Set<string>();
  for (const s of t.spans) {
    const { from, to } = label(s);
    const key = `${s.parent}@${s.send.toFixed(3)}`;
    const group = parallel.get(key)!;
    if (group.length > 1) {
      if (!seen.has(key)) {
        seen.add(key);
        lines.push({
          t: s.send,
          text: `${from} gọi cùng lúc ${group.map((g) => label(g).to).join(', ')} (song song)`,
        });
      }
    } else {
      const retry = s.attempt > 0 ? ` (retry lần ${s.attempt})` : '';
      const wait = s.waitMs > 0.05 ? `, sau khi chờ kết nối ${fmt.ms(s.waitMs)}` : '';
      lines.push({
        t: s.send,
        text: s.fireAndForget ? `${from} bắn ${to} rồi đi tiếp, không chờ` : `${from} → ${to}: gửi request${retry}${wait}`,
      });
    }
    if (s.rejected) lines.push({ t: s.arrive ?? s.send, text: `${to} đầy hàng đợi, từ chối ngay` });
    else if (s.arrive !== undefined && s.start !== undefined && s.start - s.arrive > 0.05)
      lines.push({ t: s.start, text: `${to} bận, request xếp hàng ${fmt.ms(s.start - s.arrive)} mới được xử lý` });
    if (s.timeout !== undefined) lines.push({ t: s.timeout, text: `${from} hết kiên nhẫn chờ ${to}: timeout` });
    else if (s.fireAndForget && s.reply !== undefined)
      lines.push({ t: s.reply, text: `${to} làm xong sau ${fmt.ms(s.reply - s.send)} (không ai chờ)` });
    else if (s.recv !== undefined && s.depth > 0)
      lines.push({
        t: s.recv,
        text: `${from} nhận ${s.ok ? 'kết quả' : 'lỗi'} từ ${to} sau ${fmt.ms(s.recv - s.send)}`,
      });
  }
  if (t.end !== undefined)
    lines.push({ t: t.end, text: `Người dùng nhận ${t.ok ? 'kết quả' : 'lỗi'} sau ${fmt.ms(t.end - t.begin)}` });
  return lines.sort((a, b) => a.t - b.t).map((l) => `${fmt.ms(l.t - t.begin).padStart(6)}  ${l.text}`);
}

const SEG = {
  pool: 'bg-violet-400/70',
  out: 'bg-sky-400/80',
  queue: 'bg-amber-400/80',
  work: 'bg-emerald-400/35',
  back: 'bg-teal-300/80',
};

interface Props {
  events: TraceEvent[];
  nodeLabel: (index: number) => string;
  edgeEnds: (index: number) => { source: string; target: string } | undefined;
  running: boolean;
  auto: boolean;
  onAuto: (on: boolean) => void;
  onTrace: () => void;
  onSlow: () => void;
}

/**
 * Follow single requests through the system: a waterfall (like Jaeger) with
 * network, queueing and processing time per hop, plus a plain-language
 * timeline. The followed request is also drawn bigger, with a white ring,
 * on the canvas.
 */
export function TracePanel({ events, nodeLabel, edgeEnds, running, auto, onAuto, onTrace, onSlow }: Props) {
  const traces = useMemo(() => buildTraces(events), [events]);
  const [picked, setPicked] = useState<number | null>(null);
  const done = traces.filter((t) => t.end !== undefined);
  const trace = traces.find((t) => t.id === picked) ?? done.at(-1) ?? traces.at(-1);
  const waiting = traces.length > 0 && traces.at(-1)!.end === undefined;

  const label = (s: Span) => {
    const ends = s.edge !== null ? edgeEnds(s.edge) : undefined;
    return { from: ends?.source ?? '?', to: ends?.target ?? nodeLabel(s.node) };
  };

  return (
    <div className="grid gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Theo dõi <b>một</b> request đi qua hệ thống: ai gọi ai, theo thứ tự nào, mất bao lâu ở mạng, ở hàng đợi và lúc xử
        lý. Trên canvas, request đó được vẽ to hơn và có vòng trắng.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onTrace}>
          <Crosshair /> Theo dõi 1 request
        </Button>
        <Button size="sm" variant="outline" onClick={onSlow}>
          Xem chậm 0.25×
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Switch id="auto-trace" checked={auto} onCheckedChange={onAuto} />
          <Label htmlFor="auto-trace" className="text-xs">
            <Repeat className="inline size-3" /> mỗi 2s
          </Label>
        </div>
      </div>
      {!running && <p className="text-[11px] text-warning">Mô phỏng đang dừng: bấm Chạy để request được gửi đi.</p>}
      {waiting && <p className="text-[11px] text-muted-foreground">Đang chờ request #{traces.at(-1)!.id} hoàn tất…</p>}

      {traces.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {traces.slice(-10).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPicked(t.id)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                t.id === trace?.id ? 'border-primary text-primary' : 'text-muted-foreground',
                t.end !== undefined && !t.ok && 'border-destructive/60 text-destructive',
              )}
            >
              #{t.id} {t.end !== undefined ? fmt.ms(t.end - t.begin) : '…'}
            </button>
          ))}
        </div>
      )}

      {trace && <Waterfall trace={trace} label={label} />}

      {trace && trace.end !== undefined && (
        <div className="grid gap-1">
          <div className="text-xs font-semibold">Diễn biến</div>
          <pre className="overflow-x-auto rounded-md border bg-muted/30 p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap">
            {narrate(trace, label).join('\n')}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {(
          [
            ['pool', 'chờ connection'],
            ['out', 'request trên mạng'],
            ['queue', 'xếp hàng'],
            ['work', 'xử lý (gồm cả gọi tiếp)'],
            ['back', 'response trên mạng'],
          ] as const
        ).map(([k, text]) => (
          <span key={k} className="flex items-center gap-1">
            <i className={cn('h-2 w-3 rounded-sm', SEG[k])} /> {text}
          </span>
        ))}
      </div>
    </div>
  );
}

function Waterfall({ trace, label }: { trace: Trace; label: (s: Span) => { from: string; to: string } }) {
  const t0 = trace.begin;
  const t1 = Math.max(trace.end ?? 0, ...trace.spans.map(spanEnd), t0 + 0.001);
  const span = t1 - t0;
  const x = (t: number) => `${((t - t0) / span) * 100}%`;
  const w = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`;
  const bar = (a: number | undefined, b: number | undefined, cls: string, title: string) =>
    a !== undefined && b !== undefined && b - a > span * 0.002 ? (
      <div title={`${title}: ${fmt.ms(b - a)}`} className={cn('absolute inset-y-1 rounded-[2px]', cls)} style={{ left: x(a), width: w(a, b) }} />
    ) : null;

  return (
    <div className="grid gap-0.5 rounded-md border p-2">
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>0</span>
        <span>
          request #{trace.id} · {trace.end !== undefined ? fmt.ms(trace.end - t0) : 'chưa xong'}
          {trace.end !== undefined && !trace.ok && <span className="text-destructive"> · lỗi</span>}
        </span>
        <span>{fmt.ms(span)}</span>
      </div>
      {trace.end !== undefined && trace.end < t1 - span * 0.05 && (
        <div className="text-right text-[10px] text-muted-foreground">
          vạch đứt = lúc người dùng nhận response; phần sau đó là việc chạy nền
        </div>
      )}
      {trace.end !== undefined && (
        <div className="grid grid-cols-[112px_1fr] gap-2">
          <span />
          <div className="relative h-0">
            <div
              className="absolute -top-0.5 h-[calc(var(--rows)*1.375rem+0.25rem)] border-l border-dashed border-foreground/50"
              style={{ left: x(trace.end), ['--rows' as string]: trace.spans.length }}
              title="người dùng nhận response"
            />
          </div>
        </div>
      )}
      {trace.spans.map((s) => {
        const { from, to } = label(s);
        const workStart = s.start ?? s.arrive;
        return (
          <div key={s.id} className="grid grid-cols-[112px_1fr] items-center gap-2">
            <div
              className="truncate text-[11px]"
              style={{ paddingLeft: s.depth * 8 }}
              title={`${from} → ${to}`}
            >
              <span className="text-muted-foreground">{s.depth === 0 ? '' : '↳ '}</span>
              {to}
              {s.attempt > 0 && <span className="text-warning"> ↻{s.attempt}</span>}
              {s.fireAndForget && <span className="text-violet-300"> ⇢</span>}
            </div>
            <div className={cn('relative h-5 rounded-sm bg-muted/30', s.ok === false && 'ring-1 ring-destructive/70')}>
              {bar(s.send - s.waitMs, s.send, SEG.pool, 'chờ connection')}
              {bar(s.send, s.arrive ?? s.timeout, SEG.out, 'request trên mạng')}
              {bar(s.arrive, s.start, SEG.queue, 'xếp hàng')}
              {bar(workStart, s.reply ?? s.timeout, SEG.work, 'xử lý')}
              {!s.fireAndForget && bar(s.reply, s.recv, SEG.back, 'response trên mạng')}
              {s.timeout !== undefined && (
                <div className="absolute inset-y-0 w-0.5 bg-destructive" style={{ left: x(s.timeout) }} title="timeout" />
              )}
              <span
                className="pointer-events-none absolute top-0.5 font-mono text-[9px] whitespace-nowrap text-foreground/80"
                style={
                  (spanEnd(s) - t0) / span > 0.8
                    ? { right: `calc(${100 - ((spanEnd(s) - t0) / span) * 100}% + 3px)` }
                    : { left: `calc(${x(spanEnd(s))} + 3px)` }
                }
              >
                {s.rejected ? 'từ chối' : s.timeout !== undefined ? 'timeout' : fmt.ms(spanEnd(s) - s.send)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
