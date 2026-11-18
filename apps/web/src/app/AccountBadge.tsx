import { HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Bottom of the sidebar: who is signed in and where data is stored. */
export function AccountBadge({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground', collapsed && 'justify-center px-0')}
      title="Dữ liệu lưu trong trình duyệt (IndexedDB)"
    >
      <HardDrive className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">Chế độ cục bộ</span>}
    </div>
  );
}
