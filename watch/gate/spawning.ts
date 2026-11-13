/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO THINGS ABOUT STARTING A CHILD THAT DIFFER BY PLATFORM.
 *
 * In its own module, with the platform as an argument rather than read from
 * `process`, because the only way to test the Windows behaviour from
 * anywhere else is to pass "win32" in.
 *
 * ── A PROCESS GROUP IS A POSIX IDEA ──────────────────────────────────────
 *
 * On POSIX the child is spawned detached so that it leads its own process
 * group, and a signal sent to `-pid` reaches the server and anything the
 * server started. That is what "the session is ending" has to mean when a
 * batch makes the gate fail closed.
 *
 * On Windows `detached` means something else. Node's own documentation:
 * "On Windows, setting options.detached to true makes it possible for the
 * child process to continue running after the parent exits. The child
 * process will have its own console window. Once enabled for a child
 * process, it cannot be disabled."
 *
 * A console window per server is not something a client's config should
 * produce, and a child that outlives the gate is the opposite of what the
 * flag is here for. So on Windows the child is not detached, and the kill
 * is the ordinary one — which reaches the server and not its children.
 * Reaching a whole tree on Windows wants taskkill and is not done here.
 *
 * ── A .cmd IS NOT A PROGRAM ──────────────────────────────────────────────
 *
 * `npx` on Windows is `npx.cmd`, and a .cmd file cannot be spawned
 * directly: Node's documentation says such a file "can be invoked by …
 * spawning cmd.exe and passing the .bat or .cmd file as an argument".
 * Since Node 18.20 and 20.12 it will not launch one without a shell at
 * all. So the config that works everywhere else — `-- npx -y my-server` —
 * fails on Windows with ENOENT, or with EINVAL where the .cmd was named.
 *
 * THE GATE DOES NOT REWRITE THE COMMAND. Somebody wrote that line in their
 * client's config and the gate's whole claim is that it passes things
 * through as they are; quietly putting `cmd.exe /c` in front of a command
 * would be the gate deciding what to run. What it does instead is say, when
 * the spawn has already failed, what the Windows form of that same command
 * would be, and leave the editing to the person.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** What `process.platform` gives, narrowed to the part that matters here. */
export type Platform = string;

export const isWindows = (platform: Platform): boolean => platform === "win32";

/**
 * Whether to spawn the child detached.
 *
 * True on POSIX, for the process group. False on Windows, where it would
 * give the server its own console window and let it outlive the gate.
 */
export function detachedOn(platform: Platform): boolean {
  return !isWindows(platform);
}

/**
 * How to end the child.
 *
 * "group" sends the signal to the whole process group, which needs the
 * child to have been spawned detached. "child" sends it to the one process.
 */
export function killStyleOn(platform: Platform): "group" | "child" {
  return isWindows(platform) ? "child" : "group";
}

/** The errors a Windows spawn gives for a command that is really a .cmd. */
const CMD_ERRORS = ["ENOENT", "EINVAL"];

/**
 * The Windows form of a command, for a message. Not for running.
 *
 * `cmd.exe /c <command> <args…>`, with anything containing a space quoted,
 * which is what cmd needs and what a person would have to type.
 */
export function cmdExeForm(command: string, args: string[]): string {
  const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ["cmd.exe", "/c", command, ...args].map(quote).join(" ");
}

/**
 * The lines to print when the child did not start, after the one that says
 * so. Empty where there is nothing useful to add.
 *
 * Only on Windows, and only for the two errors a .cmd gives. A missing
 * program is a missing program on every platform and the error already
 * says that; what Windows adds is a command that EXISTS and still cannot
 * be spawned, which is the case worth explaining.
 */
export function startupAdvice(
  error: { code?: string; message?: string },
  platform: Platform,
  command: string,
  args: string[],
): string[] {
  if (!isWindows(platform)) return [];
  const code = typeof error.code === "string" ? error.code : "";
  if (!CMD_ERRORS.includes(code)) return [];
  return [
    `gate: on Windows a .bat or .cmd file cannot be started directly, and "npx", "npm" and "yarn" are .cmd files.`,
    `gate: the gate did not change the command it was given. Run that command through cmd.exe yourself, by putting this after the "--" in your client's config:`,
    `gate:   ${cmdExeForm(command, args)}`,
    `gate: a command that is a real program, such as "node" or a path to an .exe, needs none of this.`,
  ];
}
