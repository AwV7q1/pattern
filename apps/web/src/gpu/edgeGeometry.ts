// Edge geometry registry shared by the React Flow edge component (which draws
// the SVG path) and the GPU renderer (which moves particles along the same
// cubic bezier), so both always match exactly.

export type Bezier = [number, number, number, number, number, number, number, number];

export function bezierFor(sx: number, sy: number, tx: number, ty: number): Bezier {
  const dx = Math.max(Math.abs(tx - sx) * 0.5, 40);
  return [sx, sy, sx + dx, sy, tx - dx, ty, tx, ty];
}

export function bezierPath(b: Bezier): string {
  return `M ${b[0]},${b[1]} C ${b[2]},${b[3]} ${b[4]},${b[5]} ${b[6]},${b[7]}`;
}

const geometry = new Map<number, Bezier>();
let version = 0;

export function setEdgeGeometry(index: number, b: Bezier) {
  const prev = geometry.get(index);
  if (prev && prev.every((v, i) => v === b[i])) return;
  geometry.set(index, b);
  version++;
}

export function clearEdgeGeometry() {
  geometry.clear();
  version++;
}

export function edgeGeometryVersion() {
  return version;
}

/** Packs edges as `[p0, c0, c1, p1]` vec2 quads indexed by engine edge index. */
export function packEdgeGeometry(): Float32Array {
  const count = geometry.size ? Math.max(...geometry.keys()) + 1 : 0;
  const out = new Float32Array(Math.max(count, 1) * 8);
  geometry.forEach((b, i) => out.set(b, i * 8));
  return out;
}
