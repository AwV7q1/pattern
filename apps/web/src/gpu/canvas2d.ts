import { MIN_VISUAL_SECONDS, type ParticleSink, type Viewport } from './renderer';

const CAPACITY = 1 << 16;
const MAX_DRAWN = 30_000; // keep the CPU path interactive
const COLORS = ['rgba(77,179,255,0.9)', 'rgba(77,242,140,0.9)', 'rgba(255,71,71,0.95)', 'rgba(255,158,38,0.95)'];

/**
 * CPU fallback for browsers without WebGPU. Same data and same maths as the
 * WGSL shader (cubic bezier, opposite lanes for responses), just evaluated in
 * JS and drawn with Canvas2D, so it handles fewer particles.
 */
export class Canvas2DRenderer implements ParticleSink {
  private ring = new Float32Array(CAPACITY * 4);
  private head = 0;
  private live = 0;
  private batches: Array<{ simSeconds: number; count: number }> = [];
  private edges = new Float32Array(0);
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 1;
  private height = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D unavailable');
    this.ctx = ctx;
  }

  get liveParticles() {
    return this.live;
  }

  reset() {
    this.head = 0;
    this.live = 0;
    this.batches = [];
  }

  setEdges(packed: Float32Array) {
    this.edges = packed.slice();
  }

  push(particles: Float32Array<ArrayBuffer>, simSeconds: number) {
    let count = particles.length / 4;
    if (!count) return;
    let src = particles;
    if (count > CAPACITY) {
      src = particles.subarray((count - CAPACITY) * 4);
      count = CAPACITY;
    }
    const first = Math.min(count, CAPACITY - this.head);
    this.ring.set(src.subarray(0, first * 4), this.head * 4);
    if (count > first) this.ring.set(src.subarray(first * 4), 0);
    this.head = (this.head + count) % CAPACITY;
    this.batches.push({ simSeconds, count });
    this.live = Math.min(this.live + count, CAPACITY);
  }

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    this.width = Math.max(1, cssWidth);
    this.height = Math.max(1, cssHeight);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
  }

  render(now: number, speed: number, vp: Viewport) {
    const minDur = MIN_VISUAL_SECONDS * speed;
    while (this.batches.length && this.batches[0].simSeconds < now - (minDur + 1)) {
      this.live -= this.batches.shift()!.count;
    }
    this.live = Math.max(0, this.live);
    const { ctx, ring, edges } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'lighter';
    const radius = 2.4 * Math.min(Math.max(vp.zoom, 0.6), 1.6);
    const edgeCount = edges.length / 8;
    const paths = COLORS.map(() => new Path2D());
    const step = Math.max(1, Math.ceil(this.live / MAX_DRAWN));
    const start = (this.head - this.live + CAPACITY) % CAPACITY;

    for (let k = 0; k < this.live; k += step) {
      const i = ((start + k) % CAPACITY) * 4;
      const edge = ring[i];
      const t0 = ring[i + 1];
      const kind = ring[i + 3];
      let t = (now - t0) / Math.max(ring[i + 2], minDur);
      if (t < 0 || t > 1 || edge >= edgeCount) continue;
      const response = kind === 1 || kind === 2;
      if (response) t = 1 - t;
      const e = edge * 8;
      const it = 1 - t;
      const a = it * it * it, b = 3 * it * it * t, c = 3 * it * t * t, d = t * t * t;
      let x = a * edges[e] + b * edges[e + 2] + c * edges[e + 4] + d * edges[e + 6];
      let y = a * edges[e + 1] + b * edges[e + 3] + c * edges[e + 5] + d * edges[e + 7];
      // tangent -> normal offset (lanes), as in the shader
      const tx = 3 * it * it * (edges[e + 2] - edges[e]) + 6 * it * t * (edges[e + 4] - edges[e + 2]) + 3 * t * t * (edges[e + 6] - edges[e + 4]);
      const ty = 3 * it * it * (edges[e + 3] - edges[e + 1]) + 6 * it * t * (edges[e + 5] - edges[e + 3]) + 3 * t * t * (edges[e + 7] - edges[e + 5]);
      const len = Math.hypot(tx, ty) || 1;
      const lane = (response ? 3 : -3) + (((k * 2654435761) >>> 0) / 4294967295 - 0.5) * 4;
      x += (-ty / len) * lane;
      y += (tx / len) * lane;
      const sx = x * vp.zoom + vp.x;
      const sy = y * vp.zoom + vp.y;
      const r = kind === 2 ? radius * 1.6 : radius;
      const p = paths[kind] ?? paths[0];
      p.moveTo(sx + r, sy);
      p.arc(sx, sy, r, 0, Math.PI * 2);
    }
    paths.forEach((p, kind) => {
      ctx.fillStyle = COLORS[kind];
      ctx.fill(p);
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  destroy() {}
}
