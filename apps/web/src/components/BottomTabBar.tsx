import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/** Floating frosted-glass tab bar pinned to the bottom center. */
export function BottomTabBar<T extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(16px,env(safe-area-inset-bottom))]">
      <div
        role="tablist"
        aria-label="Điều hướng"
        className="pointer-events-auto flex rounded-full border border-white/10 bg-background/70 p-1.5 shadow-lg shadow-black/40 backdrop-blur-xl"
      >
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
                'transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'bg-white/10 text-primary' : 'text-foreground/70 hover:text-foreground',
              )}
            >
              <Icon className="size-6" />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
