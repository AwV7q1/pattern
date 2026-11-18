import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const TAB_W = 76; // px, keep in sync with `w-[76px]`

/**
 * Floating "Liquid Glass" tab bar (iOS / iPadOS 26 style): a frosted pill that
 * hovers above the content, with a glass lens that slides to the active tab.
 */
export function BottomTabBar<T extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const index = Math.max(
    0,
    items.findIndex((i) => i.value === value),
  );
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(16px,env(safe-area-inset-bottom))]">
      <div
        role="tablist"
        aria-label="Điều hướng"
        className={cn(
          'pointer-events-auto relative isolate flex rounded-full border border-white/15 bg-white/[0.06] p-1.5',
          'backdrop-blur-2xl backdrop-saturate-[1.8]',
          'shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_-1px_1px_rgb(255_255_255/0.08),0_12px_40px_-8px_rgb(0_0_0/0.6),0_2px_6px_rgb(0_0_0/0.3)]',
          // diagonal sheen across the glass
          'before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-full before:bg-gradient-to-br before:from-white/20 before:via-transparent before:to-white/5',
        )}
      >
        {/* sliding lens behind the active tab */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1.5 left-1.5 -z-10 h-[52px] w-[76px] rounded-full border border-white/20 bg-white/[0.12] shadow-[inset_0_1px_0_rgb(255_255_255/0.4),inset_0_-1px_2px_rgb(255_255_255/0.1),0_4px_12px_rgb(0_0_0/0.25)] transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)]"
          style={{ transform: `translateX(${index * TAB_W}px)` }}
        />
        {items.map(({ value: v, label, icon: Icon }) => {
          const active = v === value;
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(v)}
              className={cn(
                'flex h-[52px] w-[76px] flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-semibold outline-none',
                'transition-[color,transform] duration-200 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'text-primary' : 'text-foreground/70 hover:text-foreground',
              )}
            >
              <Icon className={cn('size-6', active && 'stroke-[2.25]')} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
