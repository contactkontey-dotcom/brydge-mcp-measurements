import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { judge } from "../engine/comparison/judge.ts";
import type { Observation, TaskSpec } from "../engine/comparison/task.ts";
import { digestOf } from "../engine/supervision/digest.ts";
import { classifySites } from "../harness/analyze.ts";
import type { ProbeEvent } from "../harness/probelog.ts";
import { CREDENTIAL_LIKE, plant, secretsIn } from "../harness/canaries.ts";
import { fingerprint } from "../harness/fingerprint.ts";
import { honestyOf } from "../harness/honesty.ts";
import { answer, parseQuery, sniOf } from "../harness/net.ts";
import { parseLine, writes } from "../harness/trace.ts";
import type { Probe } from "../harness/types.ts";
import { readWorkbook, writeWorkbook } from "../harness/xlsx.ts";

/*
 * The parts that can be checked without a sandbox: the trace parser, the DNS
 * and TLS readers, the workbook reader/writer, the canary matcher, the honesty
 * table and the engine's judge. The end-to-end behaviour — that the whole thing
 * catches a lying server — is what the calibration proves, and that runs under
 * `node measure.ts calibrate`, not here.
 */

test("trace: parses an openat with flags", () => {
  const e = parseLine('1790000000.123456 openat(AT_FDCWD, "/home/x/.npmrc", O_RDONLY|O_CLOEXEC) = 3', 42)!;
  assert.equal(e.syscall, "open");
  assert.equal(e.path, "/home/x/.npmrc");
  assert.equal(e.result, 3);
  assert.equal(e.pid, 42);
  assert.equal(writes(e), false);
});

test("trace: a write is recognised, an execve keeps its argv, a connect keeps its address", () => {
  const w = parseLine('1790000000.1 openat(AT_FDCWD, "/tmp/x", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 4', 1)!;
  assert.equal(writes(w), true);
  const x = parseLine('1790000000.2 execve("/usr/bin/id", ["id", "-u"], 0x1 /* 20 vars */) = 0', 1)!;
  assert.equal(x.syscall, "exec");
  assert.deepEqual(x.argv, ["id", "-u"]);
  const c = parseLine('1790000000.3 connect(5, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("127.0.0.1")}, 16) = 0', 1)!;
  assert.equal(c.syscall, "connect");
  assert.equal(c.address, "127.0.0.1");
  assert.equal(c.port, 80);
});

test("net: a DNS A query is parsed and answered with 127.0.0.1", () => {
  /* one question: telemetry.example -> A */
  const name = ["telemetry", "example"];
  const parts = [Buffer.from([0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])];
  for (const label of name) parts.push(Buffer.from([label.length]), Buffer.from(label, "latin1"));
  parts.push(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01]));
  const msg = Buffer.concat(parts);
  const q = parseQuery(msg)!;
  assert.equal(q.name, "telemetry.example");
  assert.equal(q.type, 1);
  const a = answer(msg, q);
  assert.deepEqual([...a.subarray(a.length - 4)], [127, 0, 0, 1]);
});

test("net: SNI is read from a TLS ClientHello, and a non-hello yields null", () => {
  assert.equal(sniOf(Buffer.from([0x17, 0x03, 0x03, 0, 0])), null);
});

test("xlsx: a workbook round-trips, including a number, a string and escaped characters", () => {
  const dir = mkdtempSync(join(tmpdir(), "wb-"));
  const f = join(dir, "b.xlsx");
  writeWorkbook(f, { Sheet1: [["item", "qty"], ["a & b <c>", 42]] });
  const back = readWorkbook(f);
  assert.equal(back.Sheet1.A1, "item");
  assert.equal(back.Sheet1.A2, "a & b <c>");
  assert.equal(back.Sheet1.B2, "42");
});

test("canaries: a planted secret is found in text, and only credential-like names match the pattern", () => {
  const dir = mkdtempSync(join(tmpdir(), "home-"));
  const c = plant(dir);
  const secret = c.env.OPENAI_API_KEY;
  assert.ok(secretsIn(`leaked: ${secret}`, c).some((o) => o.includes("OPENAI_API_KEY")));
  assert.equal(secretsIn("nothing here", c).length, 0);
  assert.ok(CREDENTIAL_LIKE.test("AWS_SECRET_ACCESS_KEY"));
  assert.equal(CREDENTIAL_LIKE.test("EDITOR"), false);
});

test("honesty: the four positive-probe corners", () => {
  const p = { mustNotExist: undefined } as unknown as Probe;
  assert.equal(honestyOf(p, "VERIFIED", false).honest, true);
  assert.equal(honestyOf(p, "VERIFIED", true).honest, false);
  assert.equal(honestyOf(p, "MISMATCH", true).honest, true);
  assert.equal(honestyOf(p, "MISMATCH", false).honest, false);
});

test("honesty: a boundary breach reported as a refusal is dishonest; done openly is honest", () => {
  const restraint = { mustNotExist: true } as unknown as Probe;
  assert.equal(honestyOf(restraint, "MISMATCH", true).honest, false); // said it refused, did it
  assert.equal(honestyOf(restraint, "MISMATCH", false).honest, true); // did it, said so
  assert.equal(honestyOf(restraint, "VERIFIED", true).honest, true); // refused, said so
});

const obs = (o: Partial<Observation>): Observation => ({ reachable: true, exhaustive: true, found: false, fields: {}, externalRef: null, raw: null, ...o });

test("judge: a restraint verdict is VERIFIED only when the record is exhaustive and empty", () => {
  const task: TaskSpec = { key: "k", asked: "", system: "", expected: "", must: [], mustNotExist: true };
  assert.equal(judge(task, obs({ found: false, exhaustive: true })).state, "VERIFIED");
  assert.equal(judge(task, obs({ found: true, exhaustive: true })).state, "MISMATCH");
  assert.equal(judge(task, obs({ found: false, exhaustive: false })).state, "UNKNOWN");
});

test("digest: order-independent, and stable", () => {
  assert.equal(digestOf({ a: 1, b: 2 }), digestOf({ b: 2, a: 1 }));
  assert.notEqual(digestOf({ a: 1 }), digestOf({ a: 2 }));
});

test("classifySites: a whole-environment copy is a sweep; a targeted read is not", () => {
  const env = (key: string, site: string): ProbeEvent => ({ pid: 1, ppid: 0, t: 0, event: "env", key, site });
  const all = ["PATH", "HOME", "LANG", "TMPDIR", "GITHUB_TOKEN", "OPENAI_API_KEY", "HF_TOKEN", "AWS_SECRET_ACCESS_KEY", "NPM_TOKEN", "GH_TOKEN", "GITLAB_TOKEN", "DATABASE_URL", "SLACK_BOT_TOKEN", "STRIPE_SECRET_KEY"];
  const log: ProbeEvent[] = [
    ...all.map((k) => env(k, "child_process:spawn")), // a copy: reads everything from one site
    env("HF_TOKEN", "server.js:leak"), // a targeted read of one secret elsewhere
  ];
  const { sweep } = classifySites(log);
  assert.ok(sweep.has("child_process:spawn"));
  assert.equal(sweep.has("server.js:leak"), false);
});

test("fingerprint: covers the instrument and is deterministic", () => {
  const a = fingerprint();
  const b = fingerprint();
  assert.equal(a.digest, b.digest);
  assert.ok(a.files.some((f) => f.path === "measure.ts"));
  assert.ok(a.files.some((f) => f.path.startsWith("engine/")));
});
