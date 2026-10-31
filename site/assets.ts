/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO PICTURES A PAGE MAKES OF ITSELF: A PREVIEW CARD AND A BADGE.
 *
 * Both are drawn from the evidence, both are SVG written by hand, and both are
 * deliberately dull. A badge in somebody's README is the most quotable thing
 * this project produces and the easiest to mistake for a seal of approval, so
 * it carries a FACT AND A DATE — measured, when — and never a verdict, never a
 * score, never a colour that means pass. BRYDGE's accent means one thing, that
 * BRYDGE established something under a paid engagement, and a Level 1
 * measurement is not that.
 *
 * The preview card is what a link to a page unfurls into in a chat window. It
 * repeats the counts and the date, so a card that travels without its page
 * still says what the page says and when it was true.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Level1Evidence } from "../level1/run.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Monospace at 11px is almost exactly 6.6px per character. Close enough to lay out a badge. */
const width = (s: string, px: number) => Math.ceil(s.length * px * 0.6);

/**
 * A README badge: `BRYDGE level 1 · measured 2026-10-31`.
 *
 * Flat, two-tone, no shine and no colour carrying meaning. It states that a
 * measurement happened and when — nothing about the result, because a badge is
 * read at a glance and a glance cannot carry the limits that make the result
 * honest. The page it links to can.
 */
export function badgeSvg(e: Level1Evidence): string {
  const left = "BRYDGE level 1";
  const right = `measured ${e.measuredAt.slice(0, 10)}`;
  const lw = width(left, 11) + 16;
  const rw = width(right, 11) + 16;
  const h = 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="${h}" role="img" aria-label="${esc(left)}: ${esc(right)}">
  <title>${esc(left)}: ${esc(right)}</title>
  <rect width="${lw}" height="${h}" fill="#16171a"/>
  <rect x="${lw}" width="${rw}" height="${h}" fill="#e3e0da"/>
  <g font-family="IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">
    <text x="${lw / 2}" y="14" fill="#fbfaf8" text-anchor="middle">${esc(left)}</text>
    <text x="${lw + rw / 2}" y="14" fill="#16171a" text-anchor="middle">${esc(right)}</text>
  </g>
</svg>
`;
}

/** Wrap a title across at most three lines of roughly `per` characters. */
function wrap(s: string, per: number, max = 3): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > per && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === max - 1 && words.indexOf(w) < words.length - 1) break;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, max);
}

/** The 1200×630 card a link unfurls into. */
export function previewSvg(opts: { title: string; lines: string[]; foot: string }): string {
  const title = wrap(opts.title, 34);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fbfaf8"/>
  <rect x="0" y="0" width="1200" height="8" fill="#16171a"/>
  <text x="80" y="104" font-family="IBM Plex Mono, monospace" font-size="20" letter-spacing="3.4" fill="#71757f">LEVEL 1 MEASUREMENT</text>
  ${title.map((l, i) => `<text x="80" y="${212 + i * 68}" font-family="Newsreader, Georgia, serif" font-size="58" fill="#16171a">${esc(l)}</text>`).join("\n  ")}
  ${opts.lines
    .slice(0, 3)
    .map((l, i) => `<text x="80" y="${432 + i * 42}" font-family="Instrument Sans, system-ui, sans-serif" font-size="28" fill="#4a4d55">${esc(l)}</text>`)
    .join("\n  ")}
  <text x="80" y="574" font-family="IBM Plex Mono, monospace" font-size="20" fill="#71757f">${esc(opts.foot)}</text>
</svg>
`;
}

/** The three lines under the title of a server's card, from its evidence. */
export function previewLines(e: Level1Evidence): string[] {
  if (!e.observed || !e.comparison) return ["Could not start.", "Nothing is concluded about what it would have done."];
  const sites = new Set([...e.observed.dnsNames, ...e.observed.tlsHosts]).size;
  const t = e.comparison.tools.undocumented.length;
  const h = e.comparison.hosts.undeclared.length;
  const n = (x: number, one: string, many = one + "s") => `${x} ${x === 1 ? one : many}`;
  return [
    `${n(e.observed.offered.length, "tool")} offered, none called.`,
    `${sites === 0 ? "No website reached for at startup." : `${n(sites, "website")} reached for at startup.`}`,
    t === 0 && h === 0
      ? "Nothing found that its README does not name."
      : `Not named in its README: ${[t ? n(t, "tool") : "", h ? n(h, "website") : ""].filter(Boolean).join(", ")}.`,
  ];
}
