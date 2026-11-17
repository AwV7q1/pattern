import { useSyncExternalStore } from 'react';

/** Which tech sheet / comparison is open, shared by library, inspector and dialogs. */
interface State {
  sheet: string | null;
  compare: string[];
  compareOpen: boolean;
}

let state: State = { sheet: null, compare: [], compareOpen: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const MAX_COMPARE = 4;

export const techUi = {
  openSheet: (id: string) => set({ sheet: id }),
  closeSheet: () => set({ sheet: null }),
  toggleCompare: (id: string) =>
    set({
      compare: state.compare.includes(id)
        ? state.compare.filter((x) => x !== id)
        : [...state.compare, id].slice(-MAX_COMPARE),
    }),
  /** Open the comparison with exactly these techs. */
  compareWith: (ids: string[]) => set({ compare: [...new Set(ids)].slice(0, MAX_COMPARE), compareOpen: true, sheet: null }),
  openCompare: () => set({ compareOpen: true, sheet: null }),
  closeCompare: () => set({ compareOpen: false }),
  clearCompare: () => set({ compare: [] }),
};

export function useTechUi() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
