import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban,
  CalendarClock,
  CircleDollarSign,
  Clock,
  Coins,
  Flame,
  HeartCrack,
  Hourglass,
  Infinity as InfinityIcon,
  Layers,
  Lightbulb,
  Plug,
  RefreshCw,
  Server,
  Shield,
  ShieldBan,
  Swords,
  Timer,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SOCKET_KIND_LABEL } from './Infra';
import type { CardDef } from './types';
import { SCOPES, parseCardText, tokensIn, type Line, type Scope, type TokenKind } from './textFormat';

/** How each scope tag looks: the icon and color in front of its line. */
const SCOPE_STYLE: Record<Scope, { icon: LucideIcon; tone: string }> = {
  turn: { icon: Clock, tone: 'text-sky-300' },
  battle: { icon: InfinityIcon, tone: 'text-violet-300' },
  again: { icon: RefreshCw, tone: 'text-emerald-300' },
  next: { icon: CalendarClock, tone: 'text-sky-300' },
  warn: { icon: TriangleAlert, tone: 'text-amber-300' },
};

/** How each value token looks. */
export const TOKEN_STYLE: Record<TokenKind, { icon: LucideIcon; tone: string; label: string }> = {
  dmg: { icon: Swords, tone: 'text-rose-300', label: 'Sát thương' },
  hr: { icon: Shield, tone: 'text-sky-300', label: 'Headroom' },
  draw: { icon: Layers, tone: 'text-violet-300', label: 'Rút bài' },
  ops: { icon: Zap, tone: 'text-amber-300', label: 'Ops' },
  eb: { icon: HeartCrack, tone: 'text-rose-300', label: 'Error Budget' },
  gold: { icon: Coins, tone: 'text-yellow-300', label: 'Vàng' },
  money: { icon: CircleDollarSign, tone: 'text-yellow-200', label: 'Chi phí' },
  inst: { icon: Server, tone: 'text-cyan-300', label: 'Instance' },
  bot: { icon: ShieldBan, tone: 'text-emerald-300', label: 'Lọc bot' },
  time: { icon: Timer, tone: 'text-zinc-200', label: 'Thời gian' },
  turns: { icon: Hourglass, tone: 'text-zinc-200', label: 'Số lượt' },
};

/** What a keyword means, for the glossary at the bottom of the popover. */
const TOKEN_GLOSSARY: Partial<Record<TokenKind, string>> = {
  hr: 'Lớp đệm hấp thụ sát thương. Hết lượt thì mất.',
  eb: 'Máu của bạn. Về 0 là thua ca trực.',
  ops: 'Năng lượng để đánh bài, nạp lại mỗi lượt.',
  bot: 'Phần request của botnet bị chặn trước khi vào hệ thống.',
  inst: 'Số máy chạy một node. Nhiều máy chịu tải tốt hơn nhưng tốn tiền hơn.',
  money: 'Tiền hạ tầng theo giờ, cộng vào hóa đơn của trận.',
  gold: 'Tiền của ca trực, dùng ở cửa hàng.',
};

function LineView({ line, size }: { line: Line; size: 'face' | 'full' }) {
  const scope = line.scope ? SCOPE_STYLE[line.scope] : null;
  const ScopeIcon = scope?.icon;
  // icons sit inline in the sentence, sized to the text and dropped onto its baseline
  const icon = 'mr-0.5 inline-block size-[1.05em] align-[-0.17em]';
  return (
    <li className={cn(size === 'full' && line.nested && 'pl-3')}>
      {line.scope && (
        <b className={cn('font-semibold', scope?.tone)}>
          {ScopeIcon && <ScopeIcon aria-hidden className={icon} />}
          {SCOPES[line.scope]}
          {line.header ? '' : ':'}{' '}
        </b>
      )}
      {line.spans.map((s, i) => {
        if (s.t === 'text') return <span key={i}>{s.v}</span>;
        if (s.t === 'bold') return <b key={i} className="font-bold text-white">{s.v}</b>;
        const st = TOKEN_STYLE[s.kind];
        const Icon = st.icon;
        return (
          <b key={i} className={cn('whitespace-nowrap font-bold', st.tone)} title={st.label}>
            <Icon aria-hidden className={icon} />
            {s.kind === 'turns' ? `${s.v} lượt` : s.v}
          </b>
        );
      })}
    </li>
  );
}

/** Card text in the shared format: one row per line, with the icons. */
export function CardText({ text, size = 'face', className }: { text: string | undefined; size?: 'face' | 'full'; className?: string }) {
  const lines = parseCardText(text);
  if (!lines.length) return null;
  return (
    <ul className={cn(size === 'face' ? 'space-y-1 text-center text-[13px] leading-[1.3]' : 'space-y-1 text-[13.5px] leading-snug', className)}>
      {lines.map((l, i) => (
        <LineView key={i} line={l} size={size} />
      ))}
    </ul>
  );
}

/** Keywords on a card that a new player may not know. */
export function glossary(def: CardDef): { icon: LucideIcon; tone: string; term: string; text: string }[] {
  const out: { icon: LucideIcon; tone: string; term: string; text: string }[] = [];
  if (def.unplayable) out.push({ icon: Ban, tone: 'text-zinc-400', term: 'Không đánh được', text: 'Chỉ chiếm chỗ trên tay. Lá Refactor loại nó khỏi trận; điểm nghỉ và cửa hàng bỏ hẳn khỏi bộ.' });
  if (def.risk) out.push({ icon: Flame, tone: 'text-rose-300', term: 'Deploy liều', text: `Đánh lá này trừ ${def.risk} Error Budget. Không dùng được khi đang đóng băng deploy.` });
  if (def.exhaust) out.push({ icon: Flame, tone: 'text-amber-200', term: 'Tiêu hao', text: 'Đánh xong bị loại khỏi trận, không quay lại chồng bài.' });
  if (def.fits)
    out.push({
      icon: Plug,
      tone: 'text-sky-300',
      term: `Module · ổ ${def.fits.map((k) => SOCKET_KIND_LABEL[k]).join('/')}`,
      text: 'Kéo vào một ổ trống cùng loại trên sơ đồ. Module ở lại cả trận; đánh thêm lá cùng tên để lên cấp.',
    });
  for (const k of tokensIn(def.text, def.detail)) {
    const text = TOKEN_GLOSSARY[k];
    if (text) out.push({ icon: TOKEN_STYLE[k].icon, tone: TOKEN_STYLE[k].tone, term: TOKEN_STYLE[k].label, text });
  }
  return out;
}

/** The full description of a card: effects, details, keywords and the lesson. */
export function CardDetails({ def }: { def: CardDef }) {
  const terms = glossary(def);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-black',
            def.unplayable ? 'border-zinc-600 bg-zinc-800 text-zinc-500' : 'border-amber-200 bg-gradient-to-br from-amber-300 to-amber-600 text-amber-950',
          )}
        >
          {def.unplayable ? '–' : def.cost}
        </span>
        <p className={cn('text-sm font-bold leading-tight', def.upgraded && 'text-emerald-300')}>{def.name}</p>
        <span className={cn('ml-auto shrink-0 text-[11px] font-medium', def.rarity ? RARITY[def.rarity].tone : 'text-zinc-400')}>
          {def.rarity ? RARITY[def.rarity].label : 'Lá nguyền'}
        </span>
      </div>
      <CardText text={def.text} size="full" />
      {def.detail && <CardText text={def.detail} size="full" className="border-t border-white/10 pt-2 text-foreground/75" />}
      {terms.length > 0 && (
        <dl className="space-y-1 border-t border-white/10 pt-2 text-[11.5px] leading-snug">
          {terms.map((t) => (
            <div key={t.term} className="flex items-start gap-1.5">
              <t.icon aria-hidden className={cn('mt-px size-3.5 shrink-0', t.tone)} />
              <div>
                <dt className={cn('inline font-semibold', t.tone)}>{t.term}: </dt>
                <dd className="inline text-muted-foreground">{t.text}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
      <p className="flex items-start gap-1.5 border-t border-white/10 pt-2 text-[11.5px] italic leading-snug text-muted-foreground">
        <Lightbulb aria-hidden className="mt-px size-3.5 shrink-0 not-italic text-amber-200/80" />
        {def.lesson}
      </p>
    </div>
  );
}

/** Rarity label in the popover (the face shows rarity as its border, see `RARITY_STYLE` in Hand.tsx). */
const RARITY: Record<NonNullable<CardDef['rarity']>, { label: string; tone: string }> = {
  basic: { label: 'Cơ bản', tone: 'text-orange-300' },
  common: { label: 'Thường', tone: 'text-zinc-200' },
  uncommon: { label: 'Ít gặp', tone: 'text-sky-300' },
  rare: { label: 'Hiếm', tone: 'text-amber-300' },
};

const POP_W = 272;
const GAP = 12;

/**
 * The card's full description, floating beside `anchor` (in a portal, so a
 * scrolling list or a rotated hand cannot clip it). It follows the anchor
 * while open, for cards that are still moving (the hand's lift animation).
 */
export function CardPopover({ def, anchor }: { def: CardDef; anchor: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 0;
      if (a) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // beside the card, on whichever side has room (right first)
        let left = a.right + GAP;
        if (left + POP_W > vw - 8) left = a.left - GAP - POP_W;
        if (left < 8) left = Math.min(vw - POP_W - 8, Math.max(8, a.left + a.width / 2 - POP_W / 2));
        const top = Math.min(vh - h - 8, Math.max(8, a.top + a.height / 2 - h / 2));
        setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [anchor]);
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[60] rounded-xl border border-white/10 bg-zinc-950/95 p-3 text-left text-foreground shadow-2xl shadow-black/70 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
      style={{ width: POP_W, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      <CardDetails def={def} />
    </div>,
    document.body,
  );
}

/** Wraps a card shown in a list (library, rewards, shop): hovering or focusing it opens the popover. */
export function CardHover({ def, className, children }: { def: CardDef; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 180);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div ref={ref} className={className} onPointerEnter={show} onPointerLeave={hide} onFocusCapture={show} onBlurCapture={hide}>
      {children}
      {open && <CardPopover def={def} anchor={ref} />}
    </div>
  );
}
