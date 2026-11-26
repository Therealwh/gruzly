#!/usr/bin/env node
// Builds extension/dist-firefox from the Chrome/Edge sources.
//
// Firefox does not support `background.service_worker` in MV3 (it runs MV3
// extensions as event pages), so the only manifest change is:
//   background: { service_worker: "background.js" }
//   -> background: { scripts: ["background.js"] }
// A stable add-on id is added for about:debugging and signing.
//
// Note: this build has not been tested in a running Firefox. The JavaScript
// uses `browser` when present (`globalThis.browser ?? chrome`), so it is
// written to work there, but that is not a substitute for browser testing.
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist-firefox");
const SKIP = new Set(["dist-firefox", "package-firefox.mjs"]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (SKIP.has(entry.name)) continue;
  cpSync(join(root, entry.name), join(out, entry.name), { recursive: true });
}

const manifestPath = join(out, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.background = { scripts: ["background.js"] };
manifest.browser_specific_settings = {
  gecko: {
    id: "extension@gruzly.app",
    strict_min_version: "115.0",
  },
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Firefox build written to ${out}`);
console.log("Load it via about:debugging > This Firefox > Load Temporary Add-on.");
