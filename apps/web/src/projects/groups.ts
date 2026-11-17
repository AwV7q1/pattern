import type { Design } from '@/types';
import type { DesignGroup, StudioDesign } from './store';

export const NODE_W = 200;
export const NODE_H = 72;

export const GROUP_KINDS: Record<DesignGroup['kind'], { name: string; color: string; hint: string }> = {
  cluster: { name: 'Cluster', color: '#326CE5', hint: 'Cụm Kubernetes' },
  namespace: { name: 'Namespace', color: '#a78bfa', hint: 'Phân vùng logic: quyền, quota, network policy' },
  nodePool: { name: 'Node pool', color: '#34d399', hint: 'Nhóm máy (worker node); mất node pool = mất mọi pod trong đó' },
  zone: { name: 'Zone', color: '#fbbf24', hint: 'Availability zone / datacenter' },
};

type Positioned = { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } };

const inside = (g: DesignGroup, x: number, y: number) =>
  x >= g.position.x && x <= g.position.x + g.size.width && y >= g.position.y && y <= g.position.y + g.size.height;

const center = (n: Positioned) => ({
  x: n.position.x + (n.measured?.width ?? NODE_W) / 2,
  y: n.position.y + (n.measured?.height ?? NODE_H) / 2,
});

/** Nodes whose centre lies inside the group frame. */
export function memberIds(g: DesignGroup, nodes: Positioned[]) {
  return new Set(nodes.filter((n) => inside(g, center(n).x, center(n).y)).map((n) => n.id));
}

/** Groups fully inside `g` (a namespace inside a cluster moves with it). */
export function childGroups(g: DesignGroup, groups: DesignGroup[]) {
  return groups.filter(
    (o) =>
      o.id !== g.id &&
      inside(g, o.position.x, o.position.y) &&
      inside(g, o.position.x + o.size.width, o.position.y + o.size.height),
  );
}

/** Innermost group containing each node. */
export function groupOf(n: Positioned, groups: DesignGroup[]) {
  const c = center(n);
  return groups
    .filter((g) => inside(g, c.x, c.y))
    .sort((a, b) => a.size.width * a.size.height - b.size.width * b.size.height)[0];
}

/** Design with its frames and each node's innermost frame (`group`). */
export function withGroups(design: Design, groups: DesignGroup[]): StudioDesign {
  if (!groups.length) return { ...design, nodes: design.nodes.map(({ group: _g, ...n }) => n) };
  return {
    ...design,
    nodes: design.nodes.map((n) => {
      const g = groupOf(n, groups);
      const { group: _old, ...rest } = n;
      return g ? { ...rest, group: g.id } : rest;
    }),
    groups,
  };
}
