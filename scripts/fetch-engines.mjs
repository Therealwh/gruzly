// Downloads sidecar engines (yt-dlp, aria2c, ffmpeg) from official
// distribution points over HTTPS into src-tauri/binaries/ using the
// Tauri sidecar naming convention: <name>-<target-triple>[.exe].
// Idempotent: skips engines that are already present.
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "binaries");
const TRIPLE = targetTriple();

function targetTriple() {
  const { platform, arch } = process;
  if (platform === "win32") {
    return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  // linux
  return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
}

function ext(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

const SOURCES = {
  "yt-dlp": {
    win32: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"],
    darwin: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"],
    linux: ["https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"],
  },
  aria2: {
    win32: [
      {
        url: "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip",
        inner: "aria2c.exe",
      },
    ],
    // macOS/Linux: no official prebuilt — install via brew/apt in CI first;
    // the script copies the system binary into the sidecar location.
    darwin: [{ system: "aria2c" }],
    linux: [{ system: "aria2c" }],
  },
  ffmpeg: {
    win32: [
      {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
        inner: "bin/ffmpeg.exe",
      },
    ],
    darwin: [{ system: "ffmpeg" }],
    linux: [
      {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz",
        inner: "bin/ffmpeg",
      },
    ],
  },
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function fetchEngine(name, spec, outFile) {
  const entries = spec[process.platform] ?? [];
  if (entries.length === 0) {
    console.log(`[skip] ${name}: no prebuilt binary for ${process.platform} (PATH fallback)`);
    return false;
  }
  const entry = entries[0];
  if (typeof entry === "object" && entry.system) {
    // Fall back to the system binary (CI installs it via brew/apt).
    const found = execFileSync(process.platform === "win32" ? "where" : "which", [entry.system], { encoding: "utf8" })
      .split(/\r?\n/)[0]
      ?.trim();
    if (!found) throw new Error(`system binary ${entry.system} not found — install it first`);
    console.log(`[system] ${name} ← ${found}`);
    copyBin(found, outFile);
    return true;
  }
  const url = typeof entry === "string" ? entry : entry.url;
  const inner = typeof entry === "string" ? undefined : entry.inner;
  const tmp = mkdtempSync(join(BIN_DIR, `.${name}-`));
  try {
    if (inner) {
      const archive = join(tmp, "engine.bin");
      console.log(`[fetch] ${name} ← ${url}`);
      await download(url, archive);
      // bsdtar (Windows 10+ system tar, macOS, most Linux) reads zip and tar.xz
      const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      execFileSync(tar, ["-xf", archive, "-C", tmp]);
      const extracted = join(tmp, inner);
      if (!existsSync(extracted)) {
        // flatten: find the file anywhere below tmp
        const found = findFile(tmp, inner.split("/").pop());
        if (!found) throw new Error(`${inner} not found inside archive`);
        copyBin(found, outFile);
      } else {
        copyBin(extracted, outFile);
      }
    } else {
      console.log(`[fetch] ${name} ← ${url}`);
      await download(url, outFile);
    }
    console.log(`[done] ${name} → ${outFile}`);
    return true;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function findFile(root, fileName) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.name === fileName) return p;
    }
  }
  return null;
}

function copyBin(from, to) {
  rmSync(to, { force: true });
  mkdirSync(dirname(to), { recursive: true });
  // rename within a volume; copy+drop across volumes
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    rmSync(from, { force: true });
  }
}

const results = {};
mkdirSync(BIN_DIR, { recursive: true });
for (const [name, spec] of Object.entries(SOURCES)) {
  const outFile = join(BIN_DIR, ext(`${name}-${TRIPLE}`));
  if (existsSync(outFile)) {
    console.log(`[exists] ${name}: ${outFile}`);
    results[name] = "present";
    continue;
  }
  results[name] = (await fetchEngine(name, spec, outFile)) ? "downloaded" : "skipped";
}

console.log(JSON.stringify(results));
