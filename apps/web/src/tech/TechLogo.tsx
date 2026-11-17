import { cn } from '@/lib/utils';
import type { Tech } from './types';

/** Relative luminance of a `RRGGBB` colour (0 black … 1 white). */
function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Brand colour, lifted to white when it would vanish on the dark theme. */
export function brandColor(hex: string) {
  return luminance(hex) < 0.06 ? '#e4e4e7' : `#${hex}`;
}

/** Brand logo (simple-icons path) or a monogram tile. */
export function TechLogo({ tech, className, tile = true }: { tech: Tech; className?: string; tile?: boolean }) {
  const color = brandColor(tech.logo.hex);
  const box = cn('flex shrink-0 items-center justify-center rounded-md', className ?? 'size-6');
  if (tech.logo.path) {
    return (
      <span className={box} style={tile ? { background: `${color}22` } : undefined}>
        <svg viewBox="0 0 24 24" className="size-[62%]" fill={color} aria-label={tech.name} role="img">
          <path d={tech.logo.path} />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={cn(box, 'font-bold tracking-tight text-white')}
      style={{ background: `#${tech.logo.hex}`, containerType: 'size' }}
      aria-label={tech.name}
      role="img"
    >
      <span className="leading-none" style={{ fontSize: (tech.logo.mono?.length ?? 1) > 2 ? '34cqw' : '44cqw' }}>
        {tech.logo.mono}
      </span>
    </span>
  );
}
