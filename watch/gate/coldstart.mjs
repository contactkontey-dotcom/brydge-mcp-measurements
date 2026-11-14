/*
 * WHAT THE GATE COSTS AT STARTUP.
 *
 * A client launches this on every session, so the cost is paid every time.
 * Measured, not estimated: the same planted server, to the same first answer,
 * with and without the gate in front of it. The clock starts before spawn and
 * stops when the initialize result has been read, because that is the wait a
 * person actually has.
 *
 * Four ways of starting, because the choice between them is what the number
 * is for: the server alone, the gate run from TypeScript source, the gate
 * run from the build, and the build in enforce mode. Enforcement is the one
 * that has to be paid before the client's first answer, so it is the one
 * worth knowing.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "fixtures", "hostile-server.mjs");
const GATE = join(HERE, "run.ts");
const BUILT = join(HERE, "built", "gate", "run.js");
const ROUNDS = Number((process.argv.find((a) => a.startsWith("--rounds=")) ?? "--rounds=15").slice(9));

const INIT = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planted", version: "1" } } }) + "\n";

function once(command, args) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      buf += c;
      if (buf.includes("\n")) {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        try { child.kill("SIGKILL"); } catch { /* gone */ }
        resolve(ms);
      }
    });
    child.stdin.write(INIT);
  });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { n: s.length, min: +s[0].toFixed(1), median: +at(50).toFixed(1), p90: +at(90).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

/* A pin for the enforce round, adopted from what the planted server offers. */
const { recordOf } = await import(join(HERE, "built", "tools.js"));
const { adopt, write: writePin } = await import(join(HERE, "built", "gate", "pin.js"));
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");

const tools = await new Promise((resolve) => {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => {
    buf += c;
    for (const l of buf.split("\n")) {
      try {
        const m = JSON.parse(l);
        if (Array.isArray(m?.result?.tools)) {
          try { child.kill("SIGKILL"); } catch { /* gone */ }
          resolve(m.result.tools);
          return;
        }
      } catch { /* partial */ }
    }
  });
  child.stdin.write(INIT);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
});
const pinFile = join(mkdtempSync(join(tmpdir(), "gate-cold-")), "pin.json");
writePin(pinFile, adopt("planted-hostile-server", "0.0.0", tools.map(recordOf), new Date().toISOString().slice(0, 10)));

const ways = {
  server_alone: [SERVER],
  gate_from_source: [GATE, "--", process.execPath, SERVER],
  gate_built_shadow: [BUILT, "--pin", pinFile, "--", process.execPath, SERVER],
  gate_built_enforce: [BUILT, "--pin", pinFile, "--mode", "enforce", "--", process.execPath, SERVER],
  /*
   * --relist-on-change costs one more module and one more object at
   * startup, and nothing else: it sends nothing until the server says its
   * tool list changed, which is after the first answer the clock here
   * stops on. If this row is not within noise of the row above it, the
   * flag is doing something at startup that it should not be.
   */
  gate_built_enforce_relist: [BUILT, "--pin", pinFile, "--mode", "enforce", "--relist-on-change", "--", process.execPath, SERVER],
};

const got = {};
for (const name of Object.keys(ways)) got[name] = [];
/* One of each first, discarded: the first spawn pays for warm caches. */
for (const args of Object.values(ways)) await once(process.execPath, args);
/* Interleaved, so a machine that gets busier partway through makes every
 * way slower rather than one of them. */
for (let i = 0; i < ROUNDS; i++) {
  for (const [name, args] of Object.entries(ways)) got[name].push(await once(process.execPath, args));
}

const summary = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, stats(v)]));
const bare = summary.server_alone;
console.log(JSON.stringify({
  rounds: ROUNDS,
  pinnedTools: tools.length,
  milliseconds_to_first_answer: summary,
  added_median_ms: Object.fromEntries(
    Object.entries(summary)
      .filter(([k]) => k !== "server_alone")
      .map(([k, v]) => [k, +(v.median - bare.median).toFixed(1)]),
  ),
  added_p90_ms: Object.fromEntries(
    Object.entries(summary)
      .filter(([k]) => k !== "server_alone")
      .map(([k, v]) => [k, +(v.p90 - bare.p90).toFixed(1)]),
  ),
  note: "Two Node processes instead of one. The gate's own module loading is most of it; enforcement adds one more module and a pin to read.",
}, null, 2));
