import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import { BookA, FileJson, Gamepad2, GraduationCap, Shapes } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useOpenGlossary } from '@/learn/Glossary';
import { GLOSSARY } from '@/learn/glossaryData';
import { LESSONS } from '@/learn/curriculum';
import { LEVELS, PRESETS } from '@/presets';
import { useProjects } from '@/projects/store';
import { TECHS } from '@/tech/catalog';
import { TechLogo } from '@/tech/TechLogo';
import { techUi } from '@/tech/ui-store';
import { NAV } from './nav';
import { useUi } from './ui-store';

const ITEM =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-foreground';
const GROUP =
  'text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase';

/** ⌘K: jump to a page, project, level, lesson, technology or glossary term. */
export function CommandPalette() {
  const open = useUi((s) => s.commandOpen);
  const setOpen = useUi((s) => s.setCommandOpen);
  const navigate = useNavigate();
  const openGlossary = useOpenGlossary();
  const { projects } = useProjects();
  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Tìm nhanh</DialogTitle>
        <Command
          loop
          className="flex max-h-[min(70vh,560px)] flex-col"
          filter={(value, search, keywords) => {
            const hay = `${value} ${keywords?.join(' ') ?? ''}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
            const q = search.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
            return q.split(/\s+/).every((w) => hay.includes(w)) ? 1 : 0;
          }}
        >
          <Command.Input
            autoFocus
            placeholder="Trang, dự án, level, bài học, công nghệ, thuật ngữ…"
            className="h-11 border-b bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">Không tìm thấy.</Command.Empty>
            <Command.Group heading="Trang" className={GROUP}>
              {NAV.flatMap((g) => g.items)
                .filter((i) => !i.hidden)
                .map((i) => (
                  <Command.Item
                    key={i.to}
                    value={`trang ${i.label}`}
                    keywords={i.keywords ? [i.keywords] : []}
                    className={ITEM}
                    onSelect={() => go(() => (i.action === 'glossary' ? openGlossary?.() : navigate(i.to)))}
                  >
                    <i.icon className="size-4" /> {i.label}
                  </Command.Item>
                ))}
            </Command.Group>
            {!!projects?.length && (
              <Command.Group heading="Dự án của bạn" className={GROUP}>
                {projects.slice(0, 30).map((p) => (
                  <Command.Item key={p.id} value={`du an ${p.name} ${p.id}`} className={ITEM} onSelect={() => go(() => navigate(`/studio/${p.id}`))}>
                    <Shapes className="size-4" /> {p.name}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            <Command.Group heading="Level" className={GROUP}>
              {Object.entries(LEVELS).map(([key, l]) => (
                <Command.Item key={key} value={`level ${l.title} ${key}`} className={ITEM} onSelect={() => go(() => navigate(`/play/${key}`))}>
                  <Gamepad2 className="size-4" /> {l.title}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Mẫu thiết kế" className={GROUP}>
              {Object.entries(PRESETS).map(([key, p]) => (
                <Command.Item
                  key={key}
                  value={`mau ${p.title} ${key}`}
                  keywords={[p.description]}
                  className={ITEM}
                  onSelect={() => go(() => navigate(`/studio?template=${encodeURIComponent(key)}`))}
                >
                  <FileJson className="size-4" /> {p.title}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Bài học" className={GROUP}>
              {LESSONS.map((l) => (
                <Command.Item key={l.id} value={`bai hoc ${l.title} ${l.id}`} className={ITEM} onSelect={() => go(() => navigate(`/learn/${l.id}`))}>
                  <GraduationCap className="size-4" /> {l.title}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Công nghệ" className={GROUP}>
              {TECHS.map((t) => (
                <Command.Item key={t.id} value={`cong nghe ${t.name} ${t.id}`} keywords={[t.summary]} className={ITEM} onSelect={() => go(() => techUi.openSheet(t.id))}>
                  <TechLogo tech={t} className="size-4" tile={false} /> {t.name}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Thuật ngữ" className={GROUP}>
              {GLOSSARY.map((t) => (
                <Command.Item
                  key={t.id}
                  value={`thuat ngu ${t.term} ${t.id}`}
                  keywords={[...(t.aliases ?? []), t.short]}
                  className={ITEM}
                  onSelect={() => go(() => openGlossary?.(t.id))}
                >
                  <BookA className="size-4 shrink-0" /> <span className="shrink-0">{t.term}</span>
                  <span className="truncate text-xs text-muted-foreground">{t.short}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
