import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Design } from '@/types';

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  /** Last design opened in the studio, offered by the capacity tools. */
  lastDesign: { title: string; design: Design } | null;
  setLastDesign: (d: UiState['lastDesign']) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      lastDesign: null,
      setLastDesign: (lastDesign) => set({ lastDesign }),
    }),
    {
      name: 'pattern.ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, lastDesign: s.lastDesign }),
    },
  ),
);
