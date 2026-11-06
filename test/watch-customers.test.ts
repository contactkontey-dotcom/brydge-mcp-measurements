import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A CUSTOMER'S LIST IS A MAP OF THEIR OWN TOOLING, IN A PUBLIC REPOSITORY.
 *
 * Every entry names a tool, a website or a program a named organisation runs
 * and has signed off on. They gave us that; they did not publish it. One
 * `git add -A` on a distracted afternoon puts it on the internet for good, and
 * a .gitignore is only a rule until somebody passes `-f`.
 *
 * So this asks git itself what is tracked, rather than trusting the ignore
 * file to have been right.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const ROOT = join(import.meta.dirname, "..");
const DIR = "watch/customers";
const ALLOWED = new Set([`${DIR}/.gitkeep`, `${DIR}/README.md`]);

test("no customer list is tracked by git", () => {
  const tracked = execFileSync("git", ["ls-files", DIR], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const leaked = tracked.filter((f) => !ALLOWED.has(f));
  assert.deepEqual(leaked, [], `a customer list is in git: ${leaked.join(", ")}`);
});

test("a customer list added to that folder is ignored, including with git add", () => {
  /* The ignore rule is checked against git's own answer for a path that does
   * not exist, so the test needs no fixture and leaves nothing behind. */
  const out = execFileSync("git", ["check-ignore", "-v", `${DIR}/acme.json`], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /\.gitignore/, "a customer file would not be ignored");
  for (const keep of ALLOWED) {
    assert.throws(
      () => execFileSync("git", ["check-ignore", "-q", keep], { cwd: ROOT, stdio: "pipe" }),
      `${keep} is ignored and should not be`,
    );
  }
});

test("nothing in the folder right now looks like an un-ignored customer list", () => {
  for (const f of readdirSync(join(ROOT, DIR))) {
    if (ALLOWED.has(`${DIR}/${f}`)) continue;
    const out = execFileSync("git", ["check-ignore", "-v", `${DIR}/${f}`], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /\.gitignore/, `${f} is in the folder and is not ignored`);
  }
});
