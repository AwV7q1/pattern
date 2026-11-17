import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { bezierFor, bezierPath, setEdgeGeometry } from '../gpu/edgeGeometry';

export type FlowEdgeData = { index: number; latencyMs: number };
export type FlowEdgeType = Edge<FlowEdgeData, 'flow'>;

/** Draws the edge and publishes its exact bezier so particles follow it. */
export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<FlowEdgeType>) {
  const b = bezierFor(sourceX, sourceY, targetX, targetY);
  if (data) setEdgeGeometry(data.index, b); // idempotent, cheap
  return (
    <BaseEdge
      id={id}
      path={bezierPath(b)}
      style={{ stroke: selected ? '#8ab4ff' : '#2c3550', strokeWidth: selected ? 2 : 1.5 }}
    />
  );
}
