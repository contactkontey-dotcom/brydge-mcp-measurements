# agent-comms 8.15.22 — Level 1 measurement

Measured 2026-10-31. Asked for `agent-comms@8.15.22`. Instrument fingerprint `ca9170dfaeae`.

Published on npm as `agent-comms`. Its own manifest points at https://github.com/ExaDev/agent-comms, which is what the package says about itself and is not checked here.

**This is not a ranking of the most-used servers.** This package was measured because it appeared in a candidate list built from registry searches, and the order of those searches is not a measure of use.

**Level 1, and not calibration-backed.** No tool was called, so this report makes no claim about any tool doing what it says. The calibration that backs the ten curated measurements proves the instrument catches planted claims about what a tool *did*; Level 1 runs no such checks, and reads the package's own documentation by a stated rule rather than by a person, so nothing in that calibration speaks to this page.

## In plain words

We installed `agent-comms 8.15.22` from the npm registry, started it in a room with no route to the internet, where every website name answers to this machine and every credential is fake, and asked it to list its tools without calling any of them. Before any tool was used it offered 1 tool, looked up 1 website, started 2 programs and wrote 0 files; of those, 0 tools and 1 website are not named in its own README. We called no tool and read the contents of no encrypted connection, so this page says nothing about whether any of its tools does what it says.

## The standard this report uses

**A website counts as declared only if the README names it.**

A sentence about connecting somewhere, without the address, names no website. A tool counts as documented only if its name appears in the README as a whole word. Each question is asked once per thing observed, so what the README documents is never worked out from what the program offered — which is the only way "offered but not documented" can be found at all.

The host rule is loose in one direction, and it is better to say so: it reads any dotted name whose last part is two or more letters, so a filename written in prose can read as a website. That can only make the declared list longer and leave something out of the findings below. It cannot put something in.

## What it did at startup, before any tool was used

It started and identified itself as `agent-comms 1.1.0`.

| | |
| --- | --- |
| Websites it looked up | `registry.npmjs.org` |
| Encrypted connections it opened | `registry.npmjs.org` |
| Other addresses it tried | none |
| Programs it started | `agent-comms`, `node`, `setpriv` |
| Files it wrote | none |
| Package-manager commands it ran | none |
| Tools it offered | 1 |

`setpriv` in that list is the harness's own launcher, not the package's doing.

Nothing left the machine. The room it runs in has no route off the host, so every name resolved to the loopback address and no connection completed. What it would have sent is therefore unknown — and what it would have sent over an encrypted connection would be unknown even with a route, which is a limit of the method rather than of this run.

## Tools it offers, against its own README

It offered 1 tool. 1 of them is named in `README.md`.

Every tool it offered is named in the README.

## Websites it reached for, against its own README

It reached for 1 website. 1 of them is not named anywhere in `README.md`:

- **registry.npmjs.org**
  - looked up "registry.npmjs.org" during the run; answered 127.0.0.1, so nothing left the machine
  - opened TLS with SNI "registry.npmjs.org"; the bytes are encrypted and were not seen
  - absent from README.md (592 lines, sha256 285239cbace8…): the README does not contain this hostname

## Names in the README that it did not offer

25 names written in backticks in the README look like a tool name and were not among the tools it offered. A README mentions plenty of things that are not tools, so this is a weaker signal than the two above and is listed rather than counted as a finding:

- `delivery_status` — README.md line 359: `… a direct connection or the relay hub admitting the device, and the sender is told through the same 'delivery_status' event that carries read receipts. The queue is bounded both by how many messages i…`
- `dm_admit` — README.md line 361: `To let a device DM you without deciding on the spot, admit it ahead of time. 'dm_admit' with that device's id returns a grant and the exact call to make with it; the sender then calls 'dm_use_grant' w…`
- `dm_revoke` — README.md line 361: `…t' with your device id and the grant, and their first DM goes through with no decision at your end. 'dm_revoke' withdraws it. A grant only works for the device it was minted for, unless you pass 'prin…`
- `dm_use_grant` — README.md line 361: `…it' with that device's id returns a grant and the exact call to make with it; the sender then calls 'dm_use_grant' with your device id and the grant, and their first DM goes through with no decision a…`
- `gateway_list_trusted` — README.md line 367: `…ned with the user key beside the membership proof, and shown next to the principal id (in 'whoami', 'gateway_list_trusted' and the "vouched for by" column) only when it verifies against the principal …`
- `gateway_redeem_connection_code` — README.md line 580: `…shorter with '--ttl-minutes <n>' but not longer. Redeeming it trusts the issuing device, exactly as 'gateway_redeem_connection_code' does, then asks that device for the account key over the mesh's end…`
- `gateway_trust` — README.md line 529: `…lf normally has to be learned out of band (Slack, email, a phone call) before it can be pasted into 'gateway_trust'. A connection code is a single-use, short-lived artifact that makes that hand-off it…`
- `lan_web_uis` — README.md line 339: `The other bridges on the network hear those beacons. 'lan_web_uis' lists every neighbouring web UI heard this way, each as a ready-to-open 'http://<address>:<port>' URL beside the full peer id and its…`
- `list_agents` — README.md line 93: `… it is and which host it runs on. 'whoami' shows them as the 'Principal:' and 'Machine:' lines, and 'list_agents' groups agents under the machine that vouches for each, this machine first; an agent no…`
- `list_rooms` — README.md line 390: `| 'public'  | Listed in 'list_rooms' | Anyone      | Anyone       |`
- `machine_name` — README.md line 367: `An agent names itself with 'register' and 'update'. A machine names itself with 'machine_name', which every bridge the account runs on the host then signs with the machine key and gossips beside its m…`
- `member_joined` — README.md line 404: `…it receives a 'room_members' delivery event listing all current members with their status. Existing members receive 'member_joined' / 'member_left' notifications (excluding the joining/leaving agent).`
- `member_left` — README.md line 404: `…it receives a 'room_members' delivery event listing all current members with their status. Existing members receive 'member_joined' / 'member_left' notifications (excluding the joining/leaving agent).`
- `member_status` — README.md line 422: `When an agent's status changes (active / idle / busy / offline), all rooms it belongs to receive a 'member_status' notification. This covers:`
- `message_read` — README.md line 475: `…when 'onDelivery' is called (push bridges: pi, Claude Code) or when 'drainDelivery' is called (drain bridges: MCP, Codex, OpenCode). Cross-peer read receipts propagate via a 'message_read' mesh patch.`
- `node_modules` — README.md line 122: `…-coding-agent'. A '@mariozechner' host at '0.73.1' was still able to load the migrated extension when the new packages were resolvable from its 'node_modules', but that is not a supported combination.`
- `petname_set` — README.md line 384: `…racters, and free of control characters. 'register', 'update', 'machine_name', 'principal_name' and 'petname_set' refuse a name that breaks those rules, an agent that gossips one is not listed, and an…`
- `principal_name` — README.md line 367: `… it; what the name says is still the machine's own claim. An account names itself the same way with 'principal_name': the name is kept in 'user-identity.json', signed with the user key beside the memb…`
- `room_accept` — README.md line 213: `A session reached only through cc-peer has no agent-comms tool, so it can't call 'room_accept' or 'room_reject'. When a room join or a first-contact DM is waiting on it, the relayed message says which…`
- `room_join_request` — README.md line 355: `…ss before anything is sent: the call waits while the recipient's agent is told about the request (a 'room_join_request' event, listed by 'room_pending') and answers it with 'room_accept' or 'room_reje…`
- …and 5 more

## What this report does not say

- **It judges no tool.** Level 1 calls none, so no claim any tool makes is tested here.
- **It is one run, once.** A program that behaves one way while being watched and another way otherwise would produce this same page.
- **It ran with no route off the machine**, so anything that only happens after a connection succeeds did not happen.
- **Encrypted traffic was not read.** The name it asked for is recorded; the contents are not, and would not be even with a route.
- **"Declared" means named in the README**, nothing more. Only the README file that shipped in the package was read. A package that documents its tools or its destinations somewhere else — a reference file beside the README, a privacy policy, a wiki, its source — will show every one of them above as not named, which is a fact about this rule and not about the package.
- **It is not calibration-backed**, for the reason at the top.
- **It is not a ranking.** No page here says a server is more used, better or worse than another, and the set measured is whatever the candidate searches returned.
- **The harness is BRYDGE's own**, and BRYDGE has an interest in the question of whether tools do what they say.

Evidence: `README.md` (592 lines, sha256 `285239cbace8`), package integrity `sha512-HnACJpxgWzRNd0ReI…`.
