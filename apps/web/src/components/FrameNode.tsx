import { memo } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { PowerOff } from 'lucide-react';
import { siKubernetes } from 'simple-icons';
import { GROUP_KINDS } from '@/projects/groups';
import type { DesignGroup } from '@/projects/store';

export type FrameNodeData = { group: DesignGroup; members: number; down: boolean };
export type FrameNodeType = Node<FrameNodeData, 'frame'>;

/** Dashed frame for a cluster / namespace / node pool / zone. Visual only. */
export const FrameNode = memo(function FrameNode({ data, selected }: NodeProps<FrameNodeType>) {
  const kind = GROUP_KINDS[data.group.kind];
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        lineStyle={{ borderColor: kind.color }}
        handleStyle={{ background: kind.color, width: 8, height: 8, borderRadius: 2 }}
      />
      <div
        className="h-full w-full rounded-2xl border-2 border-dashed transition-colors"
        style={{
          borderColor: `${kind.color}${selected ? 'cc' : '55'}`,
          background: `${kind.color}${data.down ? '14' : '08'}`,
        }}
      >
        <div
          className="absolute -top-3 left-4 flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs shadow-sm"
          style={{ borderColor: `${kind.color}66` }}
        >
          {data.group.kind !== 'zone' && (
            <svg viewBox="0 0 24 24" className="size-3.5" fill={`#${siKubernetes.hex}`}>
              <path d={siKubernetes.path} />
            </svg>
          )}
          <span className="font-medium" style={{ color: kind.color }}>
            {kind.name}
          </span>
          <span className="font-semibold">{data.group.label}</span>
          <span className="text-muted-foreground">· {data.members} node</span>
          {data.down && (
            <span className="ml-1 flex items-center gap-0.5 rounded bg-destructive px-1 text-[10px] font-semibold text-white">
              <PowerOff className="size-2.5" /> DOWN
            </span>
          )}
        </div>
      </div>
    </>
  );
});
