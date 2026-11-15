/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT KIND OF THING IS THIS TOOL, GUESSED FROM ITS SHAPE.
 *
 * A reviewer facing 33 new tools reads them in some order, and the order
 * matters: `delete_published_social_post` deserves the attention that
 * `list_social_posts` does not. This puts a label on each one and an order
 * on the queue, from fixed rules over fixed vocabulary.
 *
 * NO MODEL, NO NETWORK, NO DESCRIPTION. The signals are the tool's NAME,
 * its PARAMETER NAMES, its ANNOTATIONS, and — for a schema that changed —
 * WHICH PARAMETERS ARE NEW. The description is not read, not matched, not
 * summarised and not printed: it is the field a hostile server controls
 * most cheaply, so a classifier that keyed on it would be the easiest part
 * of this project to fool.
 *
 * ── EVERY WORD IT PRINTS IS ITS OWN ──────────────────────────────────────
 *
 * A signal names the TOKEN FROM THE TABLES BELOW that matched, never the
 * string it matched against. So a server that names a parameter with a
 * paragraph of prose cannot get that paragraph into a report by being
 * classified: the report says `parameter matching "amount"`, and "amount"
 * is a word written here. A test holds every signal's `what` to this
 * file's own vocabulary.
 *
 * ── THE VERB IS NOT THE NOUN ─────────────────────────────────────────────
 *
 * `get_social_post` and `publish_social_post` share the token "post". One
 * reads and one writes, and a classifier that could not tell them apart
 * would be worthless on exactly the surface this project measures. So the
 * FIRST token is read as the verb, and later tokens as nouns, and a noun
 * that suggests sending, destroying or reaching out is DISCOUNTED when the
 * verb is a reading verb — reading about a post is not posting.
 *
 * Money and sensitive data are not discounted that way, because the object
 * is the point: reading a card number is still a card number.
 *
 * This is a judgement, written here so it can be argued with.
 *
 * ── THREE RULES THAT MAKE IT FAIL TOWARDS A PERSON ───────────────────────
 *
 *   1. A tool claiming `readOnlyHint` while taking risky parameters is
 *      ESCALATED, not believed. The claim is the server's; the parameters
 *      are what it will accept.
 *   2. Nothing matched means `unknown`, and unknown means review. It does
 *      not mean nothing to worry about.
 *   3. `read-only` is the lowest rank and is never a verdict that
 *      nothing can go wrong.
 *      Every assessment carries "inferred, not verified", and the only
 *      honest reading of the lowest rank is "nothing here suggested
 *      otherwise".
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { ItemKind } from "./decisions.ts";

/** The words that always travel with an assessment. */
export const INFERRED = "inferred, not verified";

export type Class =
  | "money"
  | "destructive"
  | "sensitive data"
  | "external message"
  | "exec/network"
  | "unknown"
  | "read-only";

/**
 * Triage order: what a reviewer reads first.
 *
 * `unknown` sits above `read-only` deliberately. A tool nothing could be
 * said about needs a person more than one that read as a reader does.
 */
export const CLASSES: Class[] = [
  "money",
  "destructive",
  "sensitive data",
  "external message",
  "exec/network",
  "unknown",
  "read-only",
];

/* ── The vocabulary ─────────────────────────────────────────────────────── */

/*
 * Tokens that count as a VERB when they are the first token of a name, and
 * as a noun elsewhere. Precision over recall: a word that fires on half a
 * catalogue tells a reviewer nothing, and a table tuned until its output
 * looked clever would be a table fitted to one server.
 */
const VERBS: Record<Class, string[]> = {
  money: ["pay", "charge", "refund", "invoice", "bill", "purchase", "buy", "sell", "checkout", "transfer", "withdraw", "deposit"],
  destructive: [
    "delete", "remove", "destroy", "drop", "truncate", "purge", "erase", "wipe", "rm", "unlink",
    "revoke", "terminate", "kill", "cancel", "disconnect", "reset", "overwrite", "prune", "clear", "archive",
  ],
  "sensitive data": ["decrypt", "reveal", "dump", "export", "impersonate", "authenticate", "login", "signin"],
  "external message": ["send", "post", "publish", "email", "mail", "sms", "tweet", "notify", "reply", "broadcast", "announce", "share", "comment", "dm", "message"],
  "exec/network": [
    "exec", "execute", "run", "spawn", "shell", "eval", "script", "fetch", "download", "upload",
    "request", "curl", "browse", "navigate", "connect", "proxy", "install", "deploy", "invoke", "call",
  ],
  unknown: [],
  "read-only": ["get", "list", "read", "show", "search", "find", "query", "describe", "view", "check", "inspect", "count", "has", "is", "analyze", "analyse"],
};

/*
 * Tokens that count wherever they appear in a name, and as parameter names.
 *
 * The two lists that are NOT discounted under a reading verb — money and
 * sensitive data — are the ones where the object carries the risk.
 */
const NOUNS: Record<Class, string[]> = {
  money: ["payment", "price", "amount", "balance", "currency", "card", "wallet", "subscription", "billing", "transaction", "fund", "payout", "order", "invoice", "credit"],
  destructive: ["force", "recursive", "permanent", "cascade", "hard", "irreversible"],
  "sensitive data": ["secret", "password", "passwd", "credential", "token", "apikey", "ssn", "pii", "cookie", "private", "keyfile", "certificate"],
  "external message": ["email", "mail", "sms", "tweet", "message", "post", "notification", "recipient", "audience", "subscriber"],
  "exec/network": ["url", "uri", "endpoint", "host", "hostname", "webhook", "command", "cmd", "argv", "shell", "socket", "port", "upload", "download"],
  unknown: [],
  "read-only": [],
};

/** Nouns whose class is discounted when the verb reads. See the header. */
const DISCOUNTED_UNDER_A_READING_VERB: Class[] = ["external message", "destructive", "exec/network"];

/** The annotation fields this reads, and nothing else. */
export const ANNOTATIONS = ["readOnlyHint", "destructiveHint", "openWorldHint"] as const;

/** Every token this file can print, for the test that holds it to its own words. */
export const VOCABULARY: string[] = [
  ...new Set([
    ...Object.values(VERBS).flat(),
    ...Object.values(NOUNS).flat(),
    ...ANNOTATIONS,
  ]),
];

/* ── Signals ────────────────────────────────────────────────────────────── */

export type Where = "name verb" | "name" | "parameter" | "new parameter" | "annotation" | "rule";

export interface Signal {
  where: Where;
  /**
   * The token from this file's own tables that matched, or an annotation's
   * field name, or a rule's name. NEVER the string it matched against.
   */
  what: string;
  /** What it was taken to mean. */
  says: Class | "escalated" | "discounted";
}

export interface Assessment {
  /** In triage order, never empty. */
  classes: Class[];
  signals: Signal[];
  /** The index in CLASSES of the first class: lower reads first. */
  rank: number;
  /** True when a person has to look: anything but a plain read. */
  review: boolean;
  /** The words, on every assessment, always. */
  inferred: typeof INFERRED;
}

/** A name into lowercase tokens: snake, kebab, dot and camel all split. */
export function tokensOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** The property names a schema declares, or none. */
export function parametersOf(schema: unknown): string[] {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return [];
  const props = (schema as Record<string, unknown>).properties;
  if (props === null || typeof props !== "object" || Array.isArray(props)) return [];
  return Object.keys(props as Record<string, unknown>);
}

/** The boolean annotations a definition declares, by field. */
function annotationsOf(definition: Record<string, unknown>): Partial<Record<(typeof ANNOTATIONS)[number], boolean>> {
  const a = definition.annotations;
  if (a === null || typeof a !== "object" || Array.isArray(a)) return {};
  const out: Partial<Record<(typeof ANNOTATIONS)[number], boolean>> = {};
  for (const f of ANNOTATIONS) {
    const v = (a as Record<string, unknown>)[f];
    if (typeof v === "boolean") out[f] = v;
  }
  return out;
}

const classesOf = (table: Record<Class, string[]>, token: string): Class[] =>
  CLASSES.filter((c) => table[c].includes(token));

export function rankOf(classes: Class[]): number {
  const ranks = classes.map((c) => CLASSES.indexOf(c)).filter((i) => i >= 0);
  return ranks.length ? Math.min(...ranks) : CLASSES.indexOf("unknown");
}

export interface ClassifyOptions {
  /** Parameter names that are new in this change, for an input-schema item. */
  addedParameters?: string[];
}

/**
 * Classify one tool.
 *
 * `definition` is as much of the tool as the caller has: a review queue
 * carries the whole thing for a new tool, a schema for a schema change,
 * and for a description change only the name — which is the weakest case
 * and says so, because the signals it returns are then all `name`.
 */
export function classify(definition: Record<string, unknown>, kind: ItemKind, opts: ClassifyOptions = {}): Assessment {
  const signals: Signal[] = [];
  const found = new Set<Class>();
  const name = typeof definition.name === "string" ? definition.name : "";
  const tokens = tokensOf(name);

  /* ── The verb ──────────────────────────────────────────────────────── */
  const verb = tokens[0] ?? "";
  const verbClasses = classesOf(VERBS, verb);
  const reads = verbClasses.includes("read-only");
  for (const c of verbClasses) {
    signals.push({ where: "name verb", what: verb, says: c });
    found.add(c);
  }

  /* ── The nouns ─────────────────────────────────────────────────────── */
  for (const token of tokens.slice(verbClasses.length ? 1 : 0)) {
    for (const c of [...classesOf(NOUNS, token), ...classesOf(VERBS, token)]) {
      if (c === "read-only") continue; /* a reading word in noun position says nothing */
      if (reads && DISCOUNTED_UNDER_A_READING_VERB.includes(c)) {
        signals.push({ where: "name", what: token, says: "discounted" });
        continue;
      }
      signals.push({ where: "name", what: token, says: c });
      found.add(c);
    }
  }

  /* ── The parameters ────────────────────────────────────────────────── */
  const added = new Set(opts.addedParameters ?? []);
  const params = parametersOf(definition.inputSchema);
  const risky = new Set<Class>();
  for (const p of params) {
    for (const token of tokensOf(p)) {
      for (const c of [...classesOf(NOUNS, token), ...classesOf(VERBS, token)]) {
        if (c === "read-only") continue;
        /* A parameter is what the tool ACCEPTS, so it is never discounted
         * by what the name says the tool does. */
        signals.push({ where: added.has(p) ? "new parameter" : "parameter", what: token, says: c });
        found.add(c);
        risky.add(c);
      }
    }
  }

  /* ── The annotations ───────────────────────────────────────────────── */
  const ann = annotationsOf(definition);
  if (ann.destructiveHint === true) {
    signals.push({ where: "annotation", what: "destructiveHint", says: "destructive" });
    found.add("destructive");
  }
  if (ann.openWorldHint === true) {
    signals.push({ where: "annotation", what: "openWorldHint", says: "exec/network" });
    found.add("exec/network");
  }
  if (ann.readOnlyHint === true) {
    signals.push({ where: "annotation", what: "readOnlyHint", says: "read-only" });
    /* Rule 1: the claim is the server's, the parameters are what it takes. */
    if (risky.size) {
      signals.push({ where: "rule", what: "readOnlyHint with risky parameters", says: "escalated" });
    } else if (!found.size) {
      found.add("read-only");
    }
  }

  /* ── The verdict ───────────────────────────────────────────────────── */
  const risky_classes = [...found].filter((c) => c !== "read-only");
  const classes = (risky_classes.length ? risky_classes : [...found]).sort(
    (a, b) => CLASSES.indexOf(a) - CLASSES.indexOf(b),
  );
  /* Rule 2: nothing matched is not nothing to worry about. */
  if (!classes.length) classes.push("unknown");
  void kind;
  return {
    classes,
    signals,
    rank: rankOf(classes),
    /* Rule 3: the lowest rank is not a pass. Only a plain read skips review. */
    review: !(classes.length === 1 && classes[0] === "read-only"),
    inferred: INFERRED,
  };
}

/** One line, for text output. Tokens from this file only; never a description. */
export function render(a: Assessment): string {
  const how = a.signals
    .filter((s) => s.says !== "discounted")
    .map((s) => `${s.where}: ${JSON.stringify(s.what)}`)
    .join("; ");
  return `${a.classes.join(", ")} — ${INFERRED}${how ? ` (${how})` : " (nothing matched)"}`;
}

/**
 * The order a queue is read in: by rank, then by the order given.
 *
 * Stable, so two items of one class keep the order they arrived in, and
 * nothing is reordered that the rank does not separate.
 */
export function triage<T extends { rank: number }>(items: T[]): T[] {
  return items.map((item, i) => ({ item, i })).sort((a, b) => a.item.rank - b.item.rank || a.i - b.i).map(({ item }) => item);
}
