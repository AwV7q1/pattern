// Learning path model (Duolingo-style): units → lessons → cards.

/** Animated sequence diagram: who sends what to whom, in which order. */
export interface SeqSpec {
  actors: string[];
  steps: SeqStep[];
  caption?: string;
}

export interface SeqStep {
  from: number;
  to: number;
  label?: string;
  /** `req` blue arrow, `res` green, `err` red, `async` violet dashed (not awaited). */
  kind?: 'req' | 'res' | 'err' | 'async';
  /** Steps with the same `at` play together (parallel). Defaults to the step index. */
  at?: number;
}

/** Minimal `{ design, scenario }` the engine runs headless. */
export interface SimSpec {
  design: { nodes: object[]; edges: object[] };
  scenario: object;
}

export type Metric = 'p50Ms' | 'p99Ms' | 'errorRate' | 'throughputRps';

export type Card =
  /** Explanation. `body`: paragraphs, `- ` bullets, **bold**, `code`. */
  | { type: 'read'; title: string; body: string; anim?: SeqSpec }
  | { type: 'choice'; question: string; options: string[]; answer: number; explain: string; anim?: SeqSpec }
  /** Put the items in order; `items` is the correct order (shown shuffled). */
  | { type: 'order'; question: string; items: string[]; explain: string }
  /**
   * Guess the outcome, then the engine runs the scenario and the real number
   * decides which option was right (ranges are [min, max)).
   */
  | {
      type: 'predict';
      question: string;
      sim: SimSpec;
      metric: Metric;
      options: { label: string; min: number; max: number }[];
      explain: string;
    }
  /**
   * Fix a broken design on a mini canvas inside the lesson: only the listed
   * knobs can be changed; the engine runs the edited design and every goal
   * must hold. `solution` (knob id -> value) is checked by `check:learn`.
   */
  | {
      type: 'fix';
      question: string;
      sim: SimSpec;
      knobs: Knob[];
      goals: Goal[];
      solution: Record<string, KnobValue>;
      hint?: string;
      explain: string;
    }
  /** Hands-on: a level on the canvas; the lesson is passed with ≥ 1 star. */
  | { type: 'build'; level: string; intro: string };

export type KnobValue = string | number | boolean;

/** One thing the learner may change in a `fix` card. */
export interface Knob {
  id: string;
  label: string;
  /** Node id (sets `config[field]`) or edge `[source, target]` (sets the edge field). */
  target: { node: string } | { edge: [string, string] };
  field: string;
  control:
    | { kind: 'select'; options: { value: KnobValue; label: string }[] }
    | { kind: 'number'; min: number; max: number; step?: number; unit?: string }
    | { kind: 'switch' };
  help?: string;
  /** A value that meets the numbers but is a wrong design; picking it fails the card with `why`. */
  trap?: { value: KnobValue; why: string };
}

/** A goal on the run summary, e.g. `p50Ms < 80` or `costPerHour <= 0.5`. */
export interface Goal {
  metric: Metric | 'costPerHour';
  op: '<' | '<=';
  value: number;
}

export interface Lesson {
  id: string;
  title: string;
  /** `practice`: one build card on the canvas. */
  kind: 'learn' | 'practice';
  cards: Card[];
}

export interface Unit {
  id: string;
  title: string;
  tier: 'Cơ bản' | 'Trung cấp' | 'Nâng cao';
  color: string;
  description: string;
  lessons: Lesson[];
}
