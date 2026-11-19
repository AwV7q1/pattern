// Floor 1 warmup mini bots. Small, loud and a bit silly:
// - Script Kiddie nods to the music in its headphones, pastes skulls of copied
//   scripts at you, loses its cap when hit and rage-quits when beaten;
// - Bot Ping tilts its head to listen, sends out rings from its antenna, fires
//   ping waves, drops packets when hit and times out when beaten;
// - Bot Spam Form waddles and waves its mail flag, flings envelopes, the flag
//   shoots up to call Tin Rác, and it tips over in a burst of mail;
// - Bot Kiểm Tra Uptime paces to its heartbeat, sends a pulse at you, goes into
//   fibrillation when hit and flatlines when beaten.
import { flash, fx, fxAll, play, playAdd, ready, Shots, volley, type MoveSet } from './kit';

const toLeft = (spread: number, from = 230) => (i: number): [number, number] => [-(from + ((i * 37) % 60)), ((i * 29) % (spread * 2)) - spread];

// ---------------------------------------------------------------- Script Kiddie

const kiddie: MoveSet = {
  gait: { kf: 'sk-groove', s: 1.05, origin: '80px 140px' },
  extra: ({ p }) => (
    <g data-fx="notes" fill={p.light} fontSize="11" fontFamily="sans-serif">
      {[
        [118, 80, 0],
        [40, 80, 0.9],
        [120, 70, 1.6],
      ].map(([x, y, d]) => (
        <text key={d} x={x} y={y} opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: `sk-note 2.4s ease-out ${d}s infinite` }}>
          ♪
        </text>
      ))}
    </g>
  ),
  front: ({ p }) => (
    <>
      <text data-fx="paste" x="80" y="34" textAnchor="middle" fontSize="10" fontFamily="monospace" fontWeight="bold" fill={p.light} opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        Ctrl+V
      </text>
      <Shots k="skull" n={5} x={62} y={92}>
        {() => (
          <>
            <circle r="5" fill={p.light} />
            <rect x="-3" y="2.5" width="6" height="3.5" rx="1" fill={p.light} />
            <circle cx="-1.8" cy="-0.6" r="1.3" fill="#18181b" />
            <circle cx="1.8" cy="-0.6" r="1.3" fill="#18181b" />
          </>
        )}
      </Shots>
      <text data-fx="quit" x="80" y="40" textAnchor="middle" fontSize="13" fontFamily="monospace" fontWeight="900" fill="#ef4444" stroke="#18181b" strokeWidth="0.6" opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        RAGE QUIT
      </text>
    </>
  ),
  // hammers the keyboard, "Ctrl+V", and copied skulls bounce at you
  async strike(el, tier) {
    const svg = ready(el);
    if (!svg) return;
    const a = tier === 'mini' ? 1 : 1.2;
    void play(fx(el, 'paste'), [{ opacity: 0, transform: 'translateY(6px) scale(0.6)' }, { opacity: 1, transform: 'translateY(0) scale(1.15)', offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 0, transform: 'translateY(-8px)' }], 900);
    await play(svg, [0, -3, 3, -3, 3, -2, 2, 0].map((x, i) => ({ transform: `translate(${x * a}px, ${i % 2 ? 2 : 0}px)` })), { duration: 380 });
    void play(svg, [{ transform: 'none' }, { transform: `translateX(${-14 * a}px) rotate(-6deg)`, offset: 0.35 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
    await volley(el, 'skull', toLeft(30), { ms: 520, stagger: 70, spin: 260 });
  },
  jab(el) {
    void playAdd(fx(el, 'cap'), [{ transform: 'none' }, { transform: 'translateY(-5px) rotate(-8deg)', offset: 0.4 }, { transform: 'none' }], 300);
    void play(fxAll(el, 'skull')[0], [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'translate(-30px, -6px) scale(1.1)', offset: 0.2 }, { opacity: 0, transform: 'translate(-240px, 10px) rotate(-200deg)' }], 460);
  },
  // the cap flies off and lands back on, a little crooked
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 320, 1.9);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(12px) rotate(10deg)', offset: 0.25 }, { transform: 'translateX(-3px) rotate(-4deg)', offset: 0.6 }, { transform: 'none' }], { duration: 460, easing: 'ease-out' });
    void playAdd(
      fx(el, 'cap'),
      [
        { transform: 'none' },
        { transform: 'translate(14px, -34px) rotate(140deg)', offset: 0.35, easing: 'ease-in' },
        { transform: 'translate(4px, -4px) rotate(340deg)', offset: 0.75 },
        { transform: 'translate(0, 0) rotate(360deg)' },
      ],
      700,
    );
  },
  die: { cls: 'bot-die-kiddie', ms: 1500 },
};

// ---------------------------------------------------------------- Bot Ping

const ping: MoveSet = {
  gait: { kf: 'pg-tilt', s: 3.6, origin: '80px 130px' },
  back: ({ p }) => (
    <g data-fx="emit">
      {[0, 1.2].map((d) => (
        <circle key={d} cx="80" cy="38" r="8" fill="none" stroke={p.light} strokeWidth="1.5" opacity="0" style={{ transformOrigin: '80px 38px', animation: `pg-emit 2.4s ease-out ${d}s infinite` }} />
      ))}
    </g>
  ),
  front: ({ p }) => (
    <>
      <Shots k="wave" n={3} x={50} y={84}>
        {() => <path d="M6 -14 Q-8 0 6 14" fill="none" stroke={p.light} strokeWidth="3" strokeLinecap="round" />}
      </Shots>
      <text data-fx="lost" x="80" y="146" textAnchor="middle" fontSize="7.5" fontFamily="monospace" fill="#fca5a5" opacity="0">
        Request timed out.
      </text>
    </>
  ),
  // the antenna charges, then three ping waves, one per nod
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'lamp'), [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(2.2)', filter: 'brightness(2.5)', offset: 0.7 }, { transform: 'scale(1)', filter: 'brightness(1)' }], 700);
    await play(s, [{ transform: 'none' }, { transform: 'translateX(6px) rotate(5deg)' }], { duration: 380, easing: 'ease-out' });
    void play(s, [0, 1, 2].flatMap(() => [{ transform: 'translateX(6px) rotate(5deg)' }, { transform: 'translateX(-6px) rotate(-3deg)' }]).concat({ transform: 'none' }), { duration: 620 });
    await volley(el, 'wave', () => [-250, 0], { ms: 560, stagger: 150 });
  },
  jab(el) {
    void play(fxAll(el, 'wave')[1], [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'translateX(-30px) scale(1.1)', offset: 0.2 }, { opacity: 0, transform: 'translateX(-250px)' }], 500);
  },
  // packet loss: it blinks out for a few frames and its lamp goes red
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void play(s, [1, 0.2, 1, 0.1, 0.8, 1].map((o, i) => ({ opacity: o, transform: `translateX(${i % 2 ? 4 : 0}px)` })), { duration: 420, easing: 'steps(6)' });
    void play(fx(el, 'lamp'), [{ fill: '#ef4444' }, { fill: '#ef4444', offset: 0.7 }, {}], 600);
  },
  die: { cls: 'bot-die-ping', ms: 1700 },
};

// ---------------------------------------------------------------- Bot Spam Form

const spam: MoveSet = {
  gait: { kf: 'sp-waddle', s: 1.1, origin: '80px 138px' },
  front: () => (
    <Shots k="mail" n={6} x={80} y={94} scatter={(i) => [((i * 47) % 120) - 60, -40 - ((i * 31) % 50)]}>
      {(i) => (
        <>
          <rect x="-7" y="-5" width="14" height="10" rx="1.5" fill="#fafafa" stroke={i % 2 ? '#f59e0b' : '#ef4444'} />
          <path d="M-6 -4 L0 1 L6 -4" fill="none" stroke={i % 2 ? '#f59e0b' : '#ef4444'} />
        </>
      )}
    </Shots>
  ),
  // leans back and empties its slot: a fan of envelopes
  async strike(el, tier) {
    const s = ready(el);
    if (!s) return;
    const a = tier === 'mini' ? 1 : 1.2;
    void playAdd(fx(el, 'flag'), [{ transform: 'none' }, { transform: 'rotate(-50deg)', offset: 0.4 }, { transform: 'none' }], 700);
    await play(s, [{ transform: 'none' }, { transform: `translateX(${8 * a}px) rotate(6deg) scale(1.04)` }], { duration: 300, easing: 'ease-out' });
    void play(s, [{ transform: `translateX(${8 * a}px) rotate(6deg) scale(1.04)` }, { transform: `translateX(${-12 * a}px) rotate(-5deg) scale(0.96)`, offset: 0.3 }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
    await volley(el, 'mail', toLeft(40), { ms: 560, stagger: 55, spin: 300 });
  },
  jab(el) {
    void play(fxAll(el, 'mail')[2], [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'translate(-24px, -10px) scale(1.1)', offset: 0.2 }, { opacity: 0, transform: 'translate(-240px, 6px) rotate(-260deg)' }], 480);
  },
  // the flag shoots up, two envelopes pop out of the top: "new account!"
  async summon(el) {
    const s = ready(el);
    if (!s) return;
    void playAdd(fx(el, 'flag'), [{ transform: 'none' }, { transform: 'rotate(-80deg)', offset: 0.3 }, { transform: 'rotate(-80deg)', offset: 0.7 }, { transform: 'none' }], 800);
    void play(s, [{ transform: 'none' }, { transform: 'translateY(-12px) scale(1.06)', offset: 0.4 }, { transform: 'translateY(2px) scale(1.06, 0.94)', offset: 0.7 }, { transform: 'none' }], { duration: 620, easing: 'ease-out' });
    await volley(el, 'mail', (i) => [i % 2 ? 26 : -26, -70], { ms: 600, stagger: 90, spin: 40 });
  },
  // the flag drops flat, then springs back up
  hit(el, tier) {
    const s = ready(el);
    if (!s) return;
    void flash(el);
    void play(s, [{ transform: 'none' }, { transform: `translateX(${tier === 'mini' ? 10 : 7}px) scale(1.08, 0.9)`, offset: 0.3 }, { transform: 'translateX(-2px) scale(0.97, 1.04)', offset: 0.6 }, { transform: 'none' }], { duration: 440, easing: 'ease-out' });
    void playAdd(fx(el, 'flag'), [{ transform: 'none' }, { transform: 'rotate(95deg)', offset: 0.2 }, { transform: 'rotate(95deg)', offset: 0.5 }, { transform: 'rotate(-20deg)', offset: 0.8 }, { transform: 'none' }], 700);
  },
  die: { cls: 'bot-die-spam', ms: 1600 },
};

// ---------------------------------------------------------------- Bot Kiểm Tra Uptime

const uptime: MoveSet = {
  gait: { kf: 'ut-pace', s: 1.4, origin: '80px 138px' },
  front: ({ p }) => (
    <>
      <Shots k="pulse" n={2} x={48} y={96}>
        {() => <path d="M-14 0 H-6 L-3 -9 L2 9 L5 -4 L7 0 H14" fill="none" stroke={p.light} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
      </Shots>
      <text data-fx="zero" x="80" y="40" textAnchor="middle" fontSize="10" fontFamily="monospace" fontWeight="bold" fill="#ef4444" opacity="0">
        UPTIME 0%
      </text>
    </>
  ),
  // the line on its screen spikes, and the spike leaves the screen at you
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'ecg'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(2.2)', filter: 'brightness(2)', offset: 0.4 }, { transform: 'scaleY(0.6)', offset: 0.6 }, { transform: 'scaleY(1)' }], 600);
    await play(s, [{ transform: 'none' }, { transform: 'translateY(-4px) scale(1.06)', offset: 0.5 }, { transform: 'translateY(2px) scale(0.98)' }], { duration: 300, easing: 'ease-out' });
    void play(s, [{ transform: 'translateY(2px) scale(0.98)' }, { transform: 'translateX(-14px)', offset: 0.4 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
    await volley(el, 'pulse', () => [-250, 0], { ms: 520, stagger: 160 });
  },
  jab(el) {
    void play(fx(el, 'ecg'), [{ transform: 'scaleY(1)' }, { transform: 'scaleY(1.8)', offset: 0.4 }, { transform: 'scaleY(1)' }], 300);
  },
  // fibrillation: the line goes wild, the lamp flashes red
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'ecg'), [1, -1.6, 2, -1.2, 1.5, 1].map((k) => ({ transform: `scaleY(${k})` })), { duration: 480, easing: 'steps(6)' });
    void play(fx(el, 'lamp'), [{ fill: '#ef4444' }, { fill: '#ef4444', offset: 0.8 }, {}], 600);
    void play(s, [0, 6, -5, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380 });
  },
  die: { cls: 'bot-die-uptime', ms: 1900 },
};

export const WARMUP: Record<string, MoveSet> = {
  script_kiddie: kiddie,
  ping_bot: ping,
  spam_bot: spam,
  uptime_bot: uptime,
};
