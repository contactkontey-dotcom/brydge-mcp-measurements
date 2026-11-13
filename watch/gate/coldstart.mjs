/*
 * WHAT THE GATE COSTS AT STARTUP.
 *
 * A client launches this on every session, so the cost is paid every time.
 * Measured, not estimated: the same planted server, to the same first answer,
 * with and without the gate in front of it. The clock starts before spawn and
 * stops when the initialize result has been read, because that is the wait a
 * person actually has.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "fixtures", "hostile-server.mjs");
const GATE = join(HERE, "run.ts");
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

const bare = [];
const gated = [];
/* One of each first, discarded: the first spawn pays for warm caches. */
await once(process.execPath, [SERVER]);
await once(process.execPath, [GATE, "--", process.execPath, SERVER]);
for (let i = 0; i < ROUNDS; i++) {
  bare.push(await once(process.execPath, [SERVER]));
  gated.push(await once(process.execPath, [GATE, "--", process.execPath, SERVER]));
}

const b = stats(bare);
const g = stats(gated);
console.log(JSON.stringify({
  rounds: ROUNDS,
  milliseconds_to_first_answer: { without_the_gate: b, with_the_gate: g },
  added_median_ms: +(g.median - b.median).toFixed(1),
  added_p90_ms: +(g.p90 - b.p90).toFixed(1),
  note: "Two Node processes instead of one. The gate's own module loading is most of it.",
}, null, 2));
