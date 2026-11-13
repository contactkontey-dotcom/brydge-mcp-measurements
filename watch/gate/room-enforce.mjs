/*
 * ONE REAL SERVER, IN THE SEALED ROOM, UNDER ENFORCEMENT.
 *
 * The same server and the same room as room-real.mjs:
 * @modelcontextprotocol/server-memory, from the install tree a previous
 * measurement left behind. Nothing is installed here and it is started only
 * inside the room, under the same unshare, tmpfs, loopback-only resolver,
 * setpriv and strace every measured server gets.
 *
 * Five sessions, because the question needs four comparisons:
 *
 *   direct-a   the server on its own
 *   direct-b   the server on its own again   — the control: a server that
 *              does not repeat cannot tell us anything about a proxy
 *   shadow     the gate in front of it, hiding nothing
 *   enforce    the gate in front of it with everything approved
 *   enforce-0  the gate in front of it with a pin that names no tool
 *
 * THE KILL RULE is the fourth line of the output: with everything approved,
 * the bytes the client reads under enforcement must be the bytes it reads
 * with no gate at all. enforce-0 is the other end of the same measurement —
 * proof that the comparison would have noticed a difference.
 *
 * The pin is built from the tool list the server answered in direct-a, which
 * is what `gate pin --from-current` writes. Descriptions go into the hashes
 * and nothing prints one: the output is counts, hashes and tool names.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { build } from "./build.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_BASE = "/srv/brydge-measure";
const UID = 996;
const GID = 995;

/* The gate is built once, outside the room, and each session gets a copy. */
const SHARED = join(RUN_BASE, `gate-enforce-shared-${Date.now()}`);
mkdirSync(SHARED, { recursive: true });
chmodSync(SHARED, 0o755);
build({ out: join(SHARED, "gate") });
const { recordOf } = await import(join(SHARED, "gate", "tools.js"));
const { adopt, write: writePin } = await import(join(SHARED, "gate", "gate", "pin.js"));

/** The newest install tree a previous measurement left for this package. */
function installedBin() {
  const dirs = readdirSync(RUN_BASE)
    .filter((d) => d.startsWith("modelcontextprotocol--server-memory-"))
    .sort()
    .reverse();
  for (const d of dirs) {
    const bin = join(RUN_BASE, d, "install", "node_modules", ".bin", "mcp-server-memory");
    if (existsSync(bin)) return { bin, from: d };
  }
  return null;
}

const found = installedBin();
if (!found) {
  process.stderr.write("no install tree for @modelcontextprotocol/server-memory; nothing is installed here\n");
  process.exit(1);
}

/** gated: null for no gate, else the arguments after run.js. */
function session(label, gated) {
  const runDir = join(RUN_BASE, `gate-enf-${label}-${Date.now()}`);
  const probeDir = join(runDir, "probes");
  const copyDir = join(runDir, "gate");
  const capture = join(runDir, "capture");
  for (const d of [runDir, probeDir, capture]) mkdirSync(d, { recursive: true });
  chmodSync(runDir, 0o755);
  for (const name of ["node-probe.cjs", "sitecustomize.py", "lo-up.py"]) {
    copyFileSync(join(ROOT, "harness", "probes", name), join(probeDir, name));
    chmodSync(join(probeDir, name), 0o644);
  }
  build({ out: copyDir });
  copyFileSync(join(ROOT, "watch", "gate", "fixtures", "tee.mjs"), join(copyDir, "tee.mjs"));
  execFileSync("chmod", ["-R", "a+rX", copyDir]);
  execFileSync("chown", ["-R", `${UID}:${GID}`, capture]);

  const bytes = join(capture, "stdout.bin");
  const gateErr = join(capture, "gate-stderr.txt");
  const inner = gated ? [process.execPath, join(copyDir, "gate", "run.js"), ...gated, "--", found.bin] : [found.bin];
  /* --err in every run, gated or not: the recorder must behave the same
   * way in all five, or it is a variable in the comparison. */
  const args = [join(copyDir, "tee.mjs"), "--out", bytes, "--err", gateErr, "--", ...inner];

  const spec = {
    slug: `gate-enf-${label}`,
    name: "@modelcontextprotocol/server-memory",
    registry: "local",
    version: "2.0.1",
    readmeCommand: "npx -y @modelcontextprotocol/server-memory@2.0.1",
    bin: process.execPath,
    args,
    declared: { credentials: [], tools: null, destinations: [] },
    fixtures: {},
    probes: [],
    notChecked: [],
  };
  const configPath = join(runDir, "config.json");
  writeFileSync(configPath, JSON.stringify({ spec, runDir, probeDir, bin: spec.bin, args }));
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/usr/bin:/bin`,
    HOME: "/root",
    LANG: "C.UTF-8",
  };
  const started = Date.now();
  try {
    execFileSync("unshare", ["-n", "-m", process.execPath, join(ROOT, "harness", "session.ts"), configPath], {
      env,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5 * 60_000,
    });
  } catch {
    /* the result file is what says whether it worked */
  }
  const resultPath = join(runDir, "session-result.json");
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;
  return {
    label,
    runDir,
    ms: Date.now() - started,
    bytes: existsSync(bytes) ? readFileSync(bytes) : null,
    stderr: existsSync(gateErr) ? readFileSync(gateErr, "utf8") : null,
    offered: result?.offered ?? null,
    serverInfo: result?.serverInfo ?? null,
    initError: result?.initError ?? null,
  };
}

/** The tools the server listed, read back out of the bytes it wrote. */
function toolsIn(buf) {
  if (!buf) return null;
  for (const l of buf.toString("utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const m = JSON.parse(l);
      if (Array.isArray(m?.result?.tools)) return m.result.tools;
    } catch {
      /* not a message */
    }
  }
  return null;
}

process.stderr.write(`install tree: ${found.from}\n`);
const a = session("direct-a", null);
const b = session("direct-b", null);

const tools = toolsIn(a.bytes);
if (!tools) {
  process.stderr.write("the direct run answered no tool list; there is nothing to pin\n");
  process.exit(1);
}
const pinFile = join(SHARED, "pin.json");
writePin(pinFile, adopt("@modelcontextprotocol/server-memory", "2.0.1", tools.map(recordOf), new Date().toISOString().slice(0, 10)));
chmodSync(pinFile, 0o644);

const emptyPin = join(SHARED, "pin-empty.json");
writePin(emptyPin, adopt("@modelcontextprotocol/server-memory", "2.0.1", [], new Date().toISOString().slice(0, 10)));
chmodSync(emptyPin, 0o644);

const s = session("shadow", ["--pin", pinFile]);
const e = session("enforce", ["--pin", pinFile, "--mode", "enforce"]);
const z = session("enforce-0", ["--pin", emptyPin, "--mode", "enforce"]);

const sha = (buf) => (buf ? execFileSync("sha256sum", ["-"], { input: buf }).toString().slice(0, 16) : null);
/* The gate's own lines, with nothing that came from the server in them. */
const gateLines = (t) => (t ? t.split("\n").filter((l) => l.startsWith("gate:")).map((l) => l.slice(0, 200)) : null);

const killRule = a.bytes && e.bytes ? a.bytes.equals(e.bytes) : null;

console.log(JSON.stringify({
  installTree: found.from,
  serverStartedOnlyInTheRoom: true,
  pinnedTools: tools.map((t) => t.name).sort(),
  runs: [a, b, s, e, z].map((r) => ({
    label: r.label,
    ms: r.ms,
    initError: r.initError,
    toolsOffered: r.offered ? r.offered.length : null,
    stdoutBytes: r.bytes ? r.bytes.length : null,
    stdoutSha256: sha(r.bytes),
    gate: gateLines(r.stderr),
  })),
  control_directA_equals_directB: a.bytes && b.bytes ? a.bytes.equals(b.bytes) : null,
  shadow_equals_direct: a.bytes && s.bytes ? a.bytes.equals(s.bytes) : null,
  enforce_equals_direct: killRule,
  enforce_equals_shadow: s.bytes && e.bytes ? s.bytes.equals(e.bytes) : null,
  enforce0_differs_from_direct: a.bytes && z.bytes ? !a.bytes.equals(z.bytes) : null,
  enforce0_toolsOffered: z.offered ? z.offered.length : null,
  KILL_RULE: killRule === true ? "PASSED" : "FAILED",
}, null, 2));
