import { readFileSync } from "node:fs";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE IN-PROCESS PROBES SAW, PARSED BACK.
 *
 * The Node and Python probes each write one JSON line per event to a log file.
 * This reads that file. The probes name the code that touched a variable or a
 * file; the kernel trace is the authority on WHETHER it was touched. The two
 * are used together: the trace to establish the fact, the probe to say where
 * in the server's own code it came from.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface ProbeEvent {
  pid: number;
  ppid: number;
  t: number;
  event: "loaded" | "env" | "env-all" | "open";
  runtime?: "node" | "python";
  argv?: string[];
  /** env: the variable name. */
  key?: string;
  /** env: the call site the read came from, for grouping copies vs targeted reads. */
  site?: string;
  /** open: the path. */
  path?: string;
  via?: string;
  stack?: string[];
}

export function readProbeLog(path: string): ProbeEvent[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const events: ProbeEvent[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s) as ProbeEvent);
    } catch {
      /* a torn final line: ignore */
    }
  }
  return events.sort((a, b) => a.t - b.t);
}
