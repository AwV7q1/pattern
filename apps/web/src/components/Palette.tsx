import type { DragEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { KIND_META, fmt } from '@/lib/meta';
import type { NodeConfig, NodeKind } from '@/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const DRAG_MIME = 'application/x-pattern-kind';

interface Props {
  kinds: NodeKind[];
  catalog: Record<string, NodeConfig>;
}

/** Drag a component onto the canvas; connect handles to wire it up. */
export function Palette({ kinds, catalog }: Props) {
  const onDragStart = (e: DragEvent, kind: NodeKind) => {
    e.dataTransfer.setData(DRAG_MIME, kind);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Thành phần</div>
      {kinds.map((kind) => {
        const meta = KIND_META[kind];
        const Icon = meta.icon;
        const c = catalog[kind];
        return (
          <Tooltip key={kind}>
            <TooltipTrigger asChild>
              <div
                draggable
                onDragStart={(e) => onDragStart(e, kind)}
                className="group flex cursor-grab items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm transition-colors select-none hover:border-ring active:cursor-grabbing"
              >
                <span
                  className="flex size-6 items-center justify-center rounded"
                  style={{ background: `${meta.color}26`, color: meta.color }}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{meta.name}</div>
                  {c && (
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {c.concurrency} slot · {fmt.money(c.costPerHour)}/h
                    </div>
                  )}
                </div>
                <GripVertical className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-56">
              {meta.blurb}
            </TooltipContent>
          </Tooltip>
        );
      })}
      <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
        Kéo thả vào canvas, nối từ chấm phải sang chấm trái. Chọn rồi bấm Delete để xoá.
      </p>
    </div>
  );
}
