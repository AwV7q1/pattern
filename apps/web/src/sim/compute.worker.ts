/// <reference lib="webworker" />
// Heavy one-shot engine calls (sizing, calibration) off the main thread and
// off the live-simulation worker, so the canvas keeps animating.
import init, { calibrate_json, default_sizing_spec, size_json } from 'pattern-engine-wasm';

export type ComputeRequest =
  | { id: number; op: 'defaults' }
  | { id: number; op: 'size'; spec: string }
  | { id: number; op: 'calibrate'; design: string; request: string };

const ready = init();

self.onmessage = async (e: MessageEvent<ComputeRequest>) => {
  await ready;
  const msg = e.data;
  const post = (data: unknown) => (self as DedicatedWorkerGlobalScope).postMessage({ id: msg.id, ...data! });
  try {
    const json =
      msg.op === 'defaults'
        ? default_sizing_spec()
        : msg.op === 'size'
          ? size_json(msg.spec)
          : calibrate_json(msg.design, msg.request);
    post({ result: JSON.parse(json) });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
