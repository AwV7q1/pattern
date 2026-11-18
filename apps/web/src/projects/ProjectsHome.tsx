import { useRef, useState, type ReactNode } from 'react';
import { Copy, Download, FileUp, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Preset } from '@/types';
import { techOf } from '@/tech/catalog';
import { TechLogo } from '@/tech/TechLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BLANK,
  download,
  exportJson,
  importJson,
  newId,
  projectFromPreset,
  slug,
  store,
  timeAgo,
  useProjects,
  type Project,
  type StudioDesign,
} from './store';
import { Thumbnail } from './Thumbnail';

interface Props {
  presets: Record<string, Preset>;
  onOpen: (p: Project) => void;
  /** Extra tabs (e.g. case studies): [value, label, content]. */
  extraTabs?: { value: string; label: string; content: ReactNode }[];
  tab: string;
  onTab: (t: string) => void;
  /** Shown under the title (sync notices). */
  banner?: ReactNode;
}

/** Up to five distinct technology logos used in a design. */
function TechStrip({ design }: { design: StudioDesign }) {
  const techs = [...new Set(design.nodes.map((n) => n.tech).filter(Boolean))].map((id) => techOf(id)).filter(Boolean);
  if (!techs.length) return null;
  return (
    <div className="flex items-center gap-1">
      {techs.slice(0, 6).map((t) => (
        <TechLogo key={t!.id} tech={t!} className="size-4" tile={false} />
      ))}
      {techs.length > 6 && <span className="text-[11px] text-muted-foreground">+{techs.length - 6}</span>}
    </div>
  );
}

function ProjectCard({ p, onOpen }: { p: Project; onOpen: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const save = async () => {
    setRenaming(false);
    if (name.trim() && name !== p.name) await store.put({ ...p, name: name.trim(), updatedAt: Date.now() });
  };
  return (
    <div className="group overflow-hidden rounded-lg border bg-card transition-colors hover:border-ring">
      <button className="block w-full bg-background/60" onClick={onOpen}>
        <Thumbnail design={p.design} className="aspect-[16/10] w-full p-2" />
      </button>
      <div className="flex items-start gap-2 border-t p-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              className="h-7 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          ) : (
            <button className="block max-w-full truncate text-left text-sm font-medium" onClick={onOpen} onDoubleClick={() => setRenaming(true)}>
              {p.name}
            </button>
          )}
          <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>Sửa {timeAgo(p.updatedAt)}</span>
            <TechStrip design={p.design} />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="opacity-60 group-hover:opacity-100" aria-label="Tuỳ chọn">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil /> Đổi tên
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const now = Date.now();
                store.put({ ...structuredClone(p), id: newId(), name: `${p.name} (bản sao)`, createdAt: now, updatedAt: now, rev: undefined, owner: undefined });
              }}
            >
              <Copy /> Nhân bản
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => download(`${slug(p.name)}.json`, exportJson(p))}>
              <Download /> Xuất JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                if (confirm(`Xoá dự án “${p.name}” và toàn bộ lịch sử phiên bản?`)) store.remove(p.id);
              }}
            >
              <Trash2 /> Xoá
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Home of the studio: your saved projects, templates and case studies. */
export function ProjectsHome({ presets, onOpen, extraTabs = [], tab, onTab, banner }: Props) {
  const { projects, error } = useProjects();
  const [query, setQuery] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const mine = (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));

  const create = async (preset: Preset, source?: string) => {
    const p = projectFromPreset(preset, preset === BLANK ? 'Dự án mới' : preset.title, source);
    await store.put(p);
    onOpen(p);
  };

  const onFile = async (file: File) => {
    try {
      setImportError(null);
      const p = importJson(await file.text());
      await store.put(p);
      onOpen(p);
    } catch (e) {
      setImportError(String((e as Error).message ?? e));
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 pt-8 pb-28">
        <div className="flex items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold">Studio</h1>
            <p className="text-sm text-muted-foreground">
              Thiết kế hệ thống bằng công nghệ thật, mô phỏng tải và sự cố, lưu tự động, xuất prompt cho agent triển khai.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <FileUp /> Nhập JSON
            </Button>
            <Button size="sm" onClick={() => create(BLANK, 'blank')}>
              <Plus /> Dự án mới
            </Button>
          </div>
        </div>
        {banner}
        {(error || importError) && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error ?? importError}
          </p>
        )}

        <Tabs value={tab} onValueChange={onTab}>
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="mine">Dự án của tôi{projects?.length ? ` · ${projects.length}` : ''}</TabsTrigger>
              <TabsTrigger value="templates">Mẫu</TabsTrigger>
              {extraTabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tab === 'mine' && (projects?.length ?? 0) > 0 && (
              <div className="relative ml-auto w-64">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm dự án" className="h-8 pl-7 text-xs" />
              </div>
            )}
          </div>

          <TabsContent value="mine" className="mt-4">
            {projects === null ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : projects.length === 0 ? (
              <div className="grid place-items-center gap-3 rounded-lg border border-dashed py-16 text-center">
                <p className="text-sm text-muted-foreground">Chưa có dự án nào. Bắt đầu từ bản trống hoặc một mẫu.</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => create(BLANK, 'blank')}>
                    <Plus /> Dự án trống
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onTab('templates')}>
                    Xem mẫu
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                {mine.map((p) => (
                  <ProjectCard key={p.id} p={p} onOpen={() => onOpen(p)} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="mt-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {Object.entries(presets).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => create(preset, key)}
                  className="group overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-ring"
                >
                  <div className="bg-background/60">
                    <Thumbnail design={preset.design} className="aspect-[16/10] w-full p-2" />
                  </div>
                  <div className="grid gap-1 border-t p-3">
                    <div className="truncate text-sm font-medium">{preset.title}</div>
                    <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{preset.description}</p>
                    <span className="text-[12px] text-primary opacity-0 group-hover:opacity-100">Tạo dự án từ mẫu này →</span>
                  </div>
                </button>
              ))}
            </div>
          </TabsContent>

          {extraTabs.map((t) => (
            <TabsContent key={t.value} value={t.value} className="mt-4">
              {t.content}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
