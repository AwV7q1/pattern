import type { ComponentType, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * "Back" on detail pages, where the tab bar is hidden. Without `to` it goes one
 * step back in history (or to `fallback` when the page was opened directly).
 */
export function BackLink({ to, label, className, fallback = '/learn' }: { to?: string; label: string; className?: string; fallback?: string }) {
  const navigate = useNavigate();
  if (!to)
    return (
      <Button
        size="sm"
        variant="ghost"
        className={cn('text-muted-foreground', className)}
        onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate(fallback))}
      >
        <ArrowLeft /> {label}
      </Button>
    );
  return (
    <Button size="sm" variant="ghost" asChild className={cn('text-muted-foreground', className)}>
      <Link to={to}>
        <ArrowLeft /> {label}
      </Link>
    </Button>
  );
}

/** A large entry on a home page that opens a detail page. */
export function HubCard({
  to,
  icon: Icon,
  title,
  children,
  accent = 'text-primary',
  cta,
  className,
}: {
  to: string;
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  children?: ReactNode;
  /** Text color class of the icon. */
  accent?: string;
  /** Call to action shown at the bottom (e.g. "Chơi ngay"). */
  cta?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group grid content-start gap-2 rounded-2xl border-2 border-b-4 p-5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px active:border-b-2',
        className,
      )}
    >
      <Icon className={cn('size-8', accent)} />
      <span className="text-base font-semibold">{title}</span>
      {children && <span className="text-sm text-muted-foreground">{children}</span>}
      {cta && (
        <span className={cn('mt-1 flex items-center gap-1 text-sm font-semibold', accent)}>
          {cta}
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      )}
    </Link>
  );
}
