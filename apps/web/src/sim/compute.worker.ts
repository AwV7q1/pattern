/// <reference lib="webworker" />
// Heavy one-shot engine calls (sizing, calibration, lesson predictions) off
// the main thread and off the live-simulation worker, so the canvas keeps
// animating.
import init, { calibrate_json, default_sizing_spec, level_input, play_level, run_detailed, run_headless, size_json } from 'pattern-engine-wasm';

export type ComputeRequest =
  | { id: number; op: 'defaults' }
  | { id: number; op: 'size'; spec: string }
  | { id: number; op: 'calibrate'; design: string; request: string }
  | { id: number; op: 'run'; input: string }
  | { id: number; op: 'runDetailed'; input: string }
  | { id: number; op: 'playLevel'; level: string; design: string }
  | { id: number; op: 'levelRun'; level: string; design: string };

const ready = init();

function handle(msg: ComputeRequest): string {
  switch (msg.op) {
    case 'defaults':
      return default_sizing_spec();
    case 'size':
      return size_json(msg.spec);
    case 'calibrate':
      return calibrate_json(msg.design, msg.request);
    case 'run':
      return run_headless(msg.input);
    case 'runDetailed':
      return run_detailed(msg.input);
    case 'playLevel':
      return play_level(msg.level, msg.design);
    case 'levelRun': {
      const input = level_input(msg.level, msg.design);
      return JSON.stringify({ input: JSON.parse(input), ...JSON.parse(run_detailed(input)) });
    }
  }
}

self.onmessage = async (e: MessageEvent<ComputeRequest>) => {
  await ready;
  const msg = e.data;
  const post = (data: unknown) => (self as DedicatedWorkerGlobalScope).postMessage({ id: msg.id, ...data! });
  try {
    post({ result: JSON.parse(handle(msg)) });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
