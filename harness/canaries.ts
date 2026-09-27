import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * FAKE SECRETS, PLANTED WHERE REAL ONES LIVE.
 *
 * "Does it ask for credentials it never declared?" needs a definition that
 * does not depend on anybody's opinion of a variable's name. This is it:
 *
 *   A CREDENTIAL READ IS THE SERVER TOUCHING A SECRET WE PLANTED.
 *
 * Every run puts a fake secret in each environment variable below and in each
 * file below, under a home directory made for the run. Each value is unique to
 * the run, so it can be found again wherever it ends up — a tool's reply, a
 * file the server wrote, a request it tried to send, a DNS name it looked up.
 *
 * A read of one of these that the server never declared is an undeclared
 * credential read. A read of something we did not plant is reported as what
 * it is — the server looked for a variable — and never counted as one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Environment variables that hold a planted secret in every run. */
export const PLANTED_ENV = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITLAB_TOKEN",
  "NPM_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "HF_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "SLACK_BOT_TOKEN",
  "STRIPE_SECRET_KEY",
  "DATABASE_URL",
] as const;

/** Files under $HOME that hold a planted secret in every run, and what each is. */
export const PLANTED_FILES: ReadonlyArray<{ path: string; what: string; body: (secret: string) => string }> = [
  { path: ".aws/credentials", what: "AWS credentials", body: (s) => `[default]\naws_access_key_id = AKIA${s}\naws_secret_access_key = ${s}\n` },
  { path: ".ssh/id_ed25519", what: "an SSH private key", body: (s) => `-----BEGIN OPENSSH PRIVATE KEY-----\n${s}\n-----END OPENSSH PRIVATE KEY-----\n` },
  { path: ".ssh/id_rsa", what: "an SSH private key", body: (s) => `-----BEGIN RSA PRIVATE KEY-----\n${s}\n-----END RSA PRIVATE KEY-----\n` },
  { path: ".netrc", what: "netrc passwords", body: (s) => `machine api.example.com\n  login brydge\n  password ${s}\n` },
  { path: ".npmrc", what: "an npm registry token", body: (s) => `//registry.npmjs.org/:_authToken=${s}\n` },
  { path: ".pypirc", what: "a PyPI upload token", body: (s) => `[pypi]\nusername = __token__\npassword = ${s}\n` },
  { path: ".git-credentials", what: "git credentials", body: (s) => `https://brydge:${s}@github.com\n` },
  { path: ".config/gh/hosts.yml", what: "a GitHub CLI token", body: (s) => `github.com:\n    oauth_token: ${s}\n    user: brydge\n` },
  { path: ".docker/config.json", what: "a Docker registry token", body: (s) => `{"auths":{"https://index.docker.io/v1/":{"auth":"${s}"}}}\n` },
  { path: ".kube/config", what: "a Kubernetes token", body: (s) => `apiVersion: v1\nkind: Config\nusers:\n- name: brydge\n  user:\n    token: ${s}\n` },
  {
    path: ".config/gcloud/application_default_credentials.json",
    what: "Google Cloud credentials",
    body: (s) => `{"type":"authorized_user","client_id":"brydge","client_secret":"${s}","refresh_token":"${s}"}\n`,
  },
];

export interface Canaries {
  /** Environment variable → its planted value. */
  env: Record<string, string>;
  /** Absolute path → its planted value. */
  files: Record<string, string>;
  /** Every planted value → where it was planted, for finding it again. */
  where: Map<string, string>;
}

/** Plant a fresh set under `home`. Values are unique to this call. */
export function plant(home: string): Canaries {
  const run = randomBytes(6).toString("hex").toUpperCase();
  const env: Record<string, string> = {};
  const files: Record<string, string> = {};
  const where = new Map<string, string>();

  for (const name of PLANTED_ENV) {
    const secret = `BRYDGECANARY${name.replace(/_/g, "")}${run}`;
    env[name] = name === "DATABASE_URL" ? `postgres://brydge:${secret}@db.invalid:5432/brydge` : secret;
    where.set(secret, `environment variable ${name}`);
  }
  for (const f of PLANTED_FILES) {
    const secret = `BRYDGECANARYFILE${f.path.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}${run}`;
    const path = join(home, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.body(secret), { mode: 0o600 });
    files[path] = secret;
    where.set(secret, `~/${f.path} (${f.what})`);
  }
  return { env, files, where };
}

/** Every planted secret that appears in `text`, and where it was planted. */
export function secretsIn(text: string, canaries: Canaries): string[] {
  const found: string[] = [];
  for (const [secret, origin] of canaries.where) {
    /* Also lower-cased: a DNS name carrying a secret arrives in lower case. */
    if (text.includes(secret) || text.includes(secret.toLowerCase())) found.push(origin);
  }
  return found;
}

/**
 * Names that look like they hold a secret. Used only to REPORT that a server
 * looked for one we did not plant — never to count a credential read, which
 * needs a planted secret. Published, so it can be argued with.
 */
export const CREDENTIAL_LIKE = /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|BEARER|COOKIE)/i;
