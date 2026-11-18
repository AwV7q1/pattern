import { createContext } from 'react';
import type { EdgeLayout } from '@/types';

/**
 * Reshaping edges by hand (Figma-style): the canvas provides this so an edge
 * can change its own saved layout. `begin`/`end` bracket one drag; a drag
 * that ends with the route crossing a node is undone.
 */
export interface EdgeEdit {
  /** Inner runs can be dragged (orthogonal style only). */
  orthogonal: boolean;
  begin(id: string): void;
  set(id: string, layout: EdgeLayout | undefined): void;
  end(id: string): void;
}

export const EdgeEditContext = createContext<EdgeEdit | null>(null);
