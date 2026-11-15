/*
 * ═══════════════════════════════════════════════════════════════════════════
 * TAKING ONE FIELD OUT OF A MESSAGE WITHOUT TOUCHING ANY OTHER BYTE.
 *
 * Under enforcement, an `instructions` string that differs from the pin is
 * not passed to the client. The obvious way to remove it — parse the
 * message, delete the key, serialise again — is not the identity on the
 * rest of the message: 9007199254740993 comes back as ...992, 1.0 as 1,
 * -0 as 0, and keys move. The id is the one that matters most, because a
 * client matches the answer to its request by it and this project has
 * watched a real client use 0 as one.
 *
 * So this does not parse and rebuild. It scans the raw bytes for the
 * top-level `"instructions"` key inside `result`, and returns the message
 * with exactly one contiguous span cut out of it: that key, its value, and
 * the one comma that joined it to its neighbour. Everything else is the
 * server's bytes, in the server's order, untouched — and a test holds that
 * by putting the span back and comparing.
 *
 * ── FAIL CLOSED WHEN THE SCAN IS NOT SURE ─────────────────────────────────
 *
 * The scanner knows enough JSON to step over any value — strings with their
 * escapes, numbers, literals, nested arrays and objects — and no more. It
 * refuses, by name, when the message is not one object, when `result` is
 * not an object, when `result` has no `instructions` key, when it has more
 * than one (JSON allows it; parsers disagree about which wins), or when
 * anything in the bytes is not the JSON it expects. A refusal here is the
 * caller's signal to stop the session rather than forward the message:
 * guessing at which bytes to cut is how a gate corrupts a message, and a
 * corrupted first message is worse than a session that ends saying why.
 *
 * ── WHY ONLY `result.instructions` ────────────────────────────────────────
 *
 * A key named "instructions" anywhere else — inside `serverInfo`, inside a
 * tool's `_meta`, inside a string — is somebody else's and is left alone.
 * The scanner tracks depth, and only a key at depth two directly under the
 * top-level `result` counts.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type Excised =
  | {
      ok: true;
      /** The message with the span removed. No trailing newline. */
      bytes: Buffer;
      /** The span that was removed: [start, end) in the original. */
      removed: { start: number; end: number };
    }
  | { ok: false; because: string };

/** The field this removes. One, named, so the scanner cannot be pointed elsewhere by accident. */
export const FIELD = "instructions";

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const LBRACE = 0x7b;
const RBRACE = 0x7d;
const LBRACKET = 0x5b;
const RBRACKET = 0x5d;
const COLON = 0x3a;
const COMMA = 0x2c;

const isWs = (b: number) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;

/** Index of the first non-whitespace byte at or after `i`, or buf.length. */
function skipWs(buf: Buffer, i: number): number {
  while (i < buf.length && isWs(buf[i]!)) i++;
  return i;
}

/**
 * The index just past a JSON string starting at `i` (which must be a quote).
 *
 * Escapes are stepped over as pairs; `\u` escapes as six bytes. A string
 * that does not close is a failure, reported as -1.
 */
function skipString(buf: Buffer, i: number): number {
  if (buf[i] !== QUOTE) return -1;
  i++;
  while (i < buf.length) {
    const b = buf[i]!;
    if (b === BACKSLASH) {
      const next = buf[i + 1];
      if (next === undefined) return -1;
      /* \uXXXX */
      if (next === 0x75) {
        i += 6;
        continue;
      }
      i += 2;
      continue;
    }
    if (b === QUOTE) return i + 1;
    i++;
  }
  return -1;
}

/**
 * The index just past one JSON value starting at `i`, or -1.
 *
 * Numbers and literals are taken as a run of the bytes they can contain,
 * which is enough to find where they end; this is not a validator.
 */
function skipValue(buf: Buffer, i: number): number {
  i = skipWs(buf, i);
  if (i >= buf.length) return -1;
  const b = buf[i]!;
  if (b === QUOTE) return skipString(buf, i);
  if (b === LBRACE || b === LBRACKET) {
    const close = b === LBRACE ? RBRACE : RBRACKET;
    i++;
    for (;;) {
      i = skipWs(buf, i);
      if (i >= buf.length) return -1;
      if (buf[i] === close) return i + 1;
      if (b === LBRACE) {
        /* key : value */
        const afterKey = skipString(buf, i);
        if (afterKey < 0) return -1;
        i = skipWs(buf, afterKey);
        if (buf[i] !== COLON) return -1;
        i = skipValue(buf, i + 1);
      } else {
        i = skipValue(buf, i);
      }
      if (i < 0) return -1;
      i = skipWs(buf, i);
      if (buf[i] === COMMA) {
        i++;
        continue;
      }
      if (buf[i] === close) return i + 1;
      return -1;
    }
  }
  /* number, true, false, null: a run of the bytes those can be made of */
  let j = i;
  while (j < buf.length && /[-+0-9.eEtrufalsn]/.test(String.fromCharCode(buf[j]!))) j++;
  return j > i ? j : -1;
}

/** Decode a JSON string's bytes to its value, for comparing a key. */
function keyOf(buf: Buffer, start: number, end: number): string | null {
  try {
    return JSON.parse(buf.subarray(start, end).toString("utf8")) as string;
  } catch {
    return null;
  }
}

interface Member {
  /** Where the key's opening quote is. */
  keyStart: number;
  /** Just past the value. */
  valueEnd: number;
  /** The key, decoded. */
  key: string;
}

/**
 * The members of the object starting at `i`, in order, or why not.
 *
 * Reads one level only. Nested values are stepped over, not entered.
 */
function membersOf(buf: Buffer, i: number): { members: Member[]; end: number } | { because: string } {
  i = skipWs(buf, i);
  if (buf[i] !== LBRACE) return { because: "not an object" };
  i++;
  const members: Member[] = [];
  for (;;) {
    i = skipWs(buf, i);
    if (i >= buf.length) return { because: "the object does not close" };
    if (buf[i] === RBRACE) return { members, end: i + 1 };
    const keyStart = i;
    const afterKey = skipString(buf, i);
    if (afterKey < 0) return { because: "a key is not a string" };
    const key = keyOf(buf, keyStart, afterKey);
    if (key === null) return { because: "a key could not be decoded" };
    i = skipWs(buf, afterKey);
    if (buf[i] !== COLON) return { because: `no colon after key ${JSON.stringify(key)}` };
    const valueEnd = skipValue(buf, i + 1);
    if (valueEnd < 0) return { because: `the value of ${JSON.stringify(key)} could not be read` };
    members.push({ keyStart, valueEnd, key });
    i = skipWs(buf, valueEnd);
    if (buf[i] === COMMA) {
      i++;
      continue;
    }
    if (buf[i] === RBRACE) return { members, end: i + 1 };
    return { because: `unexpected byte after the value of ${JSON.stringify(key)}` };
  }
}

/**
 * The message with `result.instructions` removed, or why it could not be.
 *
 * `raw` is one JSON-RPC message, without its newline. Nothing is parsed
 * into objects: the bytes outside the removed span are returned as they
 * were.
 */
export function exciseInstructions(raw: Buffer): Excised {
  const top = membersOf(raw, 0);
  if ("because" in top) return { ok: false, because: `the message is not one JSON object: ${top.because}` };
  /* Anything after the closing brace but whitespace is not one message. */
  if (skipWs(raw, top.end) !== raw.length) return { ok: false, because: "there are bytes after the message's closing brace" };

  const results = top.members.filter((m) => m.key === "result");
  if (results.length !== 1) return { ok: false, because: `the message has ${results.length} "result" member(s), not one` };
  const result = results[0]!;

  /* Where the result's value begins: after its key and colon. */
  let v = skipString(raw, result.keyStart);
  v = skipWs(raw, v);
  if (raw[v] !== COLON) return { ok: false, because: 'no colon after "result"' };
  const inner = membersOf(raw, v + 1);
  if ("because" in inner) return { ok: false, because: `"result" is not an object: ${inner.because}` };

  const hits = inner.members.filter((m) => m.key === FIELD);
  if (hits.length === 0) return { ok: false, because: `"result" has no ${JSON.stringify(FIELD)} member` };
  if (hits.length > 1) return { ok: false, because: `"result" has ${hits.length} ${JSON.stringify(FIELD)} members; which one a client reads is not defined` };
  const hit = hits[0]!;
  const idx = inner.members.indexOf(hit);

  /*
   * THE SPAN. From the key to the end of the value, plus one comma.
   *
   * If a member follows, take the comma after this value and the
   * whitespace up to the next key, so what remains reads `..., "next"`.
   * If this is the last member and one precedes it, take the comma BEFORE
   * it and the whitespace before the key instead, so what remains reads
   * `"prev": 1}`. If it is the only member, take the key and value alone
   * and `{}` is what remains, whitespace and all.
   */
  let start = hit.keyStart;
  let end = hit.valueEnd;
  if (idx < inner.members.length - 1) {
    const comma = skipWs(raw, end);
    if (raw[comma] !== COMMA) return { ok: false, because: "no comma after the member" };
    end = inner.members[idx + 1]!.keyStart;
  } else if (idx > 0) {
    const prevEnd = inner.members[idx - 1]!.valueEnd;
    const comma = skipWs(raw, prevEnd);
    if (raw[comma] !== COMMA) return { ok: false, because: "no comma before the member" };
    start = comma;
  }
  return {
    ok: true,
    bytes: Buffer.concat([raw.subarray(0, start), raw.subarray(end)]),
    removed: { start, end },
  };
}

/* ── Taking tools out of a tools/list result ──────────────────────────────── */

/*
 * THE SAME IDEA FOR AN ARRAY. A tools/list result whose `tools` array holds
 * a hidden tool used to be parsed, filtered and serialised again — which is
 * how an id of 9007199254740993 came back as ...992 on exactly the message
 * a client matches to its request. Now each hidden element is cut out of
 * the bytes with the one comma that joined it, and every other byte stays.
 *
 * A tool is identified by the `name` member of its element, decoded from
 * its bytes — the caller has already decided WHICH names are hidden from a
 * parsed copy; this finds WHERE they are. The two readings have to agree:
 * an element whose name cannot be read, or that has two, is a message this
 * cannot cut without guessing, and the caller stops rather than forwards.
 */

export type ToolsExcised =
  | {
      ok: true;
      /** The message with every hidden element removed and every replacement spliced in. */
      bytes: Buffer;
      /** The spans removed, in order, [start, end) in the original. */
      removed: Array<{ start: number; end: number }>;
      /** Elements left in the array, replacements included. */
      kept: number;
      /** The spans replaced, [start, end) in the original, with what went in. */
      inserted: Array<{ start: number; end: number; bytes: number }>;
    }
  | { ok: false; because: string };

/** The index just past `"key"` `:` for the top-level member named `key`, or -1. */
function valueStartOf(raw: Buffer, m: Member): number {
  let v = skipString(raw, m.keyStart);
  v = skipWs(raw, v);
  return raw[v] === COLON ? v + 1 : -1;
}

/**
 * The elements of the array starting at `i`, one level, or why not.
 */
function elementsOf(buf: Buffer, i: number): { elements: Array<{ start: number; end: number }>; end: number } | { because: string } {
  i = skipWs(buf, i);
  if (buf[i] !== LBRACKET) return { because: "not an array" };
  i++;
  const elements: Array<{ start: number; end: number }> = [];
  for (;;) {
    i = skipWs(buf, i);
    if (i >= buf.length) return { because: "the array does not close" };
    if (buf[i] === RBRACKET) return { elements, end: i + 1 };
    const start = i;
    const end = skipValue(buf, i);
    if (end < 0) return { because: `element ${elements.length + 1} could not be read` };
    elements.push({ start, end });
    i = skipWs(buf, end);
    if (buf[i] === COMMA) {
      i++;
      continue;
    }
    if (buf[i] === RBRACKET) return { elements, end: i + 1 };
    return { because: `unexpected byte after element ${elements.length}` };
  }
}

/**
 * The message with every element of `result.tools` whose name is in
 * `hidden` removed, or why it could not be done.
 *
 * With nothing to remove the message comes back unchanged and `removed` is
 * empty; a caller then forwards the original bytes.
 */
export function exciseTools(raw: Buffer, hidden: ReadonlySet<string>): ToolsExcised {
  return rewriteTools(raw, hidden, new Map());
}

/**
 * The same, and also REPLACING elements with a definition of our own.
 *
 * `replace` maps a tool name to the definition to put in its place —
 * the pin's, when the lane is serving an approved version across a change.
 * The replacement is serialised once and spliced in; every byte outside
 * the spliced span is the server's, in the server's order, which is what
 * the cuts already promise and what a test holds both to.
 *
 * THIS IS THE ONE PLACE THE GATE PUTS BYTES ON THE WIRE THAT NO SERVER
 * SENT. Every other rewrite in this file is subtractive. A reader deciding
 * whether to trust the result should know which of the two it is looking
 * at, so the spliced spans come back in `inserted`.
 */
export function rewriteTools(
  raw: Buffer,
  hidden: ReadonlySet<string>,
  replace: ReadonlyMap<string, Record<string, unknown>>,
): ToolsExcised {
  const top = membersOf(raw, 0);
  if ("because" in top) return { ok: false, because: `the message is not one JSON object: ${top.because}` };
  if (skipWs(raw, top.end) !== raw.length) return { ok: false, because: "there are bytes after the message's closing brace" };
  const results = top.members.filter((m) => m.key === "result");
  if (results.length !== 1) return { ok: false, because: `the message has ${results.length} "result" member(s), not one` };
  const rv = valueStartOf(raw, results[0]!);
  if (rv < 0) return { ok: false, because: 'no colon after "result"' };
  const inner = membersOf(raw, rv);
  if ("because" in inner) return { ok: false, because: `"result" is not an object: ${inner.because}` };
  const toolsMembers = inner.members.filter((m) => m.key === "tools");
  if (toolsMembers.length !== 1) return { ok: false, because: `"result" has ${toolsMembers.length} "tools" member(s), not one` };
  const tv = valueStartOf(raw, toolsMembers[0]!);
  if (tv < 0) return { ok: false, because: 'no colon after "tools"' };
  const arr = elementsOf(raw, tv);
  if ("because" in arr) return { ok: false, because: `"tools" is not an array: ${arr.because}` };

  /* Which elements go, and which are replaced, by the decoded name of each. */
  const going: number[] = [];
  const replacing = new Map<number, Record<string, unknown>>();
  for (const [idx, el] of arr.elements.entries()) {
    const members = membersOf(raw, el.start);
    if ("because" in members) return { ok: false, because: `tool ${idx + 1} is not an object: ${members.because}` };
    const names = members.members.filter((m) => m.key === "name");
    if (names.length !== 1) return { ok: false, because: `tool ${idx + 1} has ${names.length} "name" member(s), not one` };
    const nv = valueStartOf(raw, names[0]!);
    if (nv < 0) return { ok: false, because: `tool ${idx + 1}: no colon after "name"` };
    const ns = skipWs(raw, nv);
    const ne = skipString(raw, ns);
    if (ne < 0) return { ok: false, because: `tool ${idx + 1}: its name is not a string` };
    const name = keyOf(raw, ns, ne);
    if (name === null) return { ok: false, because: `tool ${idx + 1}: its name could not be decoded` };
    if (hidden.has(name)) going.push(idx);
    else {
      const instead = replace.get(name);
      if (instead) replacing.set(idx, instead);
    }
  }
  if (!going.length && !replacing.size) return { ok: true, bytes: raw, removed: [], kept: arr.elements.length, inserted: [] };

  /*
   * THE SPANS. Each removed element takes one comma with it: the one after
   * it when a kept element follows, otherwise the one before it. Computed
   * against the ORIGINAL positions, and applied from the back so earlier
   * offsets stay true. Runs of adjacent removed elements collapse into one
   * span, so that "the comma after" is the comma before the next KEPT
   * element and not one that is itself being removed.
   */
  const goingSet = new Set(going);
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < arr.elements.length) {
    if (!goingSet.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < arr.elements.length && goingSet.has(j + 1)) j++;
    /* elements i..j go */
    let start = arr.elements[i]!.start;
    let end = arr.elements[j]!.end;
    if (j + 1 < arr.elements.length) {
      /* a kept element follows: take the comma and whitespace up to it */
      const comma = skipWs(raw, end);
      if (raw[comma] !== COMMA) return { ok: false, because: "no comma after a removed tool" };
      end = arr.elements[j + 1]!.start;
    } else if (i > 0) {
      /* last elements go, a kept one precedes: take the comma before */
      const prevEnd = arr.elements[i - 1]!.end;
      const comma = skipWs(raw, prevEnd);
      if (raw[comma] !== COMMA) return { ok: false, because: "no comma before a removed tool" };
      start = comma;
    }
    spans.push({ start, end });
    i = j + 1;
  }
  /*
   * The edits: a cut is a span replaced by nothing, a lane element is a
   * span replaced by the pin's definition. They cannot overlap — a cut
   * span ends at the start of the next KEPT element, and a replaced
   * element is kept — so applying them in order is enough.
   */
  const inserted: Array<{ start: number; end: number; bytes: number }> = [];
  const edits: Array<{ start: number; end: number; with: Buffer }> = spans.map((s) => ({ ...s, with: Buffer.alloc(0) }));
  for (const [idx, definition] of [...replacing.entries()].sort((a, b) => a[0] - b[0])) {
    const el = arr.elements[idx]!;
    const bytes = Buffer.from(JSON.stringify(definition), "utf8");
    edits.push({ start: el.start, end: el.end, with: bytes });
    inserted.push({ start: el.start, end: el.end, bytes: bytes.length });
  }
  edits.sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i]!.start < edits[i - 1]!.end) {
      return { ok: false, because: "two edits to the tool list overlap, so the list was not changed" };
    }
  }
  const parts: Buffer[] = [];
  let cursor = 0;
  for (const e of edits) {
    parts.push(raw.subarray(cursor, e.start), e.with);
    cursor = e.end;
  }
  parts.push(raw.subarray(cursor));
  return { ok: true, bytes: Buffer.concat(parts), removed: spans, kept: arr.elements.length - going.length, inserted };
}
