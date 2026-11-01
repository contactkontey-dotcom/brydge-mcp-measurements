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
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport } from "../level1/report.ts";
import { renderIndex } from "../level1/index.ts";
import type { Level1Evidence } from "../level1/run.ts";
import { escapeHtml, markdownToHtml } from "./md.ts";
import { badgeSvg, previewLines, previewSvg } from "./assets.ts";
import type { Upstream } from "../level1/report.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(ROOT, "level1", "evidence");
const DIST = join(ROOT, "site", "dist");
export const SITE = "https://mcp.brydge-ai.com";
const REPO = "https://github.com/contactkontey-dotcom/brydge-mcp-measurements";
const MAIN = "https://www.brydge-ai.com/mcp";

/*
 * A MAINTAINER'S RESPONSE IS PUBLISHED WITH ITS LINK OR NOT AT ALL.
 *
 * `level1/upstream.json` records what happened when a finding was put to the
 * people who ship the package. If an entry exists for a page being built and it
 * has no url, the build fails rather than publishing "they closed it as not
 * planned" with nothing to click: that sentence is hearsay without the thread,
 * and the maintainer is the one it would be unfair to.
 */
export function upstreamFor(): Record<string, Upstream> {
  const p = join(ROOT, "level1", "upstream.json");
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  const out: Record<string, Upstream> = {};
  for (const [slug, v] of Object.entries(raw)) if (!slug.startsWith("_")) out[slug] = v as Upstream;
  return out;
}

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
.search{margin:0 0 18px}
.search label{display:block; font-family:var(--f-mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-faint); margin-bottom:6px}
.search input{width:100%; max-width:26rem; font:inherit; font-size:15px; color:var(--ink); background:var(--raised); border:1px solid var(--line-strong); padding:9px 12px}
.search input:focus-visible{outline:2px solid var(--ink); outline-offset:1px}
.count{font-family:var(--f-mono); font-size:12px; color:var(--ink-faint); margin:8px 0 0}
tr[hidden]{display:none}
.badge{display:block; margin:10px 0 18px}
.snippet{background:var(--raised); border:1px solid var(--line); padding:10px 12px; overflow-x:auto; font-family:var(--f-mono); font-size:12px; white-space:pre; margin:0 0 20px}
.cols{display:grid; gap:28px; grid-template-columns:repeat(auto-fit,minmax(16rem,1fr)); margin:0 0 24px; max-width:var(--measure)}
.cols h3{margin-top:0}
.tier{border-top:2px solid var(--ink); padding-top:12px}
.tier p{margin-bottom:10px}
.paste{margin:0 0 24px; max-width:var(--measure)}
.paste label{display:block; font-size:13px; color:var(--ink-muted); margin-bottom:8px}
.paste textarea{width:100%; font-family:var(--f-mono); font-size:12.5px; line-height:1.5; color:var(--ink); background:var(--raised); border:1px solid var(--line-strong); padding:10px 12px; resize:vertical}
.paste textarea:focus-visible{outline:2px solid var(--ink); outline-offset:1px}
.paste button{margin-top:10px; font:inherit; font-size:13px; color:var(--ground); background:var(--ink); border:1px solid var(--ink); padding:7px 14px; cursor:pointer}
.paste button:hover{background:var(--ink-muted); border-color:var(--ink-muted)}
#out table td{white-space:normal; max-width:34rem}
#out td:first-child{font-family:var(--f-mono); font-size:12px; white-space:nowrap}
.keys{margin:6px 0 0; font-size:12.5px; color:var(--ink-faint)}
.note{color:var(--ink-muted)}
.free{font-family:var(--f-mono); font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-faint)}
@media (max-width:420px){ th,td{white-space:normal} }
`;

function shell(opts: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  mistakeTitle: string;
  /** The card a link unfurls into. Every page has one; none is decorative. */
  preview?: string;
  /** Only the paste page sets this: a rule the browser keeps, not a promise. */
  csp?: string;
}): string {
  const card = opts.preview ?? "/p/index.png";
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.csp ? `<meta http-equiv="Content-Security-Policy" content="${opts.csp}">` : ""}
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}">
<link rel="canonical" href="${opts.canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(opts.title)}">
<meta property="og:description" content="${escapeHtml(opts.description)}">
<meta property="og:url" content="${opts.canonical}">
<meta property="og:image" content="${SITE}${card}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500&family=Newsreader:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Mono:wght@400&display=swap">
<style>${CSS}</style>
<div class="band"><div class="wrap">
  <p class="eyebrow">Level 1 measurement</p>
  <p class="says">What a server did at startup before any tool was used, and where its own README is silent about it. No tool is called, so nothing here tests whether a tool does what it says. Not calibration-backed. Not a ranking.</p>
</div></div>
<main class="wrap">
${opts.body}
<div class="foot">
  <a href="/">All measurements</a><a href="/method.html">How we measure</a><a href="/paste.html">Paste your config</a><a href="/request.html">Request a measurement</a><a href="/alerts.html">Get an alert</a><a href="/pricing.html">Pricing</a><a href="${REPO}">Harness and raw evidence</a><a href="${MAIN}">BRYDGE&rsquo;s calibrated measurements</a>
  <p class="report"><a href="${REPO}/issues/new?title=${encodeURIComponent(opts.mistakeTitle)}">Report a mistake on this page &rarr;</a></p>
</div>
</main>
</html>
`;
}

/*
 * SEARCH THAT CANNOT HIDE A ROW FROM SOMEBODY WITHOUT JAVASCRIPT.
 *
 * The table is complete in the HTML. This filters rows that are already there
 * and says how many are showing; with scripting off, every row stays visible
 * and the box simply does not appear. No index file, no fetch, no service —
 * 38 rows is a list, not a corpus, and a search that needs a server would make
 * this a site that runs something.
 */
const SEARCH = `
<form class="search" role="search" onsubmit="return false" hidden>
  <label for="q">Find a server</label>
  <input id="q" type="search" autocomplete="off" placeholder="package name, or a host it reached for">
  <p class="count" id="count" aria-live="polite"></p>
</form>
<script>
(function(){
  var form=document.querySelector('.search'), box=document.getElementById('q'),
      out=document.getElementById('count'), table=document.querySelector('table');
  if(!form||!box||!table) return;
  form.hidden=false;
  var rows=[].slice.call(table.tBodies[0].rows);
  rows.forEach(function(r){ r.dataset.hay=r.textContent.toLowerCase(); });
  function run(){
    var q=box.value.trim().toLowerCase(), shown=0;
    rows.forEach(function(r){
      var hit=!q||r.dataset.hay.indexOf(q)>-1;
      r.hidden=!hit; if(hit) shown++;
    });
    out.textContent=q?(shown+' of '+rows.length+' shown'):'';
  }
  box.addEventListener('input',run); run();
})();
</script>
`;


/*
 * THE TWO FORMS, AND NEITHER OF THEM IS A FORM THAT POSTS SOMEWHERE.
 *
 * There is no account, no database and nothing running behind this site, so a
 * request or an alert is a message to a place that already exists and already
 * keeps a public record: an issue on the measurement repository, prefilled, or
 * an email. That is less slick than a box that says "thanks, we got it", and it
 * is honest about where the message lands and who can read it — which for a
 * project whose whole claim is "check this yourself" is the point.
 */
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * PASTE YOUR CONFIG. IT DOES NOT LEAVE THE PAGE, AND THAT IS ENFORCED.
 *
 * An MCP config holds the keys to a developer's accounts. This page therefore
 * takes three precautions and tells the reader about all three in a line they
 * can check in ten seconds:
 *
 *   `connect-src 'none'` — a Content-Security-Policy rule the BROWSER enforces.
 *   No fetch, no XHR, no beacon, no WebSocket can leave this page even if the
 *   code below is wrong. A promise is worth what its enforcement is worth.
 *
 *   The index and the parser are INLINED at build time, so after the page
 *   loads it makes no request at all — the Network tab stays empty while you
 *   paste, which is the thing a cautious reader will actually check.
 *
 *   Env VALUES are discarded in `readConfig` before anything is rendered. Key
 *   names are shown, because which credentials a server asks for is the
 *   interesting part; the credentials themselves never exist past the parse.
 *
 * The one request the page makes is the webfont stylesheet, at load, before
 * anything is pasted. The page says so rather than claiming a purity it does
 * not have.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function pastePage(items: Level1Evidence[]): string {
  /* Only published measurements. A withheld finding is not public, and this
   * page is as public as the index is. */
  const index: Record<string, unknown> = {};
  for (const e of items) {
    if (!e.observed || !e.comparison) continue;
    const record = {
      name: e.package.name,
      slug: e.slug,
      version: e.package.version,
      measuredAt: e.measuredAt.slice(0, 10),
      offered: e.observed.offered.length,
      undocumentedTools: e.comparison.tools.undocumented.length,
      undeclaredHosts: e.comparison.hosts.undeclared.length,
      websites: [...new Set([...e.observed.dnsNames, ...e.observed.tlsHosts])].length,
    };
    index[e.package.name] = record;
    /* A bare command in a config is usually the package's unscoped tail. */
    index[`bin:${e.package.name.replace(/^@[^/]+\//, "")}`] = record;
  }

  const client = readFileSync(join(ROOT, "site", "paste-client.js"), "utf8");
  const ui = `
const INDEX = ${JSON.stringify(index)};
const box = document.getElementById('cfg');
const out = document.getElementById('out');
const copy = document.getElementById('copy');
let rows = [];

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function render(){
  const text = box.value.trim();
  if(!text){ out.innerHTML = ''; copy.hidden = true; rows = []; return; }
  const parsed = readConfig(text);
  if(!parsed.ok){
    out.innerHTML = '<p class="note">That did not read as an MCP config: ' + esc(parsed.error) + '</p>';
    copy.hidden = true; rows = []; return;
  }
  rows = parsed.servers.map(function(server){ return { server: server, result: match(server, INDEX) }; });
  const body = rows.map(function(r){
    const s = r.server, m = r.result;
    let pkg = '—', said = '', cls = '';
    if(m.record){
      pkg = '<a href="/s/' + esc(m.record.slug) + '.html"><code>' + esc(m.record.name) + '</code></a>';
      const t = m.record.undocumentedTools, h = m.record.undeclaredHosts;
      said = t === 0 && h === 0
        ? 'Measured ' + esc(m.record.measuredAt) + '. ' + m.record.offered + ' tools offered, ' + m.record.websites + ' websites reached for, nothing found that its README does not name.'
        : 'Measured ' + esc(m.record.measuredAt) + '. Not named in its README: ' + [t ? t + ' tool' + (t===1?'':'s') : '', h ? h + ' website' + (h===1?'':'s') : ''].filter(Boolean).join(', ') + '.';
      if(m.state === 'measured-other-version') said += ' Your config asks for ' + esc(m.wanted) + '; the page is for ' + esc(m.record.version) + '.';
    } else if(m.state === 'unmeasured'){
      pkg = '<code>' + esc(m.name) + '</code>';
      said = 'No page for this yet. <a href="/request.html">Ask for it</a>.';
    } else if(m.state === 'remote'){
      said = 'A remote server. Level 1 installs and starts a package; there is nothing here to install.';
    } else if(m.state === 'other'){
      said = esc(m.detail) + ' package. Level 1 measures npm packages only.';
    } else {
      said = 'Could not tell what this entry runs (' + esc(m.detail || '') + ').';
    }
    const keys = s.envKeys.length
      ? '<p class="keys">Asks for ' + s.envKeys.map(function(k){ return '<code>' + esc(k) + '</code>'; }).join(', ') + '. Values were discarded when this was read.</p>'
      : '';
    return '<tr><td>' + esc(s.label) + '</td><td>' + pkg + '</td><td>' + said + keys + '</td></tr>';
  }).join('');
  out.innerHTML = '<div class="scroll"><table><thead><tr><th>In your config</th><th>Package</th><th>What is on record</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  copy.hidden = rows.length === 0;
}

box.addEventListener('input', render);
copy.addEventListener('click', function(){
  navigator.clipboard.writeText(toMarkdown(rows, location.origin)).then(function(){
    copy.textContent = 'Copied';
    setTimeout(function(){ copy.textContent = 'Copy a summary'; }, 1500);
  });
});
render();
`;

  const body = [
    markdownToHtml(
      [
        `# Paste your MCP config`,
        ``,
        `See which of the servers you run have been measured, and what was found. **Nothing you paste leaves this page.**`,
        ``,
        `That is not a promise, it is a rule your browser enforces: this page is served with \`connect-src 'none'\`, so no request can be made from it at all. The measurement index and the parser are built into the page, so once it has loaded it fetches nothing — open your Network tab and watch it stay empty while you type. The one request it makes is the webfont stylesheet, at load, before you have pasted anything.`,
        ``,
        `Your \`env\` values are discarded as the config is read, before anything is drawn. The page lists which credentials each server asks for, by name, because that is the interesting part; the values never exist past the first step.`,
      ].join("\n"),
    ),
    `<form class="paste" onsubmit="return false">`,
    `<label for="cfg">Your config — <code>claude_desktop_config.json</code>, <code>.mcp.json</code>, or any file with an <code>mcpServers</code> or <code>servers</code> block</label>`,
    `<textarea id="cfg" rows="10" spellcheck="false" autocomplete="off" placeholder='{
  "mcpServers": {
    "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }
  }
}'></textarea>`,
    `<button type="button" id="copy" hidden>Copy a summary</button>`,
    `</form>`,
    `<div id="out"></div>`,
    markdownToHtml(
      [
        `## What it can and cannot tell you`,
        ``,
        `- A match is on **package name**. If you run a fork, or pin a version other than the one measured, the row says so.`,
        `- A **remote** server (\`url\`, or type \`http\`/\`sse\`) is not measurable at Level 1: there is nothing to install and start.`,
        `- A **Python, Docker, Deno or Go** server is not measured here either. Level 1 measures npm packages.`,
        `- **No page is not a verdict.** A server with no page here may never have been measured, or may have been measured with its page not yet published — a page reporting a finding waits until its maintainers have been notified. The two look the same from here, deliberately: telling them apart would announce which packages have a finding before the people who ship them have heard it.`,
        `- Every row that links to a page carries that page's limits: one run, once, no tool called, not calibration-backed.`,
      ].join("\n"),
    ),
    `<script type="module">${client.replace(/^export /gm, "")}
${ui}</script>`,
  ].join("\n");

  return shell({
    title: "Paste your MCP config — Level 1 measurements",
    description: "See which MCP servers in your config have been measured, and what was found. Read entirely in your browser; nothing is uploaded.",
    canonical: `${SITE}/paste.html`,
    body,
    mistakeTitle: "Mistake on the Level 1 paste page",
    preview: "/p/paste.png",
    csp: "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; img-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'",
  });
}

function requestPage(): string {
  const issue = (title: string, body: string) =>
    `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const body = markdownToHtml(
    [
      `# Request a measurement`,
      ``,
      `Name an npm package and it goes on the list. There is no queue position to check and no promise of a date: measurements run in batches, and a package that will not start without a credential cannot be measured at Level 1 at all — that limit is in the [method](/method.html).`,
      ``,
      `## What gets measured`,
      ``,
      `- It installs from npm and starts without a credential.`,
      `- It speaks the Model Context Protocol over stdio.`,
      `- It ships a README, which is what the comparison reads.`,
      ``,
      `A package missing any of those gets a reply saying which, rather than a page.`,
      ``,
      `## Ask`,
      ``,
      `[Open a request on GitHub](${issue("Measure: <package name>", "Package on npm:\n\nWhy it is worth measuring:\n\nAnything that needs setting up before it starts:\n")}) — the issue is public, like everything else here.`,
      ``,
      `Or email <contact@brydge-ai.com> with the package name. A request by email is answered by email; it does not appear in public until the page does.`,
    ].join("\n"),
  );
  return shell({
    title: "Request a measurement — Level 1",
    description: "Ask for an npm MCP server to be measured at Level 1.",
    canonical: `${SITE}/request.html`,
    body,
    mistakeTitle: "Mistake on the Level 1 request page",
    preview: "/p/request.png",
  });
}

function alertsPage(): string {
  const issue = (title: string, body: string) =>
    `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const body = markdownToHtml(
    [
      `# Get an alert when a measurement changes`,
      ``,
      `A measurement is one run of one version on one date. The next version can do something different, and the page you read last month may no longer describe the package you are installing. Three ways to find out, none of which needs an account here.`,
      ``,
      `## Watch the repository`,
      ``,
      `Every page is built from an evidence file in [the public repository](${REPO}). Watching it — *Custom → Releases*, or the whole repository — tells you when any measurement lands, including a re-measurement of a package you care about. The diff shows exactly what changed, because the evidence is the file.`,
      ``,
      `## Ask to be told about one package`,
      ``,
      `[Open an alert request](${issue("Alert: <package name>", "Package on npm:\n\nTell me when: (a new version is measured / a finding changes / either)\n\nHow to reach you:\n")}). You will be notified on that issue when the package is measured again, and the thread stays public so anyone can see what was said.`,
      ``,
      `Or email <contact@brydge-ai.com> and say which package and what should trigger the message.`,
      ``,
      `## Re-run it yourself, on your own schedule`,
      ``,
      `Nothing here is privileged. The harness is public and a measurement is one command:`,
      ``,
      "```",
      `git clone ${REPO}`,
      `cd brydge-mcp-measurements && node level1/run.ts <package>@<version>`,
      "```",
      ``,
      `If your run disagrees with a page here, that is a finding about us and we would like the issue.`,
    ].join("\n"),
  );
  return shell({
    title: "Alerts — Level 1 measurements",
    description: "How to find out when an MCP server's Level 1 measurement changes.",
    canonical: `${SITE}/alerts.html`,
    body,
    mistakeTitle: "Mistake on the Level 1 alerts page",
    preview: "/p/alerts.png",
  });
}

/*
 * PRICING, WITH THE FREE THING FIRST AND NO NUMBER INVENTED.
 *
 * Level 1 is free and is the whole of this site; saying so plainly is the
 * honest headline, because a reader arriving at a pricing page from a free
 * measurement wants to know what the catch is. The paid work is the curated
 * measurement — probes, oracles, a calibration — which is a different claim
 * and a different cost, and this page does not quote a figure the business has
 * not set. An invented price is a lie that costs a sale.
 */
function pricingPage(count: number): string {
  const body = markdownToHtml(
    [
      `# Pricing`,
      ``,
      `**Level 1 is free.** Fast private reports and monthly monitoring are available: email <contact@brydge-ai.com> for a quote.`,
      ``,
      `## What free means here`,
      ``,
      `All ${count} pages, every evidence file behind them, the badge, the harness and the code that renders the pages: free to read, free to re-run, free to quote, MIT-licensed. There is no account, no sign-up and nothing to buy on this site. If that is what you came for, you are done.`,
      ``,
      `## What a free page does not establish`,
      ``,
      `A Level 1 page says what a server did at startup before any tool was used, and where its own README is silent about it. It calls no tool, so it tests no claim any tool makes, and it is **not calibration-backed** — the calibration that proves the instrument catches a planted lie covers [the curated measurements](${MAIN}), not these. Both limits are printed on every page. Neither is a tease for an upsell; they are what this method can and cannot establish.`,
      ``,
      `## If you maintain a server measured here`,
      ``,
      `Nothing is for sale to you. Corrections are free and always will be: if a page is wrong, [open an issue](${REPO}/issues) or email <contact@brydge-ai.com>, and it is fixed with the correction recorded. Maintainers are notified before a finding is published and the page waits three days. Paying BRYDGE does not change what a page says — if it did, none of these pages would be worth reading.`,
    ].join("\n"),
  );
  return shell({
    title: "Pricing — Level 1 measurements",
    description: "Level 1 is free. Private reports and monthly monitoring are quoted on request.",
    canonical: `${SITE}/pricing.html`,
    body,
    mistakeTitle: "Mistake on the Level 1 pricing page",
    preview: "/p/pricing.png",
  });
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

  const upstream = upstreamFor();
  for (const e of out) {
    const u = upstream[e.slug];
    if (u && !u.url) {
      console.error(
        `site: ${e.slug} has an upstream entry with no url. A page cannot say a maintainer "${u.outcome}" ` +
          `without linking the thread. Add the url to level1/upstream.json, or remove the entry.`,
      );
      process.exit(2);
    }
  }

  rmSync(DIST, { recursive: true, force: true });
  for (const d of ["s", "b", "p"]) mkdirSync(join(DIST, d), { recursive: true });

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
      body: markdownToHtml(indexBody + note).replace("<div class=\"scroll\">", SEARCH + "<div class=\"scroll\">"),
      mistakeTitle: "Mistake on the Level 1 index",
    }),
  );
  writeFileSync(join(DIST, "method.html"), methodPage(items));
  writeFileSync(join(DIST, "request.html"), requestPage());
  writeFileSync(join(DIST, "alerts.html"), alertsPage());
  writeFileSync(join(DIST, "pricing.html"), pricingPage(out.length));
  writeFileSync(join(DIST, "paste.html"), pastePage(out));

  /* Cards for the pages that are not a server. */
  writeFileSync(join(DIST, "p", "index.svg"), previewSvg({
    title: "What MCP servers do at startup",
    lines: [`${out.length} servers measured, every tool list compared with its README.`, "No tool called. Nothing left the machine.", "Published method, published evidence."],
    foot: "mcp.brydge-ai.com",
  }));
  for (const [name, title, lines] of [
    ["method", "How we measure, and what it cannot establish", ["Five steps, one stated standard.", "Not calibration-backed, and it says so.", "Run it yourself: the harness is public."]],
    ["request", "Request a measurement", ["Name an npm package.", "It must start without a credential.", "The request is public."]],
    ["alerts", "Get an alert when a measurement changes", ["Watch the repository.", "Or ask about one package.", "Or re-run it yourself."]],
    ["paste", "Paste your MCP config", ["See which servers you run were measured.", "Read in your browser; nothing is uploaded.", "connect-src 'none', enforced by the browser."]],
    ["pricing", "Pricing", ["Level 1 is free.", "Private reports and monthly monitoring: quoted on request.", "Corrections are free, always."]],
  ] as Array<[string, string, string[]]>) {
    writeFileSync(join(DIST, "p", `${name}.svg`), previewSvg({ title, lines, foot: "mcp.brydge-ai.com" }));
  }

  for (const e of out) {
    /* The badge, and the line a maintainer pastes to use it. Stated as a fact
     * with a date, never as a verdict: a badge is read at a glance, and a
     * glance cannot carry the limits that make the result honest. */
    writeFileSync(join(DIST, "b", `${e.slug}.svg`), badgeSvg(e));
    writeFileSync(join(DIST, "p", `${e.slug}.svg`), previewSvg({
      title: e.package.name,
      lines: previewLines(e),
      foot: `measured ${e.measuredAt.slice(0, 10)} · level 1 · not calibration-backed`,
    }));

    const md = `[![BRYDGE level 1, measured ${e.measuredAt.slice(0, 10)}](${SITE}/b/${e.slug}.svg)](${SITE}/s/${e.slug}.html)`;
    const badgeBlock = [
      `## The badge for this measurement`,
      ``,
      `<img class="badge" src="/b/${e.slug}.svg" alt="BRYDGE level 1, measured ${e.measuredAt.slice(0, 10)}" width="251" height="20">`,
      ``,
      `It states that a measurement happened and when — not a verdict, not a score, and no colour that means anything. It links to this page, where the limits are. Anyone may use it; nobody needs permission, and nobody can buy a different one.`,
      ``,
      `<div class="snippet">${escapeHtml(md)}</div>`,
      ``,
      `The badge is regenerated when the package is measured again, so an old badge in a README cannot show a date that has moved on.`,
    ].join("\n");

    writeFileSync(
      join(DIST, "s", `${e.slug}.html`),
      shell({
        title: `${e.package.name} ${e.package.version} — Level 1 measurement`,
        description: `What ${e.package.name} did at startup before any tool was used, and where its own README does not name it.`,
        canonical: `${SITE}/s/${e.slug}.html`,
        body: markdownToHtml(renderReport(e, upstream[e.slug]) + "\n\n" + badgeBlock),
        mistakeTitle: `Mistake on the Level 1 page for ${e.package.name}`,
        preview: `/p/${e.slug}.png`,
      }),
    );
  }

  /*
   * The committed PNG cards, copied in. They are drawn by `site/rasterize.mjs`
   * on a machine that has a browser; this build runs where there is none, and a
   * picture of text only changes when the measurement does.
   */
  const CARDS = join(ROOT, "site", "cards");
  let cards = 0;
  if (existsSync(CARDS)) {
    for (const f of readdirSync(CARDS).filter((n) => n.endsWith(".png"))) {
      const slug = f.replace(/\.png$/, "");
      const isPage = ["index", "method", "request", "alerts", "pricing", "paste"].includes(slug);
      if (isPage || out.some((e) => e.slug === slug)) {
        copyFileSync(join(CARDS, f), join(DIST, "p", f));
        cards++;
      }
    }
  }

  const day = (items[0]?.measuredAt ?? new Date().toISOString()).slice(0, 10);
  writeFileSync(
    join(DIST, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      [`${SITE}/`, `${SITE}/method.html`, `${SITE}/request.html`, `${SITE}/alerts.html`, `${SITE}/pricing.html`, `${SITE}/paste.html`, ...out.map((e) => `${SITE}/s/${e.slug}.html`)]
        .map((u) => `  <url><loc>${u}</loc><lastmod>${day}</lastmod></url>`)
        .join("\n") +
      `\n</urlset>\n`,
  );
  writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);

  console.error(
    `site: ${out.length} server page(s), ${withheld.length} withheld pending notice, ` +
      `plus index, method, request, alerts, pricing, ${out.length} badge(s), ${out.length + 5} preview card(s), ` +
      `${cards} committed card image(s), sitemap and robots → ${DIST.replace(ROOT + "/", "")}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
