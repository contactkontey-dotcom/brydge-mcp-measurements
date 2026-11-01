/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE PAGE OVER MANY MEASUREMENTS.
 *
 * `renderIndex` is the same kind of function as `renderReport`: the evidence
 * files in, Markdown out, no lookup and no clock. Every number in a row is a
 * count read off that package's own evidence file, and a row that could not be
 * measured says so in the row rather than being left out — an index that
 * silently drops the packages that refused to start would read as a clean
 * sweep of everything tried.
 *
 * The three words `report.ts` may not use are forbidden here for the same
 * reason, and `level1-index.test.ts` fails on any of them.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport } from "./report.ts";
import type { Level1Evidence } from "./run.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE = join(ROOT, "level1", "evidence");
const REPORTS = join(ROOT, "level1", "reports");

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A row's three counts, or the reason there are none. */
function countsOf(e: Level1Evidence): { offered: string; reached: string; unnamed: string } {
  if (e.couldNotStart || !e.observed || !e.comparison) {
    return { offered: "—", reached: "—", unnamed: "—" };
  }
  const sites = [...new Set([...e.observed.dnsNames, ...e.observed.tlsHosts])].length;
  const t = e.comparison.tools.undocumented.length;
  const h = e.comparison.hosts.undeclared.length;
  return {
    offered: String(e.observed.offered.length),
    reached: String(sites),
    unnamed: t === 0 && h === 0 ? "none" : [t ? plural(t, "tool") : "", h ? plural(h, "website") : ""].filter(Boolean).join(", "),
  };
}

export function renderIndex(items: Level1Evidence[]): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  /* Alphabetical by package, because any other order would read as a ranking. */
  const rows = [...items].sort((a, b) => a.package.name.localeCompare(b.package.name));
  const ran = rows.filter((e) => !e.couldNotStart);
  const stuck = rows.filter((e) => e.couldNotStart);
  const days = [...new Set(rows.map((e) => e.measuredAt.slice(0, 10)))].sort();

  p(`# What the servers on every best-of list do at startup`);
  p();

  /*
   * THE HEADLINE, AND IT IS A COUNT RATHER THAN A CLAIM.
   *
   * It is the first thing a visitor reads, so it has to be the thing the
   * measurement actually establishes: how often a server's own README is
   * silent about something the server did or offered. Every number in it is
   * computed from the rows below — nothing here is written by hand, so the
   * sentence cannot drift from the table underneath it, which is the failure
   * the sandbox's narration had.
   */
  const toolRows = ran.filter((e) => e.comparison!.tools.undocumented.length);
  const hostRows = ran.filter((e) => e.comparison!.hosts.undeclared.length);
  const either = new Set([...toolRows, ...hostRows].map((e) => e.slug));
  const both = toolRows.filter((e) => e.comparison!.hosts.undeclared.length).length;
  const offered = ran.reduce((n, e) => n + e.observed!.offered.length, 0);
  /*
   * THE NETWORK FIGURE LEADS, AND THE TOOL FIGURE CARRIES ITS WARNING.
   *
   * "Reached for a website its README does not name" is the finding this
   * measurement can stand behind without qualification: the kernel saw the
   * lookup, and the README either contains the hostname or it does not.
   *
   * "Offered a tool its README does not name" is the larger number and the
   * softer one — a server documenting its tools in a reference file beside the
   * README shows every tool as unnamed. Printing it second, with the caveat
   * attached rather than filed under a heading further down, is the difference
   * between a figure and a figure somebody will quote at a maintainer.
   */
  const shortReadme = toolRows.filter((e) => (e.readme.bytes ?? 0) < 3000).length;
  p(`## ${plural(hostRows.length, "of " + String(ran.length) + " server", "of " + String(ran.length) + " servers")} reached for a website their own README does not name`);
  p();
  p(
    `Each of those ${plural(hostRows.length, "lookup", "servers")} is recorded with the name it asked for and the ` +
      `line of its README that does not contain it. Nothing left the machine: the room has no route off the host, ` +
      `so every name answered to the loopback address and no connection completed.`,
  );
  p();
  p(
    `**${plural(toolRows.length, "server")} offered a tool their README does not name** — ${offered.toLocaleString("en-GB")} ` +
      `tools were offered in total and **none was called**. Read that second figure with the caveat attached: this ` +
      `rule reads only the README that shipped in the package, so a server documenting its tools in a reference ` +
      `file beside it shows every tool as unnamed` +
      `${shortReadme ? `, and ${plural(shortReadme, "of those servers has", "of those servers have")} a README under three kilobytes` : ""}. ` +
      `A large count here is a fact about the rule as much as about the package.`,
  );
  p();
  p(
    `${both === 0 ? "No server did both." : `${both} did both.`} ` +
      `The remaining ${ran.length - either.size} had nothing found, which is not the same as a clean sweep — see below.`,
  );
  p();
  /* Only when there are any. A line reading "0 packages could not start" is
   * noise, and the index is built from what is publishable rather than from
   * everything minus a list, so it has nothing to say about what it cannot see. */
  if (stuck.length) {
    p(
      `${plural(stuck.length, "package")} could not start; ${stuck.length === 1 ? "its row says" : "their rows say"} ` +
        `so, with the reason where one is known.`,
    );
    p();
  }
  p(
    `${plural(rows.length, "npm package")}, each measured from its name alone: installed, started in a room with ` +
      `no route to the internet and no real credentials, asked for its list of tools, and compared against its own ` +
      `README. No tool was called. ${days.length === 1 ? `Measured ${days[0]}` : `Measured ${days[0]} to ${days[days.length - 1]}`}.`,
  );
  p();
  p(
    `**Not calibration-backed.** The calibration behind the ten curated measurements proves the instrument catches ` +
      `planted claims about what a tool *did*. Level 1 calls no tool and reads each README by a stated rule rather ` +
      `than by a person, so nothing in that calibration speaks to these pages.`,
  );
  p();
  p(`**A website counts as declared only if the README names it.** A tool counts as documented only if the README names it as a whole word.`);
  p();
  /*
   * PROVENANCE, AND WHAT IT IS NOT. npm's download figures are not reachable
   * from the machine these runs happen on, and the registry's own popularity
   * score reads 1.0 for every package on this list, so there is no measured
   * ranking behind the selection and the page must not imply one.
   */
  p(
    `**This is not a ranking of the most-used servers.** The set measured is whatever two registry searches ` +
      `returned, read by hand for whether each package is a server that starts without a credential. Download ` +
      `figures decided nothing about the order of this table, which is alphabetical by package, and four widely ` +
      `used servers are measured here that neither search returned at all. Nothing on this page says one server ` +
      `is more used, better or worse than another.`,
  );
  p();

  /* ── The ten rows. ────────────────────────────────────────────────────── */
  p(`| Package | Version | Published at | Tools offered | Websites reached for | Not named in the README | Report |`);
  p(`| --- | --- | --- | --: | --: | --- | --- |`);
  for (const e of rows) {
    const c = countsOf(e);
    const name = `\`${e.package.name}\``;
    const version = e.package.version ? `\`${e.package.version}\`` : "—";
    /* Two packages here are called Playwright and are not by the same people. */
    const maker = (e.package.repository ?? e.package.homepage ?? "").replace(/^git\+/, "").replace(/\.git$/, "");
    const at = maker ? maker.replace(/^https?:\/\/(www\.)?/, "") : "not stated";
    const unnamed = e.couldNotStart ? `**could not start** — ${e.couldNotStart.stage}` : c.unnamed;
    p(`| ${name} | ${version} | ${at} | ${c.offered} | ${c.reached} | ${unnamed} | [report](${e.slug}.md) |`);
  }
  p();

  /* ── And why, for each that did not start. ────────────────────────────── */
  if (stuck.length) {
    p(`## Could not start`);
    p();
    p(
      `${plural(stuck.length, "package")} did not get far enough to be measured. ` +
        `Each row below is the tooling's own message, not a diagnosis:`,
    );
    p();
    for (const e of stuck) {
      p(`- **${e.package.name}${e.package.version ? ` ${e.package.version}` : ""}** — could not start at the \`${e.couldNotStart!.stage}\` stage.`);
      p();
      p("  ```");
      for (const line of e.couldNotStart!.because.trim().split(/\r?\n/).slice(0, 6)) p(`  ${line}`);
      p("  ```");
      p();
    }
  }

  /* ── What the table is and is not. ────────────────────────────────────── */
  p(`## Reading the table`);
  p();
  p(
    `- **Published at** is the repository or homepage the package's own manifest points at, printed because two ` +
      `packages measured here are called Playwright and are not by the same people. It is what each package says ` +
      `about itself and is not verified.`,
  );
  p(`- **Tools offered** is what each server answered to one \`tools/list\` request. None was called.`);
  p(
    `- **Websites reached for** counts the distinct names a server looked up or opened an encrypted connection to ` +
      `before any tool was used. Nothing left the machine: every name answered to the loopback address, so no ` +
      `connection completed and no contents were seen.`,
  );
  p(
    `- **Not named in the README** is the comparison, by the rule above and nothing looser. "none" means every tool ` +
      `it offered and every website it reached for appears in its own README.`,
  );
  p(
    `- **An empty row is not a clean sweep.** A server that offers few tools and reaches for no website has little ` +
      `for this comparison to find, which is a fact about the measurement as much as about the server.`,
  );
  p(
    `- **A large count is not a scandal either.** Only the README file that shipped in the package is read. A server ` +
      `that documents its tools in another file — a reference page beside the README, or a website — shows every ` +
      `tool it offers as not named here. Each report cites the README it read, its digest and its line count, and ` +
      `the name it looked for and did not find, so any row can be checked rather than taken.`,
  );
  p(
    `- **It is one run, once,** with no route off the machine and no tool called. A page here says what a server did ` +
      `at startup while being watched, and where its README was silent about it. It says nothing else.`,
  );
  p();
  p(
    (stuck.length === 0
      ? `All ${plural(ran.length, "package")} started, so no row says could not start. `
      : `${plural(ran.length, "package")} started; ${plural(stuck.length, "package")} did not. `) +
      `Evidence for every row — the full trace, the tool list, the README digest and each citation — is in ` +
      `\`level1/evidence/\`, one JSON file per package, beside the code that produced it.`,
  );
  return out.join("\n");
}

/*
 * Rebuild every page from the evidence beside it. The pages are derived
 * artefacts: a wording fix should never mean re-running ten sealed sessions,
 * and re-running them would also be the one way a "fix" could quietly change a
 * measured number. Evidence is written once, by `run.ts`; pages are written
 * from it, as often as the words need changing.
 */
function main(): void {
  /*
   * Only `level1/evidence/` is read. A held package's evidence is written to
   * the git-ignored `level1/held/` instead, so it cannot reach the index by
   * being forgotten about here — the index is built from what is publishable,
   * rather than from everything minus a list.
   */
  const files = readdirSync(EVIDENCE).filter((f) => f.endsWith(".json")).sort();
  const items = files.map((f) => JSON.parse(readFileSync(join(EVIDENCE, f), "utf8")) as Level1Evidence);
  mkdirSync(REPORTS, { recursive: true });

  for (const e of items) writeFileSync(join(REPORTS, `${e.slug}.md`), renderReport(e) + "\n");
  const path = join(REPORTS, "index.md");
  writeFileSync(path, renderIndex(items) + "\n");
  console.error(`rebuilt ${items.length} report(s) and ${path}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
