/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT A TOOL NOW ACCEPTS, AND WHAT IT NO LONGER DOES.
 *
 * Both diffs here already answer whether an input schema moved: one hash
 * against another, or one canonical string against another. Neither says
 * what moved, and "the input schema changed" in front of somebody deciding
 * whether to approve a new version is a question, not an answer.
 *
 * ── TWO LAYERS, AND NOTHING FALLS BETWEEN THEM ───────────────────────────
 *
 * The first layer names the kinds a reader can act on: a parameter arrived
 * or went, one became required or stopped being, a type changed, enum
 * values arrived or went.
 *
 * The second layer is `differingPointers` from watch/tools.ts, pointed at
 * the input schema rather than at `extra`. It is value-generic and already
 * tested, and it answers the question the first layer cannot: every other
 * leaf at which the two schemas differ. Each of those pointers is then
 * matched against the named kinds, and any that no kind explains is
 * reported as its own line.
 *
 * That subtraction is the whole design. A schema diff that named six kinds
 * and stopped would be silent about a seventh nobody had thought of, and
 * silence here reads as "nothing else changed".
 *
 * ── THE PROSE IN A SCHEMA IS NOT PRINTED ─────────────────────────────────
 *
 * A JSON Schema carries `description`, `title` and `$comment`, and those
 * are somebody's writing, same as a tool's own description. This module
 * reports THAT the wording at a pointer changed, and how long each side is.
 * It does not print either side. A reviewer who wants to read one hands the
 * two strings to watch/words.ts, which is built to show text; this module
 * is built to describe a shape, and a shape description that quietly
 * included 400 characters of somebody's prose would be the thing that
 * published it.
 *
 * ── IT READS NOTHING ─────────────────────────────────────────────────────
 *
 * Schemas in, findings out. No node:fs, no path, no capture. Same rule as
 * watch/words.ts and checked the same way.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { canonical, differingPointers, escapePointer } from "./tools.ts";

/*
 * The kinds a reader can act on, plus the three that exist so nothing goes
 * unreported: wording, which is named but never quoted; a difference no kind
 * explains; and a schema that is on one side only.
 */
export type Kind =
  | "parameter added"
  | "parameter removed"
  | "now required"
  | "no longer required"
  | "type changed"
  | "enum values added"
  | "enum values removed"
  | "wording changed"
  | "differs"
  | "input schema arrived"
  | "input schema removed";

/** The order findings print in: what a caller acts on first, first. */
export const KIND_ORDER: Kind[] = [
  "input schema arrived",
  "input schema removed",
  "parameter removed",
  "parameter added",
  "now required",
  "no longer required",
  "type changed",
  "enum values removed",
  "enum values added",
  "wording changed",
  "differs",
];

export interface Change {
  kind: Kind;
  /** JSON Pointer into the input schema, RFC 6901, as watch/tools.ts writes them. */
  pointer: string;
  /** The same place in the words a schema's author would use, or null. */
  parameter: string | null;
  /** Values worth naming — a type, an enum member, a pair of lengths. Never prose. */
  detail: string | null;
  /** True when the pointer names a subtree because the pointer walk hit its cap. */
  atCap: boolean;
}

export interface SchemaDiff {
  changes: Change[];
  before: { present: boolean };
  after: { present: boolean };
  identical: boolean;
  /** Differing pointers that no named kind accounted for. */
  unexplained: number;
  /** Pointers the walk reached in total. */
  pointers: number;
}

/* ── Finding the parameters ─────────────────────────────────────────────── */

/*
 * Where a schema holds another schema.
 *
 * Only the keywords that appear in the tool schemas this project has
 * actually seen, plus the combinators. A keyword missing from here is not
 * skipped: the parameter walk does not reach it, so its contents stay with
 * `differingPointers`, which walks every key there is, and surface as an
 * unexplained pointer. Unnamed, never unreported.
 */
const CHILD_MAP = ["properties", "patternProperties", "$defs", "definitions"] as const;
const CHILD_ONE = ["items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames"] as const;
const CHILD_LIST = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;

/** How deep the parameter walk goes before it stops and says so. */
export const WALK_DEPTH = 8;

/*
 * The pointer walk's cap for a schema, deep enough to reach anything the
 * parameter walk can name.
 *
 * A parameter at walk depth d has a pointer 2d segments long, and a keyword
 * on it — `/type`, `/enum` — one more. So 2·WALK_DEPTH + 2 is past every
 * pointer a named kind can produce, and a capped ancestor can therefore only
 * ever cover ground no named kind reached. That is what keeps one change
 * from printing twice: named once, and again as an ancestor the naming did
 * not match. The default cap of 6 is tuned to `_meta`, and at 6 a type
 * change three parameters down did exactly that.
 */
export const SCHEMA_POINTER_DEPTH = 2 * WALK_DEPTH + 2;

export interface Param {
  pointer: string;
  parameter: string;
  node: Record<string, unknown>;
  /** True when the schema that holds this one lists it in `required`. */
  required: boolean;
  atCap: boolean;
}

const plain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Every parameter a schema declares, by pointer.
 *
 * `parameter` is the pointer said the way an author would: `options.retries`
 * for a nested property, `[]` for the schema of an array's items, `anyOf[0]`
 * for a branch. It is for reading; the pointer is what is compared.
 */
export function walkSchema(schema: unknown): { params: Map<string, Param>; required: Map<string, string[]> } {
  const out = new Map<string, Param>();
  const requiredAt = new Map<string, string[]>();
  const walk = (node: unknown, pointer: string, parameter: string, depth: number): void => {
    if (!plain(node)) return;
    const atCap = depth >= WALK_DEPTH;
    const list = Array.isArray(node.required) ? node.required.filter((x): x is string => typeof x === "string") : null;
    if (Array.isArray(node.required)) requiredAt.set(pointer, list ?? []);
    const required = new Set(list ?? []);
    for (const key of CHILD_MAP) {
      const holder = node[key];
      if (!plain(holder)) continue;
      for (const [name, child] of Object.entries(holder)) {
        const p = `${pointer}/${escapePointer(key)}/${escapePointer(name)}`;
        const label = parameter ? `${parameter}.${name}` : name;
        out.set(p, {
          pointer: p,
          parameter: label,
          node: plain(child) ? child : {},
          required: key === "properties" && required.has(name),
          atCap,
        });
        if (!atCap) walk(child, p, label, depth + 1);
      }
    }
    if (atCap) return;
    for (const key of CHILD_ONE) {
      if (!(key in node)) continue;
      const label = key === "items" ? `${parameter}[]` : `${parameter ? parameter + "." : ""}${key}`;
      walk(node[key], `${pointer}/${escapePointer(key)}`, label, depth + 1);
    }
    for (const key of CHILD_LIST) {
      const list = node[key];
      if (!Array.isArray(list)) continue;
      list.forEach((child, i) =>
        walk(child, `${pointer}/${escapePointer(key)}/${i}`, `${parameter ? parameter + "." : ""}${key}[${i}]`, depth + 1),
      );
    }
  };
  walk(schema, "", "", 0);
  return { params: out, required: requiredAt };
}

/** Every parameter a schema declares, by pointer. */
export const paramsOf = (schema: unknown): Map<string, Param> => walkSchema(schema).params;

/**
 * Every `required` array a schema declares, by the pointer of the schema
 * that holds it.
 *
 * Kept because a `required` array differs for four distinct reasons, and
 * three of them are already named elsewhere: a parameter arrived as a
 * required one, a parameter that was required went, or an existing one
 * changed state. The fourth is a requirement naming a parameter the schema
 * does not declare, which no other kind here would ever reach.
 */
export const requiredOf = (schema: unknown): Map<string, string[]> => walkSchema(schema).required;

/* ── Naming a value without quoting prose ───────────────────────────────── */

/** `description`, `title`, `$comment`: named, never printed. */
const PROSE = new Set(["description", "title", "$comment"]);

const typeOf = (node: Record<string, unknown>): string => {
  const t = node.type;
  if (t === undefined) return "(no type)";
  if (Array.isArray(t)) return t.map((x) => String(x)).join(" or ");
  return String(t);
};

/** One enum member, short enough to print, with its length when clipped. */
export function memberOf(v: unknown): string {
  const text = JSON.stringify(v) ?? "null";
  return text.length <= 40 ? text : `${text.slice(0, 40)}… (${text.length} characters)`;
}

const enumOf = (node: Record<string, unknown>): string[] | null =>
  Array.isArray(node.enum) ? node.enum.map((v) => canonical(v)) : null;

const lengthOf = (v: unknown): string =>
  typeof v === "string" ? `${v.length} character${v.length === 1 ? "" : "s"}` : v === undefined ? "none" : "not text";

/* ── The comparison ─────────────────────────────────────────────────────── */

const absent = (v: unknown) => v === null || v === undefined;

/** The value at a JSON Pointer, or undefined. Pointers come from our own walk. */
function at(root: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return root;
  let node: unknown = root;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(node)) node = node[Number(key)];
    else if (plain(node)) node = node[key];
    else return undefined;
  }
  return node;
}

/**
 * What changed between two input schemas.
 *
 * Both arguments are whatever the server sent for `inputSchema`, including
 * nothing at all: a tool that gained or lost a schema is a different fact
 * from one whose schema was edited, and both are reported.
 */
export function schemaDiff(a: unknown, b: unknown): SchemaDiff {
  const before = { present: !absent(a) };
  const after = { present: !absent(b) };
  const identical = canonical(a ?? null) === canonical(b ?? null);
  const base: SchemaDiff = { changes: [], before, after, identical, unexplained: 0, pointers: 0 };
  if (identical) return base;

  if (!before.present || !after.present) {
    return {
      ...base,
      changes: [
        {
          kind: before.present ? "input schema removed" : "input schema arrived",
          pointer: "/",
          parameter: null,
          detail: before.present
            ? "the first version declared one and the second declares none"
            : "the first version declared none and the second declares one",
          atCap: false,
        },
      ],
      pointers: 1,
    };
  }

  const A = paramsOf(a);
  const B = paramsOf(b);
  const changes: Change[] = [];
  /* Pointers a named kind accounts for: exact, or a whole subtree. */
  const exact = new Set<string>();
  const subtrees: string[] = [];
  /* Differences found by the required pass that no named kind covers. */
  let unexplainedExtra = 0;

  for (const [pointer, p] of A) {
    if (B.has(pointer)) continue;
    changes.push({ kind: "parameter removed", pointer, parameter: p.parameter, detail: typeOf(p.node), atCap: p.atCap });
    subtrees.push(pointer);
  }
  for (const [pointer, p] of B) {
    if (A.has(pointer)) continue;
    changes.push({
      kind: "parameter added",
      pointer,
      parameter: p.parameter,
      detail: `${typeOf(p.node)}${p.required ? ", required" : ""}`,
      atCap: p.atCap,
    });
    subtrees.push(pointer);
  }
  for (const [pointer, x] of A) {
    const y = B.get(pointer);
    if (!y) continue;
    if (x.required !== y.required) {
      changes.push({
        kind: y.required ? "now required" : "no longer required",
        pointer,
        parameter: x.parameter,
        detail: null,
        atCap: x.atCap || y.atCap,
      });
      /* The holder's `required` array is accounted for by the pass below,
       * which enumerates every name in or out of it. */
    }
    if (typeOf(x.node) !== typeOf(y.node)) {
      changes.push({
        kind: "type changed",
        pointer: `${pointer}/type`,
        parameter: x.parameter,
        detail: `${typeOf(x.node)} -> ${typeOf(y.node)}`,
        atCap: x.atCap || y.atCap,
      });
      exact.add(`${pointer}/type`);
    }
    const ex = enumOf(x.node);
    const ey = enumOf(y.node);
    if (canonical(ex) !== canonical(ey)) {
      const gone = (ex ?? []).filter((v) => !(ey ?? []).includes(v));
      const came = (ey ?? []).filter((v) => !(ex ?? []).includes(v));
      const say = (xs: string[]) => xs.map((v) => memberOf(JSON.parse(v))).join(", ");
      if (gone.length) {
        changes.push({ kind: "enum values removed", pointer: `${pointer}/enum`, parameter: x.parameter, detail: say(gone), atCap: x.atCap });
      }
      if (came.length) {
        changes.push({ kind: "enum values added", pointer: `${pointer}/enum`, parameter: x.parameter, detail: say(came), atCap: x.atCap });
      }
      /* An enum that only reordered has no member in or out, and the
       * pointer is still explained: it is reported as its own line below
       * rather than left to read as a membership change. */
      if (!gone.length && !came.length) {
        changes.push({
          kind: "differs",
          pointer: `${pointer}/enum`,
          parameter: x.parameter,
          detail: `the same ${(ey ?? []).length} values in a different order`,
          atCap: x.atCap,
        });
      }
      exact.add(`${pointer}/enum`);
    }
  }

  /*
   * ── THE REQUIRED ARRAYS, NAME BY NAME ────────────────────────────────
   *
   * A `required` array differs for four reasons and three are named above:
   * a parameter arrived already required, a required parameter went, or one
   * that stayed changed state. Blanket-marking the array as explained would
   * have been the easy fix and would have dropped the fourth — a
   * requirement naming a parameter the schema does not declare — along with
   * a reorder and a repeated name. So every name in and out is accounted
   * for, and only then is the array marked explained.
   *
   * The first draft marked nothing: a required parameter simply ARRIVING
   * left `/required` to come out as an unexplained difference beside the
   * "parameter added — string, required" line that had already said it.
   */
  const RA = requiredOf(a);
  const RB = requiredOf(b);
  for (const holder of [...new Set([...RA.keys(), ...RB.keys()])].sort()) {
    const xs = RA.get(holder) ?? [];
    const ys = RB.get(holder) ?? [];
    if (canonical(RA.get(holder) ?? null) === canonical(RB.get(holder) ?? null)) continue;
    const gone = xs.filter((n) => !ys.includes(n));
    const came = ys.filter((n) => !xs.includes(n));
    const declared = (name: string, side: Map<string, Param>) =>
      side.has(`${holder}/properties/${escapePointer(name)}`);
    for (const [names, side, verb] of [
      [came, B, "requires"],
      [gone, A, "required"],
    ] as const) {
      for (const name of names) {
        /* Named already: the parameter exists on that side, so either it
         * arrived (and its line says "required") or its state changed. */
        if (declared(name, side)) continue;
        changes.push({
          kind: "differs",
          pointer: `${holder}/required`,
          parameter: null,
          detail: `${verb} "${name}", which the schema on that side does not declare as a parameter`,
          atCap: false,
        });
        unexplainedExtra++;
      }
    }
    if (!gone.length && !came.length) {
      changes.push({
        kind: "differs",
        pointer: `${holder}/required`,
        parameter: null,
        detail:
          RA.has(holder) !== RB.has(holder)
            ? `the required list is on one side only and names the same ${ys.length || xs.length} parameter(s)`
            : `the same ${ys.length} name(s), listed in a different order or repeated`,
        atCap: false,
      });
      unexplainedExtra++;
    }
    exact.add(`${holder}/required`);
  }

  /* ── Everything else, from the one pointer walk ───────────────────────── */

  const named = (p: string) => exact.has(p) || subtrees.some((s) => p === s || p.startsWith(`${s}/`));
  const all = differingPointers(a, b, "", 0, SCHEMA_POINTER_DEPTH);
  let unexplained = 0;
  for (const { pointer, atCap } of all) {
    if (named(pointer)) continue;
    const last = pointer.split("/").pop() ?? "";
    if (PROSE.has(last)) {
      const where = pointer.replace(/\/[^/]+$/, "");
      const p = B.get(where) ?? A.get(where);
      changes.push({
        kind: "wording changed",
        pointer,
        parameter: p ? p.parameter : null,
        detail: `${lengthOf(at(a, pointer))} -> ${lengthOf(at(b, pointer))}, not printed here`,
        atCap,
      });
      continue;
    }
    unexplained++;
    const where = pointer.replace(/\/[^/]+$/, "");
    const p = B.get(where) ?? A.get(where);
    changes.push({ kind: "differs", pointer, parameter: p ? p.parameter : null, detail: null, atCap });
  }

  changes.sort(
    (x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || x.pointer.localeCompare(y.pointer),
  );
  return { ...base, changes, unexplained: unexplained + unexplainedExtra, pointers: all.length };
}

/* ── Printing it ────────────────────────────────────────────────────────── */

/** The one sentence that has to sit under any schema diff that printed. */
export const PROSE_WITHHELD =
  "Where the wording in a schema changed, its length is given and its text is not: " +
  "the text is the schema author's writing, and this says what the shape does.";

/** The findings as text. Facts and kinds; no reading of what any of it is for. */
export function renderSchemaDiff(d: SchemaDiff, label = "input schema"): string {
  const out: string[] = [];
  if (d.identical) {
    out.push(`${label}: the two are the same schema.`);
    return out.join("\n");
  }
  const n = d.changes.length;
  out.push(`${label}: ${n} difference${n === 1 ? "" : "s"}.`);
  out.push("");
  let kind: Kind | null = null;
  for (const c of d.changes) {
    if (c.kind !== kind) {
      kind = c.kind;
      out.push(`${kind}:`);
    }
    const bits = [c.parameter ? c.parameter : c.pointer];
    if (c.detail) bits.push(c.detail);
    out.push(`  ${bits.join(" — ")}`);
    if (c.parameter) out.push(`      at ${c.pointer}${c.atCap ? " (the walk stopped here; this names a subtree)" : ""}`);
    else if (c.atCap) out.push(`      (the walk stopped here; this names a subtree)`);
  }
  out.push("");
  if (d.unexplained) {
    out.push(
      `${d.unexplained} of ${d.pointers} differing place${d.pointers === 1 ? "" : "s"} is not one of the kinds above ` +
        `and is listed under "differs" by pointer.`,
    );
  }
  out.push(PROSE_WITHHELD);
  return out.join("\n");
}
