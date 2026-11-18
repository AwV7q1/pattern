import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { BookA, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { UNITS } from './curriculum';
import { GLOSSARY, findTerms, fold, type Term } from './glossaryData';

// ---------------------------------------------------------------- context: open the glossary from anywhere in Learn

const GlossaryCtx = createContext<((termId?: string) => void) | null>(null);

/** Hosts the glossary dialog; `Term` popovers and `GlossaryButton` open it. */
export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; focus?: string }>({ open: false });
  return (
    <GlossaryCtx.Provider value={(focus) => setState({ open: true, focus })}>
      {children}
      <GlossaryDialog open={state.open} focus={state.focus} onOpenChange={(open) => setState((s) => ({ ...s, open }))} />
    </GlossaryCtx.Provider>
  );
}

export function useOpenGlossary() {
  return useContext(GlossaryCtx);
}

export function GlossaryButton({ className, children }: { className?: string; children?: ReactNode }) {
  const open = useOpenGlossary();
  if (!open) return null;
  return (
    <button type="button" onClick={() => open()} className={className} title="Từ điển thuật ngữ">
      {children ?? <BookA className="size-6" />}
    </button>
  );
}

// ---------------------------------------------------------------- inline text

/** `code` spans only; glossary definitions are plain otherwise. */
function Plain({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((p, i) =>
        p.startsWith('`') ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em] text-foreground">
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Underline glossary terms in `text`. `seen` holds term ids already marked in
 * the same block, so each term is underlined once, at its first appearance.
 */
export function glossify(text: string, seen: Set<string>, keyPrefix = ''): ReactNode[] {
  return findTerms(text).map((part, i) => {
    if (typeof part === 'string' || seen.has(part.term.id)) {
      return <Fragment key={keyPrefix + i}>{typeof part === 'string' ? part : part.text}</Fragment>;
    }
    seen.add(part.term.id);
    return (
      <TermLink key={keyPrefix + i} term={part.term}>
        {part.text}
      </TermLink>
    );
  });
}

/** Plain string with glossary terms underlined; for questions and explanations. */
export function Glossed({ text }: { text: string }) {
  return <>{glossify(text, new Set())}</>;
}

/** Dotted-underlined term; hover (mouse) or tap shows its definition. */
export function TermLink({ term, children }: { term: Term; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const openGlossary = useOpenGlossary();
  const hover = (on: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(closeTimer.current);
    if (on) setOpen(true);
    else closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <span
          role="button"
          tabIndex={0}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          onClick={(e) => e.stopPropagation()}
          className="cursor-help underline decoration-sky-400/70 decoration-dotted decoration-2 underline-offset-4 hover:decoration-sky-400"
        >
          {children}
        </span>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          className="z-50 w-72 rounded-xl border-2 bg-card p-3 text-sm shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          <div className="font-bold text-foreground">{term.term}</div>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            <Plain text={term.short} />
          </p>
          {term.example && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Ví dụ: </span>
              <Plain text={term.example} />
            </p>
          )}
          {openGlossary && (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-sky-400 hover:underline"
              onClick={() => {
                setOpen(false);
                openGlossary(term.id);
              }}
            >
              Mở từ điển thuật ngữ →
            </button>
          )}
          <PopoverPrimitive.Arrow className="fill-border" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// ---------------------------------------------------------------- list (dialog and page)

/** Search box plus every term grouped by unit; scrolls to `focus` on mount. */
function GlossaryList({
  focus,
  stickyClass,
  scrollClass,
  headTop = 'top-0',
}: {
  focus?: string;
  stickyClass?: string;
  scrollClass?: string;
  /** Sticky offset of unit headings (below a sticky search box). */
  headTop?: string;
}) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    // wait for the content to mount
    const id = requestAnimationFrame(() =>
      listRef.current?.querySelector(`[data-term="${focus}"]`)?.scrollIntoView({ block: 'center' }),
    );
    return () => cancelAnimationFrame(id);
  }, [focus]);

  const groups = useMemo(() => {
    const q = fold(query.trim());
    const match = (t: Term) =>
      !q || [t.term, ...(t.aliases ?? []), t.short, t.example ?? ''].some((s) => fold(s).includes(q));
    return UNITS.map((u, i) => ({ unit: u, index: i, terms: GLOSSARY.filter((t) => t.unit === u.id && match(t)) })).filter(
      (g) => g.terms.length > 0,
    );
  }, [query]);
  const count = groups.reduce((n, g) => n + g.terms.length, 0);

  return (
    <>
      <div className={stickyClass}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm: p99, hang doi, cache…"
            className="pl-8"
            autoFocus={!focus}
          />
        </div>
      </div>
      <div ref={listRef} className={scrollClass}>
        {count === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Không tìm thấy thuật ngữ nào.</p>}
        {groups.map(({ unit, index, terms }) => (
          <section key={unit.id} className="mb-5">
            <h3 className={cn('sticky z-10 bg-background py-1.5 text-xs font-bold tracking-wide uppercase', headTop)} style={{ color: unit.color }}>
              Phần {index + 1} · {unit.title}
            </h3>
            <dl className="grid gap-2">
              {terms.map((t) => (
                <div
                  key={t.id}
                  data-term={t.id}
                  className={cn('rounded-lg border p-3', focus === t.id && 'border-sky-400 bg-sky-400/5 ring-2 ring-sky-400/30')}
                >
                  <dt className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                    {t.term}
                    {t.aliases && t.aliases.length > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">còn gọi: {t.aliases.join(', ')}</span>
                    )}
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    <Plain text={t.short} />
                    {t.example && (
                      <span className="mt-1 block text-xs">
                        <span className="font-semibold text-foreground">Ví dụ: </span>
                        <Plain text={t.example} />
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- dialog

function GlossaryDialog({ open, focus, onOpenChange }: { open: boolean; focus?: string; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookA className="size-5" /> Từ điển thuật ngữ
          </DialogTitle>
          <DialogDescription>
            {GLOSSARY.length} thuật ngữ, xếp theo phần học. Trong bài, từ có gạch chân chấm là thuật ngữ: di chuột hoặc chạm vào để
            xem nghĩa.
          </DialogDescription>
        </DialogHeader>
        {/* remounts on every open, so the query resets and `focus` scrolls into view */}
        {open && <GlossaryList focus={focus} scrollClass="-mx-6 min-h-0 flex-1 overflow-y-auto px-6" />}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- page (bottom tab)

/** Full-page glossary for the "Từ điển" tab. */
export function GlossaryPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 pb-8">
        <header className="pt-8 pb-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookA className="size-6 text-sky-400" /> Từ điển thuật ngữ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {GLOSSARY.length} thuật ngữ, xếp theo phần học. Trong bài, từ có gạch chân chấm là thuật ngữ: di chuột hoặc chạm vào để xem
            nghĩa.
          </p>
        </header>
        <GlossaryList stickyClass="sticky top-0 z-20 -mx-6 h-13 bg-background px-6 py-2" headTop="top-13" />
      </div>
    </div>
  );
}
