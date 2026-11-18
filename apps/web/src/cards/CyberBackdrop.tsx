import { useMemo } from 'react';

/**
 * The arena backdrop: a neon cyberspace. A perspective grid floor runs to a
 * glowing horizon lined with data towers, data rain falls behind, circuit
 * traces fade in overhead, and scanlines plus a vignette sit on top. Cyan
 * leans toward your system (left), magenta toward the botnet (right), with
 * yellow HUD accents. Purely decorative: no pointer events, hidden from
 * assistive tech, and still when the user prefers reduced motion.
 */
export function CyberBackdrop() {
  const towers = useMemo(() => makeTowers(), []);
  const rain = useMemo(() => makeRain(), []);
  return (
    <div aria-hidden className="cyber-backdrop pointer-events-none absolute inset-0 overflow-hidden bg-[#04050b]">
      <style>{CSS}</style>

      {/* sky: side glows and a haze over the horizon */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_40%,rgba(0,240,255,0.13),transparent_45%),radial-gradient(ellipse_at_82%_40%,rgba(255,0,110,0.14),transparent_45%),radial-gradient(ellipse_80%_30%_at_50%_58%,rgba(170,40,255,0.18),transparent_70%)]" />

      {/* circuit traces overhead */}
      <svg className="absolute inset-x-0 top-0 h-[55%] w-full opacity-[0.16] [mask-image:linear-gradient(to_bottom,black,transparent)]">
        <defs>
          <pattern id="cyber-circuit" width="160" height="120" patternUnits="userSpaceOnUse">
            <g fill="none" stroke="#00f0ff" strokeWidth="1">
              <path d="M0 20h40l14 14h46l10-10h50" />
              <path d="M20 120V84l18-18h38" />
              <path d="M110 120V96l12-12h38" />
              <path d="M60 0v12l10 10" />
              <path d="M130 0v30l-16 16H86" />
            </g>
            <g fill="#00f0ff">
              <circle cx="40" cy="20" r="2" />
              <circle cx="76" cy="66" r="2" />
              <circle cx="122" cy="84" r="2" />
              <circle cx="86" cy="46" r="2" />
              <circle cx="110" cy="24" r="2" />
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cyber-circuit)" />
      </svg>

      {/* data rain */}
      <div className="absolute inset-x-0 top-0 h-[60%] [mask-image:linear-gradient(to_bottom,black_30%,transparent)]">
        {rain.map((d, i) => (
          <span
            key={i}
            className="cyber-rain absolute top-0 w-px"
            style={{
              left: `${d.x}%`,
              height: `${d.len}px`,
              animationDuration: `${d.dur}s`,
              animationDelay: `${-d.delay}s`,
              background: `linear-gradient(to bottom, transparent, ${d.color})`,
            }}
          />
        ))}
      </div>

      {/* data towers on the horizon */}
      <svg className="absolute inset-x-0 top-[38%] h-[20%] w-full" viewBox="0 0 1000 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cyber-tower" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a0d33" />
            <stop offset="1" stopColor="#07060f" />
          </linearGradient>
        </defs>
        {towers.map((t, i) => (
          <g key={i}>
            <rect x={t.x} y={100 - t.h} width={t.w} height={t.h} fill="url(#cyber-tower)" stroke={t.edge} strokeOpacity="0.35" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
            {t.lights.map((l, k) => (
              <rect key={k} x={t.x + l.x} y={100 - t.h + l.y} width="1.2" height="0.9" fill={l.color} className={l.blink ? 'cyber-blink' : undefined} style={l.blink ? { animationDelay: `${l.delay}s` } : undefined} />
            ))}
          </g>
        ))}
      </svg>

      {/* horizon line */}
      <div className="absolute inset-x-0 top-[58%] h-px bg-gradient-to-r from-cyan-400/0 via-fuchsia-400/80 to-rose-500/0 shadow-[0_0_18px_4px_rgba(217,70,239,0.45)]" />

      {/* perspective grid floor */}
      <div className="absolute inset-x-0 bottom-0 top-[58%] overflow-hidden [perspective:420px]">
        <div className="cyber-floor absolute -inset-x-1/2 bottom-[-40%] top-0 origin-top [transform:rotateX(62deg)] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black)]" />
      </div>

      {/* scanlines and vignette */}
      <div className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.025)_0px,rgba(255,255,255,0.025)_1px,transparent_1px,transparent_3px)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.65))]" />

      {/* HUD corners */}
      <svg className="absolute left-3 top-12 size-10 text-[#fcee0a]/60" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M1 18V1h17M1 6h5" />
      </svg>
      <svg className="absolute right-3 top-12 size-10 text-[#fcee0a]/60" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M39 18V1H22M39 6h-5" />
      </svg>
      <span className="absolute left-16 top-[54px] font-mono text-[10px] tracking-[0.3em] text-cyan-300/30">NET://SECTOR-07</span>
      <span className="absolute right-16 top-[54px] font-mono text-[10px] tracking-[0.3em] text-rose-400/30">HOSTILE TRAFFIC</span>
    </div>
  );
}

const CSS = `
.cyber-floor {
  background-image:
    linear-gradient(to right, rgba(0,240,255,0.38) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,0,170,0.34) 1px, transparent 1px);
  background-size: 48px 48px;
  animation: cyber-floor 2.4s linear infinite;
  filter: drop-shadow(0 0 3px rgba(0,240,255,0.5));
}
@keyframes cyber-floor { to { background-position: 0 48px; } }
.cyber-rain { opacity: 0.55; animation: cyber-rain linear infinite; }
@keyframes cyber-rain { from { transform: translateY(-120%); } to { transform: translateY(70vh); } }
.cyber-blink { animation: cyber-blink 2.6s steps(1) infinite; }
@keyframes cyber-blink { 50% { opacity: 0.15; } }
@media (prefers-reduced-motion: reduce) {
  .cyber-backdrop * { animation: none !important; }
}
`;

/** Small deterministic PRNG so the skyline is the same on every render. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function makeTowers() {
  const r = rng(2077);
  const out: { x: number; w: number; h: number; edge: string; lights: { x: number; y: number; color: string; blink: boolean; delay: number }[] }[] = [];
  let x = 0;
  while (x < 1000) {
    const w = 8 + r() * 22;
    // taller toward the edges, low in the middle so the arena center stays calm
    const edgeBias = Math.abs(x / 1000 - 0.5) * 2;
    const h = 12 + r() * 40 + edgeBias * 45;
    const side = x < 500 ? '#00f0ff' : '#ff2a6d';
    const lights = [];
    const n = Math.floor((w * h) / 90);
    for (let k = 0; k < n; k++) {
      const pick = r();
      lights.push({
        x: 1 + r() * (w - 2.5),
        y: 2 + r() * (h - 3),
        color: pick < 0.12 ? '#fcee0a' : side,
        blink: r() < 0.15,
        delay: r() * 2.6,
      });
    }
    out.push({ x, w, h: Math.min(h, 100), edge: side, lights });
    x += w + 1 + r() * 6;
  }
  return out;
}

function makeRain() {
  const r = rng(77);
  return Array.from({ length: 26 }, () => ({
    x: r() * 100,
    len: 40 + r() * 120,
    dur: 3 + r() * 5,
    delay: r() * 8,
    color: r() < 0.5 ? 'rgba(0,240,255,0.7)' : r() < 0.8 ? 'rgba(255,42,109,0.6)' : 'rgba(252,238,10,0.6)',
  }));
}
