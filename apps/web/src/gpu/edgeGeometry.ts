// Edge geometry registry shared by the React Flow edge component (which draws
// the SVG path) and the particle renderers (which move particles along the
// same path), so both always match.
//
// Every edge is published as a polyline parameterised by arc length: a curve
// is flattened into short segments, an orthogonal route is its corners. The
// shaders walk the polyline, so particles move at constant speed on any shape.

export type Bezier = [number, number, number, number, number, number, number, number];
/** Flat `[x0, y0, x1, y1, …]`, at least two points. */
export type Polyline = number[];

/**
 * Per-edge drawing style read by the particle shaders:
 * `[request size, response size, fire-and-forget (0/1), unused]`.
 * Sizes are radius multipliers derived from the payload in KB.
 */
export type EdgeStyle = [number, number, number, number];
export const DEFAULT_STYLE: EdgeStyle = [1, 1, 0, 0];

/** Points per edge the shaders can read (a curve uses all of them). */
export const MAX_POINTS = 32;
/** `[style ×4, point count, pad ×3]` then `[x, y, arc fraction]` per point. */
export const EDGE_HEADER = 8;
export const FLOATS_PER_EDGE = EDGE_HEADER + MAX_POINTS * 3;

/** Bigger bodies, bigger dots: 1× at 0 KB, ~2× at 64 KB, capped at 2.6×. */
export function payloadScale(kb: number | undefined) {
  return kb && kb > 0 ? Math.min(2.6, 1 + Math.log2(1 + kb / 4) * 0.25) : 1;
}

/**
 * Cubic bezier from a node's right handle to another node's left handle.
 * Forward edges are the usual S-curve. A back edge (callee left of the
 * caller: a callback, an event loop) would cut through both nodes as an S,
 * so when `backY` is given it leaves right, swings down (or up) to about
 * `backY` and comes back into the callee's left side. `vertical` is for
 * stacked nodes joined bottom-to-top (or top-to-bottom).
 */
export function bezierFor(sx: number, sy: number, tx: number, ty: number, backY?: number, vertical?: boolean): Bezier {
  if (vertical) {
    const dy = Math.max(Math.abs(ty - sy) * 0.5, 30) * Math.sign(ty - sy || 1);
    return [sx, sy, sx, sy + dy, tx, ty - dy, tx, ty];
  }
  if (backY === undefined) {
    const dx = Math.max(Math.abs(tx - sx) * 0.5, 40);
    return [sx, sy, sx + dx, sy, tx - dx, ty, tx, ty];
  }
  // B(0.5).y = mid + 0.75·h, so h puts the loop's extreme at backY
  const h = (backY - (sy + ty) / 2) / 0.75;
  const k = 70 + Math.min(110, Math.abs(sx - tx) * 0.12);
  return [sx, sy, sx + k, sy + h, tx - k, ty + h, tx, ty];
}

export function bezierPath(b: Bezier): string {
  return `M ${b[0]},${b[1]} C ${b[2]},${b[3]} ${b[4]},${b[5]} ${b[6]},${b[7]}`;
}

/** Point of the bezier at `t`. */
export function bezierAt(b: Bezier, t: number): [number, number] {
  const it = 1 - t;
  const a = it * it * it, c1 = 3 * it * it * t, c2 = 3 * it * t * t, d = t * t * t;
  return [a * b[0] + c1 * b[2] + c2 * b[4] + d * b[6], a * b[1] + c1 * b[3] + c2 * b[5] + d * b[7]];
}

export function flattenBezier(b: Bezier, points = MAX_POINTS): Polyline {
  const out: Polyline = [];
  for (let i = 0; i < points; i++) out.push(...bezierAt(b, i / (points - 1)));
  return out;
}

/** SVG path of an orthogonal polyline with its corners rounded. */
export function roundedPath(p: Polyline, radius = 10): string {
  const n = p.length / 2;
  let d = `M ${p[0]},${p[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const [px, py, x, y, nx, ny] = [p[2 * i - 2], p[2 * i - 1], p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3]];
    const lin = Math.hypot(x - px, y - py);
    const lout = Math.hypot(nx - x, ny - y);
    const r = Math.min(radius, lin / 2, lout / 2);
    if (r < 0.5) {
      d += ` L ${x},${y}`;
      continue;
    }
    const ax = x + ((px - x) / lin) * r, ay = y + ((py - y) / lin) * r;
    const bx = x + ((nx - x) / lout) * r, by = y + ((ny - y) / lout) * r;
    d += ` L ${ax},${ay} Q ${x},${y} ${bx},${by}`;
  }
  return `${d} L ${p[2 * n - 2]},${p[2 * n - 1]}`;
}

/** Cumulative arc length fraction of each point (0 … 1). */
export function arcFractions(p: Polyline): number[] {
  const n = p.length / 2;
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
  const total = s[n - 1] || 1;
  return s.map((v) => v / total);
}

/** Point at arc fraction `t` of the polyline. */
export function pointAt(p: Polyline, t: number, s = arcFractions(p)): [number, number] {
  let i = 1;
  while (i < s.length - 1 && s[i] < t) i++;
  const f = (t - s[i - 1]) / Math.max(s[i] - s[i - 1], 1e-9);
  return [p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * f, p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * f];
}

const geometry = new Map<number, { p: Polyline; style: EdgeStyle }>();
let version = 0;

export function setEdgeGeometry(index: number, p: Polyline, style: EdgeStyle = DEFAULT_STYLE) {
  const prev = geometry.get(index);
  if (prev && prev.p.length === p.length && prev.p.every((v, i) => v === p[i]) && prev.style.every((v, i) => v === style[i])) return;
  geometry.set(index, { p: p.slice(0, MAX_POINTS * 2), style });
  version++;
}

export function clearEdgeGeometry() {
  geometry.clear();
  version++;
}

export function edgeGeometryVersion() {
  return version;
}

/** Packs edges (`FLOATS_PER_EDGE` floats each) indexed by engine edge index. */
export function packEdgeGeometry(): Float32Array {
  const count = geometry.size ? Math.max(...geometry.keys()) + 1 : 0;
  const out = new Float32Array(Math.max(count, 1) * FLOATS_PER_EDGE);
  geometry.forEach(({ p, style }, i) => {
    const o = i * FLOATS_PER_EDGE;
    const s = arcFractions(p);
    out.set(style, o);
    out[o + 4] = s.length;
    s.forEach((f, k) => out.set([p[2 * k], p[2 * k + 1], f], o + EDGE_HEADER + k * 3));
  });
  return out;
}

/**
 * Position and unit tangent at arc fraction `t` of a packed edge, as the
 * shader computes it (used by the Canvas2D fallback).
 */
export function samplePacked(edges: Float32Array, e: number, t: number): [number, number, number, number] {
  const n = edges[e + 4];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (edges[e + EDGE_HEADER + mid * 3 + 2] <= t) lo = mid;
    else hi = mid;
  }
  const a = e + EDGE_HEADER + lo * 3, b = e + EDGE_HEADER + hi * 3;
  const f = (t - edges[a + 2]) / Math.max(edges[b + 2] - edges[a + 2], 1e-6);
  const dx = edges[b] - edges[a], dy = edges[b + 1] - edges[a + 1];
  const len = Math.hypot(dx, dy) || 1;
  return [edges[a] + dx * f, edges[a + 1] + dy * f, dx / len, dy / len];
}
