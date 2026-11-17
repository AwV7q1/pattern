/// <reference lib="webworker" />
// Owns the WASM simulation and advances it in (scaled) real time.
import init, { Sim } from 'pattern-engine-wasm';
import type { FromWorker, ToWorker } from './protocol';

const TICK_MS = 16;
const MAX_STEP_WALL_MS = 100; // avoid huge catch-up steps after the tab sleeps

const ready = init();
let sim: Sim | null = null;
let running = false;
let speed = 1;
let lastWall = performance.now();

const post = (msg: FromWorker, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  await ready;
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        sim?.free();
        sim = new Sim(msg.input);
        sim.set_rps(msg.rps);
        sim.set_traffic_multiplier(msg.multiplier);
        running = false;
        post({ type: 'ready' });
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
      case 'nodeDown':
        sim?.set_node_down(msg.index, msg.down);
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

setInterval(() => {
  const now = performance.now();
  const dtWall = Math.min(now - lastWall, MAX_STEP_WALL_MS);
  lastWall = now;
  if (!sim || !running) return;
  sim.step(sim.now_ms() + dtWall * speed);
  // wasm-bindgen copies Vec<f32> into a fresh (non-shared) Float32Array
  const particles = sim.take_particles() as Float32Array<ArrayBuffer>;
  const windows = JSON.parse(sim.take_windows_json());
  post({ type: 'tick', simMs: sim.now_ms(), particles, windows }, [particles.buffer]);
}, TICK_MS);
