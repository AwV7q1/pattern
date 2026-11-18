import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Design } from '@/types';

interface UiState {
  /** A lesson or review is open: the tab bar steps aside. */
  immersive: boolean;
  setImmersive: (on: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  /** Last design opened in the studio, offered by the capacity tools. */
  lastDesign: { title: string; design: Design } | null;
  setLastDesign: (d: UiState['lastDesign']) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      immersive: false,
      setImmersive: (immersive) => set({ immersive }),
      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      lastDesign: null,
      setLastDesign: (lastDesign) => set({ lastDesign }),
    }),
    {
      name: 'pattern.ui',
      partialize: (s) => ({ lastDesign: s.lastDesign }),
    },
  ),
);
