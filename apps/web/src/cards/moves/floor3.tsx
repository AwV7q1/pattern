// Floor 3:
// - Botnet Camera IoT pans like a security camera, sweeps you with a red scan and
//   floods you from its router, fills with static when hit, and ends on a NO
//   SIGNAL test card, drooping on its mount;
// - Khuếch Đại DNS kicks with every shout, turns around to blast you, squeals
//   with feedback when hit, and deflates into silence;
// - Sâu Zero-day inches along with a wave through its segments, rears and bites,
//   spitting exploit code, ripples when hit, and falls apart segment by segment;
// - Băng Tống Tiền rattles like a lock being tried, snaps shut and throws a
//   chain, pops open a crack when hit, and gets decrypted: a key turns, the
//   shackle springs, the note flies off;
// - Nhóm APT (elite) lurks half-visible, vanishes and reappears for a dagger
//   slash, turns to smoke when hit, and dissolves, leaving only the dagger;
// - Botnet Hydra (elite) sways its three heads, strikes with each in turn,
//   sprouts a new head, and its heads droop one by one.
import { flash, fx, fxAll, play, playAdd, ready, Shots, volley, wait, type MoveSet } from './kit';

const toLeft = (spread: number, from = 230) => (i: number): [number, number] => [-(from + ((i * 37) % 60)), ((i * 29) % (spread * 2)) - spread];

// ---------------------------------------------------------------- Botnet Camera IoT

const BARS = ['#e5e7eb', '#facc15', '#22d3ee', '#4ade80', '#d946ef', '#ef4444', '#3b82f6'];

const iot: MoveSet = {
  gait: { kf: 'iot-pan', s: 4.4, origin: '119px 40px' },
  front: () => (
    <>
      <g data-fx="cone" opacity="0" style={{ transformOrigin: '40px 76px' }}>
        <defs>
          <linearGradient id="iot-cone" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M40 76 L-200 30 L-200 122 Z" fill="url(#iot-cone)" />
      </g>
      <Shots k="pkt" n={10} x={80} y={119}>
        {(i) => <rect x="-2.5" y="-2.5" width="5" height="5" rx="1" fill={i % 3 ? '#ef4444' : '#4ade80'} />}
      </Shots>
      <g data-fx="static" opacity="0">
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} x={36 + ((i * 17) % 30)} y={58 + i * 5.5} width={40 + ((i * 23) % 36)} height="2" fill="#e5e7eb" opacity={0.4 + (i % 3) * 0.2} />
        ))}
      </g>
      <g data-fx="bars" opacity="0">
        {BARS.map((c, i) => (
          <rect key={c} x={38 + i * 11} y="58" width="11" height="36" fill={c} />
        ))}
        <rect x="38" y="84" width="77" height="10" fill="#18181b" />
        <text x="76" y="92" textAnchor="middle" fontSize="7" fontFamily="monospace" fontWeight="bold" fill="#fff">
          NO SIGNAL
        </text>
      </g>
    </>
  ),
  // REC blinks, a red scan sweeps over you, the router floods packets
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'rec'), [1, 2, 1, 2, 1, 2, 1].map((k) => ({ transform: `scale(${k})` })), { duration: 600, easing: 'steps(7)' });
    void play(s, [{ transform: 'none' }, { transform: 'translateX(-6px) scale(1.05)', offset: 0.4 }, { transform: 'translateX(-6px) scale(1.05)', offset: 0.8 }, { transform: 'none' }], { duration: 1000, easing: 'ease-in-out' });
    await play(fx(el, 'cone'), [{ opacity: 0, transform: 'rotate(-8deg)' }, { opacity: 1, transform: 'rotate(-8deg)', offset: 0.15 }, { opacity: 1, transform: 'rotate(8deg)', offset: 0.75 }, { opacity: 0, transform: 'rotate(0deg)' }], { duration: 640, easing: 'ease-in-out' });
    fxAll(el, 'led').forEach((l) => void play(l, [{ fill: '#ef4444' }, { fill: '#ef4444' }], 700));
    await volley(el, 'pkt', toLeft(30, 250), { ms: 520, stagger: 35 });
  },
  jab(el) {
    void play(fx(el, 'rec'), [{ transform: 'scale(1)' }, { transform: 'scale(2)', offset: 0.4 }, { transform: 'scale(1)' }], 300);
    void play(fxAll(el, 'pkt')[0], [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0, transform: 'translate(-250px, -10px)' }], 460);
  },
  // the picture breaks up into static
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'static'), [0, 1, 0.3, 1, 0.5, 0].map((o, i) => ({ opacity: o, transform: `translateX(${i % 2 ? 6 : -4}px)` })), { duration: 420, easing: 'steps(6)' });
    void play(s, [{ transform: 'none' }, { transform: 'translateX(5px) skewX(-6deg)', offset: 0.3 }, { transform: 'translateX(-2px) skewX(3deg)', offset: 0.6 }, { transform: 'none' }], { duration: 380 });
  },
  die: { cls: 'bot-die-iot', ms: 2200 },
};

// ---------------------------------------------------------------- Khuếch Đại DNS

const amplifier: MoveSet = {
  gait: { kf: 'amp-kick', s: 1.6, origin: '60px 120px' },
  front: ({ p }) => (
    <>
      <Shots k="blast" n={4} x={28} y={80}>
        {(i) => <path d={`M10 ${-22 - i * 4} Q${-10 - i * 3} 0 10 ${22 + i * 4}`} fill="none" stroke={i % 2 ? p.light : p.main} strokeWidth="4" strokeLinecap="round" />}
      </Shots>
      <text data-fx="mute" x="92" y="40" textAnchor="middle" fontSize="13" fontFamily="monospace" fontWeight="900" fill="#a1a1aa" opacity="0">
        ×0
      </text>
    </>
  ),
  // swings round to face you, sucks in air, and blasts fifty times louder
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    const core = fx(el, 'core');
    const o = '80px 80px';
    void play(fx(el, 'x50'), [{ opacity: 0 }, { opacity: 0, offset: 0.9 }, { opacity: 1 }], 1400);
    await play(core, [{ transform: 'none', transformOrigin: o }, { transform: 'scaleX(-1)', transformOrigin: o }], { duration: 320, easing: 'ease-in-out' });
    await play(core, [{ transform: 'scaleX(-1)', transformOrigin: o }, { transform: 'scaleX(-1) translateX(-8px) scale(0.92)', transformOrigin: o }], { duration: 260, easing: 'ease-in' });
    void play(s, [0, -4, 3, -3, 2, 0].map((x) => ({ transform: `translateX(${x + 8}px)` })).concat({ transform: 'none' }), { duration: 500 });
    void play(
      core,
      [
        { transform: 'scaleX(-1) translateX(-8px) scale(0.92)', transformOrigin: o },
        { transform: 'scaleX(-1) translateX(6px) scale(1.08)', transformOrigin: o, offset: 0.2 },
        { transform: 'scaleX(-1)', transformOrigin: o, offset: 0.7 },
        { transform: 'none', transformOrigin: o },
      ],
      { duration: 800, easing: 'ease-out' },
    );
    await volley(el, 'blast', () => [-240, 0], { ms: 520, stagger: 70 });
  },
  jab(el) {
    void play(fx(el, 'waves'), [{ transform: 'none' }, { transform: 'translateX(8px) scale(1.1)', transformOrigin: '134px 80px', offset: 0.4 }, { transform: 'none' }], 300);
  },
  // feedback: a high squeal that shakes it and turns its waves jagged red
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 260, 1.6);
    void play(s, Array.from({ length: 9 }, (_, i) => ({ transform: `translate(${i % 2 ? 2 : -2}px, ${i % 3 ? 1 : -1}px)` })).concat({ transform: 'none' }), { duration: 420 });
    void play(fx(el, 'waves'), [{ filter: 'none' }, { filter: 'hue-rotate(-40deg) saturate(3) brightness(1.4)', transform: 'scaleY(1.2)', transformOrigin: '134px 80px', offset: 0.3 }, { filter: 'none' }], 480);
  },
  die: { cls: 'bot-die-amp', ms: 2000 },
};

// ---------------------------------------------------------------- Sâu Zero-day

const CODE = ['0x0d', 'ff', 'NOP', 'jmp', '0day'];

const worm: MoveSet = {
  gait: { kf: 'wm-inch', s: 2.2, origin: '30px 130px' },
  front: ({ p }) => (
    <Shots k="code" n={5} x={88} y={84}>
      {(i) => (
        <text textAnchor="middle" y="3" fontSize="8" fontFamily="monospace" fontWeight="bold" fill={i % 2 ? p.light : '#4ade80'}>
          {CODE[i]}
        </text>
      )}
    </Shots>
  ),
  // rears back on its tail, lunges, bites twice, and spits exploit code
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    const o = '30px 130px';
    await play(fx(el, 'core'), [{ transform: 'none', transformOrigin: o }, { transform: 'rotate(10deg) scale(1.04, 1.08)', transformOrigin: o }], { duration: 380, easing: 'ease-out' });
    void play(fx(el, 'core'), [{ transform: 'rotate(10deg) scale(1.04, 1.08)', transformOrigin: o }, { transform: 'translateX(-34px) rotate(-14deg) scale(1.1, 0.96)', transformOrigin: o, offset: 0.3 }, { transform: 'translateX(-28px) rotate(-10deg)', transformOrigin: o, offset: 0.6 }, { transform: 'none', transformOrigin: o }], { duration: 760, easing: 'ease-out' });
    void play(fx(el, 'jaw'), [1, 1.8, 0.6, 1.8, 0.6, 1].map((k) => ({ transform: `scaleY(${k})` })), { duration: 500, delay: 120 });
    await wait(160);
    await volley(el, 'code', toLeft(30), { ms: 540, stagger: 60, spin: 20 });
  },
  jab(el) {
    void play(fx(el, 'jaw'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.9)', offset: 0.4 }, { transform: 'scaleY(1)' }], 260);
  },
  // the blow ripples down its segments, head to tail
  hit(el) {
    if (!ready(el)) return;
    void flash(el, 280, 1.6);
    fxAll(el, 'seg')
      .reverse()
      .forEach((sg, i) => void playAdd(sg, [{ transform: 'none' }, { transform: 'translate(6px, -6px) scale(1.12)', offset: 0.35 }, { transform: 'none' }], 300 + i * 40));
    void play(fx(el, 'core'), [{ transform: 'none' }, { transform: 'translateX(5px) rotate(4deg)', transformOrigin: '30px 130px', offset: 0.3 }, { transform: 'none', transformOrigin: '30px 130px' }], { duration: 420, easing: 'ease-out' });
  },
  die: { cls: 'bot-die-worm', ms: 2200 },
};

// ---------------------------------------------------------------- Băng Tống Tiền

const ransom: MoveSet = {
  gait: { kf: 'rg-rattle', s: 2.2, origin: '80px 130px' },
  front: () => (
    <>
      <g transform="translate(40 96)">
        <g data-fx="chain" opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'right center' }}>
          {Array.from({ length: 16 }, (_, i) => (
            <ellipse key={i} cx={-i * 15} cy="0" rx="8" ry={i % 2 ? 2.5 : 4.5} fill="none" stroke="#a1a1aa" strokeWidth="2.5" />
          ))}
          <g transform="translate(-246 0)">
            <rect x="-9" y="-4" width="18" height="15" rx="3" fill="#e11d48" />
            <path d="M-5 -4 V-8 Q-5 -13 0 -13 Q5 -13 5 -8 V-4" fill="none" stroke="#a1a1aa" strokeWidth="2.5" />
          </g>
        </g>
      </g>
      <g data-fx="dkey" opacity="0">
        <g transform="translate(80 114)">
          <circle cx="-14" r="5" fill="none" stroke="#4ade80" strokeWidth="2.5" />
          <path d="M-9 0 H2 M-2 0 V3 M1 0 V3" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      </g>
    </>
  ),
  // snaps itself shut with a click and throws a chain to lock you down
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    await play(fx(el, 'shackle'), [{ transform: 'none' }, { transform: 'translateY(-10px)', offset: 0.5 }, { transform: 'translateY(3px)', offset: 0.8 }, { transform: 'none' }], { duration: 380, easing: 'ease-in' });
    void flash(el, 200, 1.8);
    void playAdd(fx(el, 'note'), [{ transform: 'none' }, { transform: 'rotate(-25deg)', offset: 0.3 }, { transform: 'rotate(12deg)', offset: 0.6 }, { transform: 'none' }], 700);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(-10px) rotate(-4deg)', offset: 0.3 }, { transform: 'none' }], { duration: 500, easing: 'ease-out' });
    await play(fx(el, 'chain'), [{ opacity: 1, transform: 'scaleX(0)' }, { opacity: 1, transform: 'scaleX(1)', offset: 0.4 }, { opacity: 1, transform: 'scaleX(1)', offset: 0.75 }, { opacity: 0, transform: 'scaleX(1) translateY(6px)' }], { duration: 700, easing: 'ease-out' });
  },
  jab(el) {
    void play(fx(el, 'shackle'), [{ transform: 'none' }, { transform: 'translateY(-5px)', offset: 0.5 }, { transform: 'none' }], 240);
  },
  // the shackle pops open a crack and slams back; the note flaps
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 260, 1.6);
    void play(s, [0, 6, -5, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380 });
    void play(fx(el, 'shackle'), [{ transform: 'none' }, { transform: 'translateY(-9px) rotate(-8deg)', offset: 0.3 }, { transform: 'translateY(1px)', offset: 0.7 }, { transform: 'none' }], { duration: 480, easing: 'ease-out' });
    void playAdd(fx(el, 'note'), [{ transform: 'none' }, { transform: 'rotate(20deg)', offset: 0.3 }, { transform: 'rotate(-10deg)', offset: 0.65 }, { transform: 'none' }], 600);
  },
  die: { cls: 'bot-die-ransom', ms: 2300 },
};

// ---------------------------------------------------------------- Nhóm APT

const apt: MoveSet = {
  gait: { kf: 'apt-lurk', s: 4.6, origin: '80px 130px' },
  front: ({ p }) => (
    <>
      <path data-fx="slash" d="M-120 40 Q-60 70 -110 130" fill="none" stroke={p.light} strokeWidth="4" strokeLinecap="round" pathLength={100} strokeDasharray="100" strokeDashoffset="100" opacity="0" style={{ filter: `drop-shadow(0 0 6px ${p.light})` }} />
      <Shots k="smoke" n={6} x={80} y={84} scatter={(i) => [((i * 41) % 80) - 40, -20 - ((i * 23) % 40)]}>
        {(i) => <circle r={7 + (i % 3) * 3} fill={p.main} fillOpacity="0.45" />}
      </Shots>
    </>
  ),
  // fades out, reappears right in front of you for one slash, and is gone again
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    const gone = { opacity: 0, filter: 'blur(4px)' };
    const here = { opacity: 1, filter: 'blur(0)' };
    void play(fx(el, 'slash'), [{ opacity: 1, strokeDashoffset: 100 }, { opacity: 1, strokeDashoffset: 0, offset: 0.5 }, { opacity: 0, strokeDashoffset: 0 }], { duration: 420, delay: 520, easing: 'ease-out' });
    void play(fx(el, 'dagger'), [{ transform: 'none' }, { transform: 'rotate(-120deg)', offset: 0.5 }, { transform: 'rotate(40deg)' }], { duration: 400, delay: 480 });
    await play(
      s,
      [
        { ...here, transform: 'none' },
        { ...gone, transform: 'scaleX(0.6)', offset: 0.22 },
        { ...gone, transform: 'translateX(-70px) scaleX(0.6)', offset: 0.32 },
        { ...here, transform: 'translateX(-70px) scale(1.06)', offset: 0.42 },
        { ...here, transform: 'translateX(-76px) rotate(-6deg)', offset: 0.62 },
        { ...gone, transform: 'translateX(-70px) scaleX(0.6)', offset: 0.76 },
        { ...gone, transform: 'scaleX(0.6)', offset: 0.84 },
        { ...here, transform: 'none' },
      ],
      { duration: 1200, easing: 'ease-in-out' },
    );
  },
  jab(el) {
    void play(fx(el, 'dagger'), [{ transform: 'none' }, { transform: 'rotate(-40deg)', offset: 0.4 }, { transform: 'none' }], 300);
  },
  // turns to smoke for a moment and pulls itself back together
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void play(s, [{ opacity: 1, filter: 'blur(0)' }, { opacity: 0.25, filter: 'blur(3px)', offset: 0.3 }, { opacity: 0.6, filter: 'blur(1px)', offset: 0.7 }, { opacity: 1, filter: 'blur(0)' }], { duration: 620, easing: 'ease-out' });
    void volley(el, 'smoke', (i) => [((i * 41) % 60) - 30 + 10, -10 - ((i * 23) % 30)], { ms: 600, stagger: 30 });
  },
  die: { cls: 'bot-die-apt', ms: 2300 },
};

// ---------------------------------------------------------------- Botnet Hydra

const hydra: MoveSet = {
  gait: { kf: 'hy-coil', s: 3, origin: '80px 136px' },
  front: ({ p }) => (
    <>
      <Shots k="venom" n={3} x={40} y={66}>
        {() => <path d="M2 -6 Q8 0 2 6 Q-10 0 2 -6 Z" fill="#a3e635" stroke="#365314" strokeWidth="0.8" style={{ filter: 'drop-shadow(0 0 3px #a3e635)' }} />}
      </Shots>
      <g transform="translate(80 132)">
        <g data-fx="sprout" opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'bottom center' }}>
          <path d="M0 0 Q-8 -20 2 -34" fill="none" stroke={p.main} strokeWidth="7" strokeLinecap="round" />
          <ellipse cx="5" cy="-38" rx="10" ry="7" fill={p.dark} stroke={p.main} strokeWidth="2" />
          <circle cx="8" cy="-40" r="2" fill="#fde047" />
        </g>
      </g>
    </>
  ),
  // the heads strike in turn: left, middle, right, and spit venom
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    const [left, right] = fxAll(el, 'head');
    const lunge = (n: Element | undefined, d: number) => play(n, [{ transform: 'none' }, { transform: `rotate(${d * 8}deg)`, offset: 0.3 }, { transform: `translate(-34px, 6px) rotate(${-d * 18}deg) scale(1.25)`, offset: 0.55 }, { transform: 'none' }], { duration: 440, easing: 'ease-out' });
    void lunge(left, -1);
    void volley(el, 'venom', (i) => [-240, (i - 1) * 16], { ms: 500, stagger: 160 });
    await wait(150);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(6px)', offset: 0.3 }, { transform: 'translateX(-22px) scale(1.06)', offset: 0.55 }, { transform: 'none' }], { duration: 440, easing: 'ease-out' });
    await wait(150);
    await lunge(right, 1);
  },
  jab(el) {
    const heads = fxAll(el, 'head');
    void playAdd(heads[Math.floor(Math.random() * heads.length)], [{ transform: 'none' }, { transform: 'translateX(-10px) rotate(-6deg)', offset: 0.4 }, { transform: 'none' }], 300);
  },
  // the side heads recoil away from the blow
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 280, 1.6);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(5px) scale(0.97)', offset: 0.3 }, { transform: 'none' }], { duration: 400, easing: 'ease-out' });
    fxAll(el, 'head').forEach((h, i) => void playAdd(h, [{ transform: 'none' }, { transform: `rotate(${i ? 18 : -18}deg)`, offset: 0.3 }, { transform: `rotate(${i ? -5 : 5}deg)`, offset: 0.65 }, { transform: 'none' }], 560));
  },
  // a new head sprouts from the coil
  async summon(el) {
    const s = ready(el);
    if (!s) return;
    void play(s, [{ transform: 'none' }, { transform: 'scale(1.04, 0.96)', filter: 'brightness(1.4) drop-shadow(0 0 8px #10b981)', offset: 0.4 }, { transform: 'none' }], { duration: 800 });
    await play(fx(el, 'sprout'), [{ opacity: 0, transform: 'scale(0.1)' }, { opacity: 1, transform: 'scale(1.15) rotate(-6deg)', offset: 0.45 }, { opacity: 1, transform: 'scale(1) rotate(4deg)', offset: 0.75 }, { opacity: 0, transform: 'translate(-30px, -10px) scale(0.6)' }], { duration: 1000, easing: 'ease-out' });
  },
  die: { cls: 'bot-die-hydra', ms: 2300 },
};

export const FLOOR3: Record<string, MoveSet> = {
  iot_botnet: iot,
  amplifier,
  worm,
  ransom_gang: ransom,
  apt_group: apt,
  hydra,
};
