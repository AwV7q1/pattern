import type { WindowMetrics } from '../types';

export type ToWorker =
  | { type: 'init'; input: string; rps: number; multiplier: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: number }
  | { type: 'rps'; value: number }
  | { type: 'multiplier'; value: number }
  | { type: 'nodeDown'; index: number; down: boolean };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'tick'; simMs: number; particles: Float32Array<ArrayBuffer>; windows: WindowMetrics[] };
