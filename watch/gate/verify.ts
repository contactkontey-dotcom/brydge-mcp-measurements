/*
 * ═══════════════════════════════════════════════════════════════════════════
 * CHECKING BEFORE A CALL GOES THROUGH.
 *
 * The gate's picture of a server comes from tool lists. Until now it got
 * them in two ways: the client asked, or — with --relist-on-change — the
 * server said something changed and the gate asked. Both leave the same
 * gap: a server that changes a description and says nothing is not noticed
 * until the client next lists, which for a client that lists once at
 * startup is never.
 *
 * --verify-on-call closes that gap at the price of latency. Before a
 * tools/call is forwarded, if the picture is older than the window, the
 * gate asks the server for its current list, waits, compares, and only
 * then forwards or refuses.
 *
 * ── THIS IS THE ONE PLACE A CLIENT'S MESSAGE WAITS ───────────────────────
 *
 * Everywhere else in this gate, nothing the client sends waits on the
 * gate's bookkeeping: a notification's answer arrives when it arrives and
 * the client is never held up for it. Here it is held up, on purpose,
 * because the question is about the very call being forwarded and an
 * answer that arrives afterwards is no use.
 *
 * The call waits, and so does everything behind it, which is how the order
 * a client sent things in is kept. The flag is off unless somebody types
 * it, and it says what it does on stderr when it is on.
 *
 * ── IT WAITS FOR A FRESH PICTURE, NOT FOR AN ID ──────────────────────────
 *
 * The wait ends when the picture becomes fresher than the window, however
 * that happened. So "one request is already outstanding" is not a reason
 * to send a second or to refuse: the answer to a list already on its way
 * refreshes the picture just as well, and the gate waits for that one.
 *
 * ── WHAT COUNTS AS A FAILURE, AND WHAT HAPPENS THEN ──────────────────────
 *
 * No answer in time, or a budget already spent, is a failure. Under
 * enforcement a failure refuses the call, naming the gate and carrying no
 * command, path or flag; --on-verify-timeout=forward is the explicit
 * choice to take latency and then forward anyway. In shadow mode nothing
 * is ever refused: the picture is updated, a report may be written, and
 * the call goes on.
 *
 * ── THE WORD IS "CHECKED", NOT THE OTHER ONE ─────────────────────────────
 *
 * The flag is --verify-on-call because that is what it was asked for, and
 * the word is fine in a flag. Nothing this gate SAYS uses the past
 * participle of it, because that word is on the list this repository
 * refuses to print about itself: it would claim the list had been attested
 * rather than read and compared. The gate checked. The sweep caught the
 * first draft of this file saying otherwise.
 *
 * A PAGE OF A LIST is not a failure here. It is handled where it already
 * was: a partial list leaves the surface unread, the wait times out
 * because the picture never became fresh, and the refusal that follows is
 * the one about a surface the gate has not read in full.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Lister } from "./relist.ts";

/** How old the picture may be before a call is held up for a new one. */
export const WINDOW_MS = 10_000;
/** How long the gate waits for the answer before giving up on it. */
export const TIMEOUT_MS = 3_000;

export const FLAG = "--verify-on-call";
export const WINDOW_FLAG = "--verify-window";
export const TIMEOUT_FLAG = "--verify-timeout";
export const ON_TIMEOUT_FLAG = "--on-verify-timeout";

/** What to do when the check does not finish. */
export type OnTimeout = "refuse" | "forward";
export const ON_TIMEOUTS: OnTimeout[] = ["refuse", "forward"];

/** How a check ended. */
export type Outcome =
  /** The picture was already fresh enough; nothing was asked and nothing waited. */
  | "fresh"
  /** A list came back and the picture is fresh now. */
  | "checked"
  /** Nothing was asked, because the client has not finished starting up. */
  | "not-started"
  /** No answer in time. */
  | "timed-out"
  /** This session has checked as many times as it will. */
  | "no-budget";

/** The outcomes that mean the gate does not know what it wanted to know. */
export const FAILED: Outcome[] = ["timed-out", "no-budget"];

export interface VerifierOptions {
  lister: Lister;
  /** How old the picture may be, in milliseconds. */
  window: number;
  /** How long to wait for an answer, in milliseconds. */
  timeout: number;
  /** Send one line to the server. */
  inject: (payload: Buffer) => void;
  now?: () => number;
  /** A request went out. */
  onAsked?: (id: string, tool: string | null) => void;
  /** A check finished, with how long it took. */
  onOutcome?: (outcome: Outcome, ms: number, tool: string | null) => void;
  /** The budget has just run out. */
  onBudgetSpent?: (line: string) => void;
}

export class Verifier {
  private readonly opts: VerifierOptions;
  private readonly now: () => number;
  /** When the gate last read a whole tool list. 0 means never. */
  private seenAt = 0;
  /** Whoever is waiting for the picture to become fresh. */
  private waiting: Array<() => void> = [];
  private checks = 0;
  private held = 0;

  constructor(opts: VerifierOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  get checksMade(): number {
    return this.checks;
  }

  /** How many calls have actually been held up. */
  get callsHeld(): number {
    return this.held;
  }

  /**
   * A whole tool list has been read and compared.
   *
   * Called for a list the client asked for and for one the gate asked
   * for, and NOT for a page of a list: a partial answer leaves the
   * surface unread, so it must not count as a fresh picture.
   */
  pictureSeen(at: number = this.now()): void {
    this.seenAt = at;
    const waiting = this.waiting;
    this.waiting = [];
    for (const wake of waiting) wake();
  }

  /** Whether the picture is older than the window. */
  stale(): boolean {
    return this.now() - this.seenAt >= this.opts.window;
  }

  /**
   * Make the picture fresh if it is not, holding the caller until it is.
   *
   * `tool` is only for the lines a caller writes; nothing here reads it.
   */
  async ensureFresh(tool: string | null = null): Promise<Outcome> {
    const began = this.now();
    if (!this.stale()) {
      this.opts.onOutcome?.("fresh", 0, tool);
      return "fresh";
    }
    this.checks++;

    const decided = this.opts.lister.considerVerify(this.opts.timeout);
    if (decided.ask) {
      this.opts.inject(decided.payload);
      this.opts.onAsked?.(decided.id, tool);
      const spent = this.opts.lister.verifyCapLine();
      if (spent) this.opts.onBudgetSpent?.(spent);
    } else if (decided.why === "the client has not finished starting up") {
      /*
       * Not a failure. A call before the client has finished starting up
       * is not something to refuse over: there is nothing to compare
       * against yet either way, and refusing on a guess would break a
       * client that calls early.
       */
      this.opts.onOutcome?.("not-started", this.now() - began, tool);
      return "not-started";
    } else if (decided.why === "this session has checked as many times as it will") {
      const spent = this.opts.lister.verifyCapLine();
      if (spent) this.opts.onBudgetSpent?.(spent);
      this.opts.onOutcome?.("no-budget", this.now() - began, tool);
      return "no-budget";
    }
    /* Otherwise one is already outstanding, and its answer will do. */

    this.held++;
    const fresh = await this.untilFresh();
    const outcome: Outcome = fresh ? "checked" : "timed-out";
    this.opts.onOutcome?.(outcome, this.now() - began, tool);
    return outcome;
  }

  /** True when the picture became fresh, false when the time ran out. */
  private untilFresh(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      /*
       * NOT unref'd, deliberately.
       *
       * This timer is what releases a held client message, so it has to
       * fire. An unref'd one does not when nothing else is keeping the
       * loop alive — which is a timer that silently does not fire, and a
       * client that silently never hears back. The cost of keeping it
       * referenced is that the process can linger for at most one timeout
       * when there is a check outstanding and nothing else to do, and a
       * server that has exited takes the gate with it anyway.
       */
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.waiting = this.waiting.filter((w) => w !== wake);
        resolve(false);
      }, this.opts.timeout);
      const wake = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
      this.waiting.push(wake);
    });
  }
}

/** One line on stderr when it is on, said once. */
export const announcement = (windowMs: number, timeoutMs: number, onTimeout: OnTimeout, enforcing: boolean): string =>
  `gate: ${FLAG} is on. Before passing a tools/call to the server, if the last tool list it read is more than ` +
  `${windowMs}ms old, this gate asks for a current one and HOLDS the call — and everything the client sends behind ` +
  `it — for up to ${timeoutMs}ms. That is the one place a client's message waits on this gate. ` +
  (enforcing
    ? onTimeout === "refuse"
      ? "If no answer comes in time the call is not forwarded."
      : `${ON_TIMEOUT_FLAG}=forward was given, so a call whose check does not finish is forwarded anyway.`
    : "This is shadow mode, so nothing is refused whatever the check finds: the picture is updated and a report may be written.");

/** One line each time a check went out. */
export const askedLine = (id: string, windowMs: number): string =>
  `gate: asked the server for a tool list before forwarding a call (${id}), because the last one it read is more than ${windowMs}ms old.`;

/** One line when a check did not finish. */
export const failedLine = (outcome: Outcome, ms: number, enforcing: boolean, onTimeout: OnTimeout): string =>
  `gate: the tool list check did not finish (${outcome === "no-budget" ? "this session has checked as many times as it will" : `no answer in ${ms}ms`}). ` +
  (enforcing && onTimeout === "refuse" ? "The call was not forwarded." : "The call was forwarded anyway.");
