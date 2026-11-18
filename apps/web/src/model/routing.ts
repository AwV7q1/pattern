// Orthogonal edge routing: every edge becomes horizontal and vertical runs
// that go around nodes, like a circuit or metro map.
//
// For each edge we try a handful of route shapes through the free channels
// between nodes (one bend, a Z through a vertical or horizontal channel, a
// detour with four bends) and keep the cheapest: crossing a node is
// forbidden in practice, then fewer bends, then shorter. Edges are routed one
// after another so later ones avoid running on top of earlier ones, and a
// final pass spreads runs that still share a channel into parallel tracks.

export interface Box {
  id: string;
  l: number;
  r: number;
  t: number;
  b: number;
}
/** Where an edge leaves or enters a node, and which way it is heading there. */
export interface Port {
  x: number;
  y: number;
  dx: number;
  dy: number;
}
export interface RouteRequest {
  id: string;
  from: Port;
  to: Port;
}

const STUB = 18; // straight run out of / into a port before the first bend
const MARGIN = 14; // clearance kept around nodes
const TRACK = 8; // gap between parallel runs sharing a channel
const NODE_HIT = 100_000;
const OVERLAP = 400;
const BEND = 30;

type Pt = [number, number];

export function routeOrthogonal(boxes: Box[], requests: RouteRequest[]): Map<string, number[]> {
  const grown = boxes.map((b) => ({ l: b.l - MARGIN, r: b.r + MARGIN, t: b.t - MARGIN, b: b.b + MARGIN }));
  // channel coordinates: just outside every node, and the middle of every gap
  const xs = channels(boxes.map((b) => [b.l, b.r]));
  const ys = channels(boxes.map((b) => [b.t, b.b]));
  const placed: Pt[][] = [];
  const out = new Map<string, Pt[]>();

  // short edges first: they have the fewest options, long ones detour around them
  const order = [...requests].sort((a, b) => dist(a) - dist(b));
  for (const req of order) {
    const p0: Pt = [req.from.x, req.from.y];
    const p1: Pt = [req.to.x, req.to.y];
    const a: Pt = [p0[0] + req.from.dx * STUB, p0[1] + req.from.dy * STUB];
    const b: Pt = [p1[0] - req.to.dx * STUB, p1[1] - req.to.dy * STUB];
    // the middle first: on a tie the first candidate wins, so jogs sit halfway
    const lxs = [(a[0] + b[0]) / 2, ...xs, a[0], b[0]];
    const lys = [(a[1] + b[1]) / 2, ...ys, a[1], b[1]];

    let best: Pt[] | null = null;
    let bestCost = Infinity;
    const consider = (mid: Pt[]) => {
      const path = simplify([p0, a, ...mid, b, p1]);
      const c = cost(path, grown, placed);
      if (c < bestCost) {
        bestCost = c;
        best = path;
      }
    };
    consider([[b[0], a[1]]]);
    consider([[a[0], b[1]]]);
    for (const x of lxs) consider([[x, a[1]], [x, b[1]]]);
    for (const y of lys) consider([[a[0], y], [b[0], y]]);
    if (bestCost >= NODE_HIT) {
      // two channels are not enough: leave through one vertical channel near
      // the source, cross on a horizontal one, come back down one near the target
      const near = (x0: number) => [...lxs].sort((p, q) => Math.abs(p - x0) - Math.abs(q - x0)).slice(0, 8);
      for (const x1 of near(a[0]))
        for (const x2 of near(b[0]))
          for (const y of lys) consider([[x1, a[1]], [x1, y], [x2, y], [x2, b[1]]]);
    }
    placed.push(best!);
    out.set(req.id, best!);
  }

  nudge([...out.values()]);
  return new Map([...out].map(([id, p]) => [id, simplify(p).flat()]));
}

function dist(r: RouteRequest) {
  return Math.abs(r.to.x - r.from.x) + Math.abs(r.to.y - r.from.y);
}

/** Sorted, deduplicated channel lines from intervals (node extents on one axis). */
function channels(spans: number[][]): number[] {
  const v: number[] = [];
  for (const [lo, hi] of spans) v.push(lo - MARGIN - 6, hi + MARGIN + 6);
  const sorted = [...spans].sort((p, q) => p[0] - q[0]);
  for (let i = 0; i < sorted.length; i++)
    for (let j = 0; j < sorted.length; j++) if (sorted[j][0] > sorted[i][1] + 2 * MARGIN) v.push((sorted[i][1] + sorted[j][0]) / 2);
  return [...new Set(v.map((x) => Math.round(x / 4) * 4))];
}

/** Drop zero-length runs and merge collinear ones. */
function simplify(p: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 0.5 && Math.abs(last[1] - q[1]) < 0.5) continue;
    out.push([q[0], q[1]]);
    while (out.length >= 3) {
      const [u, v, w] = out.slice(-3);
      const collinear = (Math.abs(u[0] - v[0]) < 0.5 && Math.abs(v[0] - w[0]) < 0.5) || (Math.abs(u[1] - v[1]) < 0.5 && Math.abs(v[1] - w[1]) < 0.5);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

function cost(path: Pt[], grown: { l: number; r: number; t: number; b: number }[], placed: Pt[][]): number {
  let c = 0;
  let prev: Pt | null = null;
  for (let i = 1; i < path.length; i++) {
    const [u, v] = [path[i - 1], path[i]];
    const d: Pt = [Math.sign(v[0] - u[0]), Math.sign(v[1] - u[1])];
    // a run that doubles back on the previous one draws over itself
    if (prev && d[0] === -prev[0] && d[1] === -prev[1]) c += NODE_HIT;
    prev = d;
    c += Math.abs(v[0] - u[0]) + Math.abs(v[1] - u[1]);
    // the first and last runs start on a node's border, so they skip that node
    for (const g of grown) if (hits(u, v, g) && !(i === 1 && inside(u, g)) && !(i === path.length - 1 && inside(v, g))) c += NODE_HIT;
    for (const other of placed) for (let k = 1; k < other.length; k++) if (overlaps(u, v, other[k - 1], other[k])) c += OVERLAP;
  }
  return c + (path.length - 2) * BEND;
}

function inside(p: Pt, g: { l: number; r: number; t: number; b: number }) {
  return p[0] >= g.l && p[0] <= g.r && p[1] >= g.t && p[1] <= g.b;
}

/** Does the axis-aligned run u→v pass through the box interior? */
function hits(u: Pt, v: Pt, g: { l: number; r: number; t: number; b: number }) {
  const [x0, x1] = [Math.min(u[0], v[0]), Math.max(u[0], v[0])];
  const [y0, y1] = [Math.min(u[1], v[1]), Math.max(u[1], v[1])];
  return x1 > g.l && x0 < g.r && y1 > g.t && y0 < g.b;
}

/** Two runs on the same line sharing some length. */
function overlaps(u: Pt, v: Pt, p: Pt, q: Pt) {
  if (Math.abs(u[0] - v[0]) < 0.5 && Math.abs(p[0] - q[0]) < 0.5 && Math.abs(u[0] - p[0]) < TRACK / 2)
    return Math.min(Math.max(u[1], v[1]), Math.max(p[1], q[1])) - Math.max(Math.min(u[1], v[1]), Math.min(p[1], q[1])) > 4;
  if (Math.abs(u[1] - v[1]) < 0.5 && Math.abs(p[1] - q[1]) < 0.5 && Math.abs(u[1] - p[1]) < TRACK / 2)
    return Math.min(Math.max(u[0], v[0]), Math.max(p[0], q[0])) - Math.max(Math.min(u[0], v[0]), Math.min(p[0], q[0])) > 4;
  return false;
}

/**
 * Runs that still share a channel are spread into parallel tracks TRACK
 * apart. Only inner runs move: the first and last are pinned to their ports.
 */
function nudge(paths: Pt[][]) {
  for (const axis of [0, 1] as const) {
    // inner runs along this axis' perpendicular: axis 0 = vertical runs (same x)
    const runs: { path: Pt[]; i: number; at: number; lo: number; hi: number }[] = [];
    for (const path of paths)
      for (let i = 1; i < path.length - 2; i++) {
        const [u, v] = [path[i], path[i + 1]];
        if (Math.abs(u[axis] - v[axis]) > 0.5) continue;
        const o = 1 - axis;
        runs.push({ path, i, at: u[axis], lo: Math.min(u[o], v[o]), hi: Math.max(u[o], v[o]) });
      }
    runs.sort((p, q) => p.at - q.at || p.lo - q.lo);
    const groups: (typeof runs)[] = [];
    for (const r of runs) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g[0].at - r.at) < TRACK / 2) g.push(r);
      else groups.push([r]);
    }
    for (const g of groups) {
      if (g.length < 2) continue;
      // interval colouring: a run takes the first track free over its length
      const tracks: number[][] = [];
      const pick = g.map((r) => {
        let t = tracks.findIndex((ends) => ends.every((end, k) => k % 2 === 1 || !(r.lo < ends[k + 1] + 4 && r.hi > end - 4)));
        if (t < 0) t = tracks.push([]) - 1;
        tracks[t].push(r.lo, r.hi);
        return t;
      });
      if (tracks.length < 2) continue;
      g.forEach((r, k) => {
        const shift = (pick[k] - (tracks.length - 1) / 2) * TRACK;
        r.path[r.i][axis] += shift;
        r.path[r.i + 1][axis] += shift;
      });
    }
  }
}
