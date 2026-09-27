/*
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS METHOD CANNOT ESTABLISH. PRINTED ON EVERY PAGE, CARRIED IN EVERY
 * RESULT FILE, AND NEVER EDITED DOWN FOR A PARTICULAR SERVER.
 *
 * A measurement that lists only what it found is an advertisement. These are
 * the things a reader must hold against every green tick on every page. They
 * are data, not prose, so the page cannot quietly show fewer of them than the
 * result file admits to.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface Limit {
  id: string;
  says: string;
}

export const LIMITS: Limit[] = [
  { id: "not-safe", says: "This cannot show a server is safe. It can show particular claims held or did not, on the calls we made, this once. A server that behaves one way when measured and another way otherwise would pass." },
  { id: "offline", says: "The server runs with no route off the machine — only loopback. So it exercises what a server does WITHOUT a network: nothing that needs a real destination runs, and code that only runs after a connection succeeds never runs here." },
  { id: "encrypted-unseen", says: "We see every destination a server aims at and the full contents of anything it sends in plaintext on port 80. What it would send over TLS is encrypted; we see the name it asked for, not the bytes. A secret sent over HTTPS to a real server would not be caught by content." },
  { id: "native-env", says: "Environment reads by the server's own JavaScript or Python are attributed to the line that made them. Reads by native code or by a subprocess are seen as file opens and process starts, but the individual variable a native read touched is not always visible." },
  { id: "no-model", says: "There is no model in the loop. A tool is called with fixed arguments and its effect is checked. This measures the tool, not an agent's judgement about when to call it." },
  { id: "our-reading", says: "\"Claims\" and \"declares\" are our readings of a server's own words, quoted so you can check them. Where a maintainer means something different, our reading is what is wrong, and the quote is there to show it." },
  { id: "not-a-sample", says: "These servers were chosen, not sampled. They skew toward ones that install cleanly and need no account. There is no ranking and no score: a page is about one server against its own claims, not against the others." },
  { id: "ours-and-interested", says: "The harness is ours, and BRYDGE is an interested party in the subject of whether tools do what they say. The calibration catches planted lies of the kinds we thought of; it cannot catch a kind we did not plant." },
  { id: "detectable", says: "A server that detected the sandbox — the empty home, the loopback-only network, the traced syscalls — could behave differently while watched. Nothing here defeats a server built to notice it is being measured." },
];
