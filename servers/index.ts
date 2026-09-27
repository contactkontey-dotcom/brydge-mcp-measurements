import type { ServerSpec } from "../harness/types.ts";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REAL SERVERS. ONE SPEC EACH: WHAT IT DECLARES, WHAT IT IS GIVEN, WHICH
 * CALLS ARE MADE, AND WHAT MUST THEN BE TRUE.
 *
 * Filled in once the harness is calibrated. Each entry is the whole of what a
 * server's page rests on, and it is published with the page so a reader can
 * disagree with any line of it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const SERVERS: ServerSpec[] = [];
