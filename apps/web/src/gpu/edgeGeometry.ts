// Edge geometry registry shared by the React Flow edge component (which draws
// the SVG path) and the particle renderers (which move particles along the
// same cubic bezier), so both always match exactly.

export type Bezier = [number, number, number, number, number, number, number, number];

/**
 * Per-edge drawing style read by the particle shaders:
 * `[request size, response size, fire-and-forget (0/1), unused]`.
 * Sizes are radius multipliers derived from the payload in KB.
 */
export type EdgeStyle = [number, number, number, number];
export const FLOATS_PER_EDGE = 12;
export const DEFAULT_STYLE: EdgeStyle = [1, 1, 0, 0];

/** Bigger bodies, bigger dots: 1× at 0 KB, ~2× at 64 KB, capped at 2.6×. */
export function payloadScale(kb: number | undefined) {
  return kb && kb > 0 ? Math.min(2.6, 1 + Math.log2(1 + kb / 4) * 0.25) : 1;
}

/**
 * Cubic bezier from a node's right handle to another node's left handle.
 * Forward edges are the usual S-curve. A back edge (callee left of the
 * caller: a callback, an event loop) would cut through both nodes as an S,
 * so when `backY` is given it leaves right, swings down (or up) to about
 * `backY` and comes back into the callee's left side. Still one cubic, so
 * particles follow it on the GPU.
 */
export function bezierFor(sx: number, sy: number, tx: number, ty: number, backY?: number): Bezier {
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

const geometry = new Map<number, { b: Bezier; style: EdgeStyle }>();
let version = 0;

export function setEdgeGeometry(index: number, b: Bezier, style: EdgeStyle = DEFAULT_STYLE) {
  const prev = geometry.get(index);
  if (prev && prev.b.every((v, i) => v === b[i]) && prev.style.every((v, i) => v === style[i])) return;
  geometry.set(index, { b, style });
  version++;
}

export function clearEdgeGeometry() {
  geometry.clear();
  version++;
}

export function edgeGeometryVersion() {
  return version;
}

/** Packs edges as `[p0, c0, c1, p1, style]` (12 floats) indexed by engine edge index. */
export function packEdgeGeometry(): Float32Array {
  const count = geometry.size ? Math.max(...geometry.keys()) + 1 : 0;
  const out = new Float32Array(Math.max(count, 1) * FLOATS_PER_EDGE);
  geometry.forEach(({ b, style }, i) => {
    out.set(b, i * FLOATS_PER_EDGE);
    out.set(style, i * FLOATS_PER_EDGE + 8);
  });
  return out;
}
