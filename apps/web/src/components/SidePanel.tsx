import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'pattern.panelWidth';
export const PANEL_DEFAULT = 380;
const PANEL_MIN = 300;
/** Space kept for the palette + a usable strip of canvas when dragging wide. */
const RESERVED = 224 + 260;

const clamp = (w: number) => {
  const max = Math.max(PANEL_MIN, window.innerWidth - RESERVED);
  return Math.round(Math.min(max, Math.max(PANEL_MIN, w)));
};

function stored() {
  const v = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(v) && v > 0 ? clamp(v) : PANEL_DEFAULT;
}

interface Props {
  /** Cover the whole workspace (palette + canvas) instead of docking right. */
  full: boolean;
  onExitFull: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Right-hand panel that can be resized by dragging its left edge (double-click
 * resets, arrow keys nudge) and expanded to fill the workspace. The canvas
 * stays mounted underneath while expanded, so the simulation keeps running.
 * It is a size container: children use `@3xl:` etc. to lay out wider.
 */
export function SidePanel({ full, onExitFull, children, className }: Props) {
  const [width, setWidth] = useState(stored);
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, w: 0 });

  const commit = useCallback((w: number) => {
    const c = clamp(w);
    setWidth(c);
    localStorage.setItem(STORAGE_KEY, String(c));
  }, []);

  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onExitFull();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, onExitFull]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setWidth(clamp(start.current.w + start.current.x - e.clientX));
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    commit(width);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') commit(width + step);
    else if (e.key === 'ArrowRight') commit(width - step);
    else return;
    e.preventDefault();
  };

  return (
    <aside
      data-full={full || undefined}
      className={cn(
        '@container relative flex shrink-0 flex-col border-l bg-background',
        full && 'absolute inset-0 z-30 border-l-0',
        className,
      )}
      style={full ? undefined : { width }}
    >
      {!full && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Kéo để đổi độ rộng panel"
          aria-valuenow={width}
          aria-valuemin={PANEL_MIN}
          tabIndex={0}
          title="Kéo để đổi độ rộng · nhấp đúp để về mặc định"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => commit(PANEL_DEFAULT)}
          onKeyDown={onKeyDown}
          className={cn(
            'group absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none outline-none',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors',
            'hover:after:bg-primary/60 focus-visible:after:bg-primary',
            dragging && 'after:bg-primary',
          )}
        />
      )}
      {/* keep text from being selected and the canvas from stealing the pointer mid-drag */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
      {children}
    </aside>
  );
}
