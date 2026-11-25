// Downloads sidecar engines (yt-dlp, aria2c, ffmpeg) from official
// distribution points over HTTPS into src-tauri/binaries/ using the
// Tauri sidecar naming convention: <name>-<target-triple>[.exe].
// Idempotent: skips engines that are already present.
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = join(ROOT_DIR, "src-tauri", "binaries");
const LOCK = JSON.parse(readFileSync(join(ROOT_DIR, "engines.lock.json"), "utf8"));
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
    win32: ["https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe"],
    darwin: ["https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_macos"],
    linux: ["https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_linux"],
  },
  aria2c: {
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
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-21-12-37/ffmpeg-N-129166-gae9f4540cb-win64-gpl.zip",
        inner: "bin/ffmpeg.exe",
      },
    ],
    darwin: [{ system: "ffmpeg" }],
    linux: [
      {
        url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-21-12-37/ffmpeg-N-129166-gae9f4540cb-linux64-gpl.tar.xz",
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

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyEngineHash(name, path) {
  const lock = LOCK.engines?.[name]?.sha256;
  const key = `${process.platform}-${process.arch}`;
  const expected = typeof lock === "string" ? lock : lock?.[key];
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
    throw new Error(`missing valid SHA-256 lock for ${name} (${key})`);
  }
  const actual = await sha256(path);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${name}: expected ${expected}, got ${actual}`);
  }
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
    // On Linux the preinstalled aria2 may be a snap wrapper that dies
    // outside its sandbox — ship a tiny exec shim instead and declare
    // aria2 as a package dependency (deb) so users get a real binary.
    const found = execFileSync(
      process.platform === "win32" ? "where" : "which",
      [entry.system],
      { encoding: "utf8" },
    )
      .split(/\r?\n/)[0]
      ?.trim();
    if (!found) throw new Error(`system binary ${entry.system} not found — install it first`);
    console.log(`[system] ${name} ← ${found}`);
    rmSync(outFile, { force: true });
    mkdirSync(dirname(outFile), { recursive: true });
    if (process.platform === "linux" && entry.system === "aria2c") {
      // exec-shim: resolve the real system binary at runtime
      const shim = ["#!/bin/sh", 'exec /usr/bin/aria2c "$@"', ""].join("\n");
      writeFileSync(outFile, shim, { mode: 0o755 });
    } else {
      copyFileSync(found, outFile);
    }
    if (!existsSync(outFile)) throw new Error(`copy failed: ${found} → ${outFile}`);
    // System-managed binaries are not reproducible artifacts; the distro or
    // Homebrew package manager supplies their own integrity chain.
    return false;
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
  // rename within a volume; copy across volumes/devices.
  // Never delete the source unless it is one of our temp copies
  // (system binaries from `where/which` stay untouched).
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    if (from.startsWith(BIN_DIR)) {
      rmSync(from, { force: true });
    }
  }
}

const results = {};
mkdirSync(BIN_DIR, { recursive: true });
for (const [name, spec] of Object.entries(SOURCES)) {
  const outFile = join(BIN_DIR, ext(`${name}-${TRIPLE}`));
  if (existsSync(outFile)) {
    await verifyEngineHash(name, outFile);
    console.log(`[exists] ${name}: ${outFile}`);
    results[name] = "present";
    continue;
  }
  results[name] = (await fetchEngine(name, spec, outFile)) ? "downloaded" : "skipped";
  if (results[name] !== "skipped") await verifyEngineHash(name, outFile);
}

// Sanity check: every engine the build script expects must exist on disk.
for (const [name, state] of Object.entries(results)) {
  if (state === "present" || state === "downloaded") {
    const outFile = join(BIN_DIR, ext(`${name}-${TRIPLE}`));
    if (!existsSync(outFile)) {
      throw new Error(`post-check failed: ${name} missing at ${outFile}`);
    }
    const size = statSync(outFile).size;
    const minSize = process.platform === "linux" && name === "aria2c" ? 30 : 100_000;
    if (size < minSize) {
      throw new Error(`post-check failed: ${name} suspiciously small (${size} bytes)`);
    }
  }
}

console.log(JSON.stringify(results));
