import { Link } from 'react-router';
import { CloudOff, HardDrive, LogIn, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-store';

/** Bottom of the sidebar: who is signed in and where projects are stored. */
export function AccountBadge({ collapsed }: { collapsed: boolean }) {
  const { status, user } = useAuth();
  const base = cn(
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
    collapsed && 'justify-center px-0',
  );
  if (status === 'signed-in' && user)
    return (
      <Link to="/account" className={base} title={`${user.email} · dự án đồng bộ với server`}>
        <UserRound className="size-4 shrink-0 text-success" />
        {!collapsed && <span className="truncate text-foreground">{user.displayName}</span>}
      </Link>
    );
  if (status === 'anonymous')
    return (
      <Link to="/login" className={base} title="Đăng nhập để đồng bộ dự án và chia sẻ link">
        <LogIn className="size-4 shrink-0" />
        {!collapsed && <span className="truncate">Đăng nhập</span>}
      </Link>
    );
  const Icon = status === 'offline' ? CloudOff : HardDrive;
  return (
    <div className={cn(base, 'hover:bg-transparent')} title="Không có server: dữ liệu lưu trong trình duyệt (IndexedDB)">
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">Chế độ cục bộ</span>}
    </div>
  );
}
