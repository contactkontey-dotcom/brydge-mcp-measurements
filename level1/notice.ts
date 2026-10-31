/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LETTER TO THE MAINTAINER, WRITTEN FROM THE EVIDENCE AND NOTHING ELSE.
 *
 * Sent before the page is published, because a maintainer reading a finding
 * about their own package on a website first has been told last. The notice is
 * therefore the same facts as the page, in a shape that can be pasted into an
 * issue: what was run, what was observed, the line of evidence under each
 * claim, and where that claim would be wrong if we have it wrong.
 *
 * It asks a question rather than making a demand. Every finding here is of one
 * narrow kind — the README does not contain this name — and the two honest
 * answers are "the README should say so" and "it is documented elsewhere, and
 * your rule only reads the README". The notice states both.
 *
 * A pure function of one evidence file, like the page. Written into
 * `level1/held/notices/`, which is git-ignored, so a notice cannot be
 * published before it has been sent.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Level1Evidence } from "./run.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(ROOT, "level1", "evidence");
const OUT = join(ROOT, "level1", "held", "notices");

/** `git+https://github.com/x/y.git` → `https://github.com/x/y`. */
const tidy = (u: string) => u.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://");

export function renderNotice(e: Level1Evidence): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  const o = e.observed;
  const c = e.comparison;
  if (!o || !c) {
    return `# ${e.package.name}@${e.package.version}\n\nThis package did not start, so there is nothing to raise with its maintainers.\n`;
  }

  const reached = [...new Set([...o.dnsNames, ...o.tlsHosts])].sort();
  const undeclared = c.hosts.undeclared;
  const declaredAndReached = c.hosts.declared.filter((d) => reached.includes(d.host));
  const repo = e.package.repository ? tidy(e.package.repository) : null;
  const home = e.package.homepage ? tidy(e.package.homepage) : null;

  p(`# ${e.package.name}@${e.package.version}`);
  p();
  p(`**Where to file:** ${repo ? `${repo}/issues` : home ? `${home} (no repository in the manifest; use whatever this page offers)` : `the manifest names no repository or homepage, so there is nowhere to file from the package alone`}`);
  if (repo && home && !home.startsWith(repo)) p(`**Also in the manifest:** ${home}`);
  p();

  if (undeclared.length === 0) {
    p(
      `**Nothing to raise.** This server reached for ${reached.length === 1 ? "one website" : `${reached.length} websites`} ` +
        `at startup and the README names ${reached.length === 1 ? "it" : "each of them"}:`,
    );
    p();
    for (const d of declaredAndReached) p(`- \`${d.host}\` — ${e.readme.file ?? "README"} line ${d.at.line}`);
    p();
    p(`No notice needs sending. The row is recorded so the set of servers that reached a website is complete.`);
    return out.join("\n");
  }

  /* ── The ask, in two sentences, before any detail. ─────────────────────── */
  p(
    `Hello — BRYDGE measured this package at startup and found ` +
      `${undeclared.length === 1 ? "one website it reached for that" : `${undeclared.length} websites it reached for that`} ` +
      `the published README does not name. We would like to check that with you before we publish the page, and to ` +
      `correct it if we have it wrong.`,
  );
  p();
  p(`## What was run`);
  p();
  p(
    `\`npm install ${e.package.name}@${e.package.version}\` into an empty directory, then the server was started in a ` +
      `sandbox with no route off the machine and no real credentials, and asked once for its list of tools. ` +
      `**No tool was called.** Every name it looked up answered 127.0.0.1, so no connection completed and nothing ` +
      `left the machine — the hostnames below are what it asked for, not traffic we observed arriving anywhere.`,
  );
  p();
  p(`## The websites it reached for, before any tool was used`);
  p();
  for (const h of undeclared) {
    p(`### \`${h.host}\` — not named in the README`);
    p();
    for (const line of h.evidence) p(`- ${line}`);
    p();
  }
  if (declaredAndReached.length) {
    p(`It also reached for ${declaredAndReached.length === 1 ? "one host the README does name" : "hosts the README names"}, which we are not raising:`);
    p();
    for (const d of declaredAndReached) p(`- \`${d.host}\` — ${e.readme.file ?? "README"} line ${d.at.line}`);
    p();
  }

  /* ── The rule, stated so the maintainer can disagree with it. ─────────── */
  p(`## The standard we applied, so you can tell us it is the wrong one`);
  p();
  p(`**A website counts as declared only if the README names it.**`);
  p();
  p(
    `We read only \`${e.readme.file ?? "README"}\` as published in the tarball of this version ` +
      `(${e.readme.lines} lines, sha256 \`${(e.readme.digest ?? "").slice(0, 16)}\`). Matching is exact, so a ` +
      `subdomain is not its parent: a README that links to \`example.com\` has not named \`api.example.com\`. ` +
      `We did not read your repository docs, your privacy policy or your source.`,
  );
  p();
  p(`Two answers would both be fair, and either would change what we publish:`);
  p();
  p(`1. **It is documented, elsewhere.** Tell us where and the page will say so.`);
  p(`2. **It should be in the README.** Then this is a documentation gap, and we will link your fix when you make one.`);
  p();
  p(
    `We are not saying the connection is improper, and the page says nothing about why it is made. The page reports ` +
      `what the program did at startup and where its README is silent. It also says, in those words, that this is ` +
      `**not a ranking of the most-used servers** and that the measurement is **not calibration-backed**.`,
  );
  p();
  p(`## What we will publish, and when`);
  p();
  p(
    `A single page per package at the URL BRYDGE publishes Level 1 measurements on, carrying the lines above, the ` +
      `full evidence file, and a visible link for reporting a mistake. Nothing is published for three days from the ` +
      `date of this notice. If you reply after publication with a correction, the page is corrected and the ` +
      `correction is recorded.`,
  );
  p();
  p(`Measured ${e.measuredAt.slice(0, 10)}. Instrument fingerprint \`${e.instrumentFingerprint.slice(0, 12)}\`. Harness and raw evidence: https://github.com/contactkontey-dotcom/brydge-mcp-measurements`);
  return out.join("\n");
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  let written = 0;
  for (const f of readdirSync(EVIDENCE).filter((x) => x.endsWith(".json")).sort()) {
    const e = JSON.parse(readFileSync(join(EVIDENCE, f), "utf8")) as Level1Evidence;
    const reached = e.observed ? new Set([...e.observed.dnsNames, ...e.observed.tlsHosts]).size : 0;
    if (!reached) continue; /* a notice is about a website it reached for */
    writeFileSync(join(OUT, `${e.slug}.md`), renderNotice(e) + "\n");
    written++;
  }
  console.error(`${written} notice(s) → ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
