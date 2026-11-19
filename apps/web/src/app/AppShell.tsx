import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlossaryProvider } from '@/learn/Glossary';
import { TechDialogs } from '@/tech/TechDialogs';
import { BottomTabBar } from '@/components/BottomTabBar';
import { useUi } from './ui-store';
import { CommandPalette } from './CommandPalette';
import { useAuth } from './auth-store';
import { TABS, isHomePath } from './nav';

/** Home pages whose scroll area already leaves room for the floating tab bar. */
const SELF_PADDED = ['/learn', '/glossary', '/studio'];

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

  // first layer (home) shows the tab bar; second layer (detail, or a lesson open full screen) hides it
  const detail = immersive || !isHomePath(pathname);
  const padded = !detail && !SELF_PADDED.includes(pathname.replace(/\/+$/, ''));

  return (
    <GlossaryProvider>
      <main className={cn('flex h-screen min-w-0 flex-col', padded && 'pb-24')}>
        <Outlet />
      </main>
      <BottomTabBar items={TABS} hidden={detail} more={{ label: 'Thêm', icon: LayoutGrid, onClick: () => setCommandOpen(true) }} />
      <CommandPalette />
      <TechDialogs />
    </GlossaryProvider>
  );
}
