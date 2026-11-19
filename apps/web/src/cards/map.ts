// A floor of the tower: a seeded map of rows of nodes joined by paths that
// branch and merge, with a boss at the top.
//
// Built by walking `map.paths` times from the bottom row to the top, one row
// at a time, moving at most one column left or right and never crossing an
// edge that is already there. Node kinds are then dealt row by row.
//
// Node ids are `row * width + col`; the boss is `rows * width`. The map is a
// pure function of (seed, act), so a saved run only keeps the node it is on.

import { nextRandom } from './rules.ts';
import type { Content, MapNode, NodeKind, TowerMap } from './types';

/** First row where elites and rest stops may appear. */
export const ELITE_ROW = 3;

export function generateMap(content: Content, seed: number, act: number): TowerMap {
  const { rows, width, paths, weights } = content.run.map;
  const rng = { rng: (Math.imul(seed ^ 0x85ebca6b, 2 * act + 1) + Math.imul(act, 0x27d4eb2f)) >>> 0 };
  const rand = (n: number) => Math.floor(nextRandom(rng) * n);
  const id = (row: number, col: number) => row * width + col;
  const bossId = rows * width;

  // ---- paths
  const next = new Map<number, Set<number>>();
  const link = (a: number, b: number) => (next.get(a) ?? next.set(a, new Set()).get(a)!).add(b);
  const crosses = (row: number, a: number, b: number) => {
    for (let c = 0; c < width; c++)
      for (const to of next.get(id(row, c)) ?? []) {
        const d = to - id(row + 1, 0);
        if ((a < c && b > d) || (a > c && b < d)) return true;
      }
    return false;
  };
  const starts: number[] = [];
  for (let p = 0; p < paths; p++) {
    let col = rand(width);
    while (p === 1 && col === starts[0]) col = rand(width);
    starts.push(col);
    for (let row = 0; row < rows - 1; row++) {
      // straight up never crosses (moves are at most one column)
      const options = [col - 1, col, col + 1].filter((c) => c >= 0 && c < width && !crosses(row, col, c));
      const to = options[rand(options.length)];
      link(id(row, col), id(row + 1, to));
      col = to;
    }
    link(id(rows - 1, col), bossId);
  }

  // ---- nodes, bottom to top
  const ids = new Set<number>([...next.keys(), ...[...next.values()].flatMap((s) => [...s])]);
  ids.delete(bossId);
  const parents = new Map<number, number[]>();
  for (const [from, tos] of next) for (const to of tos) parents.set(to, [...(parents.get(to) ?? []), from]);

  const kinds = new Map<number, NodeKind>();
  const total = weights.battle + weights.event + weights.elite + weights.rest;
  const deal = (): NodeKind => {
    let r = nextRandom(rng) * total;
    for (const k of ['battle', 'event', 'elite', 'rest'] as const) if ((r -= weights[k]) < 0) return k;
    return 'battle';
  };
  const sorted = [...ids].sort((a, b) => a - b);
  for (const n of sorted) {
    const row = Math.floor(n / width);
    let kind: NodeKind = row === 0 ? 'battle' : row === rows - 1 ? 'rest' : deal();
    const special = kind === 'elite' || kind === 'rest';
    // no elites or rests early, none twice in a row, and no rest right before the rest row
    if (row > 0 && row < rows - 1 && special && (row < ELITE_ROW || (kind === 'rest' && row === rows - 2) || (parents.get(n) ?? []).some((p) => kinds.get(p) === kind)))
      kind = 'battle';
    kinds.set(n, kind);
  }
  if (![...kinds.values()].includes('elite')) {
    const spots = sorted.filter((n) => {
      const row = Math.floor(n / width);
      return kinds.get(n) === 'battle' && row >= ELITE_ROW && row < rows - 1;
    });
    if (spots.length) kinds.set(spots[rand(spots.length)], 'elite');
  }

  const nodes: MapNode[] = sorted.map((n) => ({
    id: n,
    row: Math.floor(n / width),
    col: n % width,
    kind: kinds.get(n)!,
    next: [...(next.get(n) ?? [])].sort((a, b) => a - b),
  }));
  nodes.push({ id: bossId, row: rows, col: Math.floor(width / 2), kind: 'boss', next: [] });
  return { act, nodes, bossId };
}

export const mapNode = (map: TowerMap, id: number | null) => (id === null ? undefined : map.nodes.find((n) => n.id === id));
