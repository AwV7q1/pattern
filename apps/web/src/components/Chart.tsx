import { useEffect, useRef } from 'react';

export interface Series {
  label: string;
  color: string;
  values: number[];
}

interface Props {
  title: string;
  unit: string;
  series: Series[];
  threshold?: { value: number; label: string };
  height?: number;
}

/** Tiny dependency-free line chart (canvas). */
export function Chart({ title, unit, series, threshold, height = 96 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const n = Math.max(...series.map((s) => s.values.length), 2);
    const max = Math.max(1, threshold?.value ?? 0, ...series.flatMap((s) => s.values)) * 1.15;
    const pad = { l: 4, r: 4, t: 6, b: 4 };
    const x = (i: number) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r);
    const y = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let g = 1; g < 4; g++) {
      const gy = pad.t + (g / 4) * (h - pad.t - pad.b);
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(w - pad.r, gy);
      ctx.stroke();
    }
    if (threshold) {
      ctx.strokeStyle = 'rgba(248,113,113,0.8)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y(threshold.value));
      ctx.lineTo(w - pad.r, y(threshold.value));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const s of series) {
      if (s.values.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      s.values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.stroke();
    }
  }, [series, threshold, height]);

  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{title}</span>
        <span className="flex gap-2 font-mono">
          {series.map((s) => (
            <span key={s.label} style={{ color: s.color }}>
              {s.label} {Math.round(s.values.at(-1) ?? 0)}
              {unit}
            </span>
          ))}
        </span>
      </div>
      <canvas ref={ref} style={{ width: '100%', height }} />
    </div>
  );
}
