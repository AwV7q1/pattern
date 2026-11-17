import { cn } from '@/lib/utils';

const Arrow = ({ color }: { color: string }) => (
  <svg viewBox="-1 -1 2 2" className="size-3">
    <path d="M0.95,0 L-0.75,0.7 L-0.35,0 L-0.75,-0.7 Z" fill={color} />
  </svg>
);
const Dot = ({ color, r = 0.55 }: { color: string; r?: number }) => (
  <svg viewBox="-1 -1 2 2" className="size-3">
    <circle r={r} fill={color} />
  </svg>
);
const Cross = () => (
  <svg viewBox="-1 -1 2 2" className="size-3">
    <path d="M-0.6,-0.6 L0.6,0.6 M0.6,-0.6 L-0.6,0.6" stroke="#ff4747" strokeWidth="0.35" strokeLinecap="round" />
  </svg>
);
const Ring = () => (
  <svg viewBox="-1 -1 2 2" className="size-3">
    <circle r="0.8" fill="none" stroke="white" strokeWidth="0.18" />
    <circle r="0.35" fill="#4db3ff" />
  </svg>
);

/** What the shapes moving along the edges mean. */
export function ParticleLegend({ className }: { className?: string }) {
  const rows = [
    { icon: <Arrow color="#4db3ff" />, text: 'request (mũi tên chỉ hướng đi)' },
    { icon: <Arrow color="#ff9e26" />, text: 'retry' },
    { icon: <Dot color="#4df28c" />, text: 'response OK (làn bên kia)' },
    { icon: <Cross />, text: 'response lỗi' },
    { icon: <Dot color="#4df28c" r={0.95} />, text: 'to hơn = payload lớn hơn' },
    { icon: <Ring />, text: 'request đang được trace' },
    {
      icon: (
        <svg viewBox="0 0 12 4" className="h-1 w-3">
          <path d="M0,2 H12" stroke="currentColor" strokeDasharray="1 2.5" strokeLinecap="round" />
        </svg>
      ),
      text: 'nét đứt: không chờ trả lời',
    },
  ];
  return (
    <div className={cn('grid gap-1 text-[11px] text-muted-foreground', className)}>
      {rows.map((r) => (
        <span key={r.text} className="flex items-center gap-2">
          <span className="flex w-3 justify-center">{r.icon}</span> {r.text}
        </span>
      ))}
      <span className="mt-1 leading-snug">①②③ tuần tự · ∥ song song · ⇄ chọn 1</span>
    </div>
  );
}
