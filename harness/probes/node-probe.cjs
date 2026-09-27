"use strict";
/*
 * Loaded into every Node process of a server under measurement (NODE_OPTIONS=--require).
 * It changes nothing the server can observe except by looking for it, and writes one
 * JSON line per event to $BRYDGE_PROBE_LOG:
 *
 *   loaded    this process is covered
 *   env       the first read of one variable, with where in the code it happened
 *   env-all   the whole environment was enumerated or copied (as spawning a child does)
 *   open      a file under $HOME was opened, with where in the code it happened
 *
 * Reads that happen DURING an enumeration are part of it, not separate reads: copying
 * the environment to start a subprocess touches every variable, and counting that as
 * reading each secret would accuse every server that ever starts a program.
 */
const fs = require("node:fs");
const LOG = process.env.BRYDGE_PROBE_LOG;
const HOME = process.env.HOME || "";
if (LOG && !globalThis.__brydgeProbe) {
  globalThis.__brydgeProbe = true;
  const append = fs.appendFileSync;
  const write = (o) => {
    try {
      append(LOG, JSON.stringify({ pid: process.pid, ppid: process.ppid, t: Date.now(), ...o }) + "\n");
    } catch {}
  };
  const where = () =>
    (new Error().stack || "")
      .split("\n")
      .slice(3, 12)
      .map((s) => s.trim())
      .filter((s) => !s.includes("node-probe.cjs"));
  write({ event: "loaded", runtime: "node", argv: process.argv.slice(0, 4) });

  const seen = new Set();
  let enumerating = false;
  const read = (k) => {
    if (typeof k !== "string" || k === "BRYDGE_PROBE_LOG" || enumerating || seen.has(k)) return;
    seen.add(k);
    write({ event: "env", key: k, stack: where() });
  };
  process.env = new Proxy(process.env, {
    get(target, key) {
      read(key);
      return Reflect.get(target, key);
    },
    has(target, key) {
      read(key);
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      write({ event: "env-all", stack: where() });
      enumerating = true;
      queueMicrotask(() => {
        enumerating = false;
      });
      return Reflect.ownKeys(target);
    },
  });

  /* Opens under $HOME, attributed. The kernel trace is the complete record; this names the code. */
  const underHome = (p) => {
    try {
      const s = typeof p === "string" ? p : p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : "";
      return HOME && s.startsWith(HOME) ? s : null;
    } catch {
      return null;
    }
  };
  const wrap = (obj, name) => {
    const original = obj[name];
    if (typeof original !== "function") return;
    obj[name] = function (p, ...rest) {
      const path = underHome(p);
      if (path) write({ event: "open", path, via: name, stack: where() });
      return original.call(this, p, ...rest);
    };
  };
  for (const name of ["openSync", "open", "readFileSync", "readFile", "createReadStream"]) wrap(fs, name);
  for (const name of ["open", "readFile"]) wrap(fs.promises, name);
}
