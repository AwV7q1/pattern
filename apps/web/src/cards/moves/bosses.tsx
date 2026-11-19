// Floor bosses of floors 1 and 2 (the DDoS Lord has its own file):
// - Kẻ Đầu Độc Cache, the plague doctor, glides over a toxic fog; its flask
//   bubbles and its mask breathes fumes. It throws the flask (it shatters in a
//   splash), coughs gas when hit, pours a puddle to raise a poison node, and
//   melts into the puddle when beaten. Phase 2: purple poison, thicker fumes.
// - Black Friday, the price tag, swings on its string under a countdown. It
//   flips and sends a stampede of shopping bags, spills coins when hit, rings up
//   a sale to call scalpers, and gets stamped SOLD OUT, its string snapping.
//   Phase 2: -99%, sirens.
import { flash, fx, fxAll, isEnraged, play, playAdd, ready, Shots, wait, type MoveSet } from './kit';

const PURPLE = '#a855f7';

// ---------------------------------------------------------------- Kẻ Đầu Độc Cache

const poisoner: MoveSet = {
  gait: { kf: 'cp-glide', s: 3.4 },
  back: ({ p, enraged }) => {
    const c = enraged ? PURPLE : p.main;
    return (
      <>
        <g data-fx="fog">
          {[
            [50, 0],
            [110, 1.6],
            [80, 3.1],
          ].map(([x, d]) => (
            <ellipse key={x} cx={x} cy="142" rx="26" ry="7" fill={c} opacity="0" style={{ transformOrigin: `${x}px 142px`, animation: `cp-fog 4.8s ease-in-out ${d}s infinite` }} />
          ))}
        </g>
        <g data-fx="puddle" opacity="0" style={{ transformOrigin: '80px 144px' }}>
          <ellipse cx="80" cy="144" rx="44" ry="8" fill={c} fillOpacity="0.55" stroke={c} strokeWidth="1.5" />
          {[62, 84, 100].map((x, i) => (
            <circle key={x} cx={x} cy="143" r="2.5" fill="none" stroke={p.light} strokeWidth="1" style={{ transformOrigin: `${x}px 143px`, animation: `cp-pop 1.1s ease-out ${i * 0.35}s infinite` }} />
          ))}
        </g>
      </>
    );
  },
  extra: ({ p, enraged, glow }) => {
    const c = enraged ? PURPLE : p.main;
    return (
      <>
        {/* bubbles out of the flask */}
        <g data-fx="bubbles">
          {[0, 0.5, 1.1].map((d, i) => (
            <circle key={d} cx={124 + i * 3} cy="96" r={1.6 + (i % 2)} fill={c} opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: `cp-bubble ${enraged ? 1 : 1.6}s ease-out ${d}s infinite` }} />
          ))}
        </g>
        {/* fumes from the mask's filter */}
        <g data-fx="fumes">
          {Array.from({ length: enraged ? 4 : 2 }, (_, i) => (
            <circle key={i} cx="80" cy="114" r="5" fill={c} opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: `cp-fume 2.6s ease-out ${i * (enraged ? 0.65 : 1.3)}s infinite` }} />
          ))}
        </g>
        {/* phase 2: the flask boils over, purple */}
        {enraged && <circle cx="127" cy="110" r="9" fill={PURPLE} opacity="0.5" filter={`url(#${glow})`} style={{ animation: 'bot-flicker 0.5s ease-in-out infinite alternate' }} />}
      </>
    );
  },
  front: ({ p, enraged }) => {
    const c = enraged ? PURPLE : p.main;
    return (
      <>
        <g transform="translate(126 100)">
          <g data-fx="vial" opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <path d="M-3 -10 L3 -10 L3 -4 L8 7 Q9 10 5 10 L-5 10 Q-9 10 -8 7 L-3 -4 Z" fill="#18181b" stroke={p.light} strokeWidth="1.2" />
            <path d="M-6 3 L6 3 L8 7 Q9 9 5 9 L-5 9 Q-9 9 -8 7 Z" fill={c} />
          </g>
        </g>
        <Shots k="splash" n={9} x={-176} y={104}>
          {(i) => <path d="M0 -4 Q3 0 0 4 Q-3 0 0 -4 Z" fill={i % 3 ? c : p.light} transform={`rotate(${i * 40})`} />}
        </Shots>
        <Shots k="cough" n={3} x={72} y={112}>
          {() => <circle r="6" fill={c} fillOpacity="0.6" />}
        </Shots>
      </>
    );
  },
  // raises the flask, throws it in an arc: it shatters in a splash where it lands
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    const enraged = isEnraged(el);
    const flask = fx(el, 'flask');
    void play(s, [{ transform: 'none' }, { transform: 'translate(8px, -6px) rotate(4deg)', offset: 0.5 }, { transform: 'translate(-10px, 0) rotate(-4deg)', offset: 0.75 }, { transform: 'none' }], { duration: 900, easing: 'ease-in-out' });
    await play(flask, [{ transform: 'none' }, { transform: 'translate(6px, -26px) rotate(-70deg)' }], { duration: 450, easing: 'ease-out' });
    void play(flask, [{ opacity: 0, transform: 'translate(-10px, -10px) rotate(40deg)' }, { opacity: 0, offset: 0.6 }, { opacity: 1, transform: 'none' }], { duration: 700 });
    await play(
      fx(el, 'vial'),
      [
        { opacity: 1, transform: 'translate(0, -26px) rotate(0deg)' },
        { opacity: 1, transform: 'translate(-150px, -86px) rotate(-300deg)', offset: 0.5, easing: 'ease-in' },
        { opacity: 1, transform: 'translate(-302px, 4px) rotate(-620deg)' },
      ],
      { duration: enraged ? 420 : 520, easing: 'ease-out' },
    );
    fxAll(el, 'splash').forEach((d, i) => {
      const a = Math.PI + ((i - 4) / 4) * (Math.PI / 2.2);
      const r = (enraged ? 46 : 32) + (i % 3) * 8;
      void play(
        d,
        [
          { opacity: 1, transform: 'scale(0.5)' },
          { opacity: 1, transform: `translate(${Math.cos(a) * r * -1}px, ${Math.sin(a) * r - 10}px) scale(1.2)`, offset: 0.6 },
          { opacity: 0, transform: `translate(${Math.cos(a) * r * -1.2}px, ${Math.sin(a) * r + 14}px) scale(0.6)` },
        ],
        { duration: 520, delay: i * 12, easing: 'ease-out', fill: 'backwards' },
      );
    });
  },
  jab(el) {
    void playAdd(fx(el, 'flask'), [{ transform: 'none' }, { transform: 'rotate(-30deg)', offset: 0.4 }, { transform: 'none' }], 360);
    void play(fxAll(el, 'cough')[0], [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 0.9, transform: 'translate(-20px, -4px) scale(1.4)', offset: 0.3 }, { opacity: 0, transform: 'translate(-60px, -12px) scale(2.4)' }], 700);
  },
  // a fit of coughing: gas puffs out of the mask, the flask sloshes
  hit(el) {
    const s = ready(el);
    if (!s) return;
    void flash(el, 300, 1.5);
    void play(s, [{ transform: 'none' }, { transform: 'translateX(4px) scale(1.02, 0.96)', offset: 0.2 }, { transform: 'translateX(-2px) scale(0.99, 1.02)', offset: 0.45 }, { transform: 'translateX(3px) scale(1.01, 0.97)', offset: 0.65 }, { transform: 'none' }], { duration: 560, easing: 'ease-out' });
    void play(fx(el, 'filter'), [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.25 }, { transform: 'scale(0.9)', offset: 0.5 }, { transform: 'scale(1.25)', offset: 0.7 }, { transform: 'scale(1)' }], 560);
    void playAdd(fx(el, 'flask'), [{ transform: 'none' }, { transform: 'rotate(18deg)', offset: 0.3 }, { transform: 'rotate(-12deg)', offset: 0.6 }, { transform: 'none' }], 600);
    fxAll(el, 'cough').forEach((c, i) =>
      void play(c, [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 0.9, transform: `translate(${-10 - i * 8}px, ${-4 + i * 5}px) scale(1.3)`, offset: 0.3 }, { opacity: 0, transform: `translate(${-34 - i * 14}px, ${-10 + i * 8}px) scale(2.4)` }], { duration: 700, delay: i * 90, fill: 'backwards' }),
    );
  },
  // tips the flask over: a puddle spreads and bubbles, something rises from it
  async summon(el) {
    const s = ready(el);
    if (!s) return;
    void play(s, [{ transform: 'none' }, { transform: 'translateY(6px) rotate(-3deg) scale(1.02, 0.97)', offset: 0.4 }, { transform: 'translateY(6px) rotate(-3deg) scale(1.02, 0.97)', offset: 0.7 }, { transform: 'none' }], { duration: 1000, easing: 'ease-in-out' });
    void play(fx(el, 'flask'), [{ transform: 'none' }, { transform: 'rotate(110deg)', offset: 0.3 }, { transform: 'rotate(110deg)', offset: 0.75 }, { transform: 'none' }], { duration: 1000, easing: 'ease-in-out' });
    await play(fx(el, 'puddle'), [{ opacity: 0, transform: 'scale(0.1, 0.3)' }, { opacity: 1, transform: 'scale(1)', offset: 0.45 }, { opacity: 1, transform: 'scale(1.05)', offset: 0.8 }, { opacity: 0, transform: 'scale(1.2, 0.8)' }], { duration: 1200, easing: 'ease-out' });
  },
  die: { cls: 'bot-die-poisoner', ms: 2600 },
};

// ---------------------------------------------------------------- Black Friday

const blackFriday: MoveSet = {
  gait: { kf: 'bf-swing', s: 2.6, origin: '122px 34px' },
  back: ({ enraged }) =>
    enraged ? (
      <g data-fx="sirens">
        {[
          [26, '#ef4444', 0],
          [134, '#facc15', 0.35],
        ].map(([x, c, d]) => (
          <circle key={x} cx={x} cy="30" r="14" fill={String(c)} opacity="0" style={{ transformOrigin: `${x}px 30px`, animation: `bf-siren 0.7s ease-in-out ${d}s infinite` }} />
        ))}
      </g>
    ) : null,
  extra: ({ p, enraged }) => (
    <>
      {/* the countdown never ends */}
      <g data-fx="clock">
        <g transform="translate(46 34)">
          <rect x="-14" y="-6" width="30" height="11" rx="3" fill="#09090b" stroke={enraged ? '#ef4444' : p.main} strokeWidth="1" />
          <text x="1" y="2.6" textAnchor="middle" fontSize="7" fontFamily="monospace" fontWeight="bold" fill={enraged ? '#ef4444' : p.light} style={{ animation: 'bot-flicker 0.5s steps(1) infinite alternate' }}>
            {enraged ? '00:09' : '23:59'}
          </text>
        </g>
      </g>
      {/* phase 2: the price drops further */}
      {enraged && (
        <g style={{ transformOrigin: '76px 100px', animation: 'bf-deal 0.8s ease-in-out infinite' }}>
          <rect x="49" y="91" width="54" height="18" rx="4" fill="#ef4444" stroke="#fef08a" strokeWidth="1" />
          <text x="76" y="104.5" textAnchor="middle" fontSize="12" fontFamily="monospace" fontWeight="900" fill="#fff">
            -99%
          </text>
        </g>
      )}
    </>
  ),
  front: ({ p }) => (
    <>
      <Shots k="bag" n={6} x={52} y={128}>
        {(i) => (
          <>
            <path d="M-3 -6 Q0 -11 3 -6" fill="none" stroke={p.light} strokeWidth="1.4" />
            <rect x="-6" y="-6" width="12" height="12" rx="1.5" fill={i % 2 ? '#e11d48' : p.main} stroke="#09090b" strokeWidth="0.6" />
            <text x="0" y="3" textAnchor="middle" fontSize="7" fontFamily="monospace" fontWeight="bold" fill="#09090b">
              %
            </text>
          </>
        )}
      </Shots>
      <Shots k="coin" n={6} x={76} y={96}>
        {() => (
          <>
            <circle r="4.5" fill={p.main} stroke="#a16207" />
            <text x="0" y="2.6" textAnchor="middle" fontSize="6.5" fontFamily="monospace" fontWeight="bold" fill="#09090b">
              $
            </text>
          </>
        )}
      </Shots>
      <rect data-fx="scan" x="44" y="46" width="84" height="2.5" fill="#ef4444" opacity="0" style={{ filter: 'drop-shadow(0 0 4px #ef4444)' }} />
      <g data-fx="stamp" opacity="0" style={{ transformOrigin: '80px 80px' }}>
        <g transform="rotate(-16 80 80)">
          <rect x="30" y="66" width="100" height="28" rx="4" fill="#09090b" fillOpacity="0.6" stroke="#ef4444" strokeWidth="3.5" />
          <text x="80" y="87" textAnchor="middle" fontSize="17" fontFamily="monospace" fontWeight="900" fill="#ef4444">
            SOLD OUT
          </text>
        </g>
      </g>
    </>
  ),
  // flips over to the deal side, the price blinks, and a stampede of bags bounces at you
  async strike(el) {
    const s = ready(el);
    if (!s) return;
    const fast = isEnraged(el) ? 0.8 : 1;
    void play(fx(el, 'deal'), [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', filter: 'brightness(1.6)', offset: 0.3 }, { transform: 'scale(1)', offset: 0.5 }, { transform: 'scale(1.35)', filter: 'brightness(1.6)', offset: 0.7 }, { transform: 'scale(1)' }], 700 * fast);
    await play(s, [{ transform: 'none' }, { transform: 'scaleX(-1) translateY(-6px)', offset: 0.5 }, { transform: 'scaleX(1) translateX(-12px)' }], { duration: 600 * fast, easing: 'ease-in-out' });
    void play(s, [{ transform: 'translateX(-12px)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
    fxAll(el, 'bag').forEach((b, i) => {
      const x = -250 - (i % 3) * 30;
      const frames: Keyframe[] = [0, 0.25, 0.5, 0.75, 1].map((t, k) => ({
        transform: `translate(${x * t}px, ${k % 2 ? -12 - (i % 3) * 4 : 0}px) rotate(${k % 2 ? -10 : 6}deg)`,
        opacity: k === 4 ? 0 : 1,
      }));
      b.animate([{ opacity: 0, transform: 'scale(0.4)' }, ...frames], { duration: 640 * fast, delay: i * 70, fill: 'backwards' });
    });
    await wait(520 * fast);
  },
  jab(el) {
    void play(fx(el, 'deal'), [{ transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: 0.4 }, { transform: 'scale(1)' }], 300);
  },
  // swings hard on its string and coins spill out
  hit(el) {
    if (!ready(el)) return;
    void flash(el, 280, 1.5);
    void play(fx(el, 'core'), [{ transform: 'none', transformOrigin: '122px 34px' }, { transform: 'rotate(10deg)', transformOrigin: '122px 34px', offset: 0.25 }, { transform: 'rotate(-5deg)', transformOrigin: '122px 34px', offset: 0.6 }, { transform: 'none', transformOrigin: '122px 34px' }], { duration: 620, easing: 'ease-out' });
    fxAll(el, 'coin').forEach((c, i) => {
      const dx = ((i * 23) % 50) - 25;
      void play(
        c,
        [
          { opacity: 1, transform: 'scale(0.6)' },
          { opacity: 1, transform: `translate(${dx * 0.6}px, -22px) rotate(${i * 60}deg)`, offset: 0.35, easing: 'ease-in' },
          { opacity: 1, transform: `translate(${dx}px, 44px) rotate(${i * 120}deg)`, offset: 0.85 },
          { opacity: 0, transform: `translate(${dx}px, 40px)` },
        ],
        { duration: 700, delay: i * 30, easing: 'ease-out', fill: 'backwards' },
      );
    });
  },
  // rings up a sale: a barcode scan runs down it, the price jumps, cash flies up
  async summon(el) {
    const s = ready(el);
    if (!s) return;
    void play(fx(el, 'scan'), [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 1, transform: 'translateY(66px)', offset: 0.8 }, { opacity: 0, transform: 'translateY(70px)' }], { duration: 600, easing: 'ease-in-out' });
    await wait(500);
    void play(s, [{ transform: 'none' }, { transform: 'translateY(-14px) scale(1.06)', filter: 'brightness(1.5) drop-shadow(0 0 10px #facc15)', offset: 0.4 }, { transform: 'none' }], { duration: 600, easing: 'ease-out' });
    fxAll(el, 'coin').forEach((c, i) =>
      void play(c, [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: `translate(${(i - 2.5) * 12}px, -40px) scale(1.2)`, offset: 0.4 }, { opacity: 0, transform: `translate(${(i - 2.5) * 18}px, -80px)` }], { duration: 700, delay: i * 40, fill: 'backwards' }),
    );
    await wait(600);
  },
  die: { cls: 'bot-die-friday', ms: 2400 },
};

export const BOSSES: Record<string, MoveSet> = {
  cache_poisoner: poisoner,
  black_friday: blackFriday,
};
