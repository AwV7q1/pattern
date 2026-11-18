import type { ComponentType } from 'react';
import { Link, useLocation } from 'react-router';
import { cn } from '@/lib/utils';

export interface TabItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Paths that keep this tab highlighted (default: `to` and everything under it). */
  match?: string[];
}

const TAB =
  'flex h-[52px] w-[76px] flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

const isUnder = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Floating frosted-glass tab bar pinned to the bottom center. */
export function BottomTabBar({
  items,
  more,
}: {
  items: TabItem[];
  /** Last tab: opens something instead of navigating. */
  more?: { label: string; icon: ComponentType<{ className?: string }>; onClick: () => void };
}) {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Điều hướng chính"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(16px,env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto flex rounded-full bg-background/70 p-1.5 shadow-lg shadow-black/40 backdrop-blur-xl">
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = (match ?? [to]).some((m) => isUnder(pathname, m));
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={cn(TAB, active ? 'bg-white/10 text-primary' : 'text-foreground/70 hover:text-foreground')}
            >
              <Icon className="size-6" />
              {label}
            </Link>
          );
        })}
        {more && (
          <button type="button" onClick={more.onClick} className={cn(TAB, 'text-foreground/70 hover:text-foreground')}>
            <more.icon className="size-6" />
            {more.label}
          </button>
        )}
      </div>
    </nav>
  );
}
