import { Injectable } from '@nestjs/common';
// Same Rust engine as the browser, compiled with `wasm-pack --target nodejs`.
import { play_level, level_input, Sim } from 'pattern-engine-wasm';

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

@Injectable()
export class EngineService {
  /** Deterministic: the score matches what the player saw in the browser. */
  playLevel(levelJson: string, design: unknown): Summary {
    try {
      return JSON.parse(play_level(levelJson, JSON.stringify(design))) as Summary;
    } catch (err) {
      throw new InvalidDesignError(err instanceof Error ? err.message : String(err));
    }
  }

  levelInput(levelJson: string, design: unknown): unknown {
    return JSON.parse(level_input(levelJson, JSON.stringify(design)));
  }

  /** Throws InvalidDesignError unless the engine can build this design + scenario. */
  validate(design: unknown, scenario: unknown) {
    let sim: Sim | undefined;
    try {
      sim = new Sim(JSON.stringify({ design, scenario }));
    } catch (err) {
      throw new InvalidDesignError(err instanceof Error ? err.message : String(err));
    } finally {
      sim?.free();
    }
  }
}
