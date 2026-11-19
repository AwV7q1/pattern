import { createContext, useContext, useState, type ReactNode } from 'react';
import { SimClient } from '@/sim/client';

const SimCtx = createContext<SimClient | null>(null);

/**
 * One simulation worker for the whole app: only one canvas is on screen at a
 * time, and pages remount often with the router, so they share it instead of
 * starting a new worker (and WASM instance) on every navigation.
 */
export function SimProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new SimClient());
  return <SimCtx.Provider value={client}>{children}</SimCtx.Provider>;
}

export function useSimClient() {
  const c = useContext(SimCtx);
  if (!c) throw new Error('useSimClient outside SimProvider');
  return c;
}
