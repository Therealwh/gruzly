// Verifies that the latest published release is complete and installable.
// Run daily by .github/workflows/health.yml; needs a token with repo read.
//
// Checks, in order:
//   1. /releases/latest exists and its tag looks like vX.Y.Z
//   2. every expected asset is attached (Windows, Linux, macOS, updater JSON)
//   3. latest.json matches the tag and every platform entry is signed
//   4. the updater endpoint used by the app serves the same manifest
//   5. the Windows installer URL actually downloads

import { appendFileSync } from "node:fs";

const repo = process.env.GITHUB_REPOSITORY || "Therealwh/gruzly";
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const api = "https://api.github.com";

if (!token) {
  console.error("GH_TOKEN is required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "gruzly-health-check",
};

const failures = [];
function fail(message) {
  failures.push(message);
  console.error(`FAIL  ${message}`);
}
function pass(message) {
  console.log(`ok    ${message}`);
}

async function json(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const release = await json(`${api}/repos/${repo}/releases/latest`);
  const tag = release.tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    fail(`latest release tag "${tag}" does not look like vX.Y.Z`);
    return;
  }
  if (release.draft || release.prerelease) fail(`latest release ${tag} is a draft or pre-release`);
  else pass(`latest release ${tag}`);

  const version = tag.slice(1);
  const expected = [
    `Gruzly_${version}_x64-setup.exe`,
    `Gruzly_${version}_x64_en-US.msi`,
    "Gruzly-portable-win64.zip",
    `Gruzly_${version}_amd64.deb`,
    `Gruzly_${version}_amd64.AppImage`,
    "Gruzly_aarch64.app.tar.gz",
    "latest.json",
  ];
  const assets = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  for (const name of expected) {
    if (assets.has(name)) pass(`asset ${name}`);
    else fail(`missing asset ${name}`);
  }

  const manifestAsset = assets.get("latest.json");
  if (!manifestAsset) return;
  const manifestResponse = await fetch(manifestAsset.url, {
    headers: { ...headers, Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!manifestResponse.ok) {
    fail(`could not download latest.json (HTTP ${manifestResponse.status})`);
    return;
  }
  const manifest = await manifestResponse.json();
  if (manifest.version === version) pass(`manifest version ${manifest.version}`);
  else fail(`manifest version ${manifest.version} does not match ${version}`);

  const platforms = Object.entries(manifest.platforms || {});
  if (platforms.length === 0) fail("manifest lists no platforms");
  for (const [key, entry] of platforms) {
    if (!entry?.url) fail(`manifest entry ${key} has no url`);
    else if (!entry.signature) fail(`manifest entry ${key} has no signature`);
    else pass(`manifest entry ${key}`);
  }
  for (const required of ["windows-x86_64", "windows-x86_64-nsis", "darwin-aarch64", "linux-x86_64"]) {
    if (!manifest.platforms?.[required]) fail(`manifest is missing ${required}`);
  }

  const updater = await fetch(
    `https://github.com/${repo}/releases/latest/download/latest.json`,
    { redirect: "follow", headers: { "User-Agent": "gruzly-health-check" } },
  );
  if (!updater.ok) fail(`updater endpoint answered HTTP ${updater.status}`);
  else {
    const served = await updater.json();
    if (served.version === version) pass("updater endpoint serves the current version");
    else fail(`updater endpoint serves ${served.version}, expected ${version}`);
  }

  const installer = assets.get(`Gruzly_${version}_x64-setup.exe`);
  if (installer) {
    const head = await fetch(installer.browser_download_url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "gruzly-health-check" },
    });
    const size = Number(head.headers.get("content-length") || 0);
    if (!head.ok) fail(`installer download answered HTTP ${head.status}`);
    else if (size < 50 * 1024 * 1024) fail(`installer is suspiciously small (${size} bytes)`);
    else pass(`installer downloads (${(size / 1024 / 1024).toFixed(1)} MiB)`);
  }

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) appendFileSync(outputFile, `version=${version}
`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall release checks passed");
}

main().catch((error) => {
  console.error(`health check crashed: ${error.message}`);
  process.exit(1);
});
