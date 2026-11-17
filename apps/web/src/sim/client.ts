import type { FromWorker, ToWorker } from './protocol';
import type { WindowMetrics } from '../types';

type TickListener = (particles: Float32Array<ArrayBuffer>, windows: WindowMetrics[]) => void;

/** Main-thread handle to the simulation worker, plus an interpolated clock. */
export class SimClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private tickListeners = new Set<TickListener>();
  private resetListeners = new Set<() => void>();
  private lastSimMs = 0;
  private lastTickWall = 0;
  running = false;
  speed = 1;
  onError: (message: string) => void = (m) => console.error(m);

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === 'tick') {
        this.lastSimMs = msg.simMs;
        this.lastTickWall = performance.now();
        this.tickListeners.forEach((fn) => fn(msg.particles, msg.windows));
      } else if (msg.type === 'error') {
        this.onError(msg.message);
      }
    };
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  init(input: object, rps: number, multiplier: number) {
    this.running = false;
    this.lastSimMs = 0;
    this.send({ type: 'init', input: JSON.stringify(input), rps, multiplier });
    this.resetListeners.forEach((fn) => fn());
  }
  play() {
    this.running = true;
    this.lastTickWall = performance.now();
    this.send({ type: 'play' });
  }
  pause() {
    this.running = false;
    this.send({ type: 'pause' });
  }
  setSpeed(value: number) {
    this.speed = value;
    this.send({ type: 'speed', value });
  }
  setRps(value: number) {
    this.send({ type: 'rps', value });
  }
  setMultiplier(value: number) {
    this.send({ type: 'multiplier', value });
  }
  setNodeDown(index: number, down: boolean) {
    this.send({ type: 'nodeDown', index, down });
  }

  /** Simulated time (ms) interpolated between worker ticks for smooth rendering. */
  currentSimMs() {
    if (!this.running) return this.lastSimMs;
    return this.lastSimMs + Math.min(performance.now() - this.lastTickWall, 100) * this.speed;
  }

  onTick(fn: TickListener) {
    this.tickListeners.add(fn);
    return () => void this.tickListeners.delete(fn);
  }
  onReset(fn: () => void) {
    this.resetListeners.add(fn);
    return () => void this.resetListeners.delete(fn);
  }
}
