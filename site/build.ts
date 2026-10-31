/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STATIC SITE. NO ACCOUNTS, NO DATABASE, NOTHING RUN LIVE.
 *
 * Every page is written once from the evidence files and served as a file. The
 * only inputs are `level1/evidence/*.json` and `site/cleared.txt`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE GATE: A FINDING IS NOT PUBLISHED UNTIL ITS MAINTAINER HAS BEEN TOLD.
 *
 * A page reporting a finding is written only if its slug is listed in
 * `site/cleared.txt`. Not listed means not written, not linked and not in the
 * sitemap — so forgetting to clear a page errs towards silence. The builder has
 * no clock: three days is a promise a person keeps by adding a line, which is
 * auditable in the repository's history, where a timer would not be.
 *
 * The index still counts ALL measured servers in its headline, and says plainly
 * how many pages are withheld and why. A number a visitor cannot check yet is
 * worse than no number only if the page pretends otherwise.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * INK ONLY. No brass, no badge, no seal. BRYDGE's accent carries exactly one
 * meaning — that BRYDGE established something under a paid engagement — and a
 * Level 1 measurement is none of those things. `site.test.ts` fails on any
 * accent colour, on the three forbidden words, and on a withheld page reaching
 * the output.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport } from "../level1/report.ts";
import { renderIndex } from "../level1/index.ts";
import type { Level1Evidence } from "../level1/run.ts";
import { escapeHtml, markdownToHtml } from "./md.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(ROOT, "level1", "evidence");
const DIST = join(ROOT, "site", "dist");
export const SITE = "https://mcp.brydge-ai.com";
const REPO = "https://github.com/contactkontey-dotcom/brydge-mcp-measurements";
const MAIN = "https://www.brydge-ai.com/mcp";

export function hasFinding(e: Level1Evidence): boolean {
  if (e.couldNotStart || !e.comparison) return false;
  return e.comparison.tools.undocumented.length > 0 || e.comparison.hosts.undeclared.length > 0;
}

export function cleared(): Set<string> {
  const p = join(ROOT, "site", "cleared.txt");
  if (!existsSync(p)) return new Set();
  return new Set(
    readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean),
  );
}

/** What may be published now: no finding, or a finding whose notice has gone. */
export function publishable(items: Level1Evidence[]): { out: Level1Evidence[]; withheld: Level1Evidence[] } {
  const ok = cleared();
  const out: Level1Evidence[] = [];
  const withheld: Level1Evidence[] = [];
  for (const e of items) (hasFinding(e) && !ok.has(e.slug) ? withheld : out).push(e);
  return { out, withheld };
}

const CSS = `
:root{
  --ink:#16171a; --ink-muted:#4a4d55; --ink-faint:#71757f;
  --ground:#fbfaf8; --raised:#ffffff; --line:#e3e0da; --line-strong:#cdc9c1;
  --f-sans:"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-serif:"Newsreader",Georgia,serif;
  --f-mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --measure:66ch;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --ink:#e8e6e1; --ink-muted:#a7a9b0; --ink-faint:#7e818a;
    --ground:#101114; --raised:#171a1f; --line:#272a30; --line-strong:#3a3e46;
  }
}
:root[data-theme="dark"]{
  --ink:#e8e6e1; --ink-muted:#a7a9b0; --ink-faint:#7e818a;
  --ground:#101114; --raised:#171a1f; --line:#272a30; --line-strong:#3a3e46;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:var(--f-sans); font-size:16px; line-height:1.6;
  font-variant-numeric:tabular-nums;
}
.band{border-bottom:1px solid var(--line-strong); background:var(--raised)}
.wrap{max-width:58rem; margin:0 auto; padding-inline:16px}
.band .wrap{display:flex; flex-wrap:wrap; gap:4px 16px; align-items:baseline; padding-block:10px}
.eyebrow{font-family:var(--f-mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase; margin:0}
.band p.says{margin:0; flex:1 1 20rem; min-width:0; font-size:13px; color:var(--ink-muted)}
main{padding-block:40px 72px}
h1{font-family:var(--f-serif); font-weight:500; font-size:clamp(1.9rem,1.3rem + 2.2vw,2.6rem); line-height:1.15; margin:0 0 8px; text-wrap:balance}
h2{font-family:var(--f-serif); font-weight:500; font-size:clamp(1.35rem,1.1rem + 1.1vw,1.75rem); line-height:1.25; margin:40px 0 10px; text-wrap:balance}
h3{font-size:1rem; margin:28px 0 6px}
h4{font-size:.95rem; margin:20px 0 4px; color:var(--ink-muted)}
p,li{max-width:var(--measure)}
p{margin:0 0 14px}
ul{margin:0 0 16px; padding-left:1.15rem}
li{margin:0 0 7px}
a{color:inherit; text-decoration:underline; text-decoration-color:var(--line-strong); text-underline-offset:3px}
a:hover{text-decoration-color:var(--ink)}
a:focus-visible{outline:2px solid var(--ink); outline-offset:2px; border-radius:2px}
code{font-family:var(--f-mono); font-size:.86em; overflow-wrap:anywhere}
pre{background:var(--raised); border:1px solid var(--line); padding:12px 14px; overflow-x:auto; font-size:.84rem}
pre code{font-size:inherit}
.scroll{overflow-x:auto; margin:0 0 20px; border-block:1px solid var(--line)}
table{border-collapse:collapse; width:100%; font-size:.86rem}
th,td{text-align:left; padding:8px 12px 8px 0; border-bottom:1px solid var(--line); vertical-align:top; white-space:nowrap}
td:last-child,th:last-child{padding-right:0}
th{font-family:var(--f-mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-faint); font-weight:400}
tbody tr:last-child td{border-bottom:0}
.lede{font-size:1.05rem; color:var(--ink-muted)}
.meta{font-family:var(--f-mono); font-size:12px; color:var(--ink-faint); margin:0 0 28px}
.foot{margin-top:56px; padding-top:20px; border-top:1px solid var(--line-strong); font-size:13px; color:var(--ink-muted)}
.foot a{display:inline-block; margin-right:18px}
.report{font-family:var(--f-mono); font-size:12px}
@media (max-width:420px){ th,td{white-space:normal} }
`;

function shell(opts: { title: string; description: string; canonical: string; body: string; mistakeTitle: string }): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<link rel="canonical" href="${opts.canonical}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500&family=Newsreader:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Mono:wght@400&display=swap">
<style>${CSS}</style>
<div class="band"><div class="wrap">
  <p class="eyebrow">Level 1 measurement</p>
  <p class="says">What a server did at startup before any tool was used, and where its own README is silent about it. No tool is called, so nothing here tests whether a tool does what it says. Not calibration-backed. Not a ranking.</p>
</div></div>
<main class="wrap">
${opts.body}
<div class="foot">
  <a href="/">All measurements</a><a href="/method.html">Method and limits</a><a href="${REPO}">Harness and raw evidence</a><a href="${MAIN}">BRYDGE&rsquo;s calibrated measurements</a>
  <p class="report"><a href="${REPO}/issues/new?title=${encodeURIComponent(opts.mistakeTitle)}">Report a mistake on this page &rarr;</a></p>
</div>
</main>
</html>
`;
}

function methodPage(items: Level1Evidence[]): string {
  const fp = items[0]?.instrumentFingerprint ?? "";
  const body = markdownToHtml(
    [
      `# Method, and what it cannot establish`,
      ``,
      `Given a package name and nothing else, a Level 1 measurement does five things and stops.`,
      ``,
      `1. Installs the package into an empty directory, watched by the kernel.`,
      `2. Starts it in a sandbox with no route off the machine, where every hostname answers to the loopback address and every credential is fake.`,
      `3. Records what it did before any tool was used: names it looked up, encrypted connections it opened, programs it started, files it wrote.`,
      `4. Asks once for its list of tools. **No tool is called.**`,
      `5. Reads the README that shipped in the package and compares.`,
      ``,
      `## The standard`,
      ``,
      `**A website counts as declared only if the README names it.** A tool counts as documented only if the README names it as a whole word. Matching is exact, so a subdomain is not its parent: a README that links to \`example.com\` has not named \`api.example.com\`.`,
      ``,
      `The host pattern is loose in one direction and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings. It cannot put something in.`,
      ``,
      `## Not calibration-backed`,
      ``,
      `BRYDGE's ten curated measurements are backed by a calibration: two servers that lie on purpose, which the harness must catch before any result may be published. That calibration proves the instrument catches planted claims about what a tool *did*. Level 1 calls no tool and reads each README by a stated rule rather than by a person, so nothing in that calibration speaks to these pages. Every Level 1 page says so.`,
      ``,
      `## Not a ranking`,
      ``,
      `The set measured is whatever two registry searches returned, read by hand for whether each package is a server that starts without a credential. Download figures decided nothing about the order of the table, which is alphabetical by package. Nothing here says one server is more used, better or worse than another.`,
      ``,
      `## Findings are sent to maintainers first`,
      ``,
      `A page that reports a finding is not published until that package's maintainers have been notified and three days have passed. The notice carries the same evidence lines as the page, states the standard in full so a maintainer can say it is the wrong standard, and names the two answers that would both be fair: documented elsewhere, or a documentation gap. A page cleared for publication is listed by hand in \`site/cleared.txt\`, so the clearing is in the repository's history.`,
      ``,
      `## What a page does not say`,
      ``,
      `- It judges no tool. None was called.`,
      `- It is one run, once. A program that behaves one way while watched and another way otherwise would produce the same page.`,
      `- It ran with no route off the machine, so anything that only happens after a connection succeeds did not happen.`,
      `- Encrypted traffic was not read. The name asked for is recorded; the contents are not, and would not be even with a route.`,
      `- "Declared" means named in the README, nothing more.`,
      `- The harness is BRYDGE's own, and BRYDGE has an interest in the question of whether tools do what they say.`,
      ``,
      `## Run it yourself`,
      ``,
      `The harness, the two lying servers it is calibrated against, every evidence file behind these pages and the code that renders them are public: ${REPO}. Instrument fingerprint \`${fp.slice(0, 12)}\`.`,
    ].join("\n"),
  );
  return shell({
    title: "Method and limits — Level 1 measurements",
    description: "How a Level 1 measurement is made, the standard it applies, and what it cannot establish.",
    canonical: `${SITE}/method.html`,
    body,
    mistakeTitle: "Mistake on the Level 1 method page",
  });
}

function main(): void {
  const items = readdirSync(EVIDENCE)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(EVIDENCE, f), "utf8")) as Level1Evidence);
  const { out, withheld } = publishable(items);

  if (process.argv.includes("--withheld")) {
    console.error(`${withheld.length} page(s) waiting on a maintainer notice:`);
    for (const e of withheld) console.error(`  ${e.slug}\t${e.package.name}@${e.package.version}`);
    return;
  }

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "s"), { recursive: true });

  /* The index headline counts every measured server; only cleared pages are
   * written and linked, and the withheld count is stated rather than hidden. */
  const indexMd = renderIndex(items).replace(/\]\(([a-z0-9][a-z0-9-]*)\.md\)/g, (m, slug: string) =>
    out.some((e) => e.slug === slug) ? `](/s/${slug}.html)` : m,
  );
  const linked = new Set(out.map((e) => e.slug));
  const indexBody = indexMd
    .split(/\r?\n/)
    .filter((line) => {
      const row = /^\| `([^`]+)`/.exec(line);
      if (!row) return true;
      const e = items.find((x) => x.package.name === row[1]);
      return !e || linked.has(e.slug);
    })
    .join("\n");

  const note = withheld.length
    ? `\n\n**${withheld.length} pages are not published yet.** Each reports a finding, and a page reporting a finding goes up only after its maintainers have been notified and three days have passed. The counts above include them; the pages and the package names do not appear until then. [How that works](/method.html)\n`
    : "";

  writeFileSync(
    join(DIST, "index.html"),
    shell({
      title: "Level 1 measurements — MCP servers at startup",
      description:
        "What popular MCP servers do at startup before any tool is used, and where their own README does not name it. Published method, published evidence, not a ranking.",
      canonical: `${SITE}/`,
      body: markdownToHtml(indexBody + note),
      mistakeTitle: "Mistake on the Level 1 index",
    }),
  );
  writeFileSync(join(DIST, "method.html"), methodPage(items));

  for (const e of out) {
    writeFileSync(
      join(DIST, "s", `${e.slug}.html`),
      shell({
        title: `${e.package.name} ${e.package.version} — Level 1 measurement`,
        description: `What ${e.package.name} did at startup before any tool was used, and where its own README does not name it.`,
        canonical: `${SITE}/s/${e.slug}.html`,
        body: markdownToHtml(renderReport(e)),
        mistakeTitle: `Mistake on the Level 1 page for ${e.package.name}`,
      }),
    );
  }

  const day = (items[0]?.measuredAt ?? new Date().toISOString()).slice(0, 10);
  writeFileSync(
    join(DIST, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      [`${SITE}/`, `${SITE}/method.html`, ...out.map((e) => `${SITE}/s/${e.slug}.html`)]
        .map((u) => `  <url><loc>${u}</loc><lastmod>${day}</lastmod></url>`)
        .join("\n") +
      `\n</urlset>\n`,
  );
  writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

  console.error(
    `site: ${out.length} page(s) published, ${withheld.length} withheld pending notice, ` +
      `plus index, method, sitemap and robots → ${DIST.replace(ROOT + "/", "")}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
