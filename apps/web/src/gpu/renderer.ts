import { PARTICLE_SHADER } from './particleShader';

const CAPACITY = 1 << 18; // particles alive in the ring buffer
const FLOATS_PER_PARTICLE = 4;
const MAX_EDGES = 1024;
const MIN_VISUAL_SECONDS = 0.45; // real seconds a particle takes to cross an edge

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * GPU-driven particle renderer. Particles are written once into a ring
 * buffer; the vertex shader derives each particle's position from the
 * current simulated time, so per-frame CPU work is O(new events), not
 * O(live particles).
 */
export class ParticleRenderer {
  private head = 0;
  /** Recent uploads, oldest first, to know which ring slots can still be visible. */
  private batches: Array<{ simSeconds: number; count: number }> = [];
  private live = 0;
  private uniforms = new Float32Array(8);
  private width = 1;
  private height = 1;
  lost = false;

  /** Number of instances drawn last frame (for diagnostics). */
  get liveParticles() {
    return this.live;
  }

  private constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private canvas: HTMLCanvasElement,
    private pipeline: GPURenderPipeline,
    private bindGroup: GPUBindGroup,
    private uniformBuffer: GPUBuffer,
    private particleBuffer: GPUBuffer,
    private edgeBuffer: GPUBuffer,
  ) {
    this.reset();
  }

  static async create(canvas: HTMLCanvasElement): Promise<ParticleRenderer | null> {
    if (!('gpu' in navigator)) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
      // COPY_SRC lets tests read frames back (headless browsers cannot screenshot WebGPU)
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const module = device.createShaderModule({ code: PARTICLE_SHADER });
    const additive: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: additive, alpha: additive } }] },
      primitive: { topology: 'triangle-list' },
    });

    const uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const particleBuffer = device.createBuffer({
      size: CAPACITY * FLOATS_PER_PARTICLE * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const edgeBuffer = device.createBuffer({
      size: MAX_EDGES * 8 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffer } },
        { binding: 2, resource: { buffer: edgeBuffer } },
      ],
    });

    const renderer = new ParticleRenderer(
      device, context, canvas, pipeline, bindGroup, uniformBuffer, particleBuffer, edgeBuffer,
    );
    device.lost.then((info) => {
      if (info.reason !== 'destroyed') console.warn('WebGPU device lost:', info.message);
      renderer.lost = true;
    });
    return renderer;
  }

  /** Clears all particles (t0 = -1 marks a slot as empty). */
  reset() {
    const empty = new Float32Array(CAPACITY * FLOATS_PER_PARTICLE);
    for (let i = 1; i < empty.length; i += FLOATS_PER_PARTICLE) empty[i] = -1;
    this.device.queue.writeBuffer(this.particleBuffer, 0, empty);
    this.head = 0;
    this.batches = [];
    this.live = 0;
  }

  setEdges(packed: Float32Array) {
    const data = packed.subarray(0, MAX_EDGES * 8);
    // Storage-bound arrayLength() is the full buffer, so pad unused edges
    // with zeros; particles never reference them.
    const full = new Float32Array(MAX_EDGES * 8);
    full.set(data);
    this.device.queue.writeBuffer(this.edgeBuffer, 0, full);
  }

  /**
   * Appends `[edge, t0, dur, kind]` quads to the ring buffer. `simSeconds` is
   * the simulated time of the newest particle in the batch.
   */
  push(particles: Float32Array<ArrayBuffer>, simSeconds: number) {
    let count = particles.length / FLOATS_PER_PARTICLE;
    if (count === 0) return;
    let src = particles;
    if (count > CAPACITY) {
      src = particles.subarray((count - CAPACITY) * FLOATS_PER_PARTICLE);
      count = CAPACITY;
    }
    const first = Math.min(count, CAPACITY - this.head);
    this.device.queue.writeBuffer(
      this.particleBuffer, this.head * FLOATS_PER_PARTICLE * 4, src, 0, first * FLOATS_PER_PARTICLE,
    );
    if (count > first) {
      this.device.queue.writeBuffer(
        this.particleBuffer, 0, src, first * FLOATS_PER_PARTICLE, (count - first) * FLOATS_PER_PARTICLE,
      );
    }
    this.head = (this.head + count) % CAPACITY;
    this.batches.push({ simSeconds, count });
    this.live = Math.min(this.live + count, CAPACITY);
  }

  /** Drops batches that can no longer be on screen. */
  private expire(now: number, maxVisible: number) {
    while (this.batches.length && this.batches[0].simSeconds < now - maxVisible) {
      this.live -= this.batches.shift()!.count;
    }
    this.live = Math.max(0, Math.min(this.live, CAPACITY));
  }

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    this.width = Math.max(1, cssWidth);
    this.height = Math.max(1, cssHeight);
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  }

  render(simSeconds: number, speed: number, viewport: Viewport) {
    if (this.lost) return;
    const minDur = MIN_VISUAL_SECONDS * speed;
    // particles last max(minDur, edge latency); 1 s of slack covers slow edges
    this.expire(simSeconds, minDur + 1);
    const u = this.uniforms;
    u[0] = simSeconds;
    u[1] = minDur;
    u[2] = viewport.zoom;
    u[3] = 2.4;
    u[4] = viewport.x;
    u[5] = viewport.y;
    u[6] = this.width;
    u[7] = this.height;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    // Draw only the live tail of the ring: [head - live, head), wrapping.
    const start = (this.head - this.live + CAPACITY) % CAPACITY;
    const first = Math.min(this.live, CAPACITY - start);
    if (first > 0) pass.draw(6, first, 0, start);
    if (this.live > first) pass.draw(6, this.live - first, 0, 0);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy() {
    this.particleBuffer.destroy();
    this.edgeBuffer.destroy();
    this.uniformBuffer.destroy();
    this.device.destroy();
  }
}
