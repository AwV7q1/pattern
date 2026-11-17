import { useEffect, useRef, useState } from 'react';
import { useStoreApi } from '@xyflow/react';
import { ParticleRenderer, type ParticleSink } from '@/gpu/renderer';
import { Canvas2DRenderer } from '@/gpu/canvas2d';
import { edgeGeometryVersion, packEdgeGeometry } from '@/gpu/edgeGeometry';
import type { SimClient } from '@/sim/client';
import { Badge } from '@/components/ui/badge';

type Backend = 'init' | 'webgpu' | 'canvas2d';

const force2d = () => new URLSearchParams(location.search).get('renderer') === '2d';

/**
 * Particle canvas rendered underneath React Flow's nodes. Uses WebGPU when
 * available, otherwise the Canvas2D fallback (`?renderer=2d` forces it).
 * Reads the viewport straight from the React Flow store each frame.
 */
export function ParticleLayer({ client }: { client: SimClient }) {
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const cpuCanvasRef = useRef<HTMLCanvasElement>(null);
  const store = useStoreApi();
  const [backend, setBackend] = useState<Backend>('init');

  useEffect(() => {
    let renderer: ParticleSink | null = null;
    let raf = 0;
    let disposed = false;
    let edgeVersion = -1;
    const unsubs: Array<() => void> = [];

    (async () => {
      // A canvas that got a 'webgpu' context cannot give a '2d' one, so each backend has its own.
      let r: ParticleSink | null = null;
      let kind: Backend = 'canvas2d';
      let canvas = cpuCanvasRef.current!;
      if (!force2d()) {
        try {
          r = await ParticleRenderer.create(gpuCanvasRef.current!);
          if (r) {
            kind = 'webgpu';
            canvas = gpuCanvasRef.current!;
          }
        } catch (err) {
          console.warn('WebGPU init failed, using Canvas2D', err);
        }
      }
      r ??= new Canvas2DRenderer(cpuCanvasRef.current!);
      if (disposed) {
        r.destroy();
        return;
      }
      renderer = r;
      setBackend(kind);
      if (import.meta.env.DEV) Object.assign(window, { __particles: r });

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        r.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      };
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      resize();
      unsubs.push(() => ro.disconnect());
      unsubs.push(client.onTick((particles) => r.push(particles, client.currentSimMs() / 1000)));
      unsubs.push(client.onReset(() => r.reset()));

      const frame = () => {
        raf = requestAnimationFrame(frame);
        const v = edgeGeometryVersion();
        if (v !== edgeVersion) {
          edgeVersion = v;
          r.setEdges(packEdgeGeometry());
        }
        const [x, y, zoom] = store.getState().transform;
        r.render(client.currentSimMs() / 1000, client.speed, { x, y, zoom });
      };
      frame();
    })().catch((err) => console.error(err));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unsubs.forEach((u) => u());
      renderer?.destroy();
    };
  }, [client, store]);

  return (
    <>
      <canvas
        ref={gpuCanvasRef}
        className="pointer-events-none absolute inset-0 z-[1] size-full"
        hidden={backend === 'canvas2d'}
      />
      <canvas
        ref={cpuCanvasRef}
        className="pointer-events-none absolute inset-0 z-[1] size-full"
        hidden={backend !== 'canvas2d'}
      />
      {backend !== 'init' && (
        <Badge
          variant="outline"
          className="absolute top-3 left-3 z-10 bg-background/80 font-mono text-[11px] backdrop-blur"
        >
          {backend === 'webgpu' ? 'WebGPU' : 'Canvas2D fallback'}
        </Badge>
      )}
    </>
  );
}
