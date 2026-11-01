/*
 * Types for `paste-client.js`.
 *
 * The parser stays plain JavaScript because the page inlines that exact file
 * at build time — what the tests import is byte-for-byte what ships to a
 * browser, with no compile step in between to argue about. The cost of that
 * choice is this file: the types live beside the code rather than in it.
 *
 * `Found` and `Match` are declared as one shape with optional members rather
 * than as discriminated unions. That is deliberate. A union would make
 * `found.detail` an error on the `npm` arm, which is correct for the parser
 * but wrong for a test that pastes a known config and asserts on the field it
 * knows is there. The discipline that matters here — no env VALUE survives —
 * is enforced by a test, not by a type.
 */

/** A package specifier split at its version, if it carries one. */
export declare function splitSpec(spec: string): { name: string; version: string | null };

/** What a config entry would install, or why there is no package to name. */
export interface Found {
  kind: "npm" | "binary" | "remote" | "other" | "unknown";
  /** Present for `npm` and `binary`. */
  name?: string;
  /** Present for `npm` and `binary`; null when the config pins nothing. */
  version?: string | null;
  /** Present for `remote`, `other` and `unknown`: the URL, ecosystem or reason. */
  detail?: string;
}

/** A config entry as read, loosely enough to describe any JSON that arrives. */
export declare function packageOf(entry: {
  command?: unknown;
  args?: unknown;
  url?: unknown;
  type?: unknown;
}): Found;

/** One server from a pasted config. `env` VALUES are gone; the keys remain. */
export interface ParsedServer {
  label: string;
  command: string;
  args: string[];
  url: string | null;
  type: string | null;
  envKeys: string[];
  found: Found;
}

export interface ParsedConfig {
  ok: boolean;
  error: string | null;
  servers: ParsedServer[];
}

/** Parse a pasted config. Never throws; a bad paste comes back `ok: false`. */
export declare function readConfig(text: string): ParsedConfig;

/** A measurement as the page carries it, inlined by `site/build.ts`. */
export interface IndexRecord {
  name: string;
  slug: string;
  version: string;
  measuredAt: string;
  offered: number;
  undocumentedTools: number;
  undeclaredHosts: number;
  websites: number;
}

export interface Match {
  state: "measured" | "measured-other-version" | "unmeasured" | "remote" | "other" | "unknown";
  /** The package name, for `unmeasured` and both `measured` states. */
  name?: string;
  /** The version the pasted config asks for, where it differs from ours. */
  wanted?: string | null;
  /** Present for both `measured` states. */
  record?: IndexRecord;
  /** Present for `remote`, `other` and `unknown`. */
  detail?: string;
}

/** Match a parsed server against the measurement index. */
export declare function match(server: ParsedServer, index: Record<string, IndexRecord>): Match;

/** A summary somebody can paste into a ticket. Never carries an env value. */
export declare function toMarkdown(
  rows: { server: ParsedServer; result: Match }[],
  origin: string,
): string;
