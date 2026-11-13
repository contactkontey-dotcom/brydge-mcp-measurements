/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ASKING FOR A TOOL LIST THE CLIENT DID NOT ASK FOR.
 *
 * A description can change with no version bump, and a server says so with
 * notifications/tools/list_changed. Until now the gate only ever SAW that
 * notification: the re-check happened when the client next listed, and a
 * client that lists once at startup gives the gate one look.
 *
 * With --relist-on-change the gate sends a tools/list of its own when the
 * notification arrives. G4a is the groundwork: the flag, the identity of
 * the gate's own messages, and what happens when a client uses that
 * identity. Nothing is sent yet.
 *
 * ── THIS IS THE FIRST THING THE GATE SENDS BY ITSELF ─────────────────────
 *
 * Everything else it does is to a message somebody else wrote. A request of
 * its own is traffic the client never asked for and the server did not
 * expect, which is why it is behind a flag that is off unless somebody
 * types it, and why the flag says so on stderr when it is on. A gate that
 * started talking because of a config it inherited would be the opposite of
 * the point.
 *
 * ── THE IDS ARE STRINGS IN ONE NAMESPACE ─────────────────────────────────
 *
 * "brydge-gate/1", "brydge-gate/2", and so on. JSON-RPC allows a string id
 * and this is the one shape a client is least likely to collide with — but
 * "least likely" is not "cannot", and the whole gate depends on telling its
 * own answer apart from the client's. So a collision is not something to
 * hope about:
 *
 *   WITH THE FLAG ON, a client request carrying an id in this namespace
 *   ends the session. The gate cannot know whether an answer to that id is
 *   the client's or its own, and a gate that guesses could hand the client
 *   an answer to a question it never asked, or compare a tool list against
 *   a pin having read somebody else's reply.
 *
 *   WITH THE FLAG OFF the gate reserves nothing, so the same id is just a
 *   string. It is noted and nothing else happens: ending a working session
 *   over an id that matters to nobody would be the gate breaking a server
 *   for its own convenience.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** What the gate calls its own requests. */
export const RESERVED_PREFIX = "brydge-gate/";

/** The id for the nth request the gate sends. */
export function reservedId(n: number): string {
  return `${RESERVED_PREFIX}${n}`;
}

/**
 * Whether an id is one the gate reserves.
 *
 * Strings only, and only with the prefix. A number is never reserved: a
 * client using 1 or 2 is ordinary and must keep working. A string that
 * merely starts with the word is not enough either — the separator is part
 * of the prefix, so "brydge-gateway-3" is somebody else's id.
 */
export function isReservedId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(RESERVED_PREFIX);
}

/** The flag, and what it is called where a person reads it. */
export const FLAG = "--relist-on-change";

/**
 * One line on stderr when it is on, said once.
 *
 * It names what changes, because this is the gate sending something rather
 * than passing something on, and somebody reading a log should not have to
 * work out where an extra request came from.
 */
export const ANNOUNCEMENT =
  `gate: ${FLAG} is on. When the server says notifications/tools/list_changed, this gate sends a ` +
  `tools/list of its own and reads the answer, so a change is noticed without waiting for the client to ask. ` +
  `Those requests use ids beginning "${RESERVED_PREFIX}" and their answers are not passed to the client. ` +
  `Everything else goes through as it did.`;

/** Why a session is ending, when a client uses an id the gate reserves. */
export function collisionBecause(id: unknown, pinFile: string): string {
  return (
    `the client sent a request with id ${JSON.stringify(id)}, which is in the namespace this gate uses for its ` +
    `own requests while ${FLAG} is on. It cannot tell an answer to that id apart from an answer to its own, ` +
    `so it is not guessing. Run without ${FLAG}, or have the client use another id. Pin: ${pinFile}.`
  );
}

/**
 * Whether this client line is a request whose id the gate reserves.
 *
 * Only a REQUEST matters — something with both a method and an id, which is
 * a question the server will answer. A response from the client to a
 * server's request carries an id the server chose, and a notification
 * carries none.
 */
export function clientUsesReservedId(parsed: unknown): { id: unknown } | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const m = parsed as Record<string, unknown>;
  if (typeof m.method !== "string") return null;
  if (!("id" in m) || m.id === undefined) return null;
  return isReservedId(m.id) ? { id: m.id } : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * G4b: THE ASKING.
 *
 * On notifications/tools/list_changed the gate sends a tools/list of its
 * own, reads the answer, and does not pass that answer to the client. The
 * client never asked for it, so a response to it would be an answer to a
 * question the client never put.
 *
 * ── THE POLICY, AND WHY EACH PART OF IT ──────────────────────────────────
 *
 * NOT BEFORE THE CLIENT HAS FINISHED STARTING UP. The gate waits for the
 * client's notifications/initialized. A request before that arrives in the
 * middle of a handshake the gate is not part of, and a server within its
 * rights to refuse anything before initialization would refuse it.
 *
 * ONE AT A TIME. A second request while one is outstanding would make two
 * answers the gate has to tell apart for no gain: the second would be about
 * the same surface.
 *
 * A SECOND BETWEEN THEM, AND TWENTY IN A SESSION. Some servers send
 * list_changed in answer to a tools/list, and a gate that asked on every
 * notification would ping-pong with such a server for ever. The interval
 * makes a storm cost the gate nothing, and the cap is the end of it: at
 * twenty the gate stops asking, says so once, and goes back to comparing
 * the lists the client asks for. Standing down is not silent, because a
 * gate that quietly stopped looking would be worse than one that never
 * looked.
 *
 * FIVE SECONDS, AND NEVER IN THE WAY. If no answer comes the request is
 * forgotten and the next notification may ask again. Nothing the client
 * sends ever waits on any of this: the timeout is a timer, not a block.
 *
 * A PAGE IS NOT A SURFACE. An answer carrying nextCursor is part of a list,
 * and a tool that changed may be on a page the gate did not get — so it is
 * not compared at all. Under enforcement that is a surface the gate has not
 * read, and it says so rather than carrying on with a picture it knows is
 * incomplete.
 *
 * AN ERROR, OR AN ANSWER TO AN ID NOBODY SENT, IS NO INFORMATION. Noted,
 * and nothing changes. A server that will not answer this is a server whose
 * lists the gate reads when the client asks for them, as before.
 *
 * ── THE NAMESPACE IS THE GATE'S, IN BOTH DIRECTIONS ──────────────────────
 *
 * Nothing the server sends under a "brydge-gate/" id reaches the client —
 * not only the answers the gate is waiting for. A planted server answering
 * "brydge-gate/99", which this session never sent, used to be passed
 * straight through, which made the gate's own announcement false: it says
 * those answers do not reach the client, and one did. Worse, it is a way
 * for a server to send a client whatever it likes while wearing the gate's
 * name.
 *
 * So a server message carrying a reserved id is dropped whether the gate
 * sent that id or not, and the two cases are noted differently. A request
 * from the server under such an id is dropped too: a client answering it
 * would put a reserved id on the wire from the client's side, which is the
 * collision that ends a session, and a server should not be able to end
 * one by picking an id.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** At least this long between two requests of the gate's own. */
export const MIN_INTERVAL_MS = 1_000;
/** At most this many in one session. */
export const CAP = 20;
/** How long an answer has before the request is forgotten. */
export const TIMEOUT_MS = 5_000;

/** Why the gate did not ask, when it did not. */
export type Declined =
  | "the client has not finished starting up"
  | "one is already outstanding"
  | "the last one was less than a second ago"
  | "this session has asked as many times as it will";

export type Asked = { ask: true; id: string; payload: Buffer } | { ask: false; why: Declined };

export interface ListerOptions {
  now?: () => number;
}

/**
 * Decides whether to ask, and keeps track of what was asked.
 *
 * It holds no timers and sends nothing: it says what to do and the caller
 * does it. That is what makes the policy testable without a server.
 */
export class Lister {
  private readonly now: () => number;
  private started = false;
  private outstanding: { id: string; at: number } | null = null;
  private lastAt = 0;
  private count = 0;
  private saidCapped = false;
  /** Ids the gate has asked under, so an answer can be recognised. */
  private readonly mine = new Set<string>();

  constructor(opts: ListerOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  get asked(): number {
    return this.count;
  }

  get waiting(): string | null {
    return this.outstanding?.id ?? null;
  }

  /** The client's own messages, read only for notifications/initialized. */
  sawClient(parsed: unknown): void {
    if (!plainish(parsed)) return;
    if (parsed["method"] === "notifications/initialized") this.started = true;
  }

  /** Whether this server line is the notification that prompts a request. */
  isChangeNotice(parsed: unknown): boolean {
    return plainish(parsed) && parsed["method"] === "notifications/tools/list_changed" && parsed["id"] === undefined;
  }

  /**
   * Whether to ask now, and under which id.
   *
   * Only call it for a line `isChangeNotice` accepted: the count and the
   * interval are spent here.
   */
  consider(): Asked {
    if (!this.started) return { ask: false, why: "the client has not finished starting up" };
    this.forget();
    if (this.outstanding) return { ask: false, why: "one is already outstanding" };
    if (this.count >= CAP) return { ask: false, why: "this session has asked as many times as it will" };
    const at = this.now();
    if (this.lastAt && at - this.lastAt < MIN_INTERVAL_MS) {
      return { ask: false, why: "the last one was less than a second ago" };
    }
    const id = reservedId(++this.count);
    this.mine.add(id);
    this.outstanding = { id, at };
    this.lastAt = at;
    return { ask: true, id, payload: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }), "utf8") };
  }

  /** Drop an outstanding request that has run out of time. */
  forget(): string | null {
    if (!this.outstanding) return null;
    if (this.now() - this.outstanding.at < TIMEOUT_MS) return null;
    const id = this.outstanding.id;
    this.outstanding = null;
    return id;
  }

  /** Whether an id is one the gate asked under. */
  isMine(id: unknown): boolean {
    return typeof id === "string" && this.mine.has(id);
  }

  /** An answer came back. Returns true if it was the outstanding one. */
  settle(id: unknown): boolean {
    if (!this.isMine(id)) return false;
    if (this.outstanding?.id === id) this.outstanding = null;
    return true;
  }

  /** The cap's one line, said once, or null if it has been said. */
  capLine(): string | null {
    if (this.count < CAP || this.saidCapped) return null;
    this.saidCapped = true;
    return (
      `gate: this session has asked the server for a tool list ${CAP} times, which is as many as it will. ` +
      `It is no longer asking on notifications/tools/list_changed, and goes on comparing the lists the client asks for. ` +
      `A server sending that notification this often is worth a look.`
    );
  }
}

const plainish = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** One stderr line for a request the gate sent. */
export const askedLine = (id: string, because: string): string =>
  `gate: asked the server for a tool list of its own (${id}), because ${because}. The answer is not passed to the client.`;

/** One stderr line when it did not ask. */
export const declinedLine = (why: Declined): string =>
  `gate: did not ask the server for a tool list: ${why}.`;

/** One stderr line when an answer ran out of time. */
export const timedOutLine = (id: string): string =>
  `gate: no answer to the tool list this gate asked for (${id}) within ${TIMEOUT_MS / 1_000}s. Nothing changed; it may ask again.`;

/** One stderr line for an answer that was only a page of the list. */
export const partialLine = (id: string): string =>
  `gate: the answer to the tool list this gate asked for (${id}) carries a cursor, so it is one page and not the whole surface. ` +
  `It was not compared.`;

/**
 * One stderr line for a server message under one of the gate's ids that
 * this session never sent.
 *
 * Not an error: a server is free to send what it likes. It is recorded
 * because a server using the gate's namespace is worth knowing about, and
 * because the client did not get it.
 */
export const strangerLine = (id: string, what: string): string =>
  `gate: the server sent ${what} under id ${JSON.stringify(id)}, which is in this gate's namespace and is not an answer ` +
  `to anything it asked. It was not passed to the client.`;
