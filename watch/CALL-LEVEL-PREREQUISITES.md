# Before any tool is called: resource limits

A prerequisite for the call-level diff. **Not built, and nothing here is
wired to anything.** It is written down so the gap is on the record rather
than in a conversation.

## What the room has today

`harness/session.ts` builds the sealed room, and for a run that only lists
tools it is enough:

- `unshare -n -m` — its own network namespace (loopback only) and its own
  mounts
- `/etc/resolv.conf` bound to a loopback-only resolver
- `/home` replaced with an empty tmpfs
- planted credentials and files, so what the server was given is known
- `setpriv --reuid 996 --regid 995 --clear-groups` — an unprivileged user
- `strace -ff -ttt` over `open`, `openat`, `creat`, `execve`, `connect`
- a filesystem snapshot before and after **every** call
- `callTimeoutSeconds`, 60 by default

## What it does not have

**No resource limits of any kind.** `grep -rn "RLIMIT\|prlimit\|ulimit\|
setrlimit\|cgroup"` over `harness/`, `engine/` and `level1/` returns
nothing, and `setpriv` is invoked with `--reuid`, `--regid` and
`--clear-groups` only.

That is survivable while the only thing asked of a server is `initialize`
and `tools/list`: a server that misbehaves at startup does so before it has
been given anything to work with, and the timeout ends it.

It stops being survivable the moment a tool is **called** with arguments.
Then arbitrary code runs on arbitrary input, and the four ways that ends
badly are not hypothetical:

| | what happens now |
|---|---|
| allocates without bound | the host's memory, not the sandbox's |
| forks without bound | the host's process table |
| writes without bound | the host's disk — and the disk floor that protects a measurement is checked **before** a run, not during one |
| spins | a core for the whole 60-second timeout, times however many calls run in parallel |

The namespaces isolate the **network** and the **mounts**. They do not
isolate CPU, memory, processes or disk, and nothing else here does either.

## What to add, before the first call

Set on the measured process, not on the harness:

- `RLIMIT_AS` — address space
- `RLIMIT_NPROC` — processes and threads
- `RLIMIT_FSIZE` — the largest file one call may write
- `RLIMIT_CPU` — a hard ceiling under the wall-clock timeout, so a spinning
  call is killed by the kernel and not waited out
- `RLIMIT_NOFILE` — open descriptors
- `RLIMIT_CORE` 0 — a dump of a large process fills a disk for no reason

`setpriv` cannot set these. The two honest routes are a cgroup v2 slice for
the namespace, or a small `prlimit` wrapper between `setpriv` and the
server. The cgroup also gives a usage figure afterwards, which a `prlimit`
wrapper does not.

## Tested: an outer wrapper does it, and the fingerprint is untouched

This section replaces what stood here before, which was wrong. It said the
limits meant changing `harness/session.ts`, which is inside the instrument
fingerprint, and therefore cost a recalibration and a re-measure of all 67.
That was reasoning, not a test. Tested, **the recalibration cost is zero.**

Everything below was measured in this container, through the exact chain the
room uses: `unshare -n -m` → `strace` → `setpriv --reuid 996`.

**rlimits propagate and enforce.** Neither `unshare`, `strace` nor `setpriv`
resets them, so a `prlimit` around the whole run reaches the measured server:

| limit | propagates | enforces |
|---|---|---|
| `RLIMIT_NPROC` | yes | 14 forks succeeded of 60 attempted at a cap of 15 |
| `RLIMIT_FSIZE` | yes | killed at exactly the cap, 1048576 bytes written of 4 MB |
| `RLIMIT_CPU` | yes | visible in the server's own `/proc/self/limits` |
| `RLIMIT_NOFILE` | yes | visible in the server's own `/proc/self/limits` |

**`RLIMIT_NPROC` is uid-scoped, which is exactly the shape wanted.** It is
counted per real uid and root is exempt through `CAP_SYS_RESOURCE`: at a cap
of 15, root forked 60 of 60 while uid 996 managed 14. So one outer limit
constrains the measured server and leaves the harness's own `npm install`
alone.

**Proved end to end on a real measurement.** `prlimit --nproc=3` →
"could not start at initialize" on both runs of `wikipedia-mcp@1.0.3`;
`--nproc=128` → 2 tools measured. The limit reaches the server, not just the
harness, and npm install was untouched either way. A full measure passes
under `--nproc=128 --fsize=2147483648 --cpu=900 --nofile=4096`.

**`RLIMIT_AS` is the wrong knob and must not be used.** It caps *virtual*
address space, and Node's TypeScript stripper runs on WebAssembly, which
reserves a large range regardless of what it uses. Measured: a `.ts`
entrypoint fails at 8 GB of address space and works at 16 GB. A cap low
enough to constrain a server kills the harness before it parses its own
entry file, with `RangeError: WebAssembly.Instance(): Out of memory`.

**Memory is a cgroup, and v1 is what this container has.** The v2 tree is
mounted but `cgroup.controllers` is EMPTY, so `mkdir` under it succeeds and
the files are inert — `memory.max` accepts a write and `memory.current` does
not exist. Writing a limit there looks like it worked and does nothing. The
memory controller is on cgroup v1, and a child there enforces: a process
touching 400 MB under `memory.limit_in_bytes` of 256 MB was `Killed`.

So the whole set is an outer wrapper:

```
prlimit --nproc=... --fsize=... --cpu=... --nofile=... -- <the run>
```

plus a cgroup v1 memory slice around it. **Nothing in `harness/`, `engine/`
or `measure.ts` changes**, the fingerprint `ca9170df…` is unchanged, and no
recalibration or re-measure is needed.

### What the wrapper still cannot do

It is one limit for the whole run, not one per call. A tool that allocates
inside a generous whole-run cap is not caught by it, and the cap has to stay
generous because `npm install`, `node` and `strace` live under the same
ceiling for memory, file size and CPU — only `NPROC` separates the harness
from the server, and only because of the uid. Per-call limits and per-call
attribution are a later stage and would need the instrument to change.

## Not covered by limits

A limit stops a call from exhausting the host. It does not stop a call from
doing something the room already permits, and those stay the sandbox's job:

- writing inside the tmpfs — contained, and destroyed with the sandbox, but
  it can still poison the **second** call of a pair, which is what the
  twice-and-agree rule rests on. That is an argument about reset
  granularity, not about limits.
- reading a planted credential it was never handed — already visible in the
  trace, and a finding worth reporting rather than a failure to prevent.
- reaching for a host — already fails at `connect`, because the room has no
  route off the machine.
