/*
 * THE GATE, IN THE SEALED ROOM, WITH A PLANTED SERVER AS ITS CHILD.
 *
 * Not measureServer: that installs a package, and nothing here installs or
 * runs anybody else's code. This builds the same config.json measure.ts
 * builds and enters the room the same way — `unshare -n -m node
 * harness/session.ts <config>` — with the harness's own client playing the
 * client, the gate in the executable position, and a server written in this
 * repository as the gate's child.
 *
 * THE REPOSITORY IS UNDER /home, WHICH THE ROOM REPLACES WITH A TMPFS. So
 * the gate's files are copied out of /home first, into the run directory,
 * with their relative paths preserved: watch/gate/*.ts needs ../tools.ts.
 * A module left under /home vanishes from view the moment the room is built.
 */
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { build } from "./build.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_BASE = "/srv/brydge-measure";
const UID = 996;
const GID = 995;
const CASE = (process.argv.find((a) => a.startsWith("--case=")) ?? "--case=plain").slice(7);

const runDir = join(RUN_BASE, `gate-room-${Date.now()}`);
const probeDir = join(runDir, "probes");
const copyDir = join(runDir, "gate");
const journalDir = join(runDir, "journal");
for (const d of [runDir, probeDir, journalDir]) mkdirSync(d, { recursive: true });
chmodSync(runDir, 0o755);

for (const name of ["node-probe.cjs", "sitecustomize.py", "lo-up.py"]) {
  copyFileSync(join(ROOT, "harness", "probes", name), join(probeDir, name));
  chmodSync(join(probeDir, name), 0o644);
}

/*
 * The BUILT gate, out of /home, which the room replaces with a tmpfs.
 *
 * One self-contained tree, which is what a client launches anyway. Copying
 * a hand-picked list of sources was how this broke once: run.ts gained
 * three imports, the list did not grow with it, and the gate died on its
 * first line — which the room reported, correctly, as the server process
 * exiting.
 */
build({ out: copyDir });
copyFileSync(join(ROOT, "watch", "gate", "fixtures", "hostile-server.mjs"), join(copyDir, "server.mjs"));
execFileSync("chmod", ["-R", "a+rX", copyDir]);
execFileSync("chown", ["-R", `${UID}:${GID}`, journalDir]);

const journal = join(journalDir, "notes.ndjson");
const spec = {
  slug: "gate-room",
  name: "gate-room",
  registry: "local",
  version: "0.0.0",
  readmeCommand: "node watch/gate/built/gate/run.js -- <server>",
  bin: process.execPath,
  args: [join(copyDir, "gate", "run.js"), "--journal", journal, "--", process.execPath, join(copyDir, "server.mjs"), `--case=${CASE}`],
  declared: { credentials: [], tools: null, destinations: [] },
  fixtures: {},
  probes: [],
  notChecked: [],
};

const configPath = join(runDir, "config.json");
writeFileSync(configPath, JSON.stringify({ spec, runDir, probeDir, bin: spec.bin, args: spec.args }));

const env = {
  PATH: `${dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/usr/bin:/bin`,
  HOME: "/root",
  LANG: "C.UTF-8",
};

process.stderr.write(`room: ${runDir}\n`);
try {
  execFileSync("unshare", ["-n", "-m", process.execPath, join(ROOT, "harness", "session.ts"), configPath], {
    env,
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 5 * 60_000,
  });
} catch (e) {
  process.stderr.write(`room: session exited non-zero: ${e.status ?? e.message}\n`);
}

const resultPath = join(runDir, "session-result.json");
if (!existsSync(resultPath)) {
  process.stderr.write("room: no session-result.json; the room did not finish\n");
  process.exit(1);
}
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const transcript = result.session?.transcript ?? [];
const fromServer = transcript.filter((e) => e.dir === "from-server").length;
const stderrLines = transcript.filter((e) => e.dir === "stderr").map((e) => String(e.message)).join("");

console.log(JSON.stringify({
  runDir,
  serverInfo: result.serverInfo,
  initError: result.initError,
  offered: result.offered,
  transcriptEntries: transcript.length,
  fromServer,
  gateStderrSeen: /Nothing was hidden from the client/.test(stderrLines),
  gateStderrFirstLine: (stderrLines.split("\n").find((l) => l.startsWith("gate:")) ?? "").slice(0, 160),
  journalExists: existsSync(journal),
  journalKinds: existsSync(journal)
    ? readFileSync(journal, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).kind)
        .reduce((o, k) => ((o[k] = (o[k] ?? 0) + 1), o), {})
    : null,
}, null, 2));
