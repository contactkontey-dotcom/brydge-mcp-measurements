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

  /* A server may shell out to a package manager to do its work (mcp-server-fetch
   * runs npm to extract readable text). npm and npx REFUSE to run when
   * process.env is a Proxy — they exit before doing anything — so wrapping it
   * here would break the child and turn a working tool into a false failure.
   * When this process IS a package manager, we leave process.env untouched (the
   * file-open logging below is harmless and stays). The manager's own reads of
   * its config are then judged by the analyzer, which knows npm reading ~/.npmrc
   * is npm being npm, not the server stealing a credential. */
  const argvList = process.argv || [];
  const isPackageManager =
    argvList.some((a) => /(?:^|\/)(npm|npx|npm-cli\.js|npx-cli\.js|corepack)$/.test(a)) || /npm-cli\.js|npx-cli\.js|\/npm\/bin\//.test(argvList.join(" "));

  /* Record every read and the SITE it came from; the analyzer decides which
   * site was copying the environment and which was targeting a secret — the
   * same rule for both runtimes. A membership test (`"X" in process.env`) is a
   * presence check, not a read of the value, so it is not logged. */
  const seen = new Set(); // "key\x00site"
  const read = (k) => {
    if (typeof k !== "string" || k === "BRYDGE_PROBE_LOG") return;
    const stack = where();
    const site = stack[0] || "?";
    const tag = `${k}\x00${site}`;
    if (seen.has(tag)) return;
    seen.add(tag);
    write({ event: "env", key: k, site, stack: stack.slice(0, 6) });
  };
  if (!isPackageManager)
    process.env = new Proxy(process.env, {
      get(target, key) {
        read(key);
        return Reflect.get(target, key);
      },
      ownKeys(target) {
        write({ event: "env-all", stack: where() });
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
