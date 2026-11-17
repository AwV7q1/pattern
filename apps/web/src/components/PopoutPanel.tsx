import { useEffect, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  title: ReactNode;
  icon?: ReactNode;
  /** Extra buttons in the header, left of the pop-out button. */
  actions?: ReactNode;
  /** Children may lay out differently when popped out. */
  children: ReactNode | ((expanded: boolean) => ReactNode);
  className?: string;
  bodyClassName?: string;
  /** Controlled mode (optional). */
  expanded?: boolean;
  onExpandedChange?: (v: boolean) => void;
}

/**
 * A bordered panel that can be "popped out" into a full-width tab covering
 * the workspace below the app header, and docked back (button or Esc).
 * The same element is restyled rather than re-mounted, so its state (inputs,
 * running simulations, scroll) survives the switch. It is a size container:
 * children can use `@3xl:` etc. to use the extra room.
 */
export function PopoutPanel({ title, icon, actions, children, className, bodyClassName, expanded, onExpandedChange }: Props) {
  const [own, setOwn] = useState(false);
  const open = expanded ?? own;
  const set = (v: boolean) => (onExpandedChange ? onExpandedChange(v) : setOwn(v));

  useEffect(() => {
    if (!open) return;
    // capture phase so an outer full-size panel does not also close on the same Esc
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      set(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <section
      data-popout={open || undefined}
      className={cn(
        '@container flex flex-col rounded-xl border bg-card',
        open && 'fixed inset-x-0 top-14 bottom-0 z-40 rounded-none border-0 border-t shadow-2xl',
        className,
      )}
    >
      <header className={cn('flex items-center gap-2 border-b px-3 py-2', open && 'px-6')}>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
        {actions}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={open ? 'Thu lại vào panel' : 'Tách ra toàn màn hình'}
          title={open ? 'Thu lại (Esc)' : 'Tách ra xem toàn màn hình'}
          onClick={() => set(!open)}
        >
          {open ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </header>
      <div className={cn('min-h-0 flex-1 p-3', open && 'overflow-y-auto', bodyClassName)}>
        <div className={cn(open && 'mx-auto max-w-7xl px-3 py-2')}>
          {typeof children === 'function' ? children(open) : children}
        </div>
      </div>
    </section>
  );
}
