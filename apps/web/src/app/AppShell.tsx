import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { BookA, Gamepad2, Gauge, GraduationCap, LayoutGrid, Shapes } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlossaryProvider } from '@/learn/Glossary';
import { TechDialogs } from '@/tech/TechDialogs';
import { BottomTabBar, type TabItem } from '@/components/BottomTabBar';
import { useUi } from './ui-store';
import { CommandPalette } from './CommandPalette';
import { useAuth } from './auth-store';

const TABS: TabItem[] = [
  { to: '/learn', label: 'Học', icon: GraduationCap },
  { to: '/play', label: 'Game', icon: Gamepad2, match: ['/play', '/cards', '/interview', '/levels'] },
  { to: '/studio', label: 'Studio', icon: Shapes, match: ['/studio', '/library', '/cases', '/s'] },
  { to: '/capacity/sizing', label: 'Công suất', icon: Gauge, match: ['/capacity'] },
  { to: '/glossary', label: 'Từ điển', icon: BookA },
];

/**
 * Pages whose scroll area already leaves room for the floating tab bar, and
 * canvases that should run underneath it. Every other page gets bottom padding.
 */
const UNDER_TAB_BAR = [/^\/learn(\/|$)/, /^\/glossary$/, /^\/capacity\//, /^\/studio(\/[^/]+)?$/, /^\/play\/.+/, /^\/s\//];

/** Layout of every page: page content, floating tab bar, command palette and global dialogs. */
export function AppShell() {
  const setCommandOpen = useUi((s) => s.setCommandOpen);
  const immersive = useUi((s) => s.immersive);
  const refreshAuth = useAuth((s) => s.refresh);
  const { pathname } = useLocation();
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

  const padded = !immersive && !UNDER_TAB_BAR.some((r) => r.test(pathname));

  return (
    <GlossaryProvider>
      <main className={cn('flex h-screen min-w-0 flex-col', padded && 'pb-24')}>
        <Outlet />
      </main>
      {!immersive && (
        <BottomTabBar items={TABS} more={{ label: 'Thêm', icon: LayoutGrid, onClick: () => setCommandOpen(true) }} />
      )}
      <CommandPalette />
      <TechDialogs />
    </GlossaryProvider>
  );
}
