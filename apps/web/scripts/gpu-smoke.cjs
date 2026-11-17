// WebGPU renderer smoke test.
//
// Headless browsers generally cannot screenshot a WebGPU canvas, so this test
// renders into an offscreen texture and reads the pixels back with
// copyTextureToBuffer, then checks where particles landed.
//
// Usage: start `pnpm dev` (port 5173), then `node scripts/gpu-smoke.cjs`.
// Requires the `playwright` package and a Chromium build with WebGPU.
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({
    channel: 'chromium',
    args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-webgpu-adapter=swiftshader'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error('[browser]', m.text()));
  await page.route(`${BASE}/__gpu-smoke`, (r) => r.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto(`${BASE}/__gpu-smoke`);

  const result = await page.evaluate(async () => {
    const { ParticleRenderer } = await import('/src/gpu/renderer.ts');
    const W = 512, H = 200; // W * 4 bytes is a multiple of 256 (copy row alignment)
    let tex = null;
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        configure({ device, format }) {
          tex = device.createTexture({
            size: [W, H], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          });
        },
        getCurrentTexture: () => tex,
      }),
    };
    const r = await ParticleRenderer.create(fakeCanvas);
    if (!r) return { error: 'WebGPU unavailable' };
    const errors = [];
    r.device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
    r.resize(W, H, 1);
    r.setEdges(new Float32Array([50, 100, 183.33, 100, 316.67, 100, 450, 100])); // straight line
    r.push(new Float32Array([
      0, 0.0, 1.0, 0,  // request, t = 0.5 -> x = 250, upper lane
      0, 0.25, 1.0, 2, // error response, t = 0.25 reversed -> x = 350, lower lane
      0, 0.0, 0.1, 1,  // expired
      0, 0.9, 1.0, 0,  // not started
    ]), 0.5);

    const blobs = async () => {
      const buf = r.device.createBuffer({ size: W * 4 * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = r.device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: W * 4 }, [W, H]);
      r.device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const px = new Uint8Array(buf.getMappedRange().slice(0));
      buf.unmap();
      const bgra = tex.format.startsWith('bgra');
      const out = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (px[i + 3] < 30) continue;
          const red = bgra ? px[i + 2] : px[i];
          const blue = bgra ? px[i] : px[i + 2];
          let b = out.find((o) => Math.abs(o.x / o.n - x) < 20);
          if (!b) out.push((b = { x: 0, y: 0, n: 0, red: 0, blue: 0 }));
          b.x += x; b.y += y; b.n++; b.red += red; b.blue += blue;
        }
      }
      return out.map((b) => ({ x: b.x / b.n, y: b.y / b.n, color: b.red > b.blue ? 'red' : 'blue' }));
    };

    r.render(0.5, 1, { x: 0, y: 0, zoom: 1 });
    const active = await blobs();
    const liveActive = r.liveParticles;
    r.render(10, 1, { x: 0, y: 0, zoom: 1 });
    const later = await blobs();
    return { active, liveActive, later, liveLater: r.liveParticles, errors };
  });
  await browser.close();

  const checks = [];
  const check = (name, ok) => checks.push({ name, ok });
  if (result.error) {
    console.error(result.error);
    process.exit(2);
  }
  const [a, b] = [...(result.active ?? [])].sort((p, q) => p.x - q.x);
  check('no GPU validation errors', result.errors.length === 0);
  check('exactly two visible particles', result.active.length === 2);
  check('request at x≈250, upper lane, blue', a && Math.abs(a.x - 250) < 3 && a.y < 100 && a.color === 'blue');
  check('error response at x≈350, lower lane, red', b && Math.abs(b.x - 350) < 3 && b.y > 100 && b.color === 'red');
  check('expired batches leave the live range', result.liveActive === 4 && result.liveLater === 0);
  check('nothing drawn after expiry', result.later.length === 0);

  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (result.errors.length) console.log(result.errors);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
})();
