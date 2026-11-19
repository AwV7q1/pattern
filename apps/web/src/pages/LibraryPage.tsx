import { useMemo, useState } from 'react';
import { Check, GitCompareArrows, Library, Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TECHS } from '@/tech/catalog';
import { TechLogo } from '@/tech/TechLogo';
import { CATEGORIES } from '@/tech/types';
import { MAX_COMPARE, techUi, useTechUi } from '@/tech/ui-store';
import { BackLink } from '@/components/BackLink';

/** `/library`: every technology of the catalog, with details and comparison. */
export function LibraryPage() {
  const ui = useTechUi();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        ...c,
        items: TECHS.filter(
          (t) => t.category === c.id && (!q || `${t.name} ${t.vendor} ${t.summary}`.toLowerCase().includes(q)),
        ),
      })).filter((g) => g.items.length),
    [q],
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8">
        <BackLink to="/studio" label="Studio" className="-mb-4 -ml-3 justify-self-start" />
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Library className="size-5" /> Thư viện công nghệ
            </h1>
            <p className="text-sm text-muted-foreground">
              {TECHS.length} công nghệ thật với điểm mạnh/yếu và số mô phỏng mặc định. Kéo thả vào canvas trong Studio.
            </p>
          </div>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Tìm công nghệ…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Button variant="secondary" disabled={ui.compare.length < 2} onClick={() => techUi.openCompare()}>
            <GitCompareArrows /> So sánh ({ui.compare.length}/{MAX_COMPARE})
          </Button>
        </div>
        {groups.map((g) => (
          <section key={g.id} className="grid gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{g.name}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((t) => {
                const selected = ui.compare.includes(t.id);
                return (
                  <div key={t.id} className={cn('grid gap-2 rounded-lg border p-3', selected && 'border-primary/60')}>
                    <div className="flex items-center gap-2">
                      <TechLogo tech={t} className="size-8" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{t.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{t.vendor}</div>
                      </div>
                      <Badge variant="secondary">{t.license}</Badge>
                    </div>
                    <p className="line-clamp-3 text-sm text-muted-foreground">{t.summary}</p>
                    <div className="mt-auto flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => techUi.openSheet(t.id)}>
                        Chi tiết
                      </Button>
                      <Button size="sm" variant={selected ? 'secondary' : 'ghost'} onClick={() => techUi.toggleCompare(t.id)}>
                        {selected ? <Check /> : <Plus />} So sánh
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
