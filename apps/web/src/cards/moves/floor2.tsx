// Floor 2:
// - Scraper Đối Thủ rolls back and forth on its wheels, sucks your price tags in
//   through its hose, coughs dust when hit, and bursts when its bag overloads;
// - Credential Stuffer tiptoes, jingling its stolen keys, tries key after key on
//   you, drops its loot when hit, and gets caught: sirens, hands up, it slinks off;
// - Slowloris hangs on its cable and does everything slowly: a slow lunge while
//   held connections crawl down the cable, a late flinch, and it falls asleep;
// - Bot Săn Sneaker jogs in place, sprints at you in a blur of afterimages,
//   tips onto its heel when hit and gets kicked up out of sight;
// - Trại Click Farm (elite) hums, its screens lighting in turn, floods you with
//   cursors, ejects another phone, and goes dark screen by screen;
// - Kẻ Lạm Dụng API (elite) bounces between breathing braces, clamps them and
//   fires a burst of requests, and gets its key revoked (401): braces fall apart.
import { flash, fx, fxAll, play, playAdd, ready, Shots, volley, wait, type MoveSet } from './kit';

const toLeft = (spread: number, from = 230) => (i: number): [number, number] => [-(from + ((i * 37) % 60)), ((i * 29) % (spread * 2)) - spread];

// ---------------------------------------------------------------- Scraper

const scraper: MoveSet = {
  gait: { kf: 'sc-roll', s: 2.4, origin: '80px 118px' },
  front: ({ p }) => (
    <>
      <Shots k="loot" n={7} x={104} y={130} scatter={(i) => [((i * 41) % 100) - 50, -30 - ((i * 27) % 50)]}>
        {(i) =>
          i % 2 ? (
            <text textAnchor="middle" y="3" fontSize="9" fontFamily="monospace" fontWeight="bold" fill={p.light}>
              $
            </text>
          ) : (
            <>
              <path d="M-6 -4 L4 -4 L7 0 L4 4 L-6 4 Z" fill={p.light} />
              <circle cx="3.5" cy="0" r="1" fill={p.dark} />
            </>
          )
        }
      </Shots>
      <Shots k="dust" n={3} x={124} y={92}>
        {() => <circle r="5" fill="#a8a29e" fillOpacity="0.6" />}
      </Shots>
    </>
  ),
  // swings its hose at you and sucks in everything with a price on it
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'hose'), [{ transform: 'none' }, { transform: 'rotate(-28deg) translateX(-6px)', offset: 0.25 }, { transform: 'rotate(-28deg) translateX(-6px)', offset: 0.8 }, { transform: 'none' }], { duration: 1000, easing: 'ease-in-out' });
    void play(s, [0, 1, 2, 3, 4, 5, 6].map((k) => ({ transform: `translate(${k % 2 ? -2 : 1}px, ${k % 2 ? 1 : 0}px)` })).concat({ transform: 'none' }), { duration: 700 });
    fxAll(el, 'loot').forEach((l, i) => {
      const dx = -(230 + ((i * 37) % 70));
      const dy = ((i * 29) % 60) - 40;
      l.animate(
        [
          { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(1.2)` },
          { opacity: 1, transform: `translate(${dx * 0.8}px, ${dy * 0.8}px) rotate(-30deg) scale(1.2)`, offset: 0.15 },
          { opacity: 1, transform: `translate(${dx * 0.2}px, ${dy * 0.3}px) rotate(160deg) scale(0.9)`, offset: 0.8 },
          { opacity: 0, transform: 'translate(0, 0) scale(0.2)' },
        ],
        { duration: 620, delay: i * 50, easing: 'ease-in', fill: 'backwards' },
      );
    });
    await wait(820);
    // gulp
    await play(s, [{ transform: 'none' }, { transform: 'scale(1.08, 0.94)', offset: 0.4 }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
  },
  jab(el) {
    void playAdd(fx(el, 'hose'), [{ transform: 'none' }, { transform: 'rotate(-14deg)', offset: 0.4 }, { transform: 'none' }], 320);
  },
  // the hose jerks and dust puffs out of the back
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 280, 1.6);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(8px) rotate(4deg)', offset: 0.3 }, { transform: 'translateX(-2px)', offset: 0.65 }, { transform: 'none' }], { duration: 440, easing: 'ease-out' });
    void playAdd(fx(el, 'hose'), [{ transform: 'none' }, { transform: 'rotate(22deg)', offset: 0.25 }, { transform: 'rotate(-10deg)', offset: 0.6 }, { transform: 'none' }], 560);
    void volley(el, 'dust', (i) => [20 + i * 10, -10 + i * 8], { ms: 600, stagger: 60 });
  },
  die: { cls: 'bot-die-scraper', ms: 2000 },
};

// ---------------------------------------------------------------- Credential Stuffer

const stuffer: MoveSet = {
  gait: { kf: 'cs-tiptoe', s: 2.6, origin: '80px 130px' },
  front: () => (
    <>
      <Shots k="key" n={4} x={60} y={96}>
        {(i) => (
          <g stroke={i === 3 ? '#4ade80' : '#fbbf24'} strokeWidth="2" fill="none" strokeLinecap="round">
            <circle cx="-5" r="3.5" />
            <path d="M-1.5 0 H8 M5 0 V3 M8 0 V3" />
          </g>
        )}
      </Shots>
      <text data-fx="combo" x="62" y="40" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="#e2e8f0" opacity="0">
        admin / 123456?
      </text>
      <g data-fx="siren" opacity="0">
        <circle cx="30" cy="34" r="16" fill="#ef4444" style={{ animation: 'bf-siren 0.5s ease-in-out infinite' }} />
        <circle cx="130" cy="34" r="16" fill="#3b82f6" style={{ animation: 'bf-siren 0.5s ease-in-out 0.25s infinite' }} />
      </g>
    </>
  ),
  // leans in and tries key after key: wrong, wrong, wrong, right
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'combo'), [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none', offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0, transform: 'translateY(-4px)' }], 1100);
    await play(s, [{ transform: 'none' }, { transform: 'translate(6px, -4px) rotate(5deg)' }], { duration: 300, easing: 'ease-out' });
    void play(s, [{ transform: 'translate(6px, -4px) rotate(5deg)' }, { transform: 'translate(-16px, 0) rotate(-6deg)', offset: 0.3 }, { transform: 'translate(-12px, 0) rotate(-4deg)', offset: 0.7 }, { transform: 'none' }], { duration: 800, easing: 'ease-out' });
    void playAdd(fx(el, 'keys'), [0, 1, 2, 3].flatMap(() => [{ transform: 'rotate(-16deg)' }, { transform: 'rotate(16deg)' }]).concat({ transform: 'none' }), 700, 'linear');
    await volley(el, 'key', (i) => [-240, (i - 1.5) * 6], { ms: 460, stagger: 130, spin: 540 });
  },
  jab(el) {
    void playAdd(fx(el, 'keys'), [{ transform: 'none' }, { transform: 'rotate(-20deg)' }, { transform: 'rotate(14deg)' }, { transform: 'none' }], 320, 'linear');
  },
  // flinches and its loot bag jumps out of its hand
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 280, 1.6);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(7px) rotate(-5deg)', offset: 0.3 }, { transform: 'translateX(-2px) rotate(2deg)', offset: 0.65 }, { transform: 'none' }], { duration: 440, easing: 'ease-out' });
    void playAdd(fx(el, 'bag'), [{ transform: 'none' }, { transform: 'translate(-6px, -18px) rotate(-30deg)', offset: 0.35, easing: 'ease-in' }, { transform: 'translate(-2px, 2px) rotate(-6deg)', offset: 0.75 }, { transform: 'none' }], 620);
    void playAdd(fx(el, 'keys'), [{ transform: 'none' }, { transform: 'rotate(30deg)', offset: 0.3 }, { transform: 'rotate(-14deg)', offset: 0.65 }, { transform: 'none' }], 600);
  },
  die: { cls: 'bot-die-stuffer', ms: 2200 },
};

// ---------------------------------------------------------------- Slowloris

const loris: MoveSet = {
  gait: { kf: 'sl-hang', s: 7, origin: '80px 124px' },
  front: ({ p }) => (
    <>
      <Shots k="held" n={5} x={20} y={126}>
        {() => <circle r="2.6" fill={p.light} />}
      </Shots>
      <g data-fx="zzz" opacity="0" fontFamily="monospace" fontWeight="bold" fill={p.light}>
        <text x="108" y="52" fontSize="10">
          z
        </text>
        <text x="118" y="40" fontSize="14">
          z
        </text>
        <text x="130" y="24" fontSize="19">
          Z
        </text>
      </g>
    </>
  ),
  // a long, slow wind-up and a lazy lunge, while held connections crawl down the cable
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    fxAll(el, 'held').forEach((d, i) =>
      void play(d, [{ opacity: 0, transform: 'translate(0, 0)' }, { opacity: 1, transform: 'translate(-30px, 1px)', offset: 0.2 }, { opacity: 1, transform: 'translate(-200px, 4px)', offset: 0.85 }, { opacity: 0, transform: 'translate(-230px, 4px)' }], { duration: 1500, delay: i * 160, easing: 'linear', fill: 'backwards' }),
    );
    await play(s, [{ transform: 'none' }, { transform: 'translateX(8px) rotate(4deg)' }], { duration: 700, easing: 'ease-in-out' });
    await play(s, [{ transform: 'translateX(8px) rotate(4deg)' }, { transform: 'translateX(-26px) rotate(-5deg)', offset: 0.55 }, { transform: 'none' }], { duration: 1000, easing: 'cubic-bezier(0.5, 0, 0.5, 1)' });
  },
  jab(el) {
    void play(fxAll(el, 'held')[0], [{ opacity: 0 }, { opacity: 1, transform: 'translateX(-30px)', offset: 0.2 }, { opacity: 0, transform: 'translateX(-200px)' }], { duration: 1200, easing: 'linear' });
  },
  // notices the hit only a moment later, and flinches slowly
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void play(s, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.5)', offset: 0.2 }, { filter: 'brightness(1)' }], 300);
    void play(s, [{ transform: 'none' }, { transform: 'none', offset: 0.35 }, { transform: 'translateX(5px) rotate(4deg)', offset: 0.6 }, { transform: 'translateX(-2px) rotate(-1deg)', offset: 0.85 }, { transform: 'none' }], { duration: 1100, easing: 'ease-in-out' });
  },
  die: { cls: 'bot-die-loris', ms: 2400 },
};

// ---------------------------------------------------------------- Bot Săn Sneaker

const sneaker: MoveSet = {
  gait: { kf: 'sn-jog', s: 0.6, origin: '80px 124px' },
  extra: ({ bodyId }) => (
    <>
      {[0, 1, 2].map((i) => (
        <use key={i} data-fx="echo" href={`#${bodyId}`} opacity="0" />
      ))}
    </>
  ),
  front: () => (
    <Shots k="dust" n={4} x={110} y={126}>
      {(i) => <circle r={4 + (i % 2) * 2} fill="#a8a29e" fillOpacity="0.55" />}
    </Shots>
  ),
  // backs up, then a sprint so fast it leaves copies of itself behind
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    await play(s, [{ transform: 'none' }, { transform: 'translateX(12px) rotate(6deg) scale(0.96, 1.04)' }], { duration: 260, easing: 'ease-out' });
    void volley(el, 'dust', (i) => [30 + i * 12, -6 - i * 3], { ms: 500, stagger: 30 });
    fxAll(el, 'echo').forEach((e, i) =>
      void play(e, [{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 0.35 - i * 0.08, transform: `translateX(${-20 - i * 12}px)`, offset: 0.35 }, { opacity: 0, transform: `translateX(${-50 - i * 8}px)` }], { duration: 420, delay: 40 + i * 40, fill: 'backwards' }),
    );
    await play(s, [{ transform: 'translateX(12px) rotate(6deg) scale(0.96, 1.04)' }, { transform: 'translateX(-66px) skewX(-14deg)', offset: 0.35 }, { transform: 'translateX(-58px) skewX(4deg)', offset: 0.5 }, { transform: 'none' }], { duration: 640, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
  },
  jab(el) {
    void play(fx(el, 'speed'), [{ transform: 'none' }, { transform: 'translateX(-6px) scaleX(1.5)', offset: 0.4 }, { transform: 'none' }], 300);
  },
  // tips back onto its heel and skids
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 260, 1.6);
    void play(s, [{ transform: 'none', transformOrigin: '34px 124px' }, { transform: 'translateX(8px) rotate(-14deg)', transformOrigin: '34px 124px', offset: 0.3 }, { transform: 'translateX(4px) rotate(3deg)', transformOrigin: '34px 124px', offset: 0.7 }, { transform: 'none', transformOrigin: '34px 124px' }], { duration: 520, easing: 'ease-out' });
    void playAdd(fx(el, 'laces'), [{ transform: 'none' }, { transform: 'rotate(20deg) translateY(-3px)', offset: 0.3 }, { transform: 'none' }], 460);
  },
  die: { cls: 'bot-die-sneaker', ms: 1700 },
};

// ---------------------------------------------------------------- Trại Click Farm

const clickFarm: MoveSet = {
  gait: { kf: 'cf-hum', s: 0.9, origin: '80px 134px' },
  front: ({ p }) => (
    <>
      <Shots k="cursor" n={8} x={40} y={80}>
        {(i) => <path d="M-3 -6 L-3 6 L0 3 L3 8 L4.5 7.2 L1.5 2.4 L6 2.1 Z" fill={i % 2 ? p.light : p.main} stroke="#09090b" strokeWidth="0.7" />}
      </Shots>
      <Shots k="phone" n={1} x={80} y={30}>
        {() => (
          <>
            <rect x="-6" y="-10" width="12" height="20" rx="2.5" fill="#18181b" stroke="#22d3ee" strokeWidth="1.5" />
            <rect x="-4" y="-7" width="8" height="12" rx="1" fill="#22d3ee" opacity="0.4" />
          </>
        )}
      </Shots>
    </>
  ),
  // every screen flashes in a wave, then a flood of cursors
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    fxAll(el, 'screen').forEach((sc, i) => void play(sc, [{ opacity: 0.22 }, { opacity: 1, filter: 'brightness(2)', offset: 0.4 }, { opacity: 0.22 }], { duration: 360, delay: i * 45 }));
    void play(fx(el, 'face'), [{ fill: '#09090b' }, { fill: '#a3e635', offset: 0.5 }, { fill: '#09090b' }], 500);
    await play(s, [{ transform: 'none' }, { transform: 'scale(1.05) translateX(4px)', offset: 0.6 }, { transform: 'scale(1.02)' }], { duration: 420, easing: 'ease-out' });
    void play(s, [{ transform: 'scale(1.02)' }, { transform: 'translateX(-10px) scale(0.98)', offset: 0.3 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
    await volley(el, 'cursor', toLeft(46), { ms: 520, stagger: 45, spin: 30 });
  },
  jab(el) {
    const sc = fxAll(el, 'screen');
    sc.forEach((x, i) => void play(x, [{ opacity: 0.22 }, { opacity: 0.9, offset: 0.4 }, { opacity: 0.22 }], { duration: 260, delay: (i % 4) * 30 }));
  },
  // the screens flicker off in a ripple and come back
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 260, 1.5);
    void play(s, [0, 5, -4, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380 });
    fxAll(el, 'screen').forEach((sc, i) => void play(sc, [{ opacity: 0.22 }, { opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 0.22 }], { duration: 420, delay: Math.abs((i % 3) - 1) * 60 + Math.floor(i / 3) * 40 }));
  },
  // a fresh phone pops out of the rack
  async summon(el) {
    const s = ready(el);
    if (!s) return;
    void play(s, [{ transform: 'none' }, { transform: 'translateY(4px) scale(1.04, 0.95)', offset: 0.3 }, { transform: 'translateY(-6px) scale(0.98, 1.04)', offset: 0.6 }, { transform: 'none' }], { duration: 600, easing: 'ease-out' });
    await volley(el, 'phone', () => [10, -36], { ms: 700, spin: 360 });
  },
  die: { cls: 'bot-die-farm', ms: 2200 },
};

// ---------------------------------------------------------------- Kẻ Lạm Dụng API

const REQ = ['GET', 'POST', '{}', 'PUT', '[ ]', 'GET'];

const abuser: MoveSet = {
  gait: { kf: 'aa-bob', s: 1.8, origin: '80px 126px' },
  front: ({ p }) => (
    <>
      <Shots k="req" n={6} x={50} y={82}>
        {(i) => (
          <text textAnchor="middle" y="3" fontSize="8" fontFamily="monospace" fontWeight="bold" fill={i % 2 ? p.light : p.main}>
            {REQ[i]}
          </text>
        )}
      </Shots>
      <text data-fx="revoked" x="80" y="148" textAnchor="middle" fontSize="11" fontFamily="monospace" fontWeight="900" fill="#ef4444" opacity="0">
        401 REVOKED
      </text>
    </>
  ),
  // the braces clamp shut, fling open, and out comes a burst of requests
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    const braces = fxAll(el, 'brace');
    braces.forEach((b, i) => void play(b, [{ transform: 'none' }, { transform: `translateX(${i ? -10 : 10}px)`, offset: 0.4 }, { transform: `translateX(${i ? 12 : -12}px)`, offset: 0.65 }, { transform: 'none' }], { duration: 760, easing: 'ease-in-out' }));
    void play(fx(el, 'key'), [{ filter: 'brightness(1)' }, { filter: 'brightness(2.4) drop-shadow(0 0 4px #fbbf24)', offset: 0.4 }, { filter: 'brightness(1)' }], 700);
    await play(s, [{ transform: 'none' }, { transform: 'scale(0.94, 1.06)', offset: 0.6 }, { transform: 'scale(0.95, 1.05)' }], { duration: 320, easing: 'ease-in' });
    void play(s, [{ transform: 'scale(0.95, 1.05)' }, { transform: 'translateX(-12px) scale(1.06, 0.95)', offset: 0.3 }, { transform: 'none' }], { duration: 440, easing: 'ease-out' });
    await volley(el, 'req', toLeft(36), { ms: 520, stagger: 55 });
  },
  jab(el) {
    fxAll(el, 'brace').forEach((b, i) => void play(b, [{ transform: 'none' }, { transform: `translateX(${i ? -6 : 6}px)`, offset: 0.4 }, { transform: 'none' }], 280));
  },
  // the braces snap shut around it and the key spins
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 280, 1.6);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(6px) scale(0.95)', offset: 0.3 }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
    fxAll(el, 'brace').forEach((b, i) => void play(b, [{ transform: 'none' }, { transform: `translateX(${i ? -12 : 12}px) scaleY(0.9)`, offset: 0.25 }, { transform: 'none' }], { duration: 460, easing: 'ease-out' }));
    void play(fx(el, 'key'), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 480, easing: 'ease-out' });
  },
  die: { cls: 'bot-die-abuser', ms: 2000 },
};

export const FLOOR2: Record<string, MoveSet> = {
  scraper,
  cred_stuffer: stuffer,
  slowloris: loris,
  sneaker_bot: sneaker,
  click_farm: clickFarm,
  api_abuser: abuser,
};
