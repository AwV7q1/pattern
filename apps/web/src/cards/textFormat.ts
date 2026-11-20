/**
 * The shared format for card text (`text`, `detail`, `upgrade.text`,
 * `upgrade.detail` in `data/cards.json`). It is rendered by `CardText.tsx`.
 *
 * One effect per line, with lines split by "\n". The card face shows `text`;
 * the hover popover shows `text`, then `detail`, then the keyword glossary.
 * Keep `text` short (at most 4 short lines) and put the rest in `detail`.
 *
 * Scope tags start a line:
 *   {turn}   Lượt này      {battle} Cả trận     {again} Đánh lại
 *   {next}   Lượt sau      {warn}   Cẩn thận
 * A tag with text after it labels that line ("{turn} Lọc {bot:50%} bot.").
 * A tag alone on a line is a header for the lines below it, until the next tag.
 *
 * Value tokens go anywhere in a line, as `{kind:value}`. They render as an
 * icon and the value, so write the unit word after them:
 *   {dmg:5} sát thương     {hr:+5} Headroom     Rút {draw:1} lá
 *   {ops:+1} Ops           {eb:4} Error Budget  {gold:4} vàng
 *   {money:$0.10/h}        {inst:+1} instance   Lọc {bot:25%} bot
 *   {time:250ms}           {turns:2} (shows "2 lượt")
 * `**x**` makes x bold (key numbers that have no token).
 */

export const SCOPES = {
  turn: 'Lượt này',
  battle: 'Cả trận',
  again: 'Đánh lại',
  next: 'Lượt sau',
  warn: 'Cẩn thận',
} as const;
export type Scope = keyof typeof SCOPES;

export const TOKENS = ['dmg', 'hr', 'draw', 'ops', 'eb', 'gold', 'money', 'inst', 'bot', 'time', 'turns'] as const;
export type TokenKind = (typeof TOKENS)[number];

export type Span = { t: 'text'; v: string } | { t: 'bold'; v: string } | { t: 'token'; kind: TokenKind; v: string };

export interface Line {
  scope?: Scope;
  /** A header line: the scope alone, the lines after it belong to it. */
  header?: boolean;
  /** The line sits under a header. */
  nested?: boolean;
  spans: Span[];
}

const SCOPE_RE = /^\{(\w+)\}\s*/;
const SPAN_RE = /\{(\w+):([^}]+)\}|\*\*([^*]+)\*\*/g;

const isScope = (k: string): k is Scope => k in SCOPES;
const isToken = (k: string): k is TokenKind => (TOKENS as readonly string[]).includes(k);

/** How a token reads as plain text. */
export const tokenText = (kind: TokenKind, v: string) => (kind === 'turns' ? `${v} lượt` : v);

function spans(s: string, errors?: string[]): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const m of s.matchAll(SPAN_RE)) {
    if (m.index > at) out.push({ t: 'text', v: s.slice(at, m.index) });
    if (m[3] !== undefined) out.push({ t: 'bold', v: m[3] });
    else if (isToken(m[1])) out.push({ t: 'token', kind: m[1], v: m[2] });
    else {
      errors?.push(`unknown token {${m[1]}:…}`);
      out.push({ t: 'text', v: m[0] });
    }
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ t: 'text', v: s.slice(at) });
  if (out.some((x) => x.t === 'text' && /[{}]/.test(x.v))) errors?.push(`stray brace in "${s}"`);
  return out;
}

/** Parse card text into lines. Problems go to `errors` (the content test uses this). */
export function parseCardText(text: string | undefined, errors?: string[]): Line[] {
  if (!text) return [];
  const lines: Line[] = [];
  let underHeader = false;
  for (const raw of text.split('\n')) {
    const s = raw.trim();
    if (!s) continue;
    const m = SCOPE_RE.exec(s);
    if (m && isScope(m[1])) {
      const rest = s.slice(m[0].length);
      if (!rest) {
        lines.push({ scope: m[1], header: true, spans: [] });
        underHeader = true;
      } else {
        lines.push({ scope: m[1], spans: spans(rest, errors) });
        underHeader = false;
      }
    } else {
      if (m && !isToken(m[1])) errors?.push(`unknown scope {${m[1]}}`);
      lines.push({ nested: underHeader, spans: spans(s, errors) });
    }
  }
  return lines;
}

/** The text without markup, for `title` attributes and screen readers. */
export function plainCardText(text: string | undefined): string {
  return parseCardText(text)
    .map((l) => {
      const body = l.spans.map((x) => (x.t === 'token' ? tokenText(x.kind, x.v) : x.v)).join('');
      return l.scope ? `${SCOPES[l.scope]}:${body ? ` ${body}` : ''}` : body;
    })
    .join(' ');
}

/** Token kinds used in some text. The glossary explains these. */
export function tokensIn(...texts: (string | undefined)[]): Set<TokenKind> {
  const out = new Set<TokenKind>();
  for (const t of texts) for (const l of parseCardText(t)) for (const x of l.spans) if (x.t === 'token') out.add(x.kind);
  return out;
}
