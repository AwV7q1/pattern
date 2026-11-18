/// <reference lib="webworker" />
// Owns the WASM simulation and advances it in (scaled) real time.
import init, { Sim, catalog_json, level_input, play_level } from 'pattern-engine-wasm';
import type { FromWorker, ToWorker } from './protocol';

const TICK_MS = 16;
const MAX_STEP_WALL_MS = 100; // avoid huge catch-up steps after the tab sleeps

let sim: Sim | null = null;
let running = false;
let speed = 1;
let stopAt: number | null = null;
let lastWall = performance.now();

const post = (msg: FromWorker, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const ready = init().then(() => post({ type: 'hello', catalog: JSON.parse(catalog_json()) }));

function start(input: string, stopAtMs: number | null) {
  sim?.free();
  sim = null;
  sim = new Sim(input);
  stopAt = stopAtMs;
  running = false;
  post({ type: 'ready', input });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  await ready;
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        start(msg.input, msg.stopAtMs);
        if (msg.rps !== null) sim!.set_rps(msg.rps);
        sim!.set_traffic_multiplier(msg.multiplier);
        break;
      case 'initLevel':
        start(level_input(msg.level, msg.design), msg.stopAtMs);
        break;
      case 'play':
        running = true;
        lastWall = performance.now();
        break;
      case 'pause':
        running = false;
        break;
      case 'speed':
        speed = msg.value;
        break;
      case 'rps':
        sim?.set_rps(msg.value);
        break;
      case 'multiplier':
        sim?.set_traffic_multiplier(msg.value);
        break;
      case 'flushCache':
        sim?.flush_cache(msg.index);
        break;
      case 'nodeDown':
        sim?.set_node_down(msg.index, msg.down);
        break;
      case 'trace':
        sim?.trace_next(msg.count);
        break;
      case 'verify':
        try {
          post({ type: 'verified', id: msg.id, summary: JSON.parse(play_level(msg.level, msg.design)) });
        } catch (err) {
          post({ type: 'verified', id: msg.id, error: errorMessage(err) });
        }
        break;
    }
  } catch (err) {
    sim = null;
    post({ type: 'error', message: errorMessage(err) });
  }
};

setInterval(() => {
  const now = performance.now();
  const dtWall = Math.min(now - lastWall, MAX_STEP_WALL_MS);
  lastWall = now;
  if (!sim || !running) return;
  let target = sim.now_ms() + dtWall * speed;
  const done = stopAt !== null && target >= stopAt;
  if (done) target = stopAt!;
  sim.step(target);
  if (done) running = false;
  // wasm-bindgen copies Vec<f32> into a fresh (non-shared) Float32Array
  const particles = sim.take_particles() as Float32Array<ArrayBuffer>;
  const windows = JSON.parse(sim.take_windows_json());
  const traces = JSON.parse(sim.take_traces_json());
  post({ type: 'tick', simMs: sim.now_ms(), particles, windows, traces, done }, [particles.buffer]);
}, TICK_MS);
