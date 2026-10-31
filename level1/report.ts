/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE PAGE, DERIVED FROM THE EVIDENCE AND FROM NOTHING ELSE.
 *
 * A pure function: evidence in, Markdown out. No lookup, no clock, no network.
 * Run it twice on one evidence file and get the same bytes, which is what lets
 * the report be committed beside the JSON it came from and diffed when a
 * package is measured again.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EVERY SENTENCE IS A FUNCTION OF THE EVIDENCE.
 *
 * The sandbox's narration was once a three-entry lookup keyed on the verdict,
 * and it printed "the destination's books are empty" above a table showing two
 * records. A measurement product whose page contradicts the evidence beneath it
 * has no business describing anybody else's software. So no sentence here
 * states a count the evidence did not carry, and nothing is hardcoded about
 * any particular package.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THREE WORDS THIS FILE MAY NOT USE: "safe", "unsafe", "dangerous".
 *
 * Level 1 records what a program did at startup and where its README does and
 * does not match. None of those three words is a conclusion that evidence can
 * support, and a reader who met one here would reasonably take the report to
 * mean more than it does. `level1-report.test.ts` fails on any of them.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Level1Evidence } from "./run.ts";

/** Programs the harness itself starts, named so a reader is not puzzled. */
const HARNESS_PROGRAMS = new Set(["setpriv", "strace"]);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const code = (s: string) => "`" + s + "`";
const list = (xs: string[]) => (xs.length ? xs.map(code).join(", ") : "none");

/** `README.md` line 29, quoted. The citation shape used throughout. */
function cite(file: string | null, at: { line: number; text: string }): string {
  return `${file ?? "README"} line ${at.line}: \`${at.text.replace(/`/g, "'")}\``;
}

export function renderReport(e: Level1Evidence): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);

  /* ── Heading and identity ─────────────────────────────────────────────── */
  p(`# ${e.package.name}${e.package.version ? ` ${e.package.version}` : ""} — Level 1 measurement`);
  p();
  p(
    `Measured ${e.measuredAt.slice(0, 10)}. Asked for ${code(e.asked)}. ` +
      `Instrument fingerprint ${code(e.instrumentFingerprint.slice(0, 12))}.`,
  );
  p();

  /*
   * WHOSE PACKAGE THIS IS, FROM ITS OWN MANIFEST.
   *
   * Two packages on the measured list are called Playwright and are not by the
   * same people. A page naming only "Playwright MCP" would let a reader hang
   * one's findings on the other's author, so the full npm name and the
   * repository the manifest points at are printed on every page. Neither is
   * verified: it is what the package says about itself, and the sentence says
   * so rather than vouching for it.
   */
  const maker = e.package.repository ?? e.package.homepage;
  p(
    `Published on npm as ${code(e.package.name)}. ` +
      (maker
        ? `Its own manifest points at ${maker.replace(/^git\+/, "").replace(/\.git$/, "")}, which is what the package says about itself and is not checked here.`
        : `Its manifest names no repository or homepage, so this page cannot say who publishes it beyond the npm name.`),
  );
  p();
  p(
    `**This is not a ranking of the most-used servers.** This package was measured because it appeared in a ` +
      `candidate list built from registry searches, and the order of those searches is not a measure of use.`,
  );
  p();
  p(
    `**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim ` +
      `about any tool doing what it says. The calibration that backs the ten curated measurements ` +
      `proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such ` +
      `checks, and reads the package's own documentation by a stated rule rather than by a person, ` +
      `so nothing in that calibration speaks to this page.`,
  );
  p();

  /*
   * ── THE PARAGRAPH FOR SOMEBODY WHO WILL NEVER READ THE REST. ────────────
   *
   * Three sentences: what was run, what was found, what was not checked. Every
   * number in it is a count taken straight off the evidence, and it introduces
   * no word the sections below do not support — it is the same page, shorter,
   * not a summary with an opinion in it. The third sentence is not a
   * disclaimer bolted on: a reader who stops after this paragraph has to leave
   * knowing what the measurement did not look at, or the paragraph has
   * misinformed them.
   */
  p(`## In plain words`);
  p();
  p(plainWords(e));
  p();

  /* ── The standard, in plain words. ────────────────────────────────────── */
  p(`## The standard this report uses`);
  p();
  p(`**A website counts as declared only if the README names it.**`);
  p();
  p(
    `A sentence about connecting somewhere, without the address, names no website. ` +
      `A tool counts as documented only if its name appears in the README as a whole word. ` +
      `Each question is asked once per thing observed, so what the README documents is never ` +
      `worked out from what the program offered — which is the only way "offered but not ` +
      `documented" can be found at all.`,
  );
  p();
  p(
    `The host rule is loose in one direction, and it is better to say so: it reads any dotted ` +
      `name whose last part is two or more letters, so a filename written in prose can read as a ` +
      `website. That can only make the declared list longer and leave something out of the findings ` +
      `below. It cannot put something in.`,
  );
  p();

  /* ── Could not start. The whole report, when that is what happened. ───── */
  if (e.couldNotStart) {
    p(`## Could not start`);
    p();
    p(`This package was not measured. It failed at the ${code(e.couldNotStart.stage)} stage:`);
    p();
    p("```");
    p(e.couldNotStart.because.trim());
    p("```");
    p();
    /* And what the install said, which is usually where the reason really is. */
    if (e.couldNotStart.installSaid) {
      p(`The install that preceded it said:`);
      p();
      p("```");
      p(e.couldNotStart.installSaid.trim());
      p("```");
      p();
    }
    p(
      `That is the whole result. Nothing is concluded about what the package would have done, ` +
        `because it did not run.`,
    );
    if (e.observed) {
      p();
      p(
        `It did get far enough to be watched: ${plural(e.observed.dnsNames.length, "name")} looked up, ` +
          `${plural(e.observed.programsStarted.length, "program")} started.`,
      );
    }
    p();
    p(renderLimits(e));
    return out.join("\n");
  }

  const o = e.observed!;
  const c = e.comparison!;

  /* ── What it did before anything asked it to. ─────────────────────────── */
  p(`## What it did at startup, before any tool was used`);
  p();
  const serverInfo = e.serverInfo as { name?: string; version?: string } | null;
  if (serverInfo?.name) {
    p(`It started and identified itself as ${code(`${serverInfo.name} ${serverInfo.version ?? ""}`.trim())}.`);
    p();
  }
  p(`| | |`);
  p(`| --- | --- |`);
  p(`| Websites it looked up | ${o.dnsNames.length ? list(o.dnsNames) : "none"} |`);
  p(`| Encrypted connections it opened | ${o.tlsHosts.length ? list(o.tlsHosts) : "none"} |`);
  p(`| Other addresses it tried | ${o.connectAttempts.length ? list(o.connectAttempts) : "none"} |`);
  p(`| Programs it started | ${o.programsStarted.length ? list(o.programsStarted) : "none"} |`);
  p(`| Files it wrote | ${o.filesWritten.length ? list(o.filesWritten) : "none"} |`);
  /* The row says what was recorded: a package manager was run, with its
   * arguments. Labelling it "packages it installed" put `npm config get
   * registry` under the word "installed", which it is not. */
  p(`| Package-manager commands it ran | ${o.installedDuringRun.length ? list(o.installedDuringRun) : "none"} |`);
  p(`| Tools it offered | ${o.offered.length} |`);
  p();

  const ours = o.programsStarted.filter((x) => HARNESS_PROGRAMS.has(x));
  if (ours.length) {
    p(`${list(ours)} in that list ${ours.length === 1 ? "is" : "are"} the harness's own launcher, not the package's doing.`);
    p();
  }
  if (o.dnsNames.length) {
    p(
      `Nothing left the machine. The room it runs in has no route off the host, so every name ` +
        `resolved to the loopback address and no connection completed. What it would have sent is ` +
        `therefore unknown — and what it would have sent over an encrypted connection would be ` +
        `unknown even with a route, which is a limit of the method rather than of this run.`,
    );
    p();
  }

  /* ── Tools against the README. ────────────────────────────────────────── */
  p(`## Tools it offers, against its own README`);
  p();
  p(
    `It offered ${plural(o.offered.length, "tool")}. ` +
      `${c.tools.documented.length} of them ${c.tools.documented.length === 1 ? "is" : "are"} named in ` +
      `${code(e.readme.file ?? "the README")}.`,
  );
  p();
  if (c.tools.undocumented.length === 0) {
    p(`Every tool it offered is named in the README.`);
  } else {
    p(`${plural(c.tools.undocumented.length, "tool")} it offered ${c.tools.undocumented.length === 1 ? "is" : "are"} not:`);
    p();
    for (const t of c.tools.undocumented) {
      p(`- **${t.name}**`);
      for (const line of t.evidence) p(`  - ${line}`);
    }
  }
  p();

  /* ── Websites against the README. ─────────────────────────────────────── */
  p(`## Websites it reached for, against its own README`);
  p();
  const contacted = [...new Set([...o.dnsNames, ...o.tlsHosts])].length;
  if (contacted === 0) {
    p(`It reached for no website at startup.`);
  } else if (c.hosts.undeclared.length === 0) {
    p(`It reached for ${plural(contacted, "website")}, and the README names all of them.`);
  } else {
    p(
      `It reached for ${plural(contacted, "website")}. ` +
        `${c.hosts.undeclared.length} of them ${c.hosts.undeclared.length === 1 ? "is" : "are"} not named anywhere in ` +
        `${code(e.readme.file ?? "the README")}:`,
    );
    p();
    for (const h of c.hosts.undeclared) {
      p(`- **${h.host}**`);
      for (const line of h.evidence) p(`  - ${line}`);
    }
  }

  /*
   * ── And the words the README uses on the subject. ────────────────────────
   *
   * Stated, never weighed. A reader who wants to decide whether that sentence
   * covers the hosts above can follow the line number and read it; this report
   * does not decide it for them, and could not: the rule above is about names,
   * and prose contains none.
   */
  const noted = e.readmeNotes ?? [];
  if (noted.length) {
    /* One citation per word, each to that word's own first line. Collapsing
     * them into a single quote once put a line containing "telemetry" under
     * both words and cited neither accurately. */
    const parts = [...new Set(noted.map((n) => n.word))].map((word) => {
      const its = noted.filter((n) => n.word === word);
      const where =
        its.length === 1
          ? `line ${its[0].at.line}`
          : `lines ${its.slice(0, -1).map((n) => n.at.line).join(", ")} and ${its[its.length - 1].at.line}`;
      const reads = its.length === 1 ? "it reads" : "the first reads";
      return `"${word}" — ${e.readme.file ?? "README"} ${where}; ${reads} \`${its[0].at.text.replace(/`/g, "'")}\``;
    });
    p();
    p(
      `The README uses the ${parts.length === 1 ? "word" : "words"} ${parts.join("; and ")}. ` +
        `Stated here because it is in the document. This report does not decide whether it accounts ` +
        `for the websites above.`,
    );
  }
  p();

  /* ── What the README did list that never appeared. ────────────────────── */
  const offered = new Set(o.offered);
  const documentedNotOffered = (e.declaration?.identifiers ?? []).filter((i) => !offered.has(i.name));
  if (documentedNotOffered.length) {
    p(`## Names in the README that it did not offer`);
    p();
    p(
      `${plural(documentedNotOffered.length, "name")} written in backticks in the README ` +
        `${documentedNotOffered.length === 1 ? "looks" : "look"} like a tool name and ` +
        `${documentedNotOffered.length === 1 ? "was" : "were"} not among the tools it offered. ` +
        `A README mentions plenty of things that are not tools, so this is a weaker signal than the ` +
        `two above and is listed rather than counted as a finding:`,
    );
    p();
    for (const i of documentedNotOffered.slice(0, 20)) p(`- ${code(i.name)} — ${cite(e.readme.file, i.at)}`);
    if (documentedNotOffered.length > 20) p(`- …and ${documentedNotOffered.length - 20} more`);
    p();
  }

  p(renderLimits(e));
  return out.join("\n");
}

/** Three sentences, each number a count off the evidence. */
function plainWords(e: Level1Evidence): string {
  const who = `${code(`${e.package.name}${e.package.version ? ` ${e.package.version}` : ""}`)}`;
  const room = `in a room with no route to the internet, where every website name answers to this machine and every credential is fake`;

  if (e.couldNotStart) {
    return [
      `We installed ${who} from the npm registry and tried to start it ${room}.`,
      `It did not start: it failed at the ${code(e.couldNotStart.stage)} stage, so there is nothing measured on this page.`,
      `We called none of its tools and we have not worked out what it would have done, because it did not run.`,
    ].join(" ");
  }

  const o = e.observed!;
  const c = e.comparison!;
  const sites = [...new Set([...o.dnsNames, ...o.tlsHosts])].length;
  const theirs = o.programsStarted.filter((x) => !HARNESS_PROGRAMS.has(x)).length;

  return [
    `We installed ${who} from the npm registry, started it ${room}, and asked it to list its tools without calling any of them.`,
    `Before any tool was used it offered ${plural(o.offered.length, "tool")}, looked up ${plural(sites, "website")}, ` +
      `started ${plural(theirs, "program")} and wrote ${plural(o.filesWritten.length, "file")}; ` +
      /* A compound subject takes a plural verb whichever way the counts fall:
       * "1 tool and 0 websites is not named" was a grammar bug, not a count. */
      `of those, ${plural(c.tools.undocumented.length, "tool")} and ${plural(c.hosts.undeclared.length, "website")} ` +
      `are not named in its own README.`,
    `We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.`,
  ].join(" ");
}

function renderLimits(e: Level1Evidence): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);

  p(`## What this report does not say`);
  p();
  p(`- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.`);
  p(
    `- **It is one run, once.** A program that behaves one way while being watched and another way ` +
      `otherwise would produce this same page.`,
  );
  p(
    `- **It ran with no route off the machine**, so anything that only happens after a connection ` +
      `succeeds did not happen.`,
  );
  p(
    `- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, ` +
      `and would not be even with a route.`,
  );
  p(
    `- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was ` +
      `read. A package that documents its tools or its destinations somewhere else — a reference file beside the ` +
      `README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a ` +
      `fact about this rule and not about the package.`,
  );
  p(`- **It is not calibration-backed**, for the reason at the top.`);
  p(
    `- **It is not a ranking.** No page here says a server is more used, better or worse than another, and the ` +
      `set measured is whatever the candidate searches returned.`,
  );
  p(
    `- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools ` +
      `do what they say.`,
  );
  p();
  p(
    `Evidence: ${e.readme.file ? `${code(e.readme.file)} (${e.readme.lines} lines, sha256 ${code((e.readme.digest ?? "").slice(0, 12))})` : "no README shipped with this package"}` +
      `${e.package.integrity ? `, package integrity ${code(e.package.integrity.slice(0, 24) + "…")}` : ""}.`,
  );
  return out.join("\n");
}
