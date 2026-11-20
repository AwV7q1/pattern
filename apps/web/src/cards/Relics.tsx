// Relics: icons, the bar shown in the run and battle top bars, and a large tile for picks.

import { useEffect, useState } from 'react';
import {
  Activity,
  BellRing,
  Cable,
  Cpu,
  PiggyBank,
  BookOpen,
  Bookmark,
  CalendarClock,
  Coffee,
  Earth,
  Flame,
  Gauge,
  Gem,
  Globe,
  ListX,
  Network,
  Ship,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RelicDef, RelicRarity } from './types';

const RELIC_ICON: Record<string, LucideIcon> = {
  gauge: Gauge,
  calendar: CalendarClock,
  book: BookOpen,
  list: ListX,
  bell: BellRing,
  globe: Globe,
  trending: TrendingUp,
  flame: Flame,
  coffee: Coffee,
  bookmark: Bookmark,
  activity: Activity,
  ship: Ship,
  earth: Earth,
  network: Network,
  cable: Cable,
  cpu: Cpu,
  piggy: PiggyBank,
};

export const RELIC_RARITY: Record<RelicRarity, { label: string; tone: string }> = {
  common: { label: 'Thường', tone: 'border-zinc-400/50 text-zinc-200' },
  uncommon: { label: 'Ít gặp', tone: 'border-sky-400/60 text-sky-300' },
  rare: { label: 'Hiếm', tone: 'border-amber-400/70 text-amber-300' },
  boss: { label: 'Trùm', tone: 'border-rose-400/70 text-rose-300' },
};

const relicIcon = (r: RelicDef) => RELIC_ICON[r.icon] ?? Gem;

/** Small round icons with a tooltip; relics in `fired` pulse once. */
export function RelicBar({ relics, ids, fired = [] }: { relics: RelicDef[]; ids: string[]; fired?: string[] }) {
  // replay the pulse every time the list of fired relics changes
  const [pulse, setPulse] = useState<{ key: number; ids: string[] }>({ key: 0, ids: [] });
  const firedKey = fired.join(',');
  useEffect(() => {
    if (firedKey) setPulse((p) => ({ key: p.key + 1, ids: firedKey.split(',') }));
  }, [firedKey]);
  if (!ids.length) return null;
  return (
    <div className="flex items-center gap-1" aria-label="Relic">
      {ids.map((id) => {
        const r = relics.find((x) => x.id === id);
        if (!r) return null;
        const Icon = relicIcon(r);
        const on = pulse.ids.includes(id);
        return (
          <span
            key={on ? `${id}:${pulse.key}` : id}
            title={`${r.name}: ${r.text}`}
            className={cn(
              'flex size-7 items-center justify-center rounded-full border bg-background/70',
              RELIC_RARITY[r.rarity].tone,
              on && 'animate-[relic-pulse_700ms_ease-out]',
            )}
          >
            <Icon className="size-3.5" />
          </span>
        );
      })}
    </div>
  );
}

/** A large relic tile (elite drop, boss pick, shop). */
export function RelicTile({ relic, selected, children }: { relic: RelicDef; selected?: boolean; children?: React.ReactNode }) {
  const Icon = relicIcon(relic);
  const rarity = RELIC_RARITY[relic.rarity];
  return (
    <div
      className={cn(
        'flex w-[220px] flex-col items-center gap-2 rounded-2xl border bg-card/85 p-4 text-center',
        selected ? 'border-amber-300 ring-2 ring-amber-300/60' : 'border-border',
      )}
    >
      <span className={cn('flex size-14 items-center justify-center rounded-full border-2 bg-background/70', rarity.tone)}>
        <Icon className="size-7" />
      </span>
      <span className="font-semibold">{relic.name}</span>
      <span className={cn('text-[10px] uppercase tracking-wider', rarity.tone.split(' ').at(-1))}>{rarity.label}</span>
      <span className="text-sm">{relic.text}</span>
      <span className="text-xs italic text-muted-foreground">{relic.lesson}</span>
      {children}
    </div>
  );
}
