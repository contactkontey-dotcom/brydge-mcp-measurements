/*
 * ═══════════════════════════════════════════════════════════════════════════
 * LEVEL 1: A MEASUREMENT FROM A PACKAGE NAME ALONE.
 *
 * A curated measurement in `servers/index.ts` is a person's work: the tool list
 * copied from the docs, the destinations traced through the source, and two or
 * three probes with hand-picked arguments and an oracle to judge each against.
 * That is what makes those ten reports say "this claim held".
 *
 * Level 1 has none of it. Given a package name it can still answer a narrower
 * question, and answer it without a person: WHAT DOES THIS SERVER DO BEFORE
 * ANYBODY ASKS IT TO DO ANYTHING, AND DOES ITS OWN README MENTION THAT?
 *
 * ───────────────────────────────────────────────────────────────────────────
 * IT CHANGES NOTHING ABOUT THE INSTRUMENT, ON PURPOSE.
 *
 * `fingerprint()` hashes every file under `engine/` and `harness/`, plus
 * `measure.ts`, and the ten published results are only publishable while the
 * calibration's fingerprint matches. So Level 1 is a CALLER: it imports the
 * exported `measureServer` and touches not one byte of the instrument. The
 * calibration stands, and no recalibration is owed.
 *
 * What it does instead of probes is pass none. `session.ts` asks for the tool
 * list before it walks the probe list, so an empty probe list still yields a
 * started server, its tool list, the whole strace, every name it looked up,
 * every TLS handshake it attempted and every file it wrote.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT A LEVEL 1 REPORT MAY NOT CLAIM.
 *
 * Not calibration-backed. The calibration proves the instrument catches
 * planted lies about what a TOOL DID — probes against oracles. Level 1 runs no
 * probes, and its declaration is read by a rule rather than by a person, so
 * nothing in the calibration speaks to whether that reading was right. Every
 * Level 1 result carries `notCalibrationBacked: true` and is written to
 * `level1/evidence/`, never to `results/`, which the site reads.
 *
 * No claim about any tool doing what it says. Level 1 never calls a tool.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureServer } from "../measure.ts";
import { fingerprint } from "../harness/fingerprint.ts";
import { LIMITS } from "../harness/limits.ts";
import { programsSince } from "../harness/trace.ts";
import type { ServerSpec, TraceEvent } from "../harness/types.ts";
import { notedWords, readDeclaration, whereNamed, type Declaration, type Mention } from "./declare.ts";
import { renderReport } from "./report.ts";
import { executableOf, resolvePackage, type Resolved } from "./resolve.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "level1", "evidence");
const REPORTS = join(ROOT, "level1", "reports");
/*
 * HELD: MEASURED, AND NOT PUBLISHED YET.
 *
 * `held/` is git-ignored (see .gitignore), which is what makes it a hold and
 * not a label: a held package's evidence and page are written there and never
 * reach a commit, so the repository says nothing about it at all — not even
 * that something is being held. The list itself lives inside that directory for
 * the same reason.
 */
const HELD = join(ROOT, "level1", "held");

function heldSlugs(): Set<string> {
  const list = join(HELD, "hold.txt");
  if (!existsSync(list)) return new Set();
  return new Set(
    readFileSync(list, "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

/**
 * A FILENAME THAT CANNOT BE TWO PACKAGES AT ONCE.
 *
 * The first version of this flattened every non-alphanumeric run to one dash,
 * so `@playwright/mcp` and `playwright-mcp` — two different packages by two
 * different authors, both on the measured list — produced the same slug. The
 * second run would have overwritten the first's evidence and published one
 * package's findings under the other's name. Nothing in the harness would have
 * noticed, because both files were well-formed.
 *
 * So the scope separator survives as a DOUBLE dash, which a single dash in a
 * name can never produce: `@playwright/mcp` → `playwright--mcp`,
 * `playwright-mcp` → `playwright-mcp`. `main()` also refuses to write over an
 * evidence file that records a different package name, so a slug rule that is
 * wrong again fails loudly rather than quietly.
 */
export function slugOf(name: string): string {
  const clean = (part: string) => part.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const m = /^@([^/]+)\/(.+)$/.exec(name);
  return m ? `${clean(m[1])}--${clean(m[2])}` : clean(name);
}

/**
 * The spec Level 1 hands the instrument.
 *
 * `destinations` carries the README's own hosts, so the instrument's network
 * comparison runs on the same declaration this report prints. `tools` is NULL
 * on purpose — see `comparison.tools` below: one rule for "the README names
 * this tool" has to be applied in both directions, which needs the offered
 * list, which does not exist until the run is over. So Level 1 does that
 * comparison itself, with a line citation per tool, rather than let a second
 * rule produce a second answer.
 */
function specFor(r: Resolved, declaration: Declaration, bin: string): ServerSpec {
  return {
    slug: slugOf(r.name),
    name: r.name,
    registry: "npm",
    version: r.version,
    readmeCommand: `npx -y ${r.name}@${r.version}`,
    bin,
    args: [],
    callTimeoutSeconds: 60,
    declared: {
      credentials: [],
      tools: null,
      destinations: declaration.hosts.map((h) => ({
        host: h.host,
        source: { url: `${r.name}@${r.version}:${r.readmeFile ?? "README"}#L${h.at.line}`, quote: h.at.text },
      })),
    },
    fixtures: {},
    probes: [],
    notChecked: [],
  };
}

export interface Level1Evidence {
  level: 1;
  notCalibrationBacked: true;
  asked: string;
  slug: string;
  package: { name: string; version: string; tarball: string; integrity: string; repository: string | null; homepage: string | null };
  measuredAt: string;
  /** The instrument's fingerprint, recorded even though Level 1 is not gated on it. */
  instrumentFingerprint: string;
  /** The rules this run applied, in its own words, as data. */
  standard: Record<string, string>;
  readme: { file: string | null; digest: string | null; lines: number | null; bytes: number | null };
  /*
   * Words the README uses on the subject of the hosts, with the line each is
   * on. Recorded and printed; never weighed. A README that says "pseudonymous
   * telemetry" without a hostname still declares no host under the rule above,
   * and this field exists so a reader is told the sentence is there and where
   * to find it rather than left to discover it. Nothing downstream reads it as
   * a declaration, and `report.ts` states plainly that it decides nothing.
   */
  readmeNotes: Array<{ word: string; at: Mention }>;
  declaration: { hosts: Array<{ host: string; at: Mention }>; identifiers: Array<{ name: string; at: Mention }> } | null;
  /*
   * `because` is the tooling's own message. `installSaid` is npm's output from
   * the install that preceded it, which `measureServer` captures and this threw
   * away: fifteen packages in the first sweep reported "the server process
   * exited" when the truth was that nothing had been installed for it to run,
   * and the reason was sitting in npm's stderr. A "could not start" that cannot
   * say why is a measurement of our own plumbing presented as a fact about
   * somebody else's package.
   */
  couldNotStart: { stage: string; because: string; installSaid?: string } | null;
  serverInfo: unknown;
  observed: {
    offered: string[];
    dnsNames: string[];
    tlsHosts: string[];
    connectAttempts: string[];
    programsStarted: string[];
    filesWritten: string[];
    installedDuringRun: string[];
  } | null;
  comparison: {
    tools: {
      rule: string;
      documented: Array<{ name: string; at: Mention }>;
      undocumented: Array<{ name: string; evidence: string[] }>;
    };
    hosts: {
      rule: string;
      declared: Array<{ host: string; at: Mention }>;
      undeclared: Array<{ host: string; evidence: string[] }>;
    };
  } | null;
  /** The instrument's own findings, unchanged. */
  findings: unknown[];
  limits: Array<{ id: string; says: string }>;
}

const STANDARD = {
  hosts:
    "A host counts as declared only if the README contains that exact hostname. Prose about telemetry that names no host declares no host. A subdomain is not its parent.",
  tools:
    "A tool counts as documented only if its exact name appears in the README as a whole word. Asked once per offered tool, so the documented set is never derived from the offered set.",
  looseness:
    "The host pattern matches any dotted name whose last label is two or more letters, so a filename like capture.js reads as a host. That can only make the declared set bigger and suppress a finding, never invent one.",
  probes: "No tool is called. Level 1 makes no claim about any tool doing what it says.",
  determinism: "No model and no heuristic about meaning. The same README and the same run produce the same report.",
  notedWords:
    "If the README uses the word telemetry or analytics anywhere, the report says so and gives the line. That is recorded, not weighed: it does not make any host declared and the report does not decide whether it accounts for one.",
} as const;

/**
 * Flatten one trace into the short lists a report prints.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THREE FIELD NAMES WORTH WRITING DOWN, BECAUSE GETTING THEM WRONG REPORTS
 * SILENCE RATHER THAN AN ERROR.
 *
 * The first draft of this filtered on `syscall === "execve"` and read `argv`
 * as a string. The trace records the syscall as `exec` and `argv` as an array,
 * so the filter matched nothing and Desktop Commander's twelve program starts
 * came out as "started no programs" — a false all-clear, which is the one kind
 * of mistake a measurement must not make quietly. It was caught by checking
 * the raw trace against the report rather than by trusting the report.
 *
 * So "a program it started" is now the INSTRUMENT'S OWN definition, imported:
 * `programsSince` filters `exec` with `result === 0` and takes the basename.
 * One definition, and it cannot drift from the one the curated runs use.
 *
 * And `family` is not carried into the stored session at all — `session.ts`
 * copies ten fields of each trace event and that is not among them — so a unix
 * socket cannot be told from a network address by its family here. A
 * filesystem path is not a network address, so an address containing a slash
 * is excluded. Without that, `/var/run/nscd/socket` reads as a connection
 * attempt, which it is not.
 */
function observeFrom(session: Record<string, unknown>, offered: string[]) {
  const trace = (session.trace ?? []) as TraceEvent[];
  const dns = (session.dns ?? []) as Array<{ name: string }>;
  const caught = (session.caught ?? []) as Array<{ sni?: string; port?: number }>;
  const written = (session.written ?? {}) as Record<string, string>;

  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
  const argvOf = (e: TraceEvent) => (e.argv ?? []).join(" ");

  return {
    offered,
    dnsNames: uniq(dns.map((d) => d.name.toLowerCase())),
    tlsHosts: uniq(caught.filter((c) => c.port === 443 && c.sni).map((c) => (c.sni as string).toLowerCase())),
    connectAttempts: uniq(
      trace
        .filter((e) => e.syscall === "connect" && e.address && !e.address.includes("/") && e.address !== "127.0.0.1" && e.address !== "::1")
        .map((e) => `${e.address}:${e.port ?? "?"}`),
    ),
    programsStarted: uniq(programsSince(trace, 0)),
    filesWritten: uniq(Object.keys(written)),
    /* A package manager run during the session is an install at RUN time, which
     * is a different fact from the install we performed and watched. */
    installedDuringRun: uniq(
      trace
        .filter((e) => e.syscall === "exec" && e.result === 0 && /(^|\/)(npm|npx|pip|pip3|uv|uvx|yarn|pnpm)$/.test(e.path ?? ""))
        .map((e) => argvOf(e).slice(0, 200)),
    ),
  };
}

export async function runLevel1(ref: string): Promise<Level1Evidence> {
  const measuredAt = new Date().toISOString();
  const base = {
    level: 1 as const,
    notCalibrationBacked: true as const,
    asked: ref,
    measuredAt,
    instrumentFingerprint: fingerprint().digest,
    standard: STANDARD as unknown as Record<string, string>,
    limits: LIMITS,
  };

  /* ── Resolve. A name that does not resolve has not been measured. ──────── */
  let resolved: Resolved;
  try {
    resolved = resolvePackage(ref);
  } catch (e) {
    return {
      ...base,
      slug: slugOf(ref),
      package: { name: ref, version: "", tarball: "", integrity: "", repository: null, homepage: null },
      readme: { file: null, digest: null, lines: null, bytes: null },
      readmeNotes: [],
      declaration: null,
      couldNotStart: { stage: "resolve", because: e instanceof Error ? e.message : String(e) },
      serverInfo: null,
      observed: null,
      comparison: null,
      findings: [],
    };
  }

  const declaration = resolved.readme ? readDeclaration(resolved.readme) : null;
  const readme = {
    file: resolved.readmeFile,
    digest: declaration?.digest ?? null,
    lines: declaration?.lines ?? null,
    bytes: declaration?.bytes ?? null,
  };
  const shell = {
    ...base,
    slug: slugOf(resolved.name),
    package: {
      name: resolved.name,
      version: resolved.version,
      tarball: resolved.tarball,
      integrity: resolved.integrity,
      repository: resolved.repository,
      homepage: resolved.homepage,
    },
    readme,
    readmeNotes: resolved.readme ? notedWords(resolved.readme) : [],
    declaration: declaration ? { hosts: declaration.hosts, identifiers: declaration.identifiers } : null,
  };

  /* ── Which executable. Level 1 never guesses between several. ──────────── */
  let bin: string;
  try {
    bin = executableOf(resolved).bin;
  } catch (e) {
    return { ...shell, couldNotStart: { stage: "executable", because: e instanceof Error ? e.message : String(e) }, serverInfo: null, observed: null, comparison: null, findings: [] };
  }

  /* ── Install under watch, then the sealed room. The instrument's work. ─── */
  const spec = specFor(resolved, declaration ?? { digest: "", lines: 0, bytes: 0, hosts: [], identifiers: [] }, bin);
  let report: Awaited<ReturnType<typeof measureServer>>["report"];
  let raw: { session?: Record<string, unknown>; installOut?: string };
  try {
    const out = await measureServer(spec);
    report = out.report;
    raw = out.raw as { session?: Record<string, unknown>; installOut?: string };
  } catch (e) {
    /*
     * `measureServer` throws when the install produced no executable or the
     * sealed session wrote no result. Either way the server did not start, and
     * the honest report says so with what the tooling said — never a guess at
     * the cause.
     */
    return { ...shell, couldNotStart: { stage: "start", because: (e instanceof Error ? e.message : String(e)).slice(0, 4000) }, serverInfo: null, observed: null, comparison: null, findings: [] };
  }

  /*
   * It started, and then refused to talk. A server that wants a password or a
   * configuration file reaches here: the process ran, `initialize` failed, and
   * the message is the server's own.
   */
  if (report.initError) {
    return {
      ...shell,
      couldNotStart: {
        stage: "initialize",
        because: report.initError.slice(0, 4000),
        installSaid: (raw.installOut ?? "").trim().slice(-1500) || undefined,
      },
      serverInfo: report.serverInfo,
      observed: raw.session ? observeFrom(raw.session, report.offered) : null,
      comparison: null,
      findings: report.findings,
    };
  }

  const observed = observeFrom(raw.session ?? {}, report.offered);

  /* ── The comparison, with a citation for every line of it. ─────────────── */
  const documented: Array<{ name: string; at: Mention }> = [];
  const undocumented: Array<{ name: string; evidence: string[] }> = [];
  for (const tool of report.offered) {
    const at = resolved.readme ? whereNamed(resolved.readme, tool) : null;
    if (at) documented.push({ name: tool, at });
    else
      undocumented.push({
        name: tool,
        evidence: [
          `offered in tools/list by ${report.name}@${report.version}`,
          resolved.readme
            ? `absent from ${resolved.readmeFile} (${declaration?.lines ?? 0} lines, sha256 ${declaration?.digest.slice(0, 12)}…): no whole-word match for "${tool}"`
            : `the package ships no README, so nothing documents it`,
        ],
      });
  }

  const declaredHosts = new Set((declaration?.hosts ?? []).map((h) => h.host));
  const contacted = [...new Set([...observed.dnsNames, ...observed.tlsHosts])].sort();
  const undeclared = contacted
    .filter((h) => !declaredHosts.has(h))
    .map((host) => ({
      host,
      evidence: [
        observed.dnsNames.includes(host) ? `looked up "${host}" during the run; answered 127.0.0.1, so nothing left the machine` : "",
        observed.tlsHosts.includes(host) ? `opened TLS with SNI "${host}"; the bytes are encrypted and were not seen` : "",
        resolved.readme
          ? `absent from ${resolved.readmeFile} (${declaration?.lines ?? 0} lines, sha256 ${declaration?.digest.slice(0, 12)}…): the README does not contain this hostname`
          : `the package ships no README, so nothing declares it`,
      ].filter(Boolean),
    }));

  return {
    ...shell,
    couldNotStart: null,
    serverInfo: report.serverInfo,
    observed,
    comparison: {
      tools: { rule: STANDARD.tools, documented, undocumented },
      hosts: { rule: STANDARD.hosts, declared: declaration?.hosts ?? [], undeclared },
    },
    findings: report.findings,
  };
}

async function main(): Promise<void> {
  const ref = process.argv[2];
  if (!ref) {
    console.error("usage: node level1/run.ts <package>[@version]");
    process.exit(1);
  }
  const evidence = await runLevel1(ref);
  const onHold = heldSlugs().has(evidence.slug);
  const outDir = onHold ? HELD : OUT;
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${evidence.slug}.json`);

  /*
   * NEVER WRITE ONE PACKAGE'S EVIDENCE OVER ANOTHER'S.
   *
   * Re-measuring the same package is ordinary and overwrites by design — a new
   * version, a fixed bug in this code. Writing a DIFFERENT package to that
   * filename is the slug bug above, and it would publish findings under the
   * wrong name. So the name on disk is checked, not assumed.
   */
  if (existsSync(path)) {
    const held = JSON.parse(readFileSync(path, "utf8")) as { package?: { name?: string } };
    const was = held.package?.name;
    if (was && was !== evidence.package.name) {
      console.error(
        `level 1 — refusing to write ${evidence.package.name} over ${was}: both resolve to the slug "${evidence.slug}".`,
      );
      process.exit(2);
    }
  }
  writeFileSync(path, JSON.stringify(evidence, null, 2));

  /* The page is a pure function of the file beside it, so it is written from
   * the evidence rather than from anything still in memory here. */
  const reportDir = onHold ? HELD : REPORTS;
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${evidence.slug}.md`);
  writeFileSync(reportPath, renderReport(JSON.parse(readFileSync(path, "utf8")) as Level1Evidence) + "\n");

  console.error(
    (onHold ? "HELD — not published. " : "") +
      (evidence.couldNotStart
      ? `level 1 — ${evidence.slug}: COULD NOT START at ${evidence.couldNotStart.stage}`
      : `level 1 — ${evidence.slug}: ${evidence.observed?.offered.length ?? 0} tool(s) offered, ` +
          `${evidence.comparison?.tools.undocumented.length ?? 0} undocumented, ` +
          `${evidence.comparison?.hosts.undeclared.length ?? 0} undeclared host(s)`),
  );
  console.error(`written: ${path}`);
  console.error(`written: ${reportPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
