import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { timeAgo } from './store';

export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved'; at: number } | { status: 'error'; message: string };

/** Figma-style quiet indicator: a dot and one grey word. */
export function SaveStatus({ state }: { state: SaveState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(id);
  }, []);
  const text =
    state.status === 'saving' ? 'Đang lưu…' : state.status === 'error' ? 'Lỗi lưu' : state.status === 'saved' ? 'Đã lưu' : 'Chưa sửa';
  const tip =
    state.status === 'saved'
      ? `Tự động lưu vào trình duyệt (IndexedDB) · ${timeAgo(state.at)}`
      : state.status === 'error'
        ? state.message
        : 'Mọi thay đổi được lưu tự động · ⌘/Ctrl+S để tạo phiên bản có tên';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex cursor-default items-center gap-1.5 text-xs text-muted-foreground select-none">
          <span
            className={cn(
              'size-1.5 rounded-full transition-colors',
              state.status === 'saving' && 'animate-pulse bg-warning',
              state.status === 'saved' && 'bg-success/70',
              state.status === 'error' && 'bg-destructive',
              state.status === 'idle' && 'bg-muted-foreground/40',
            )}
          />
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
