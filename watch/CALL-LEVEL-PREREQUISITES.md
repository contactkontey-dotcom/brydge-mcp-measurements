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

## Why this is a prerequisite and not a task

Every limit above is a change to how the measured process is started, which
is `harness/session.ts`, which is **inside the instrument fingerprint**
(`ca9170df…`). Adding them invalidates the calibration behind all 67
published measurements, so it means a recalibration run and a re-measure,
not an afternoon.

The ordering follows from that: limits, then recalibration, then the first
call. A call-level diff built before them is one unbounded `malloc` in one
tool away from taking the machine down mid-sweep — and the sweep is the
thing that produces the evidence.

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
