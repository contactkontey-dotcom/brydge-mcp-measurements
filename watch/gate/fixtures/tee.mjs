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
 *
 * --err <file> keeps a copy of the child's stderr as well. Pass it in every
 * run of a comparison or in none: a child whose stderr is a pipe in one run
 * and inherited in another has been given two different worlds to start in.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const argv = process.argv.slice(2);
const at = argv.indexOf("--");
const out = argv[argv.indexOf("--out") + 1];
const errAt = argv.indexOf("--err");
const errOut = errAt === -1 ? null : argv[errAt + 1];
const [command, ...args] = argv.slice(at + 1);

const file = createWriteStream(out);
const errFile = errOut ? createWriteStream(errOut) : null;
const child = spawn(command, args, { stdio: ["pipe", "pipe", errFile ? "pipe" : "inherit"] });
if (errFile) {
  child.stderr.on("data", (b) => {
    errFile.write(b);
    process.stderr.write(b);
  });
}

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
  errFile?.end();
  file.end(() => process.exit(signal ? 128 : (code ?? 0)));
});
