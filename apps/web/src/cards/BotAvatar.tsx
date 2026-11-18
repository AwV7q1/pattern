import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * The botnet: a robot head inside a swarm of infected nodes. It cracks and
 * flickers as its HP drops.
 */
export const BotAvatar = forwardRef<HTMLDivElement, { hpRatio: number; className?: string }>(function BotAvatar(
  { hpRatio, className },
  ref,
) {
  const hurt = hpRatio < 0.5;
  const dying = hpRatio < 0.25;
  const eye = dying ? '#fbbf24' : '#fb7185';
  return (
    <div ref={ref} className={cn('relative size-44', className)}>
      <svg viewBox="0 0 160 160" className="size-full overflow-visible" aria-hidden>
        <defs>
          <radialGradient id="bot-aura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.45" />
            <stop offset="60%" stopColor="#f43f5e" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bot-head" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3f3f46" />
            <stop offset="100%" stopColor="#18181b" />
          </linearGradient>
          <filter id="bot-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="80" cy="80" r="80" fill="url(#bot-aura)" />

        {/* swarm of infected machines */}
        <g style={{ transformOrigin: '80px 80px', animation: 'spin 18s linear infinite' }}>
          <circle cx="80" cy="80" r="70" fill="none" stroke="#f43f5e" strokeOpacity="0.18" strokeDasharray="2 6" />
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return <rect key={i} x={80 + 70 * Math.cos(a) - 3} y={80 + 70 * Math.sin(a) - 3} width="6" height="6" rx="1.5" fill="#fb7185" opacity={i % 3 === 0 ? 0.9 : 0.45} />;
          })}
        </g>
        <g style={{ transformOrigin: '80px 80px', animation: 'spin 11s linear infinite reverse' }}>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2 + 0.4;
            return <circle key={i} cx={80 + 56 * Math.cos(a)} cy={80 + 56 * Math.sin(a)} r="2" fill="#fda4af" opacity="0.6" />;
          })}
        </g>

        {/* antenna */}
        <line x1="80" y1="46" x2="80" y2="30" stroke="#71717a" strokeWidth="3" strokeLinecap="round" />
        <circle cx="80" cy="26" r="5" fill="#fb7185" filter="url(#bot-glow)" className="animate-pulse" />

        {/* ears */}
        <rect x="34" y="68" width="8" height="22" rx="3" fill="#27272a" stroke="#f43f5e" strokeOpacity="0.5" />
        <rect x="118" y="68" width="8" height="22" rx="3" fill="#27272a" stroke="#f43f5e" strokeOpacity="0.5" />

        {/* head */}
        <rect x="42" y="46" width="76" height="68" rx="18" fill="url(#bot-head)" stroke="#f43f5e" strokeWidth="2" strokeOpacity="0.8" />
        <rect x="50" y="58" width="60" height="34" rx="10" fill="#09090b" />

        {/* eyes: narrow, angry slits */}
        <g filter="url(#bot-glow)" className={dying ? 'animate-pulse' : undefined}>
          <path d="M57 70 L74 74 L74 80 L57 79 Z" fill={eye} />
          <path d="M103 70 L86 74 L86 80 L103 79 Z" fill={eye} />
        </g>

        {/* mouth grill */}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={62 + i * 8} y="99" width="4" height="8" rx="1" fill="#52525b" />
        ))}

        {/* damage */}
        {hurt && <path d="M108 50 L100 62 L106 66 L96 80" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" />}
        {dying && (
          <>
            <path d="M48 98 L58 92 L54 86" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="112" cy="40" r="3" fill="#71717a" opacity="0.6" className="animate-ping" />
          </>
        )}
      </svg>
    </div>
  );
});
