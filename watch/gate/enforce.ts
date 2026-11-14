/*
 * ═══════════════════════════════════════════════════════════════════════════
 * HIDING, AND NOT FORWARDING. ONLY WHEN SOMEBODY ASKS FOR IT.
 *
 * Shadow is the default and stays the default. Everything here happens only
 * under `--mode enforce`, which somebody has to type.
 *
 * ── THE ONE MESSAGE THAT IS REWRITTEN, AND ONLY WHEN IT MUST BE ──────────
 *
 * A tools/list result with something hidden in it is the only message this
 * rewrites. Every other byte in both directions is forwarded as it arrived,
 * and a tools/list result with NOTHING hidden is forwarded as it arrived
 * too — re-serialising it would change key order and spacing for no reason,
 * and a client that sees different bytes with the gate in front of an
 * approved server would be reading the gate rather than the server. That is
 * also what makes the test possible: with everything approved, enforce is
 * byte-for-byte what the server said.
 *
 * ── WHAT A REFUSAL MAY NOT CONTAIN ───────────────────────────────────────
 *
 * A refusal is read by a MODEL. It used to end with "To approve it: run
 * node watch/cli.ts gate approve --pending <report> …", which is the gate
 * handing the model the command for undoing the gate — a file path, a flag
 * and all. A model trying to be helpful has every reason to run it.
 *
 * So nothing a client can read carries a command, a file path or a flag.
 * Not the refusal, not the data beside it, not the message for a tool list
 * this cannot read. What it says instead is what happened, why, and that
 * the person running the client is the one who decides. The instructions
 * for approving go to stderr and to the report, which a person reads and a
 * model is not given.
 *
 * A test builds every message this module can send to a client and refuses
 * any of them that carries a path, a flag, a file name or a command.
 *
 * ── A REFUSAL SAYS WHO REFUSED ───────────────────────────────────────────
 *
 * "the gate did not forward this call" — not an unknown-tool error, which
 * would be the gate lying about what the server offers, and never a word
 * that claims the action was stopped somewhere. The gate did not forward a
 * message. The server is still running, still has whatever access it had,
 * and anything else talking to it can still call that tool.
 *
 * A client that listed the tools before enforcement started may call one
 * that is hidden now. Its refusal says the tool was hidden rather than
 * pretending it never existed, because the client is not wrong — it did see
 * it. A tool the SERVER has stopped offering says that instead.
 *
 * ── TWO SHAPES FOR THE SAME SENTENCE ─────────────────────────────────────
 *
 * `error` is a JSON-RPC error and is the default: it is the honest shape,
 * because the request was not carried out. Some clients turn a protocol
 * error into a transport failure or a retry loop and the model never reads
 * the sentence, so `result` puts the same words in a tool result with
 * `isError` true — the shape a server uses to tell a model that a call went
 * wrong. Which one a client handles better is a question for a test on a
 * real client, not one to guess at, so both exist and neither is assumed.
 *
 * Only a tools/call refusal has the two shapes. A tool list that cannot be
 * read is a failure of tools/list, which has no result shape that can carry
 * an error, so that one is always a protocol error.
 *
 * ── FAIL CLOSED, AND WHAT THAT COSTS ─────────────────────────────────────
 *
 * A tool list this cannot read means a list it cannot gate, so the client
 * gets an error for that request instead of an ungated list; the session
 * carries on. A batch can carry a tools/list or a tools/call inside an
 * array where this cannot reach them, so in enforce mode it stops the
 * session rather than wave it through. Both say the file and the command.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { Line } from "./transport.ts";
import { toolsOf, type WouldHide } from "./router.ts";
import { ADOPTED, type Pin } from "./pin.ts";

/** The sentence a refusal always opens with. */
export const DID_NOT_FORWARD = "the gate did not forward this call";

/** What the gate calls itself in anything a client can read. */
export const GATE = "brydge-gate";

/**
 * Not -32601 and not -32602.
 *
 * Those are "no such method" and "bad parameters", which is what a server
 * says about a tool it does not have. This is a different fact — the server
 * has it and the gate did not pass the message on — and borrowing the
 * server's code for it would make the gate indistinguishable from the
 * server being asked for something that is not there.
 */
export const REFUSAL_CODE = -32000;

export type Why =
  | { kind: "hidden"; because: WouldHide["because"] }
  | { kind: "withdrawn" }
  /** The surface is not known: a list the gate asked for came back partial. */
  | { kind: "unread"; because: string };

/**
 * The shape a refused tools/call comes back in.
 *
 * "error" is a JSON-RPC error: the request was not carried out, and that is
 * what an error means. "result" is a tool result with isError true, which
 * is how a server tells a model a call went wrong — the same words, in the
 * shape a model is more likely to be shown.
 */
export type RefusalStyle = "error" | "result";
export const REFUSAL_STYLES: RefusalStyle[] = ["error", "result"];
export const DEFAULT_REFUSAL_STYLE: RefusalStyle = "error";

export interface Action {
  /** Forward the line as it arrived. */
  forward: boolean;
  /** Bytes to put on the wire instead, without a newline. */
  replaceWith?: Buffer;
  /** Bytes to send back to the CLIENT instead of forwarding to the server. */
  replyToClient?: Buffer;
  /** Stop: the reason, already said in full. */
  stop?: string;
}

const pass: Action = { forward: true };
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export interface EnforcerOptions {
  /**
   * The pin file. Named only in what goes to stderr — a reason the session
   * is ending, which a person reads — and never in anything sent to a
   * client.
   */
  pinFile: string;
  /** The shape of a refused tools/call. Defaults to an error. */
  refusalStyle?: RefusalStyle;
  /** Called when a list is rewritten, for the one stderr line. */
  onHide?: (hidden: WouldHide[], shown: number) => void;
  /** Called when a call is refused. */
  onRefuse?: (tool: string, why: Why) => void;
  /** Called when something fails closed. */
  onFailClosed?: (because: string) => void;
}

/**
 * Decides what to do with each line, in enforce mode.
 *
 * It is told what the router found rather than finding it again: one
 * comparison, in one place.
 */
export class Enforcer {
  /** Tool names currently hidden, by the reason they are hidden. */
  private hidden = new Map<string, WouldHide["because"]>();
  /** Every tool name the server has offered in this session. */
  private everOffered = new Set<string>();
  /** The names in the most recent list the server answered. */
  private offeredNow = new Set<string>();
  /** Client request ids that asked for a tools/list, to their method. */
  private readonly inFlight = new Map<string, { method: string; tool: string | null }>();
  private sawList = false;
  /** Why the surface is not known, while it is not. */
  private unread: string | null = null;

  private readonly opts: EnforcerOptions;

  /*
   * Written out rather than declared in the parameter list: a parameter
   * property is TypeScript that has to be compiled away, and the tests run
   * this file as source under a runtime that only strips types.
   */
  constructor(opts: EnforcerOptions) {
    this.opts = opts;
  }

  get hiddenCount(): number {
    return this.hidden.size;
  }

  /**
   * The gate asked for a tool list and got back one page of it.
   *
   * A tool that changed may be on a page the gate did not get, so the
   * picture it has is one it knows to be incomplete. Under enforcement
   * that is not something to carry on with: until a whole list arrives,
   * calls are not passed on. `noteList` clears it, because a complete list
   * is what it was waiting for.
   */
  cannotReadSurface(because: string): void {
    this.unread = because;
  }

  get surfaceUnread(): string | null {
    return this.unread;
  }

  /** What the router decided about one list, taken as the state to enforce. */
  noteList(records: Array<{ name: string }>, hidden: WouldHide[]): void {
    this.unread = null;
    this.sawList = true;
    this.offeredNow = new Set(records.map((r) => r.name));
    for (const n of this.offeredNow) this.everOffered.add(n);
    this.hidden = new Map(hidden.map((h) => [h.tool, h.because]));
  }

  /* ── Client to server ─────────────────────────────────────────────────── */

  fromClient(line: Line): Action {
    if (line.parsed === null) return pass;
    if (Array.isArray(line.parsed)) return this.stopOnBatch(line.parsed.length, "from the client");
    if (!plain(line.parsed)) return pass;

    const message = line.parsed;
    const method = typeof message.method === "string" ? message.method : null;
    const id = message.id;
    if (!method || id === undefined) return pass;

    const tool = method === "tools/call" ? nameOf(message.params) : null;
    this.inFlight.set(keyOf(id), { method, tool });
    if (method !== "tools/call" || tool === null) return pass;

    const why = this.whyRefused(tool);
    if (!why) return pass;
    this.opts.onRefuse?.(tool, why);
    return { forward: false, replyToClient: this.refusal(id, tool, why) };
  }

  /**
   * Whether a call would be forwarded, and why not.
   *
   * A tool nobody has listed yet is forwarded: until the server has answered
   * a tools/list there is nothing to compare it against, and refusing on a
   * guess would break a client that calls before it lists.
   */
  whyRefused(tool: string): Why | null {
    /*
     * Before anything about one tool: if the gate has not read the whole
     * surface, it does not know whether THIS tool is one of the ones that
     * changed. Failing closed here is the only answer that is not a guess.
     */
    if (this.unread) return { kind: "unread", because: this.unread };
    if (!this.sawList) return null;
    const because = this.hidden.get(tool);
    if (because) return { kind: "hidden", because };
    if (this.everOffered.has(tool) && !this.offeredNow.has(tool)) return { kind: "withdrawn" };
    return null;
  }

  /** The refusal, as the client will read it. */
  /**
   * The sentence, which is the same whichever shape carries it.
   *
   * No command, no path, no flag: a model reads this. It says what
   * happened, why, and who decides — and that retrying is not the way,
   * because a model that reads a refusal as a temporary failure will try
   * again, which is the loop this is meant not to cause.
   */
  sentence(tool: string, why: Why): string {
    if (why.kind === "unread") {
      return (
        `${DID_NOT_FORWARD}: ${why.because}, so the gate has not read what the server is offering now ` +
        `and cannot tell whether "${tool}" is one of the tools that changed. It is not passing calls on until it has. ` +
        `The person running this client can see what happened in the gate's own output.`
      );
    }
    return why.kind === "withdrawn"
      ? `${DID_NOT_FORWARD}: the server is no longer offering "${tool}". It was in an earlier tool list in this session and is not in the current one.`
      : `${DID_NOT_FORWARD}: "${tool}" is hidden, because ${why.because}. ` +
        `If your client listed the tools before it was hidden, it may still be showing it. ` +
        `Retrying will not change it, and there is nothing here for you to fix: ` +
        `the person running this client decides what is approved, and the gate has written down what differs for them.`;
  }

  refusal(id: unknown, tool: string, why: Why): Buffer {
    const said = this.sentence(tool, why);
    const reason =
      why.kind === "withdrawn" ? "no longer offered by the server" : why.kind === "unread" ? "the tool list has not been read in full" : why.because;
    /* Said as data as well as in words, because a client that shows only a
     * code and a field should still be able to show who refused. */
    const data = { gate: GATE, tool, reason, didNotForward: true };

    if ((this.opts.refusalStyle ?? DEFAULT_REFUSAL_STYLE) === "result") {
      /*
       * A tool result, not an error. `content` first and `isError` after it,
       * because that is the order a server writes them in and a client
       * reading the stream positionally should find nothing unusual.
       *
       * `_meta` rather than a top-level field: a result may carry _meta and
       * a client that does not know this gate ignores it, where an invented
       * sibling of `content` is a result shape nothing else produces.
       */
      return Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: said }],
            isError: true,
            _meta: { [`${GATE}/didNotForward`]: data },
          },
        }),
        "utf8",
      );
    }

    return Buffer.from(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: REFUSAL_CODE, message: said, data } }),
      "utf8",
    );
  }

  /* ── Server to client ─────────────────────────────────────────────────── */

  fromServer(line: Line): Action {
    if (line.parsed === null) return pass;
    if (Array.isArray(line.parsed)) return this.stopOnBatch(line.parsed.length, "from the server");
    if (!plain(line.parsed)) return pass;

    const message = line.parsed;
    const id = message.id;
    if (id === undefined || typeof message.method === "string") return pass;
    const asked = this.inFlight.get(keyOf(id));
    if (!asked) return pass;
    this.inFlight.delete(keyOf(id));
    if (asked.method !== "tools/list") return pass;
    if (message.error !== undefined) return pass;

    const read = toolsOf(message.result);
    if ("because" in read) {
      /* A list this cannot read is a list it cannot gate. The client gets an
       * error for that one request rather than an ungated list, and the
       * session carries on. */
      const because = `a tools/list this cannot read: ${read.because}`;
      this.opts.onFailClosed?.(because);
      return {
        forward: false,
        replyToClient: Buffer.from(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: {
              code: REFUSAL_CODE,
              message:
                `the gate did not forward this tool list: ${read.because}. ` +
                `It cannot hide what it cannot read, so it passed nothing on. ` +
                `The person running this client can see what happened in the gate's own output.`,
              data: { gate: GATE, reason: because, didNotForward: true },
            },
          }),
          "utf8",
        ),
      };
    }

    if (!this.hidden.size) return pass; /* nothing to take out: the server's own bytes go on */

    const kept = read.tools.filter((t) => !this.hidden.has(String(t.name)));
    if (kept.length === read.tools.length) return pass;

    const result = { ...(message.result as Record<string, unknown>), tools: kept };
    const out = Buffer.from(JSON.stringify({ ...message, result }), "utf8");
    this.opts.onHide?.(
      [...this.hidden.entries()].map(([tool, because]) => ({ tool, because })) as WouldHide[],
      kept.length,
    );
    return { forward: false, replaceWith: out };
  }

  private stopOnBatch(n: number, where: string): Action {
    const because =
      `a batch of ${n} message(s) ${where}: a tools/list or a tools/call inside an array is somewhere ` +
      `this cannot reach, so it cannot hide or refuse one. Pin: ${this.opts.pinFile}.`;
    this.opts.onFailClosed?.(because);
    return { forward: false, stop: because };
  }
}

const keyOf = (id: unknown): string => (typeof id === "string" ? `s:${id}` : `n:${String(id)}`);

/** The tool a tools/call names, or null. */
export function nameOf(params: unknown): string | null {
  if (!plain(params)) return null;
  return typeof params.name === "string" && params.name ? params.name : null;
}

/** The line stderr gets once, when enforcement is on. */
export function enforcingLine(pin: Pin, pinFile: string): string {
  const tools = Object.values(pin.tools);
  const approved = tools.filter((t) => t.how === "approve").length;
  /*
   * The count, not only the pin's own label.
   *
   * A pin adopted from a server and then approved item by item keeps
   * `source: adopted, not reviewed` — which is true of how the pin began
   * and gets less true with every approval. Saying "4 tools, 1 approved"
   * is the whole of it, where the label alone told somebody who had just
   * approved something that nothing had been reviewed.
   */
  const how =
    pin.source === ADOPTED
      ? approved
        ? `, taken from what the server offered and ${ADOPTED}, of which ${approved} now carr${approved === 1 ? "ies" : "y"} a decision`
        : `, taken from what the server offered and ${ADOPTED}`
      : `, of which ${approved} carr${approved === 1 ? "ies" : "y"} a decision`;
  return (
    `gate: enforcing against ${tools.length} pinned tool(s) for ${pin.package}@${pin.packageVersion}${how}. ` +
    `Tools that differ from ${pinFile} are not passed to the client, and calls to them are not forwarded. ` +
    `The server is running and this does not change what it can reach.`
  );
}

/** The line stderr gets each time a list is rewritten. */
export function hidLine(hidden: WouldHide[], shown: number): string {
  const by: Record<string, number> = {};
  for (const h of hidden) by[h.because] = (by[h.because] ?? 0) + 1;
  const kinds = Object.entries(by)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([because, n]) => `${n} ${because}`)
    .join("; ");
  return `gate: did not pass ${hidden.length} tool(s) to the client (${kinds}); ${shown} passed on.`;
}
