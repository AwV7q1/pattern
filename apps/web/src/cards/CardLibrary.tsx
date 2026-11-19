import { useMemo, useState } from 'react';
import { LibraryBig, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CardDef, CardType } from './types';
import { CardFace, TYPE_STYLE } from './Hand';
import { TYPE_ICON } from './cardArt';

const TYPE_ORDER: CardType[] = ['infra', 'policy', 'action', 'attack', 'curse'];

type Filter = 'all' | 'deck' | CardType;

/**
 * Every card in the game, grouped by type and sorted by cost, with how many
 * copies the starting deck holds. Read-only: it opens over the battle.
 */
export function CardLibrary({ cards, deck, onClose }: { cards: CardDef[]; deck: string[]; onClose: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const copies = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of deck) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [deck]);

  const sorted = useMemo(
    () => [...cards].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.cost - b.cost || a.name.localeCompare(b.name, 'vi')),
    [cards],
  );
  const shown = sorted.filter((c) => (filter === 'all' ? true : filter === 'deck' ? copies.has(c.id) : c.type === filter));

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'Tất cả', count: cards.length },
    { id: 'deck', label: 'Trong bộ bài', count: copies.size },
    ...TYPE_ORDER.map((t) => ({ id: t as Filter, label: TYPE_STYLE[t].label, count: cards.filter((c) => c.type === t).length })),
  ];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Thư viện thẻ bài">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <LibraryBig className="size-5 text-amber-300" />
        <h2 className="text-base font-semibold">Thư viện thẻ bài</h2>
        <span className="text-sm text-muted-foreground">
          {cards.length} loại · bộ khởi đầu {deck.length} lá
        </span>
        <div className="flex flex-wrap gap-1.5 md:ml-4">
          {chips.map((c) => {
            const Icon = c.id in TYPE_STYLE ? TYPE_ICON[c.id as CardType] : null;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setFilter(c.id)}
                aria-pressed={filter === c.id}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  filter === c.id ? 'border-amber-300/70 bg-amber-400/15 text-amber-200' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {Icon && <Icon className="size-3" />}
                {c.label}
                <span className="font-mono opacity-60">{c.count}</span>
              </button>
            );
          })}
        </div>
        <Button size="icon" variant="ghost" className="ml-auto" aria-label="Đóng thư viện" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto grid max-w-[1400px] grid-cols-[repeat(auto-fill,minmax(176px,1fr))] justify-items-center gap-x-4 gap-y-6">
          {shown.map((c) => {
            const n = copies.get(c.id) ?? 0;
            return (
              <div key={c.id} className="flex flex-col items-center gap-2">
                <div className="h-[300px] w-[176px] transition-transform duration-200 hover:-translate-y-1">
                  <CardFace def={c} playable lesson />
                </div>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px]',
                    n > 0 ? 'bg-amber-400/15 text-amber-200' : c.unplayable ? 'bg-zinc-500/15 text-zinc-400' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {n > 0 ? `Trong bộ ×${n}` : c.unplayable ? 'Do địch nhét vào' : 'Chưa có trong bộ'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
