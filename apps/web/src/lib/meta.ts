import { Database, Inbox, Server, Split, Users, Zap, type LucideIcon } from 'lucide-react';
import type { NodeKind } from '@/types';

export const KIND_META: Record<NodeKind, { name: string; color: string; icon: LucideIcon; blurb: string }> = {
  client: { name: 'Client', color: '#a78bfa', icon: Users, blurb: 'Nguồn traffic.' },
  loadBalancer: {
    name: 'Load balancer',
    color: '#60a5fa',
    icon: Split,
    blurb: 'Chia request round-robin cho các node phía sau, né edge có circuit breaker đang mở.',
  },
  service: {
    name: 'Service',
    color: '#34d399',
    icon: Server,
    blurb: 'Xử lý request rồi gọi xuống downstream, giữ slot trong lúc chờ.',
  },
  cache: { name: 'Cache', color: '#f472b6', icon: Zap, blurb: 'Hit thì trả lời ngay, miss thì gọi xuống dưới.' },
  database: { name: 'Database', color: '#fbbf24', icon: Database, blurb: 'Ít slot, chậm hơn, đắt.' },
  queue: {
    name: 'Queue',
    color: '#22d3ee',
    icon: Inbox,
    blurb: 'Ack ngay cho bên gửi, consumer xử lý bất đồng bộ phía sau.',
  },
};

export function utilColor(u: number) {
  if (u < 0.6) return 'var(--success)';
  if (u < 0.85) return 'var(--warning)';
  return 'var(--destructive)';
}

export const fmt = {
  ms: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : v < 10 ? `${v.toFixed(1)}ms` : `${Math.round(v)}ms`),
  pct: (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`,
  money: (v: number) => `$${v.toFixed(2)}`,
  rps: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`),
};
