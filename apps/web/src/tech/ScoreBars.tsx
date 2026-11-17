import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SCORE_KEYS, SCORE_LABELS, type ScoreKey, type Tech } from './types';

function barColor(v: number) {
  if (v >= 8) return 'var(--success)';
  if (v >= 5) return 'var(--primary)';
  return 'var(--warning)';
}

export function ScoreBar({ value, best, compact }: { value: number; best?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn('flex flex-1 gap-[2px]', compact ? 'h-1.5' : 'h-2')}>
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className="flex-1 rounded-[1px]"
            style={{ background: i < value ? barColor(value) : 'var(--muted)', opacity: i < value ? 1 : 0.6 }}
          />
        ))}
      </div>
      <span className={cn('w-5 text-right font-mono text-[12px]', best ? 'font-semibold text-success' : 'text-muted-foreground')}>
        {value}
      </span>
    </div>
  );
}

export function ScoreLabel({ k }: { k: ScoreKey }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-xs text-muted-foreground">{SCORE_LABELS[k].name}</span>
      </TooltipTrigger>
      <TooltipContent side="left">{SCORE_LABELS[k].hint}</TooltipContent>
    </Tooltip>
  );
}

export function ScoreBars({ tech, compact }: { tech: Tech; compact?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-1.5">
      {SCORE_KEYS.map((k) => (
        <div key={k} className="contents">
          <ScoreLabel k={k} />
          <ScoreBar value={tech.scores[k]} compact={compact} />
        </div>
      ))}
    </div>
  );
}

export const SCORE_NOTE = 'Điểm tương đối 1–10 do biên tập ước lượng để hỗ trợ lựa chọn, không phải benchmark.';
