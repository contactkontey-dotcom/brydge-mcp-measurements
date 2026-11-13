/*
 * Types for build.mjs, which is plain JavaScript on purpose: it is the thing
 * that compiles the TypeScript, so it cannot be TypeScript itself.
 *
 * Without this, every file that imports it is implicitly `any`, and a
 * misspelt option or a changed return shape goes unnoticed in the very
 * places that drive the build — the tests and the room runners.
 */

/** Where a build goes when the caller does not say. */
export declare const OUT: string;
/** The sources compiled, relative to the repository root. */
export declare const SOURCES: string[];
/** The built gate's entry point under OUT. */
export declare const ENTRY: string;

/** The newest modification time among the sources, in milliseconds; 0 for none. */
export declare function sourcesChangedAt(): number;
/** The built entry's modification time, or 0 when there is no build. */
export declare function builtAt(): number;

/** `ok` false is a refusal to run, and `because` says it in words. */
export interface Staleness {
  ok: boolean;
  because: string | null;
}

/** Whether what is on disk was built from what is on disk now. */
export declare function staleness(): Staleness;

export interface Built {
  out: string;
  /** What a client launches: <out>/gate/run.js. */
  entry: string;
  /** Every built file, relative to `out`, sorted. */
  files: string[];
}

/** Compile the gate. `out` lets a caller keep its own tree. */
export declare function build(options?: { clean?: boolean; out?: string }): Built;
