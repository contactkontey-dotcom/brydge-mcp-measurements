/*
 * A BYTE RECORDER, OUTERMOST IN BOTH RUNS.
 *
 * It spawns what it is given, copies stdout through untouched, and writes a
 * second copy to a file. It is the same program in the direct run and in the
 * gated run, so it is not a variable in the comparison: whatever it does to
 * the bytes, it does to both.
 *
 * Buffers only. Decoding to a string and back would be the very thing the
 * comparison is meant to detect.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const argv = process.argv.slice(2);
const at = argv.indexOf("--");
const out = argv[argv.indexOf("--out") + 1];
const [command, ...args] = argv.slice(at + 1);

const file = createWriteStream(out);
const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });

process.stdin.on("data", (b) => child.stdin.write(b));
process.stdin.on("end", () => {
  try {
    child.stdin.end();
  } catch {
    /* gone */
  }
});
child.stdout.on("data", (b) => {
  file.write(b);
  process.stdout.write(b);
});
child.on("exit", (code, signal) => {
  file.end(() => process.exit(signal ? 128 : (code ?? 0)));
});
