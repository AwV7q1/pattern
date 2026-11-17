import { useEffect, useRef, useState } from 'react';
import { useStoreApi } from '@xyflow/react';
import { ParticleRenderer } from '../gpu/renderer';
import { edgeGeometryVersion, packEdgeGeometry } from '../gpu/edgeGeometry';
import type { SimClient } from '../sim/client';

/**
 * WebGPU canvas rendered underneath React Flow. Reads the React Flow
 * viewport directly from its store each frame (no React re-renders).
 */
export function ParticleLayer({ client }: { client: SimClient }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const store = useStoreApi();
  const [status, setStatus] = useState<'init' | 'ok' | 'unsupported'>('init');

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: ParticleRenderer | null = null;
    let raf = 0;
    let disposed = false;
    let edgeVersion = -1;
    const unsubs: Array<() => void> = [];

    ParticleRenderer.create(canvas)
      .then((r) => {
        if (disposed) return r?.destroy();
        if (!r) return setStatus('unsupported');
        renderer = r;
        setStatus('ok');
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
      })
      .catch((err) => {
        console.error(err);
        setStatus('unsupported');
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unsubs.forEach((u) => u());
      renderer?.destroy();
    };
  }, [client, store]);

  return (
    <>
      <canvas ref={canvasRef} className="particle-canvas" />
      {status === 'unsupported' && (
        <div className="gpu-warning">
          Trình duyệt không hỗ trợ WebGPU: simulation và biểu đồ vẫn chạy, nhưng không có hiệu ứng particle.
        </div>
      )}
    </>
  );
}
