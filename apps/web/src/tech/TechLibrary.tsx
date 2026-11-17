import { useMemo, useState, type DragEvent } from 'react';
import { ChevronRight, GitCompareArrows, Info, Plus, Search, X, Check } from 'lucide-react';
import { KIND_META } from '@/lib/meta';
import { cn } from '@/lib/utils';
import type { NodeKind } from '@/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DRAG_MIME } from '@/components/Palette';
import { TECHS, TECH_BY_ID } from './catalog';
import { TechLogo } from './TechLogo';
import { CATEGORIES, type Tech } from './types';
import { techUi, useTechUi } from './ui-store';
import { GROUP_KINDS } from '@/projects/groups';
import type { DesignGroup } from '@/projects/store';

export const TECH_MIME = 'application/x-pattern-tech';
export const GROUP_MIME = 'application/x-pattern-group';

const GENERIC: NodeKind[] = ['loadBalancer', 'service', 'cache', 'database', 'queue'];

function startDrag(e: DragEvent, kind: NodeKind, tech?: string) {
  e.dataTransfer.setData(DRAG_MIME, kind);
  if (tech) e.dataTransfer.setData(TECH_MIME, tech);
  e.dataTransfer.effectAllowed = 'move';
}

function TechRow({ tech, inCompare }: { tech: Tech; inCompare: boolean }) {
  return (
    <div
      draggable
      onDragStart={(e) => startDrag(e, tech.kind, tech.id)}
      className="group flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-sm select-none hover:bg-accent active:cursor-grabbing"
      title={tech.summary}
    >
      <TechLogo tech={tech} className="size-6" />
      <span className="min-w-0 flex-1 truncate">{tech.name}</span>
      <button
        aria-label={inCompare ? 'Bỏ khỏi so sánh' : 'Thêm vào so sánh'}
        onClick={() => techUi.toggleCompare(tech.id)}
        className={cn(
          'rounded p-0.5 text-muted-foreground hover:text-foreground',
          inCompare ? 'text-primary opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        {inCompare ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
      </button>
      <button
        aria-label="Chi tiết"
        onClick={() => techUi.openSheet(tech.id)}
        className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
      >
        <Info className="size-3.5" />
      </button>
    </div>
  );
}

/** Sandbox palette: real-world technologies grouped by category, searchable. */
export function TechLibrary() {
  const ui = useTechUi();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ gateway: true, runtime: true, cache: true, database: true, queue: true });
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        ...c,
        items: TECHS.filter(
          (t) =>
            t.category === c.id &&
            (!q || `${t.name} ${t.vendor} ${t.summary} ${t.id}`.toLowerCase().includes(q)),
        ),
      })).filter((g) => g.items.length),
    [q],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm Redis, Kafka, Postgres…"
          className="h-8 pl-7 text-xs"
        />
        {query && (
          <button className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" onClick={() => setQuery('')}>
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {groups.map((g) => {
          const expanded = !!q || open[g.id];
          return (
            <div key={g.id} className="mb-1">
              <button
                className="flex w-full items-center gap-1 px-1 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
                onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))}
              >
                <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
                {g.name}
                <span className="ml-auto font-mono text-[10px] normal-case">{g.items.length}</span>
              </button>
              {expanded && g.id === 'k8s' && !q && (
                <div className="mb-1 grid grid-cols-2 gap-1 px-1">
                  {(Object.keys(GROUP_KINDS) as DesignGroup['kind'][]).map((k) => (
                    <div
                      key={k}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(GROUP_MIME, k);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      title={`${GROUP_KINDS[k].hint}. Kéo vào canvas, rồi kéo node vào trong khung.`}
                      className="cursor-grab rounded-md border-2 border-dashed px-2 py-1 text-[11px] select-none hover:bg-accent"
                      style={{ borderColor: `${GROUP_KINDS[k].color}88`, color: GROUP_KINDS[k].color }}
                    >
                      {GROUP_KINDS[k].name}
                    </div>
                  ))}
                </div>
              )}
              {expanded && g.items.map((t) => <TechRow key={t.id} tech={t} inCompare={ui.compare.includes(t.id)} />)}
            </div>
          );
        })}
        {!q && (
          <div className="mb-1">
            <button
              className="flex w-full items-center gap-1 px-1 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
              onClick={() => setOpen((o) => ({ ...o, generic: !o.generic }))}
            >
              <ChevronRight className={cn('size-3 transition-transform', open.generic && 'rotate-90')} />
              Chung (trừu tượng)
            </button>
            {open.generic &&
              GENERIC.map((kind) => {
                const meta = KIND_META[kind];
                const Icon = meta.icon;
                return (
                  <div
                    key={kind}
                    draggable
                    onDragStart={(e) => startDrag(e, kind)}
                    title={meta.blurb}
                    className="flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-sm select-none hover:bg-accent"
                  >
                    <span className="flex size-6 items-center justify-center rounded-md" style={{ background: `${meta.color}26`, color: meta.color }}>
                      <Icon className="size-3.5" />
                    </span>
                    {meta.name}
                  </div>
                );
              })}
          </div>
        )}
        {groups.length === 0 && <p className="px-1 py-4 text-xs text-muted-foreground">Không tìm thấy “{query}”.</p>}
      </div>

      {ui.compare.length > 0 && (
        <div className="grid gap-2 rounded-md border bg-card p-2">
          <div className="flex items-center gap-1">
            {ui.compare.map((id) => (
              <button key={id} onClick={() => techUi.toggleCompare(id)} title={`Bỏ ${TECH_BY_ID[id]?.name}`}>
                <TechLogo tech={TECH_BY_ID[id]} className="size-6" />
              </button>
            ))}
            <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={techUi.clearCompare} aria-label="Xoá">
              <X className="size-3.5" />
            </button>
          </div>
          <Button size="sm" className="h-7" onClick={techUi.openCompare}>
            <GitCompareArrows /> So sánh {ui.compare.length}
          </Button>
        </div>
      )}
      <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
        Kéo thả vào canvas · nối chấm phải → chấm trái · <Plus className="inline size-2.5" /> để so sánh
      </p>
    </div>
  );
}
