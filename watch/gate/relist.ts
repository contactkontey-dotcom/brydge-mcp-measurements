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
