import type { EdgePolicy, NodeConfig, NodeKind } from '@/types';

export type TechCategory =
  | 'gateway'
  | 'runtime'
  | 'auth'
  | 'cache'
  | 'database'
  | 'search'
  | 'storage'
  | 'queue'
  | 'stream'
  | 'k8s';

export const CATEGORIES: { id: TechCategory; name: string }[] = [
  { id: 'gateway', name: 'Gateway / Load balancer' },
  { id: 'runtime', name: 'Service runtime' },
  { id: 'auth', name: 'Identity / Auth' },
  { id: 'cache', name: 'Cache' },
  { id: 'database', name: 'Database' },
  { id: 'search', name: 'Search' },
  { id: 'storage', name: 'Object storage' },
  { id: 'queue', name: 'Message queue' },
  { id: 'stream', name: 'Event streaming' },
  { id: 'k8s', name: 'Kubernetes' },
];

export type ScoreKey =
  | 'throughput'
  | 'latency'
  | 'durability'
  | 'scalability'
  | 'opsSimplicity'
  | 'costEfficiency'
  | 'ecosystem';

export const SCORE_LABELS: Record<ScoreKey, { name: string; hint: string }> = {
  throughput: { name: 'Thông lượng', hint: 'Số request/message xử lý được trên mỗi node' },
  latency: { name: 'Độ trễ thấp', hint: 'Càng cao càng nhanh (p50/p99 thấp)' },
  durability: { name: 'Độ bền dữ liệu', hint: 'Khả năng không mất dữ liệu khi sự cố' },
  scalability: { name: 'Mở rộng ngang', hint: 'Dễ thêm node để tăng tải' },
  opsSimplicity: { name: 'Dễ vận hành', hint: 'Cài đặt, nâng cấp, giám sát, ít bẫy' },
  costEfficiency: { name: 'Chi phí hợp lý', hint: 'Hiệu năng trên mỗi đồng chi phí' },
  ecosystem: { name: 'Hệ sinh thái', hint: 'Thư viện, tài liệu, cộng đồng, managed service' },
};
export const SCORE_KEYS = Object.keys(SCORE_LABELS) as ScoreKey[];

export interface TechLogo {
  /** SVG path in a 24×24 viewBox (simple-icons). */
  path?: string;
  /** Brand colour without `#`. */
  hex: string;
  /** Shown when there is no path. */
  mono?: string;
}

export interface Tech {
  id: string;
  name: string;
  vendor: string;
  license: 'OSS' | 'Managed' | 'Commercial' | 'Source-available';
  category: TechCategory;
  /** Engine node kind it is simulated as. */
  kind: NodeKind;
  logo: TechLogo;
  summary: string;
  details: {
    strengths: string[];
    weaknesses: string[];
    useWhen: string[];
    avoidWhen: string[];
    /** Delivery / consistency semantics worth knowing. */
    semantics?: string[];
  };
  scores: Record<ScoreKey, number>;
  /** Realistic per-instance simulation numbers. */
  config: Partial<NodeConfig>;
  /** Policy applied to new edges pointing at this tech (e.g. connection pool). */
  edgeDefaults?: Partial<EdgePolicy>;
  deploy: { image?: string; keySettings: string[] };
  alternatives: string[];
  /** Kubernetes workload hints, used by the K8s prompt target. */
  k8s?: { workload: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Managed' };
}
