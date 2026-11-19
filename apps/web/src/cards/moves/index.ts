// Every enemy's own move set, by enemy id (see kit.ts). An enemy missing here,
// or a piece a move set leaves out, uses the shared motion in botMotion.ts.
import './moves.css';
import type { MoveSet } from './kit';
import { lordMoves, LORD } from './ddosLord';
import { WARMUP } from './warmup';
import { BOSSES } from './bosses';
import { FLOOR1 } from './floor1';

export const MOVES: Record<string, MoveSet> = {
  ...WARMUP,
  ...FLOOR1,
  ...BOSSES,
  [LORD]: lordMoves,
};

export const movesOf = (enemyId: string | null | undefined): MoveSet | undefined => (enemyId ? MOVES[enemyId] : undefined);
export type { MoveSet, LayerProps } from './kit';
