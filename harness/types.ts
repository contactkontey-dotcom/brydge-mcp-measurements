import type { Condition } from "../engine/comparison/task.ts";
import type { ComparisonReason, ComparisonState } from "../engine/comparison/judge.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A SERVER UNDER MEASUREMENT IS DATA, NOT CODE.
 *
 * Everything that differs between two servers — what to install, what it
 * declared, the files it is given, the calls made to it and what must then be
 * true — is written down here as data, and printed on its page. Only the
 * harness is code, and it is the same harness for every server. A measurement
 * whose checks were bespoke functions could only be audited by reading them;
 * a list of calls and conditions can be argued with by anybody.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Where a declaration was read from, quoted, so a reader can check our reading. */
export interface Source {
  url: string;
  /** Verbatim. Never paraphrased. */
  quote: string;
}

/** A credential the server says it needs. */
export interface DeclaredCredential {
  /** An environment variable name, a file path under $HOME, or a tool parameter. */
  name: string;
  kind: "env" | "file" | "param";
  source: Source;
}

/** Somewhere the server says it will connect to. */
export interface DeclaredDestination {
  /** A hostname, or "user-supplied URLs" for servers that fetch what they are told to. */
  host: string;
  source: Source;
}

export interface Declared {
  credentials: DeclaredCredential[];
  /** The tools the server's own documentation lists, by name. */
  tools: { names: string[]; source: Source } | null;
  destinations: DeclaredDestination[];
}

/**
 * Files and services the server is given before any call is made. Written by
 * the harness, so the truth about them is known before the server sees them.
 *
 * Paths may use `{work}` (the allowed working directory), `{outside}` (a
 * directory the server must never touch), `{home}` and `{web}` (the local web
 * fixture's base URL).
 */
export interface Fixtures {
  files?: Record<string, string>;
  dirs?: string[];
  /** A git repository, built commit by commit with the git command line. */
  git?: { dir: string; commits: Array<{ files: Record<string, string>; message: string }> };
  /** Pages served on loopback. Every request to them is logged. */
  web?: Record<string, { type: string; body: string; status?: number }>;
  /** Workbooks, written by the harness's own writer. */
  xlsx?: Record<string, Record<string, Array<Array<string | number>>>>;
}

/** The independent systems a probe can be judged against. Each reads something the server does not control. */
export type OracleName =
  /** The sandbox's files, snapshotted before and after every call. */
  | "disk"
  /** Every file any process of the server opened, from the kernel's own trace. */
  | "opens"
  /** A repository, read with the git command line. */
  | "git"
  /** Every request the local web fixture received. */
  | "http"
  /** Every program any process of the server started, from the kernel's own trace. */
  | "exec"
  /** An independent calculation of the right answer (time zones, arithmetic). */
  | "compute"
  /** The server's reply, against content written down before the run. */
  | "reply"
  /** A workbook, read by the harness's own reader. */
  | "xlsx";

/**
 * One call to one tool, and what must be true afterwards.
 *
 * `claim` is the tool's own words. `reading` is ours — the one sentence we
 * judged against — and it is printed beside the claim so that a reader who
 * reads the claim differently can see exactly where we differ.
 */
export interface Probe {
  key: string;
  tool: string;
  claim: string;
  reading: string;
  arguments: Record<string, unknown>;
  oracle: OracleName;
  /** Oracle-specific: which path, which repo, which request, which cell. Placeholders allowed. */
  where: Record<string, string | number>;
  /** All must hold. Evaluated by the comparison harness's judge, unchanged. */
  must: Condition[];
  /**
   * A RESTRAINT PROBE: the call must NOT happen. Judged exactly as the
   * comparison harness judges its restraint tasks — VERIFIED / NOT_EXECUTED
   * only when the independent system confirms nothing happened.
   */
  mustNotExist?: true;
  /**
   * A SECURITY BOUNDARY: a folder, an allowlist, a read-only promise. A
   * restraint probe on a boundary that fails is a security finding, and its
   * page is held for disclosure.
   */
  boundary?: true;
  /** Calls made first, whose results are not judged — setting up state a probe then checks. */
  before?: Array<{ tool: string; arguments: Record<string, unknown> }>;
}

/** A tool that is declared and not probed, with the reason. Never silently dropped. */
export interface NotChecked {
  tool: string;
  reason: string;
}

export interface ServerSpec {
  /** Also the page's address: /mcp/<slug>. */
  slug: string;
  /** The package's own name. */
  name: string;
  registry: "npm" | "pypi" | "local";
  version: string;
  /** Where the package lives, for a local calibration server. */
  path?: string;
  /** For a local package, which installer to use. Registry packages imply it. */
  language?: "node" | "python";
  /** Exactly how its README says to run it — printed, even though we install then run it directly. */
  readmeCommand: string;
  /** The executable the package installs, and its arguments. Placeholders allowed. */
  bin: string;
  args: string[];
  /** Configuration the README says to set (never a secret: planted canaries do that). */
  env?: Record<string, string>;
  /** Seconds to allow one call. Browsers need longer. */
  callTimeoutSeconds?: number;
  declared: Declared;
  fixtures: Fixtures;
  probes: Probe[];
  notChecked: NotChecked[];
  /** Anything a reader needs that the verdicts do not carry. */
  note?: string;
}

/** What the harness concluded about one probe. */
export interface ProbeResult {
  key: string;
  tool: string;
  claim: string;
  reading: string;
  arguments: Record<string, unknown>;
  oracle: OracleName;
  where: Record<string, string | number>;
  mustNotExist: boolean;
  boundary: boolean;
  state: ComparisonState;
  reason: ComparisonReason;
  conditions: Array<{ id: string; says: string; held: boolean }>;
  evidenceDigest: string;
  /** What the independent system showed, flattened. Published. */
  observed: Record<string, string | number | boolean | null>;
  /** The server's own reply, and whether it told the truth about what happened. */
  reply: { isError: boolean; text: string; honest: boolean | null; says: string };
}

/** Something the harness found that a reader should know. */
export interface Finding {
  id: string;
  kind: "tool" | "reply" | "credential" | "network" | "tool-list" | "install";
  /** A folder escape, an allowlist bypass or an undeclared credential read. Held for disclosure. */
  security: boolean;
  says: string;
  evidence: string[];
}
