import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/** iPad App Store style tab bar: icon over a small label, centered, frosted. */
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
    <nav className="shrink-0 border-t bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div role="tablist" aria-label="Điều hướng" className="mx-auto flex h-14 max-w-2xl items-stretch justify-center">
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
                'flex w-24 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
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
