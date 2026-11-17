import { useCallback, useEffect, useState } from 'react';
import { Lightbulb, Loader2, Send, Star, Target, Trophy, Zap } from 'lucide-react';
import { fmt } from '@/lib/meta';
import type { Design, Level, Summary } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface Entry {
  player: string;
  stars: number;
  costPerHour: number;
  p99Ms: number;
}

export function Stars({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn('inline-flex gap-0.5', className)}>
      {[0, 1, 2].map((i) => (
        <Star key={i} className={cn('size-4', i < count ? 'fill-warning text-warning' : 'text-muted-foreground/40')} />
      ))}
    </span>
  );
}

const CHAOS_LABEL: Record<string, string> = {
  down: 'sập',
  up: 'hồi phục',
  latency: 'chậm ×',
  errors: 'lỗi ',
};

interface Props {
  level: Level;
  design: () => Design;
  onVerify: () => Promise<Summary | null>;
  verifying: boolean;
  best: number;
  /** Shared leaderboard on the NestJS server (learning-path levels are local only). */
  online?: boolean;
}

export function LevelPanel({ level, design, onVerify, verifying, best, online = true }: Props) {
  const [showHint, setShowHint] = useState(false);
  const [player, setPlayer] = useState(() => localStorage.getItem('pattern.player') ?? '');
  const [board, setBoard] = useState<Entry[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sc = level.scenario;

  const loadBoard = useCallback(async () => {
    if (!online) return;
    try {
      const res = await fetch(`/api/levels/${level.id}/leaderboard`);
      setBoard(res.ok ? await res.json() : null);
    } catch {
      setBoard(null);
    }
  }, [level.id, online]);

  useEffect(() => {
    setShowHint(false);
    setStatus(null);
    void loadBoard();
  }, [loadBoard]);

  const submit = async () => {
    localStorage.setItem('pattern.player', player);
    setSending(true);
    setStatus(null);
    try {
      const d = design();
      const res = await fetch(`/api/levels/${level.id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player, design: { nodes: d.nodes, edges: d.edges } }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? res.statusText);
      setStatus(
        `Server chấm ${body.summary.stars}★ (${fmt.money(body.summary.costPerHour)}/h, p99 ${fmt.ms(body.summary.p99Ms)}), hạng #${body.rank}${body.improved ? '' : ', chưa vượt kết quả cũ'}.`,
      );
      await loadBoard();
    } catch (err) {
      setStatus(
        err instanceof TypeError
          ? 'Không kết nối được server. Chạy `pnpm dev:server` để bật leaderboard.'
          : `Lỗi: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{level.title}</h2>
          <Stars count={best} />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{level.brief}</p>
      </div>

      <div className="grid gap-1.5 rounded-md border bg-muted/30 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium">
          <Target className="size-3.5" /> Mục tiêu
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
          <span className="text-muted-foreground">p99</span>
          <span>≤ {sc.slo.p99Ms}ms</span>
          <span className="text-muted-foreground">lỗi</span>
          <span>≤ {fmt.pct(sc.slo.errorRate, 0)}</span>
          <span className="text-muted-foreground">ngân sách</span>
          <span>{sc.budgetPerHour != null ? `≤ ${fmt.money(sc.budgetPerHour)}/h` : 'không giới hạn'}</span>
          <span className="text-muted-foreground">thời lượng</span>
          <span>{(sc.durationMs ?? 0) / 1000}s</span>
        </div>
        {sc.events && sc.events.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {sc.events.map((e, i) => (
              <span key={i} className="flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                <Zap className="size-2.5" />
                {e.atMs / 1000}s {e.node} {CHAOS_LABEL[e.action]}
                {e.action === 'latency' || e.action === 'errors' ? e.value : ''}
              </span>
            ))}
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          ★ đạt SLO · ★★ trong ngân sách · ★★★ ≥98% thời gian đạt SLO và không tồn backlog
        </p>
      </div>

      {level.hint &&
        (showHint ? (
          <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs leading-relaxed">
            <Lightbulb className="size-4 shrink-0 text-warning" />
            {level.hint}
          </p>
        ) : (
          <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setShowHint(true)}>
            <Lightbulb /> Xem gợi ý
          </Button>
        ))}

      <Button onClick={() => void onVerify()} disabled={verifying}>
        {verifying ? <Loader2 className="animate-spin" /> : <Star />}
        Chấm điểm (chạy đủ {(sc.durationMs ?? 0) / 1000}s)
      </Button>

      {online && (
        <>
          <Separator />

          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Trophy className="size-4 text-warning" /> Leaderboard
            </div>
            <div className="flex gap-2">
              <div className="grid flex-1 gap-1">
                <Label htmlFor="player" className="sr-only">
                  Tên người chơi
                </Label>
                <Input
                  id="player"
                  className="h-8"
                  placeholder="Tên của bạn"
                  value={player}
                  maxLength={24}
                  onChange={(e) => setPlayer(e.target.value)}
                />
              </div>
              <Button size="sm" variant="secondary" disabled={!player.trim() || sending} onClick={() => void submit()}>
                {sending ? <Loader2 className="animate-spin" /> : <Send />} Gửi
              </Button>
            </div>
            {status && <p className="text-xs text-muted-foreground">{status}</p>}
            {board === null ? (
              <p className="text-xs text-muted-foreground">Leaderboard cần server NestJS (`pnpm dev:server`).</p>
            ) : board.length === 0 ? (
              <p className="text-xs text-muted-foreground">Chưa có ai. Bạn là người đầu tiên!</p>
            ) : (
              <ol className="grid gap-1 text-xs">
                {board.map((e, i) => (
                  <li key={e.player} className="flex items-center gap-2 rounded px-2 py-1 odd:bg-muted/30">
                    <span className="w-4 text-right font-mono text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 truncate">{e.player}</span>
                    <Stars count={e.stars} className="[&_svg]:size-3" />
                    <span className="w-12 text-right font-mono">{fmt.money(e.costPerHour)}</span>
                    <span className="w-12 text-right font-mono text-muted-foreground">{fmt.ms(e.p99Ms)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}
