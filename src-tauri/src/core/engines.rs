//! Engine discovery and version probing (yt-dlp / aria2c / ffmpeg).
//!
//! Engines are resolved from, in order:
//!   1. the bundled sidecar directory (next to the app binary in dev,
//!      the resource dir in production);
//!   2. the system PATH.
//!
//! Probes run the engine with a version flag, arguments passed as a
//! vector (never a shell string), with a hard timeout.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub id: String,
    pub present: bool,
    pub version: Option<String>,
    pub source: Option<String>, // "bundled" | "path"
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

struct EngineSpec {
    id: &'static str,
    exe_names: &'static [&'static str],
    version_args: &'static [&'static str],
    /// Extracts a clean version string from combined output.
    parse: fn(&str) -> Option<String>,
}

fn parse_first_token_version(prefix: &str) -> impl Fn(&str) -> Option<String> + '_ {
    move |out: &str| {
        out.lines()
            .find(|l| l.starts_with(prefix))
            .and_then(|l| l.split_whitespace().nth(1))
            .map(|s| s.trim().to_string())
    }
}

fn parse_ytdlp(out: &str) -> Option<String> {
    out.lines()
        .next()
        .map(|l| l.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parse_aria2(out: &str) -> Option<String> {
    (parse_first_token_version("aria2"))(out)
}

fn parse_ffmpeg(out: &str) -> Option<String> {
    // Output looks like: "ffmpeg version 7.1-full_build-www.gyan.dev Copyright ..."
    out.lines()
        .find(|l| l.starts_with("ffmpeg version"))
        .and_then(|l| l.split_whitespace().nth(2))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

const SPECS: &[EngineSpec] = &[
    EngineSpec {
        id: "yt-dlp",
        exe_names: &["yt-dlp", "yt-dlp.exe"],
        version_args: &["--version"],
        parse: parse_ytdlp,
    },
    EngineSpec {
        id: "aria2",
        exe_names: &["aria2c", "aria2c.exe"],
        version_args: &["--version"],
        parse: parse_aria2,
    },
    EngineSpec {
        id: "ffmpeg",
        exe_names: &["ffmpeg", "ffmpeg.exe"],
        version_args: &["-version"],
        parse: parse_ffmpeg,
    },
];

/// Candidate directories that may contain bundled engines.
fn candidate_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
            // dev layout: target/<profile>/… — engines sit next to the binary
            dirs.push(dir.join("binaries"));
        }
    }
    if let Ok(resource_dir) = app
        .path()
        .resolve("binaries", tauri::path::BaseDirectory::Resource)
    {
        dirs.push(resource_dir);
    }
    if let Ok(resource_root) = app
        .path()
        .resolve(".", tauri::path::BaseDirectory::Resource)
    {
        dirs.push(resource_root);
    }
    dirs
}

/// Directories from the PATH environment variable.
fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default()
}

fn find_binary(dir: &PathBuf, names: &[&str]) -> Option<PathBuf> {
    for name in names {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Runs `binary version_args` and returns trimmed combined output.
fn probe_version(binary: &PathBuf, args: &[&str]) -> Result<String, EngineError> {
    use std::io::Read;

    let mut child = Command::new(binary)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let deadline = std::time::Instant::now() + PROBE_TIMEOUT;
    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut buf = Vec::new();

    // Simple bounded read: engines print version info immediately.
    loop {
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            return Err(EngineError::Io(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "version probe timed out",
            )));
        }
        let mut chunk = [0u8; 4096];
        match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
        if buf.len() > 16 * 1024 {
            break; // enough for a version string
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
    }
    let _ = child.wait();

    Ok(String::from_utf8_lossy(&buf).trim().to_string())
}

/// Probes all engines. Runs on a blocking thread (spawned by the caller).
pub fn probe_all(app: &tauri::AppHandle) -> Vec<EngineInfo> {
    let bundle_dirs = candidate_dirs(app);
    let sys_dirs = path_dirs();

    SPECS
        .iter()
        .map(|spec| {
            // 1. bundled
            for dir in &bundle_dirs {
                if let Some(binary) = find_binary(dir, spec.exe_names) {
                    if let Ok(out) = probe_version(&binary, spec.version_args) {
                        if let Some(v) = (spec.parse)(&out) {
                            return EngineInfo {
                                id: spec.id.to_string(),
                                present: true,
                                version: Some(v),
                                source: Some("bundled".into()),
                            };
                        }
                    }
                }
            }
            // 2. PATH
            for dir in &sys_dirs {
                if let Some(binary) = find_binary(dir, spec.exe_names) {
                    if let Ok(out) = probe_version(&binary, spec.version_args) {
                        if let Some(v) = (spec.parse)(&out) {
                            return EngineInfo {
                                id: spec.id.to_string(),
                                present: true,
                                version: Some(v),
                                source: Some("path".into()),
                            };
                        }
                    }
                }
            }
            EngineInfo {
                id: spec.id.to_string(),
                present: false,
                version: None,
                source: None,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ytdlp_version() {
        assert_eq!(parse_ytdlp("2026.11.15\n"), Some("2026.11.15".into()));
        assert_eq!(parse_ytdlp(""), None);
    }

    #[test]
    fn parses_aria2_version() {
        assert_eq!(
            parse_aria2("aria2 1.37.0\nCopyright (C) 2006 Tatsuhiro Tsujikawa\n"),
            Some("1.37.0".into())
        );
    }

    #[test]
    fn parses_ffmpeg_version() {
        assert_eq!(
            parse_ffmpeg("ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) 2000-2024\n"),
            Some("7.1-full_build-www.gyan.dev".into())
        );
    }
}
