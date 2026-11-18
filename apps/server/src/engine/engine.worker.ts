// Runs in a worker thread (piscina): the simulation is CPU-bound and would
// otherwise block the event loop for every other request.
import { level_input, play_level, run_headless } from 'pattern-engine-wasm';

export type EngineTask =
  | { op: 'playLevel'; level: string; design: string }
  | { op: 'levelInput'; level: string; design: string }
  | { op: 'run'; input: string };

export default function run(task: EngineTask): string {
  switch (task.op) {
    case 'playLevel':
      return play_level(task.level, task.design);
    case 'levelInput':
      return level_input(task.level, task.design);
    case 'run':
      return run_headless(task.input);
  }
}
