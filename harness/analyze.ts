import type { Canaries } from "./canaries.ts";
import { CREDENTIAL_LIKE, PLANTED_ENV, secretsIn } from "./canaries.ts";
import type { CaughtConnection, DnsQuery, WebRequest } from "./net.ts";
import type { ProbeEvent } from "./probelog.ts";
import type { ServerRequest } from "./client.ts";
import type { TraceEvent } from "./trace.ts";
import type { Declared, Finding, ProbeResult } from "./types.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * FROM EVERYTHING RECORDED, THE THINGS A READER SHOULD KNOW — AND WHICH OF
 * THEM IS A SECURITY HOLE THAT IS HELD BACK UNTIL THE MAINTAINER HAS BEEN TOLD.
 *
 * Two, and only two, kinds of finding are held for disclosure:
 *
 *   1. A SECURITY BOUNDARY THAT FAILED — a folder escape, an allowlist bypass.
 *      That is decided by a probe's verdict (a boundary restraint that came
 *      back MISMATCH), not here.
 *
 *   2. AN UNDECLARED CREDENTIAL READ — the server touched a secret we planted
 *      that its own documentation never said it would need. That is decided
 *      here, and the definition does not depend on anyone's opinion of a
 *      variable's name: a credential read is the reading of a PLANTED secret.
 *
 * Everything else — a server that phones home, a tool that is offered but not
 * documented, a reply that overstates what happened — is published the day the
 * page goes up, with an open invitation to the maintainer to respond. Only the
 * two above wait thirty days.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface RunLogs {
  /** The whole run, all processes. */
  trace: TraceEvent[];
  probeLog: ProbeEvent[];
  dns: DnsQuery[];
  caught: CaughtConnection[];
  webReqs: WebRequest[];
  serverRequests: ServerRequest[];
  /** Every file the server created or changed during the run, path → content. */
  written: Record<string, string>;
  /** Every tool reply's text, for secret-scanning. */
  replies: string[];
  /** The tool names the server actually offered in tools/list. */
  offered: string[];
}

const has = (list: { name: string; kind: string }[], kind: string, name: string) =>
  list.some((d) => d.kind === kind && d.name.replace(/^~\//, "").replace(/^\.\//, "") === name.replace(/^~\//, "").replace(/^\.\//, ""));

/* ── Credentials: the reading of a planted secret ─────────────────────────── */

function credentialFindings(run: RunLogs, declared: Declared, canaries: Canaries, home: string): Finding[] {
  const findings: Finding[] = [];

  /* (1) Individual reads of a planted environment variable. The probe already
   * excludes reads made while the whole environment was being enumerated. */
  const readEnv = new Map<string, string[]>();
  for (const e of run.probeLog) {
    if (e.event === "env" && e.key && (PLANTED_ENV as readonly string[]).includes(e.key)) {
      const stack = (readEnv.get(e.key) ?? []).concat((e.stack ?? []).slice(0, 3));
      readEnv.set(e.key, stack);
    }
  }
  for (const [name, stack] of readEnv) {
    const declaredHere = has(declared.credentials, "env", name);
    findings.push({
      id: `credential:env:${name}`,
      kind: "credential",
      security: !declaredHere,
      says: declaredHere
        ? `Read the environment variable ${name}, which it declares it needs.`
        : `Read the environment variable ${name}, a planted credential it never declared.`,
      evidence: [`first read at: ${stack.slice(0, 3).join(" | ") || "native code (no JS/Python frame)"}`],
    });
  }

  /* (2) Successful opens of a planted credential file. The kernel trace is the
   * authority; the probe log supplies the attributing stack when there is one. */
  const plantedPaths = new Set(Object.keys(canaries.files));
  const openedFiles = new Map<string, TraceEvent[]>();
  for (const e of run.trace) {
    if (e.syscall === "open" && e.result >= 0 && e.path && plantedPaths.has(e.path)) {
      openedFiles.set(e.path, (openedFiles.get(e.path) ?? []).concat(e));
    }
  }
  for (const path of openedFiles.keys()) {
    const origin = canaries.where.get(canaries.files[path]) ?? path;
    const rel = path.startsWith(home + "/") ? "~/" + path.slice(home.length + 1) : path;
    const declaredHere = has(declared.credentials, "file", rel) || has(declared.credentials, "file", path);
    const attribution = run.probeLog.find((e) => e.event === "open" && e.path === path)?.stack?.slice(0, 3);
    findings.push({
      id: `credential:file:${rel}`,
      kind: "credential",
      security: !declaredHere,
      says: declaredHere
        ? `Opened ${origin}, which it declares it needs.`
        : `Opened ${origin}, a planted credential file it never declared.`,
      evidence: [`opened per kernel trace`, attribution ? `code: ${attribution.join(" | ")}` : `no JS/Python frame (native or subprocess)`],
    });
  }

  /* (3) A request to the person for a credential-like field (elicitation). */
  for (const req of run.serverRequests) {
    if (req.method !== "elicitation/create") continue;
    const params = req.params as { message?: string; requestedSchema?: { properties?: Record<string, unknown> } } | undefined;
    const props = params?.requestedSchema?.properties ?? {};
    const credProp = Object.keys(props).find((k) => CREDENTIAL_LIKE.test(k));
    const message = params?.message ?? "";
    if (credProp || CREDENTIAL_LIKE.test(message)) {
      /* Declaring "I read env X" does not declare "I will ask the person for a
       * token". It counts as declared only if the elicited field itself is
       * named in the server's declarations. */
      const declaredHere = credProp !== undefined && declared.credentials.some((c) => c.name.toLowerCase() === credProp.toLowerCase());
      findings.push({
        id: `credential:elicitation:${credProp ?? "message"}`,
        kind: "credential",
        security: !declaredHere,
        says: `Asked the client for a credential-like field${credProp ? ` (${credProp})` : ""} through an elicitation request.`,
        evidence: [`message: ${message.slice(0, 200)}`, `fields: ${Object.keys(props).join(", ") || "(none named)"}`],
      });
    }
  }

  /* (4) A planted secret that LEFT the process — in a reply, a written file, an
   * outbound request, or a name it looked up. Always a security finding: a
   * secret we planted got out. */
  const haystacks: Array<{ where: string; text: string }> = [
    ...run.replies.map((text, i) => ({ where: `a tool reply (#${i + 1})`, text })),
    ...Object.entries(run.written).map(([path, text]) => ({ where: `a file it wrote (${path})`, text })),
    ...run.caught.filter((c) => c.request).map((c) => ({ where: `an outbound request on port ${c.port}`, text: c.request! })),
    ...run.dns.map((d) => ({ where: `a name it looked up (${d.name})`, text: d.name })),
  ];
  const leaked = new Map<string, Set<string>>();
  for (const h of haystacks) for (const origin of secretsIn(h.text, canaries)) {
    if (!leaked.has(origin)) leaked.set(origin, new Set());
    leaked.get(origin)!.add(h.where);
  }
  for (const [origin, wheres] of leaked) {
    findings.push({
      id: `credential:leak:${origin}`,
      kind: "credential",
      security: true,
      says: `A planted secret (${origin}) appeared where the server could send it out.`,
      evidence: [...wheres],
    });
  }

  return findings;
}

/* ── Whole-environment enumeration and non-planted lookups: notes, not reads ─ */

function environmentNotes(run: RunLogs): Finding[] {
  const findings: Finding[] = [];
  const enumerated = run.probeLog.filter((e) => e.event === "env-all");
  if (enumerated.length) {
    findings.push({
      id: "credential:note:enumerated",
      kind: "credential",
      security: false,
      says: `Enumerated or copied the whole environment ${enumerated.length} time(s) — normal when starting a subprocess, and NOT counted as reading any one secret.`,
      evidence: enumerated.slice(0, 2).map((e) => (e.stack ?? []).slice(0, 2).join(" | ")).filter(Boolean),
    });
  }
  /* Credential-like names the server looked up that we did NOT plant. */
  const planted = new Set<string>(PLANTED_ENV as readonly string[]);
  const looked = new Set<string>();
  for (const e of run.probeLog) if (e.event === "env" && e.key && !planted.has(e.key) && CREDENTIAL_LIKE.test(e.key)) looked.add(e.key);
  if (looked.size) {
    findings.push({
      id: "credential:note:looked",
      kind: "credential",
      security: false,
      says: `Looked for credential-like variables we did not plant: ${[...looked].join(", ")}. Reported for completeness; not counted as a credential read.`,
      evidence: [`no planted secret was behind these names`],
    });
  }
  return findings;
}

/* ── Network: where it tried to go. Not a security hold unless a secret rode along ─ */

function networkFindings(run: RunLogs, declared: Declared): Finding[] {
  const findings: Finding[] = [];
  const declaredHosts = new Set(declared.destinations.map((d) => d.host.toLowerCase()));
  const undeclaredNames = [...new Set(run.dns.map((d) => d.name))].filter(
    (n) => !declaredHosts.has(n) && !declared.destinations.some((d) => d.host === "user-supplied URLs"),
  );
  if (undeclaredNames.length) {
    findings.push({
      id: "network:dns",
      kind: "network",
      security: false,
      says: `Looked up ${undeclaredNames.length} name(s) not in its declared destinations: ${undeclaredNames.slice(0, 8).join(", ")}${undeclaredNames.length > 8 ? " …" : ""}.`,
      evidence: [`every lookup was answered with 127.0.0.1; nothing left the machine`],
    });
  }
  const tls = run.caught.filter((c) => c.port === 443 && c.sni);
  if (tls.length) {
    findings.push({
      id: "network:tls",
      kind: "network",
      security: false,
      says: `Opened TLS to ${[...new Set(tls.map((c) => c.sni))].join(", ")}. The bytes it would have sent are encrypted and were NOT seen — a limit of the method.`,
      evidence: tls.slice(0, 4).map((c) => `SNI ${c.sni}`),
    });
  }
  const failedConnects = run.trace.filter((e) => e.syscall === "connect" && e.family !== "AF_UNIX" && e.address && e.address !== "127.0.0.1");
  if (failedConnects.length) {
    findings.push({
      id: "network:connect",
      kind: "network",
      security: false,
      says: `Tried to connect to ${[...new Set(failedConnects.map((e) => `${e.address}:${e.port ?? "?"}`))].slice(0, 6).join(", ")} — outside loopback, so it could not complete.`,
      evidence: [`the network namespace has only loopback`],
    });
  }
  return findings;
}

/* ── Tool list: what it documents against what it offers ───────────────────── */

function toolListFindings(run: RunLogs, declared: Declared): Finding[] {
  if (!declared.tools) return [];
  const findings: Finding[] = [];
  const offered = new Set(run.offered);
  const documented = new Set(declared.tools.names);
  const missing = declared.tools.names.filter((n) => !offered.has(n));
  const extra = run.offered.filter((n) => !documented.has(n));
  if (missing.length)
    findings.push({
      id: "tool-list:missing",
      kind: "tool-list",
      security: false,
      says: `Documents ${missing.length} tool(s) it did not offer: ${missing.join(", ")}.`,
      evidence: [`from ${declared.tools.source.url}`],
    });
  if (extra.length)
    findings.push({
      id: "tool-list:extra",
      kind: "tool-list",
      security: false,
      says: `Offered ${extra.length} tool(s) its documentation does not list: ${extra.join(", ")}.`,
      evidence: [`offered in tools/list, absent from ${declared.tools.source.url}`],
    });
  return findings;
}

/* ── Per-probe rollups: a tool that misbehaved, a reply that misled ────────── */

function probeFindings(results: ProbeResult[]): Finding[] {
  const findings: Finding[] = [];
  for (const r of results) {
    if (r.boundary && r.mustNotExist && r.state === "MISMATCH") {
      findings.push({
        id: `tool:boundary:${r.key}`,
        kind: "tool",
        security: true,
        says: `${r.tool} crossed a boundary it should not: ${r.reading}`,
        evidence: [`verdict ${r.state}/${r.reason}`, `observed: ${JSON.stringify(r.observed).slice(0, 300)}`],
      });
    } else if (r.state === "MISMATCH") {
      findings.push({
        id: `tool:${r.key}`,
        kind: "tool",
        security: false,
        says: `${r.tool} did not do what it claims: ${r.reading}`,
        evidence: [`verdict ${r.state}/${r.reason}`],
      });
    }
    if (r.reply.honest === false) {
      findings.push({
        id: `reply:${r.key}`,
        kind: "reply",
        security: false,
        says: `${r.tool} reported "${r.reply.says}".`,
        evidence: [`reply: ${r.reply.text.slice(0, 200)}`],
      });
    }
  }
  return findings;
}

/* ── Install time: a package's own install scripts, watched the same way ──── */

export interface InstallLogs {
  trace: TraceEvent[];
  probeLog: ProbeEvent[];
  /** The recorded integrity of what was fetched (npm lock / PyPI sha256). */
  integrity: string[];
}

/** Findings from the install itself — postinstall and build scripts run code. */
export function installFindings(install: InstallLogs, _declared: Declared, canaries: Canaries, home: string): Finding[] {
  const findings: Finding[] = [];
  const plantedPaths = new Set(Object.keys(canaries.files));
  const openedFiles = new Set(
    install.trace.filter((e) => e.syscall === "open" && e.result >= 0 && e.path && plantedPaths.has(e.path)).map((e) => e.path!),
  );
  const readEnv = new Set(
    install.probeLog.filter((e) => e.event === "env" && e.key && (PLANTED_ENV as readonly string[]).includes(e.key)).map((e) => e.key!),
  );
  for (const path of openedFiles) {
    const origin = canaries.where.get(canaries.files[path]) ?? path;
    const rel = path.startsWith(home + "/") ? "~/" + path.slice(home.length + 1) : path;
    findings.push({
      id: `install:file:${rel}`,
      kind: "install",
      security: true,
      says: `An install script opened ${origin}. Nothing about installing this package declares a need for it.`,
      evidence: [`opened during install, per kernel trace`],
    });
  }
  for (const name of readEnv) {
    findings.push({
      id: `install:env:${name}`,
      kind: "install",
      security: true,
      says: `An install script read the environment variable ${name}, a planted credential.`,
      evidence: [`read during install`],
    });
  }
  if (install.integrity.length)
    findings.push({
      id: "install:integrity",
      kind: "install",
      security: false,
      says: `Installed at a pinned integrity, recorded so the exact bytes can be fetched again.`,
      evidence: install.integrity.slice(0, 6),
    });
  return findings;
}

/** Everything worth knowing about one run, and whether any of it is held. */
export function analyze(run: RunLogs, declared: Declared, canaries: Canaries, results: ProbeResult[], home: string): { findings: Finding[]; anySecurity: boolean } {
  const findings = [
    ...probeFindings(results),
    ...credentialFindings(run, declared, canaries, home),
    ...environmentNotes(run),
    ...networkFindings(run, declared),
    ...toolListFindings(run, declared),
  ];
  return { findings, anySecurity: findings.some((f) => f.security) };
}
