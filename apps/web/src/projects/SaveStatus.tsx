import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { timeAgo } from './store';
import { useSync } from './sync';

export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved'; at: number } | { status: 'error'; message: string };

/** Figma-style quiet indicator: a dot and one grey word. */
export function SaveStatus({ state, owned = false }: { state: SaveState; /** Project synced to the account. */ owned?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 15000);
    return () => clearInterval(id);
  }, []);
  const sync = useSync();
  const synced = sync.state !== 'off' && owned;
  const waiting = synced && (sync.pending > 0 || sync.state === 'syncing');
  const text =
    state.status === 'saving'
      ? 'Đang lưu…'
      : state.status === 'error'
        ? 'Lỗi lưu'
        : state.status !== 'saved'
          ? 'Chưa sửa'
          : !synced
            ? 'Đã lưu'
            : sync.state === 'offline'
              ? 'Đã lưu · offline'
              : sync.state === 'error'
                ? 'Đã lưu · lỗi đồng bộ'
                : waiting
                  ? 'Đang đồng bộ…'
                  : 'Đã đồng bộ';
  const tip =
    state.status === 'saved'
      ? synced
        ? sync.state === 'offline'
          ? `Lưu trong trình duyệt, ${sync.pending} thay đổi sẽ gửi lên server khi có mạng`
          : sync.state === 'error'
            ? `Đồng bộ lỗi: ${sync.error}`
            : `Lưu trong trình duyệt và đồng bộ với tài khoản${sync.lastSync ? ` · ${timeAgo(sync.lastSync)}` : ''}`
        : `Tự động lưu vào trình duyệt (IndexedDB) · ${timeAgo(state.at)}`
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
              state.status === 'saved' && !waiting && 'bg-success/70',
              state.status === 'saved' && waiting && 'animate-pulse bg-primary',
              state.status === 'saved' && synced && (sync.state === 'offline' || sync.state === 'error') && 'bg-warning',
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
