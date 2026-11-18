import type { NodeConfig, Summary, TraceEvent, WindowMetrics } from '../types';

export type ToWorker =
  /** Sandbox: run `{ design, scenario }` as given. `rps` overrides the traffic schedule. */
  | { type: 'init'; input: string; rps: number | null; multiplier: number; stopAtMs: number | null }
  /** Game: the engine applies the level rules (catalog, limits) to the design. */
  | { type: 'initLevel'; level: string; design: string; stopAtMs: number | null }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'speed'; value: number }
  | { type: 'rps'; value: number }
  | { type: 'multiplier'; value: number }
  | { type: 'nodeDown'; index: number; down: boolean }
  | { type: 'flushCache'; index: number }
  /** Follow the next `count` user requests hop by hop. */
  | { type: 'trace'; count: number }
  /** Headless scoring, exactly what the server does on submit. */
  | { type: 'verify'; id: number; level: string; design: string };

export type FromWorker =
  | { type: 'hello'; catalog: Record<string, NodeConfig> }
  | { type: 'ready'; input: string }
  | { type: 'error'; message: string }
  | {
      type: 'tick';
      simMs: number;
      particles: Float32Array<ArrayBuffer>;
      windows: WindowMetrics[];
      traces: TraceEvent[];
      done: boolean;
    }
  | { type: 'verified'; id: number; summary?: Summary; error?: string };
