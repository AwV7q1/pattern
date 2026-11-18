import { Injectable, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import Piscina from 'piscina';
import { AppConfig } from '../config/config';
import type { EngineTask } from './engine.worker';

export interface Summary {
  durationMs: number;
  total: number;
  ok: number;
  errors: number;
  timeouts: number;
  retries: number;
  errorRate: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  costPerHour: number;
  slo: { p99Ms: number; errorRate: number };
  sloPass: boolean;
  sloWindowRatio: number;
  budgetPerHour: number | null;
  backlog: number;
  stars: number;
}

export class InvalidDesignError extends Error {}

/** The pool is saturated or the run timed out (HTTP 503). */
export class ServiceUnavailableError extends ServiceUnavailableException {}

/** Waiting tasks beyond which new ones are refused (503) instead of queueing forever. */
const MAX_QUEUE = 16;

/**
 * Same Rust engine as the browser (`wasm-pack --target nodejs`), run on a
 * small worker pool. Deterministic: a score equals what the player saw.
 */
@Injectable()
export class EngineService implements OnModuleDestroy {
  private readonly pool: Piscina;
  private readonly timeoutMs: number;

  constructor(config: AppConfig) {
    const threads = config.get('ENGINE_THREADS') ?? Math.max(1, Math.min(2, availableParallelism() - 1));
    this.timeoutMs = config.get('ENGINE_TIMEOUT_MS');
    this.pool = new Piscina({
      filename: resolve(__dirname, 'engine.worker.js'),
      minThreads: 1,
      maxThreads: threads,
      maxQueue: MAX_QUEUE,
      idleTimeout: 60_000,
    });
  }

  async onModuleDestroy() {
    await this.pool.destroy();
  }

  get stats() {
    return { threads: this.pool.threads.length, queued: this.pool.queueSize, completed: this.pool.completed };
  }

  private async exec(task: EngineTask): Promise<string> {
    if (this.pool.queueSize >= MAX_QUEUE) throw new ServiceUnavailableError('engine busy, try again shortly');
    const abort = AbortSignal.timeout(this.timeoutMs);
    try {
      return (await this.pool.run(task, { signal: abort })) as string;
    } catch (err) {
      if (abort.aborted) throw new ServiceUnavailableError('simulation took too long');
      const message = err instanceof Error ? err.message : String(err);
      if (/queue is full/i.test(message)) throw new ServiceUnavailableError('engine busy, try again shortly');
      throw new InvalidDesignError(message);
    }
  }

  async playLevel(levelJson: string, design: unknown): Promise<Summary> {
    return JSON.parse(await this.exec({ op: 'playLevel', level: levelJson, design: JSON.stringify(design) })) as Summary;
  }

  async levelInput(levelJson: string, design: unknown): Promise<unknown> {
    return JSON.parse(await this.exec({ op: 'levelInput', level: levelJson, design: JSON.stringify(design) }));
  }

  /** Play a design on a level and keep the sanitized input and every metrics window. */
  async levelRun(level: unknown, design: unknown): Promise<{ input: { design: { nodes: unknown[]; edges: unknown[] } }; summary: Summary; windows: { nodes: { utilization: number; rejected: number }[] }[] }> {
    return JSON.parse(await this.exec({ op: 'levelRun', level: JSON.stringify(level), design: JSON.stringify(design) }));
  }

  /** Run `{ design, scenario }` (with `durationMs`) to the end. */
  async run(input: unknown): Promise<Summary> {
    return JSON.parse(await this.exec({ op: 'run', input: JSON.stringify(input) })) as Summary;
  }
}
