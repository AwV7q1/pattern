import { useMemo } from 'react';

/**
 * The arena backdrop: a quiet network map. A faint dot grid, a few network
 * nodes joined by thin links with packets drifting along them, and the two
 * side glows (your system cyan, the botnet rose). Everything stays low
 * contrast and fades out around the middle, so cards and numbers read
 * first. Decorative only; motion stops under prefers-reduced-motion.
 */
export function NetBackdrop() {
  const net = useMemo(() => makeNet(), []);
  return (
    <div aria-hidden className="net-backdrop pointer-events-none absolute inset-0 overflow-hidden">
      <style>{CSS}</style>
      {/* side glows */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_22%_45%,rgba(56,189,248,0.09),transparent_50%),radial-gradient(ellipse_at_80%_45%,rgba(244,63,94,0.10),transparent_45%)]" />
      {/* dot grid, clear in the middle */}
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1.5px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_55%_50%_at_50%_45%,transparent_30%,black)]" />
      {/* network map */}
      <svg className="absolute inset-0 size-full [mask-image:radial-gradient(ellipse_50%_45%_at_50%_45%,transparent_35%,black_85%)]" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        <g stroke="rgba(255,255,255,0.07)" strokeWidth="1" fill="none">
          {net.links.map((l, i) => (
            <path key={i} id={`net-link-${i}`} d={`M${l.a.x} ${l.a.y}L${l.b.x} ${l.b.y}`} />
          ))}
        </g>
        {net.links.map((l, i) =>
          l.packet ? (
            <circle key={i} r="1.8" fill={l.color} opacity="0.55">
              <animateMotion dur={`${l.dur}s`} begin={`${-l.delay}s`} repeatCount="indefinite">
                <mpath href={`#net-link-${i}`} />
              </animateMotion>
            </circle>
          ) : null,
        )}
        {net.nodes.map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={n.r + 3} fill={n.color} opacity="0.06" />
            <circle cx={n.x} cy={n.y} r={n.r} fill="none" stroke={n.color} strokeOpacity="0.35" />
            <circle cx={n.x} cy={n.y} r="1.2" fill={n.color} opacity="0.5" />
          </g>
        ))}
      </svg>
      {/* soft vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,rgba(0,0,0,0.45))]" />
    </div>
  );
}

const CSS = `
@media (prefers-reduced-motion: reduce) {
  .net-backdrop animateMotion { display: none; }
  .net-backdrop circle[opacity="0.55"] { display: none; }
}
`;

/** Small deterministic PRNG so the map is the same on every render. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function makeNet() {
  const r = rng(42);
  const nodes: { x: number; y: number; r: number; color: string }[] = [];
  // scatter nodes on a loose grid, skipping the middle of the arena
  for (let gx = 0; gx < 9; gx++) {
    for (let gy = 0; gy < 6; gy++) {
      if (r() < 0.45) continue;
      const x = 40 + gx * 115 + (r() - 0.5) * 70;
      const y = 30 + gy * 105 + (r() - 0.5) * 60;
      const dx = (x - 500) / 500;
      const dy = (y - 270) / 300;
      if (dx * dx + dy * dy < 0.18) continue;
      nodes.push({ x, y, r: 2.5 + r() * 2.5, color: x < 500 ? '#7dd3fc' : '#fda4af' });
    }
  }
  // link each node to its two nearest neighbours
  const links: { a: (typeof nodes)[number]; b: (typeof nodes)[number]; packet: boolean; dur: number; delay: number; color: string }[] = [];
  const seen = new Set<string>();
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter((o) => o.j !== i && o.d < 190)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
      .forEach(({ j, d }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        links.push({ a, b: nodes[j], packet: r() < 0.35, dur: d / 22, delay: r() * 8, color: a.color });
      });
  });
  return { nodes, links };
}
