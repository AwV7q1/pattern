// The classic enemies and floor 1:
// - Botnet Bầy Kiến scuttles with twitching antennae, sends a column of ants,
//   curls up when hit, calls ants out of the ground and dies on its back;
// - Bão Retry billows and drizzles, strikes three times (each bolt a retry),
//   bursts apart when hit and rains itself out;
// - Đàn Thundering Herd paws the ground and snorts steam, charges with its head
//   down in a cloud of dust, shakes off hits and topples, seeing stars;
// - Crawler Tham Lam yo-yos on its thread, drops and shoots a web, zips up when
//   hit, and falls when its thread snaps;
// - Rò Rỉ Bộ Nhớ (elite) slowly bloats until garbage collection snaps it back,
//   sprays bits, and is OOM-killed: it swells, then pops;
// - Cron Nửa Đêm (elite) rattles like an alarm, rings sound waves at you, spits
//   out cron gears, clonks when hit, and breaks: spring out, bells off.
import { flash, fx, fxAll, play, playAdd, ready, Shots, volley, wait, type MoveSet } from './kit';

// ---------------------------------------------------------------- Botnet Bầy Kiến

const Ant = ({ c, l }: { c: string; l: string }) => (
  <>
    <path d="M-3 -3 l-2 -3 M1 -3 l1 -3 M-3 3 l-2 3 M1 3 l1 3" stroke="#71717a" strokeWidth="0.9" />
    <ellipse cx="-3" cy="0" rx="3" ry="2.2" fill={c} />
    <ellipse cx="2.5" cy="0" rx="3" ry="2.4" fill={l} />
  </>
);

const swarm: MoveSet = {
  gait: { kf: 'sw-scuttle', s: 0.8, origin: '80px 130px' },
  front: ({ p }) => (
    <Shots k="ant" n={8} x={64} y={132}>
      {() => <Ant c={p.main} l={p.light} />}
    </Shots>
  ),
  // rears up clacking its mandibles, and a column of ants marches at you
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    await play(s, [{ transform: 'none' }, { transform: 'translateY(-8px) rotate(8deg)', offset: 0.6 }, { transform: 'translateY(-6px) rotate(6deg)' }], { duration: 360, easing: 'ease-out' });
    void play(s, [{ transform: 'translateY(-6px) rotate(6deg)' }, { transform: 'translate(-10px, 2px) rotate(-4deg) scale(1.04, 0.96)', offset: 0.35 }, { transform: 'none' }], { duration: 480, easing: 'ease-out' });
    fxAll(el, 'ant').forEach((a, i) => {
      const steps = [0, 0.2, 0.4, 0.6, 0.8, 1];
      a.animate(
        [{ opacity: 0, transform: 'scale(0.3)' }, ...steps.map((t, k) => ({ opacity: k === 5 ? 0 : 1, transform: `translate(${-260 * t}px, ${k % 2 ? -5 : 4}px) scale(1.2)` }))],
        { duration: 760, delay: i * 55, easing: 'linear', fill: 'backwards' },
      );
    });
    await wait(600);
  },
  jab(el) {
    fxAll(el, 'antenna').forEach((a) => void playAdd(a, [{ transform: 'none' }, { transform: 'rotate(-14deg)', offset: 0.4 }, { transform: 'none' }], 280));
  },
  // curls up, antennae folded
  hit(el, tier) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 300, 1.7);
    void play(s, [{ transform: 'none' }, { transform: `translateX(${tier === 'mini' ? 10 : 6}px) rotate(-10deg) scale(0.88)`, offset: 0.3 }, { transform: 'translateX(-2px) rotate(3deg) scale(1.02)', offset: 0.7 }, { transform: 'none' }], { duration: 480, easing: 'ease-out' });
    fxAll(el, 'antenna').forEach((a, i) => void playAdd(a, [{ transform: 'none' }, { transform: `rotate(${i ? 40 : -40}deg)`, offset: 0.3 }, { transform: 'none' }], 520));
  },
  // antennae glow and beat, ants crawl up out of the ground
  async summon(el) {
    const s = ready(el);
    if (!s) return;
    fxAll(el, 'antenna').forEach((a, i) => void playAdd(a, [0, 1, 2, 3].flatMap(() => [{ transform: 'none' }, { transform: `rotate(${i ? 12 : -12}deg)` }]).concat({ transform: 'none' }), 700, 'linear'));
    void play(s, [{ transform: 'none', filter: 'brightness(1)' }, { transform: 'translateY(-6px)', filter: 'brightness(1.6) drop-shadow(0 0 8px #f43f5e)', offset: 0.5 }, { transform: 'none', filter: 'brightness(1)' }], { duration: 700 });
    await volley(el, 'ant', (i) => [((i * 23) % 70) - 35, 12 + (i % 3) * 3], { ms: 600, stagger: 40 });
  },
  die: { cls: 'bot-die-swarm', ms: 1800 },
};

// ---------------------------------------------------------------- Bão Retry

const storm: MoveSet = {
  gait: { kf: 'rs-billow', s: 4 },
  front: () => (
    <Shots k="zap" n={3} x={54} y={96}>
      {(i) => <path d={`M0 ${i * 8 - 8} L-40 ${i * 8 - 18} L-70 ${i * 8 + 2} L-120 ${i * 8 - 14} L-160 ${i * 8 + 6} L-210 ${i * 8 - 10} L-250 ${i * 8}`} fill="none" stroke="#fde047" strokeWidth="3" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px #fde047)' }} />}
    </Shots>
  ),
  // darkens and swells, then strikes three times: try, retry, retry
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    await play(fx(el, 'core'), [{ filter: 'brightness(1)', transform: 'scale(1)' }, { filter: 'brightness(0.55)', transform: 'scale(1.08)' }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
    const bolts = fxAll(el, 'zap');
    for (let i = 0; i < bolts.length; i++) {
      void play(bolts[i], [{ opacity: 1, transform: 'scaleX(0)', transformOrigin: 'right center' }, { opacity: 1, transform: 'scaleX(1)', transformOrigin: 'right center', offset: 0.2 }, { opacity: 0.8, transformOrigin: 'right center', offset: 0.6 }, { opacity: 0, transform: 'scaleX(1)', transformOrigin: 'right center' }], 300);
      void play(s, [{ filter: 'brightness(2.2)', transform: 'translateX(-4px)' }, { filter: 'brightness(1)', transform: 'none' }], 200);
      await wait(150);
    }
    fx(el, 'core')?.getAnimations().forEach((a) => a.cancel());
    void play(fx(el, 'core'), [{ filter: 'brightness(0.55)', transform: 'scale(1.08)' }, { filter: 'brightness(1)', transform: 'scale(1)' }], 300);
  },
  jab(el) {
    void play(fx(el, 'lightning'), [{ filter: 'brightness(1)' }, { filter: 'brightness(3)', offset: 0.3 }, { filter: 'brightness(1)' }], 260);
  },
  // the puffs burst apart and it pours
  hit(el) {
    if (!ready(el)) return;
    void flash(el, 260, 1.6);
    void play(fx(el, 'core'), [{ transform: 'none' }, { transform: 'translateX(4px) scale(1.16, 0.88)', offset: 0.25 }, { transform: 'scale(0.95, 1.05)', offset: 0.55 }, { transform: 'none' }], { duration: 460, easing: 'ease-out' });
    void play(fx(el, 'rain'), [{ transform: 'none', opacity: 1 }, { transform: 'translateY(8px) scaleY(1.6)', opacity: 1, offset: 0.4 }, { transform: 'none', opacity: 1 }], 460);
  },
  die: { cls: 'bot-die-storm', ms: 2000 },
};

// ---------------------------------------------------------------- Đàn Thundering Herd

const herd: MoveSet = {
  gait: { kf: 'hd-paw', s: 2.4, origin: '80px 130px' },
  extra: () => (
    <g data-fx="steam">
      {[-1, 1].map((d) => (
        <circle key={d} cx={80 + d * 9} cy="106" r="4" fill="#e4e4e7" opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center', ['--sx' as string]: `${d * 14}px`, animation: `hd-steam 2.4s ease-out ${d > 0 ? 0.08 : 0}s infinite` }} />
      ))}
    </g>
  ),
  front: () => (
    <>
      <Shots k="dust" n={6} x={96} y={138}>
        {(i) => <circle r={5 + (i % 3) * 2} fill="#a8a29e" fillOpacity="0.55" />}
      </Shots>
      <g data-fx="stars" opacity="0" style={{ transformOrigin: '96px 50px' }}>
        {[0, 120, 240].map((a) => (
          <path key={a} transform={`rotate(${a} 96 50) translate(96 32)`} d="M0 -4 L1.2 -1.2 L4 0 L1.2 1.2 L0 4 L-1.2 1.2 L-4 0 L-1.2 -1.2 Z" fill="#fde047" />
        ))}
      </g>
    </>
  ),
  // head down, two scrapes of the hoof, then a charge in a cloud of dust
  async strike(el, tier) {
    const s = ready(el);
    if (!s) return;
    const a = tier === 'elite' ? 1.2 : 1;
    await play(s, [{ transform: 'none' }, { transform: 'translate(4px, 4px) rotate(-8deg)', offset: 0.3 }, { transform: 'translate(6px, 2px) rotate(-8deg)', offset: 0.5 }, { transform: 'translate(4px, 4px) rotate(-8deg)', offset: 0.7 }, { transform: 'translate(8px, 2px) rotate(-9deg)' }], { duration: 520, easing: 'ease-in-out' });
    void play(fx(el, 'horns'), [{ filter: 'brightness(1)' }, { filter: 'brightness(1.8) drop-shadow(0 0 4px #fff)', offset: 0.3 }, { filter: 'brightness(1)' }], 500);
    void volley(el, 'dust', (i) => [40 + i * 12, -6 - (i % 3) * 6], { ms: 600, stagger: 30 });
    await play(s, [{ transform: 'translate(8px, 2px) rotate(-9deg)' }, { transform: `translate(${-58 * a}px, 0) rotate(-6deg) skewX(-6deg)`, offset: 0.4 }, { transform: `translate(${-50 * a}px, 0) rotate(-2deg)`, offset: 0.55 }, { transform: 'none' }], { duration: 640, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' });
  },
  jab(el) {
    void play(fxAll(el, 'dust')[0], [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 0.8, transform: 'translate(16px, -6px) scale(1.2)', offset: 0.3 }, { opacity: 0, transform: 'translate(36px, -12px) scale(1.6)' }], 500);
  },
  // shakes its head, the nose ring swinging
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 280, 1.6);
    void play(s, [0, 6, -6, 5, -4, 2, 0].map((r) => ({ transform: `rotate(${r}deg)` })), { duration: 520, easing: 'ease-out' });
    void play(fx(el, 'ring'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(40deg)', offset: 0.25 }, { transform: 'rotate(-30deg)', offset: 0.5 }, { transform: 'rotate(15deg)', offset: 0.75 }, { transform: 'rotate(0deg)' }], 700);
  },
  die: { cls: 'bot-die-herd', ms: 2000 },
};

// ---------------------------------------------------------------- Crawler Tham Lam

const crawler: MoveSet = {
  gait: { kf: 'cr-yoyo', s: 3.2, origin: '80px 0px' },
  front: ({ p }) => (
    <g transform="translate(62 112)">
      <g data-fx="silk" opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'right center' }}>
        <line x1="-240" y1="0" x2="0" y2="0" stroke={p.light} strokeWidth="1.5" strokeDasharray="5 2" />
        <g transform="translate(-240 0)" stroke={p.light} strokeWidth="1" fill="none">
          {[6, 12].map((r) => (
            <circle key={r} r={r} />
          ))}
          {[0, 45, 90, 135].map((a) => (
            <line key={a} x1="-14" y1="0" x2="14" y2="0" transform={`rotate(${a})`} />
          ))}
        </g>
      </g>
    </g>
  ),
  // drops fast on its thread and shoots a strand of web at you
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    await play(s, [{ transform: 'none' }, { transform: 'translateY(-10px)', offset: 0.4 }, { transform: 'translateY(16px) scale(1.04)', offset: 0.8 }, { transform: 'translateY(14px)' }], { duration: 420, easing: 'ease-in' });
    void play(fx(el, 'silk'), [{ opacity: 1, transform: 'translateY(14px) scaleX(0)' }, { opacity: 1, transform: 'translateY(14px) scaleX(1)', offset: 0.35 }, { opacity: 1, transform: 'translateY(14px) scaleX(1)', offset: 0.7 }, { opacity: 0, transform: 'translateY(14px) scaleX(1)' }], { duration: 600, easing: 'ease-out' });
    void play(s, [{ transform: 'translateY(14px)' }, { transform: 'translate(6px, 14px) rotate(-4deg)', offset: 0.3 }, { transform: 'translateY(14px)', offset: 0.6 }, { transform: 'none' }], { duration: 700, easing: 'ease-in-out' });
    await wait(260);
  },
  jab(el) {
    fxAll(el, 'legs').forEach((l, i) => void playAdd(l, [{ transform: 'none' }, { transform: `rotate(${i ? 12 : -12}deg)`, offset: 0.4 }, { transform: 'none' }], 260));
  },
  // zips up its thread and lowers itself again
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 260, 1.6);
    void play(s, [{ transform: 'none' }, { transform: 'translate(4px, -26px) rotate(6deg)', offset: 0.2 }, { transform: 'translateY(-22px)', offset: 0.5 }, { transform: 'translateY(3px)', offset: 0.85 }, { transform: 'none' }], { duration: 700, easing: 'ease-out' });
    fxAll(el, 'legs').forEach((l) => void playAdd(l, [{ transform: 'none' }, { transform: 'scale(0.75)', offset: 0.25 }, { transform: 'none' }], 500));
  },
  die: { cls: 'bot-die-crawler', ms: 1900 },
};

// ---------------------------------------------------------------- Rò Rỉ Bộ Nhớ

const leak: MoveSet = {
  gait: { kf: 'ml-bloat', s: 5, origin: '80px 112px' },
  extra: ({ p }) => (
    <g data-fx="bits" fontSize="7" fontFamily="monospace" fontWeight="bold" fill={p.light}>
      {[
        [50, 0, '1'],
        [80, 0.8, '0'],
        [110, 1.6, '1'],
      ].map(([x, d, b]) => (
        <text key={String(x)} x={Number(x)} y="44" opacity="0" style={{ animation: `ml-bit 2.4s ease-out ${d}s infinite` }}>
          {b}
        </text>
      ))}
    </g>
  ),
  front: ({ p }) => (
    <>
      <Shots k="bit" n={12} x={60} y={78} scatter={(i) => [Math.cos(i * 0.52) * (50 + (i % 3) * 14), Math.sin(i * 0.52) * (44 + (i % 2) * 12)]}>
        {(i) => (
          <text textAnchor="middle" y="3" fontSize="10" fontFamily="monospace" fontWeight="bold" fill={i % 2 ? p.light : p.main}>
            {i % 3 ? '1' : '0'}
          </text>
        )}
      </Shots>
      <text data-fx="oom" x="80" y="30" textAnchor="middle" fontSize="12" fontFamily="monospace" fontWeight="900" fill="#ef4444" stroke="#18181b" strokeWidth="0.5" opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        OOM KILLED
      </text>
    </>
  ),
  // swells, its gauge flashing red, then sprays leaked bits at you
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'ram'), [{ fill: '#ef4444', transform: 'scale(1)' }, { fill: '#ef4444', transform: 'scale(1.4)', offset: 0.5 }, { fill: '#ef4444', transform: 'scale(1)', offset: 0.9 }, {}], 900);
    await play(fx(el, 'core'), [{ transform: 'none' }, { transform: 'scale(1.16, 1.12)', transformOrigin: '80px 112px' }], { duration: 420, easing: 'ease-in' });
    void play(fx(el, 'core'), [{ transform: 'scale(1.16, 1.12)', transformOrigin: '80px 112px' }, { transform: 'scale(0.94, 0.97)', transformOrigin: '80px 112px', offset: 0.3 }, { transform: 'none', transformOrigin: '80px 112px' }], { duration: 400, easing: 'ease-out' });
    await volley(el, 'bit', (i) => [-(220 + ((i * 41) % 90)), ((i * 37) % 90) - 45], { ms: 560, stagger: 28 });
  },
  jab(el) {
    void play(fx(el, 'pool'), [{ transform: 'scale(1)' }, { transform: 'scale(1.2, 1.4)', offset: 0.4 }, { transform: 'scale(1)' }], 400);
  },
  // the gauge glitches, it squishes and the puddle splashes
  hit(el) {
    if (!ready(el)) return;
    void flash(el, 300, 1.6);
    void play(fx(el, 'core'), [{ transform: 'none' }, { transform: 'translateX(6px) scale(1.06, 0.92)', transformOrigin: '80px 112px', offset: 0.3 }, { transform: 'translateX(-3px) scale(0.98, 1.03)', transformOrigin: '80px 112px', offset: 0.6 }, { transform: 'none' }], { duration: 440, easing: 'ease-out' });
    void play(fx(el, 'ram'), [0, 3, -3, 2, 0].map((x, i) => ({ transform: `translateX(${x}px)`, opacity: i % 2 ? 0.3 : 1 })), { duration: 360, easing: 'steps(5)' });
    void play(fx(el, 'pool'), [{ transform: 'scale(1)' }, { transform: 'scale(1.3, 1.6)', offset: 0.3 }, { transform: 'scale(1)' }], 500);
  },
  die: { cls: 'bot-die-leak', ms: 2000 },
};

// ---------------------------------------------------------------- Cron Nửa Đêm

const cron: MoveSet = {
  gait: { kf: 'cs-ring', s: 1.6, origin: '80px 130px' },
  front: ({ p }) => (
    <>
      <Shots k="ring" n={4} x={38} y={44}>
        {() => <path d="M6 -10 Q-6 0 6 10" fill="none" stroke={p.light} strokeWidth="2.5" strokeLinecap="round" />}
      </Shots>
      <Shots k="gear" n={3} x={80} y={36}>
        {() => (
          <>
            {Array.from({ length: 6 }, (_, k) => (
              <rect key={k} x="-1.5" y="-7" width="3" height="4" fill="#a78bfa" transform={`rotate(${k * 60})`} />
            ))}
            <circle r="4.5" fill="#27272a" stroke="#a78bfa" strokeWidth="1.5" />
          </>
        )}
      </Shots>
      <path data-fx="spring" d="M80 40 l-6 -4 l12 -4 l-12 -4 l12 -4 l-12 -4 l12 -4 l-6 -3" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinejoin="round" opacity="0" style={{ transformOrigin: '80px 40px' }} />
    </>
  ),
  // the hammer goes mad on the bells, waves of sound ring out at you
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    void playAdd(fx(el, 'bells'), [0, 1, 2, 3, 4, 5].flatMap(() => [{ transform: 'rotate(-10deg)' }, { transform: 'rotate(10deg)' }]).concat({ transform: 'none' }), 700, 'linear');
    void play(fx(el, 'display'), [{ filter: 'brightness(1)', transform: 'scale(1)' }, { filter: 'brightness(2.5)', transform: 'scale(1.3)', offset: 0.3 }, { filter: 'brightness(1)', transform: 'scale(1)' }], 700);
    void play(s, [0, -3, 3, -3, 3, -2, 2, 0].map((x, i) => ({ transform: `translate(${x - (i > 3 ? 6 : 0)}px, ${i % 2 ? -3 : 0}px)` })), { duration: 700 });
    await wait(180);
    await volley(el, 'ring', () => [-240, 0], { ms: 520, stagger: 110 });
  },
  jab(el) {
    void playAdd(fx(el, 'bells'), [{ transform: 'none' }, { transform: 'rotate(-12deg)' }, { transform: 'rotate(12deg)' }, { transform: 'none' }], 240, 'linear');
  },
  // clonk: the bells knock askew and the display loses its time
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 280, 1.6);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(6px) rotate(6deg)', offset: 0.25 }, { transform: 'translateX(-2px) rotate(-3deg)', offset: 0.6 }, { transform: 'none' }], { duration: 460, easing: 'ease-out' });
    void playAdd(fx(el, 'bells'), [{ transform: 'none' }, { transform: 'translateY(-6px) rotate(18deg)', offset: 0.25 }, { transform: 'rotate(-8deg)', offset: 0.6 }, { transform: 'none' }], 560);
    void play(fx(el, 'display'), [1, 0, 1, 0, 1].map((o) => ({ opacity: o })), { duration: 400, easing: 'steps(5)' });
  },
  // the clock spits out spinning cron gears
  async summon(el) {
    const s = ready(el);
    if (!s) return;
    void play(s, [{ transform: 'none' }, { transform: 'translateY(-10px) scale(1.05)', filter: 'brightness(1.5) drop-shadow(0 0 8px #a78bfa)', offset: 0.4 }, { transform: 'none' }], { duration: 640, easing: 'ease-out' });
    await volley(el, 'gear', (i) => [(i - 1) * 34, -44 - (i % 2) * 10], { ms: 640, stagger: 90, spin: 360 });
  },
  die: { cls: 'bot-die-cron', ms: 2100 },
};

export const FLOOR1: Record<string, MoveSet> = {
  swarm,
  retry_storm: storm,
  herd,
  crawler,
  memory_leak: leak,
  cron_storm: cron,
};
