import type { FromWorker, ToWorker } from './protocol';
import type { NodeConfig, Summary, WindowMetrics } from '../types';

type TickListener = (particles: Float32Array<ArrayBuffer>, windows: WindowMetrics[], done: boolean) => void;

/** Main-thread handle to the simulation worker, plus an interpolated clock. */
export class SimClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private tickListeners = new Set<TickListener>();
  private resetListeners = new Set<() => void>();
  private pending = new Map<number, (r: { summary?: Summary; error?: string }) => void>();
  private nextId = 1;
  private lastSimMs = 0;
  private lastTickWall = 0;
  running = false;
  speed = 1;
  catalog: Record<string, NodeConfig> = {};
  /** Engine input of the current run (catalog applied in game mode). */
  input: { design: { nodes: { id: string; config: NodeConfig }[] } } | null = null;
  onError: (message: string) => void = (m) => console.error(m);
  onReady: () => void = () => {};
  onStop: () => void = () => {};

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'hello':
          this.catalog = msg.catalog;
          break;
        case 'ready':
          this.input = JSON.parse(msg.input);
          this.onReady();
          break;
        case 'tick':
          this.lastSimMs = msg.simMs;
          this.lastTickWall = performance.now();
          if (msg.done) {
            this.running = false;
            this.onStop();
          }
          this.tickListeners.forEach((fn) => fn(msg.particles, msg.windows, msg.done));
          break;
        case 'error':
          this.input = null;
          this.onError(msg.message);
          break;
        case 'verified':
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
          break;
      }
    };
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  private reset() {
    this.running = false;
    this.lastSimMs = 0;
    this.resetListeners.forEach((fn) => fn());
  }

  init(input: object, rps: number | null, multiplier: number, stopAtMs: number | null = null) {
    this.reset();
    this.send({ type: 'init', input: JSON.stringify(input), rps, multiplier, stopAtMs });
  }
  initLevel(level: object, design: object) {
    this.reset();
    const stopAtMs = (level as { scenario: { durationMs?: number } }).scenario.durationMs ?? null;
    this.send({ type: 'initLevel', level: JSON.stringify(level), design: JSON.stringify(design), stopAtMs });
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
  verify(level: object, design: object): Promise<{ summary?: Summary; error?: string }> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ type: 'verify', id, level: JSON.stringify(level), design: JSON.stringify(design) });
    });
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
