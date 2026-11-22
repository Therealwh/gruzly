// Sets TAURI_SIGNING_* secrets on Therealwh/gruzly via the GitHub API.
// Token comes from git credential manager; key from ~/.tauri/gruzly.key.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import sodium from "libsodium-wrappers";

const token = execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n" })
  .toString().split("\n").find((l) => l.startsWith("password="))?.slice(9)?.trim();
if (!token) throw new Error("no github token");

const REPO = "Therealwh/gruzly";
const api = (path, opts = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });

const pkRes = await api(`/repos/${REPO}/actions/secrets/public-key`);
if (!pkRes.ok) throw new Error(`public-key: ${pkRes.status} ${await pkRes.text()}`);
const { key_id, key } = await pkRes.json();

await sodium.ready;

async function putSecret(name, raw) {
  // Uint8Array output → encode manually as standard base64
  // (libsodium's "base64" format is URL-safe and GitHub's API rejects it).
  const cipherBytes = sodium.crypto_box_seal(
    Buffer.from(raw, "utf8"),
    Buffer.from(key, "base64"),
    null,
  );
  const cipher = Buffer.from(cipherBytes).toString("base64");
  const res = await api(`/repos/${REPO}/actions/secrets/${name}`, {
    method: "PUT",
    body: JSON.stringify({ encrypted_value: cipher, key_id }),
  });
  console.log(name, res.status, res.ok ? "OK" : await res.text());
}

const priv = readFileSync(join(homedir(), ".tauri", "gruzly.key"), "utf8").trim();
await putSecret("TAURI_SIGNING_PRIVATE_KEY", priv);
await putSecret("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "");
