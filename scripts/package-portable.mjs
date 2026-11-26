// Assembles a portable distribution: Gruzly.exe + sidecar engines in one
// folder, zipped. Run after `npx tauri build` (release profile).
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_ROOT = join(ROOT, "src-tauri", "target");
const TARGET_CANDIDATES = [
  join(TARGET_ROOT, "x86_64-pc-windows-msvc", "release"),
  join(TARGET_ROOT, "release"),
];
const TARGET = TARGET_CANDIDATES.find((dir) => existsSync(join(dir, "gruzly.exe")));
const OUT = join(ROOT, "portable", "Gruzly-portable-win64");

if (!TARGET) {
  console.error("gruzly.exe not found — run `npx tauri build` first");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

copyFileSync(join(TARGET, "gruzly.exe"), join(OUT, "Gruzly.exe"));

const sidecars = readdirSync(TARGET).filter((name) => /^(yt-dlp|aria2c|ffmpeg).*\.exe$/i.test(name));
for (const name of sidecars) copyFileSync(join(TARGET, name), join(OUT, name));
for (const prefix of ["yt-dlp", "aria2c", "ffmpeg"]) {
  if (!sidecars.some((name) => name.toLowerCase().startsWith(prefix))) {
    throw new Error(`portable package missing ${prefix} sidecar`);
  }
}
copyFileSync(join(ROOT, "LICENSE"), join(OUT, "LICENSE"));
copyFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), join(OUT, "THIRD_PARTY_NOTICES.md"));

const zip = join(ROOT, "portable", "Gruzly-portable-win64.zip");
rmSync(zip, { force: true });
// bsdtar makes a deterministic zip; -C strips absolute paths.
execFileSync(
  join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
  ["-a", "-c", "-f", zip, "-C", join(ROOT, "portable"), "Gruzly-portable-win64"],
);

console.log(`portable: ${zip}`);
