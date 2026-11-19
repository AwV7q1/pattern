import { createContext, useContext } from 'react';

/**
 * What the canvas is focused on: the hovered (else selected) node, or the
 * selected edge. Edges that do not touch it are dimmed and drop their labels,
 * so one service's calls can be read in a busy diagram.
 */
export interface EdgeFocus {
  node: string | null;
  edge: string | null;
}

export const EdgeFocusContext = createContext<EdgeFocus>({ node: null, edge: null });

/** `true` = in focus, `false` = dimmed, `null` = nothing is focused. */
export function useEdgeFocus(id: string, source: string, target: string): boolean | null {
  const f = useContext(EdgeFocusContext);
  if (f.edge) return f.edge === id;
  if (f.node) return f.node === source || f.node === target;
  return null;
}
