import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { PanelLeftClose, PanelLeftOpen, Search, Shapes } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlossaryProvider, useOpenGlossary } from '@/learn/Glossary';
import { TechDialogs } from '@/tech/TechDialogs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NAV, type NavItem } from './nav';
import { useUi } from './ui-store';
import { CommandPalette } from './CommandPalette';
import { AccountBadge } from './AccountBadge';
import { useAuth } from './auth-store';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const openGlossary = useOpenGlossary();
  const location = useLocation();
  const Icon = item.icon;
  const base =
    'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  const inner = (
    <>
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </>
  );
  const link = item.action ? (
    <button type="button" className={cn(base, 'w-full')} onClick={() => openGlossary?.()}>
      {inner}
    </button>
  ) : (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          base,
          // /studio/:id and /play/... keep their section highlighted
          (isActive || location.pathname.startsWith(`${item.to}/`)) && 'bg-accent font-medium text-foreground',
        )
      }
    >
      {inner}
    </NavLink>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const openCommand = useUi((s) => s.setCommandOpen);
  return (
    <nav
      className={cn(
        'flex shrink-0 flex-col gap-3 border-r bg-card/40 px-2 py-3 transition-[width] duration-200',
        collapsed ? 'w-13' : 'w-56',
      )}
      aria-label="Điều hướng chính"
    >
      <div className={cn('flex items-center gap-2 px-1', collapsed && 'justify-center')}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Shapes className="size-4" />
        </span>
        {!collapsed && <span className="font-semibold">Pattern</span>}
      </div>
      <button
        type="button"
        onClick={() => openCommand(true)}
        className={cn(
          'flex h-8 items-center gap-2 rounded-md border bg-background/40 px-2 text-xs text-muted-foreground hover:text-foreground',
          collapsed && 'justify-center px-0',
        )}
        title="Tìm nhanh"
      >
        <Search className="size-3.5 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Tìm nhanh…</span>
            <kbd className="rounded border px-1 font-mono text-[10px]">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </>
        )}
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.hidden);
          if (!items.length) return null;
          return (
            <div key={g.label} className="grid gap-0.5">
              {!collapsed && (
                <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">{g.label}</div>
              )}
              {items.map((i) => (
                <SidebarItem key={i.to} item={i} collapsed={collapsed} />
              ))}
            </div>
          );
        })}
      </div>
      <AccountBadge collapsed={collapsed} />
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
          collapsed && 'justify-center',
        )}
        aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        {!collapsed && 'Thu gọn'}
      </button>
    </nav>
  );
}

/** Layout of every page: sidebar, page content, command palette and global dialogs. */
export function AppShell() {
  const setCommandOpen = useUi((s) => s.setCommandOpen);
  const refreshAuth = useAuth((s) => s.refresh);
  useEffect(() => {
    void refreshAuth();
    // signed in or out in another tab
    const onFocus = () => void refreshAuth();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAuth]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommandOpen]);

  return (
    <GlossaryProvider>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <TechDialogs />
    </GlossaryProvider>
  );
}
