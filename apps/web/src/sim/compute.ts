import type { CalibrationResult, Design, SizingReport, SizingSpec, Summary, WindowMetrics } from '@/types';
import type { ComputeRequest } from './compute.worker';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Promise wrapper around the compute worker (one shared instance). */
class Compute {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  private call<T>(req: WithoutId<ComputeRequest>): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        if (e.data.error !== undefined) p?.reject(new Error(e.data.error));
        else p?.resolve(e.data.result);
      };
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker!.postMessage({ ...req, id });
    });
  }

  defaults() {
    return this.call<SizingSpec>({ op: 'defaults' });
  }

  size(spec: SizingSpec) {
    return this.call<SizingReport>({ op: 'size', spec: JSON.stringify(spec) });
  }

  /** Run `{ design, scenario }` (with `durationMs`) to the end. */
  run(input: object) {
    return this.call<Summary>({ op: 'run', input: JSON.stringify(input) });
  }

  /** Score a design against a level, exactly like the game and the server. */
  playLevel(level: object, design: object) {
    return this.call<Summary>({ op: 'playLevel', level: JSON.stringify(level), design: JSON.stringify(design) });
  }

  /** Run to the end and keep every metrics window (A/B charts). */
  runDetailed(input: object) {
    return this.call<{ summary: Summary; windows: WindowMetrics[] }>({ op: 'runDetailed', input: JSON.stringify(input) });
  }

  calibrate(design: Design, request: CalibrateRequest) {
    return this.call<CalibrationResult>({
      op: 'calibrate',
      design: JSON.stringify(design),
      request: JSON.stringify(request),
    });
  }
}

export interface CalibrateRequest {
  summaries: { name: string; json: string }[];
  fit: string[];
  observe: string[];
  maxVus?: number | null;
  maxEvals?: number;
  slo?: { p99Ms: number; errorRate: number } | null;
}

export const compute = new Compute();
