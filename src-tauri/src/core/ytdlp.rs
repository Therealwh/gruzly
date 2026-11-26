//! yt-dlp integration: link analysis (--dump-single-json) and downloads
//! with machine-readable progress (--progress-template, one JSON object
//! per line). All process arguments are passed as arrays — never shell
//! strings — and no secrets (cookies) are ever logged.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

/// CREATE_NO_WINDOW: yt-dlp runs inside a GUI app — no console flashes.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use serde::{Deserialize, Serialize};

/// How long a single analysis may take before we give up.
const ANALYZE_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub enum YtdlpError {
    #[error("analysis timed out")]
    Timeout,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Engine(String),
}

impl YtdlpError {
    /// Stable machine code for the frontend to pick an i18n key.
    pub fn code(&self) -> &'static str {
        match self {
            YtdlpError::Timeout => "analysisFailed",
            YtdlpError::Io(_) => "network",
            YtdlpError::Engine(_) => "analysisFailed",
        }
    }
}

// ---------------------------------------------------------------------------
// Analysis types (serde camelCase — the wire format for the frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMeta {
    pub id: String,
    pub title: String,
    pub webpage_url: String,
    pub extractor: Option<String>,
    pub uploader: Option<String>,
    pub channel: Option<String>,
    pub duration: Option<f64>,
    pub view_count: Option<u64>,
    pub upload_date: Option<String>, // YYYYMMDD
    pub thumbnail: Option<String>,
    pub is_live: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub format_id: String,
    pub ext: String,
    pub height: Option<u64>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub has_video: bool,
    pub has_audio: bool,
    pub size_bytes: Option<u64>,
    pub tbr: Option<f64>,
    pub note: Option<String>,
    pub hdr: bool,
    pub dynamic_range: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub lang: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub url: String,
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)] // video payload dominates; sizes stay reasonable
pub enum Analysis {
    Video {
        meta: VideoMeta,
        formats: Vec<FormatInfo>,
        subtitles: Vec<SubtitleTrack>,
    },
    Playlist {
        title: String,
        webpage_url: String,
        entries: Vec<PlaylistEntry>,
    },
}

// ---------------------------------------------------------------------------
// Raw yt-dlp JSON (only the fields we consume)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct RawInfo {
    #[serde(default)]
    _type: Option<String>,
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    webpage_url: Option<String>,
    #[serde(default)]
    extractor_key: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
    view_count: Option<u64>,
    upload_date: Option<String>,
    thumbnail: Option<String>,
    is_live: Option<bool>,
    formats: Option<Vec<RawFormat>>,
    entries: Option<Vec<RawInfo>>,
    subtitles: Option<std::collections::HashMap<String, serde_json::Value>>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawFormat {
    #[serde(default)]
    format_id: String,
    #[serde(default)]
    ext: Option<String>,
    height: Option<u64>,
    fps: Option<f64>,
    vcodec: Option<String>,
    acodec: Option<String>,
    filesize: Option<u64>,
    filesize_approx: Option<u64>,
    tbr: Option<f64>,
    format_note: Option<String>,
    dynamic_range: Option<String>,
}

impl RawFormat {
    fn into_format(self, video_duration: Option<f64>) -> FormatInfo {
        let vcodec = self.vcodec.filter(|c| !c.is_empty() && c != "none");
        let acodec = self.acodec.filter(|c| !c.is_empty() && c != "none");
        let has_video = vcodec.is_some();
        let has_audio = acodec.is_some();
        let size = self.filesize.or(self.filesize_approx).or_else(|| {
            self.tbr
                .map(|t| ((t * 1000.0 / 8.0) * video_duration.unwrap_or(0.0)) as u64)
                .filter(|s| *s > 0)
        });
        let hdr = self
            .dynamic_range
            .as_deref()
            .map(|d| !d.is_empty() && d != "SDR")
            .unwrap_or(false)
            || self
                .format_note
                .as_deref()
                .map(|n| n.to_uppercase().contains("HDR"))
                .unwrap_or(false);
        FormatInfo {
            format_id: self.format_id,
            ext: self.ext.unwrap_or_default(),
            height: self.height,
            fps: self.fps,
            vcodec,
            acodec,
            has_video,
            has_audio,
            size_bytes: size,
            tbr: self.tbr,
            note: self.format_note,
            hdr,
            dynamic_range: self.dynamic_range,
        }
    }
}

// ---------------------------------------------------------------------------
// Security validation
// ---------------------------------------------------------------------------

const COOKIE_BROWSERS: [&str; 8] = [
    "chrome", "firefox", "edge", "brave", "chromium", "opera", "vivaldi", "safari",
];

/// Validates a URL before it ever reaches an engine command line:
/// known scheme + non-empty host + no leading dash (argument injection).
pub fn validate_url(url: &str) -> Result<(), YtdlpError> {
    if url.trim_start_matches('-').len() != url.len() {
        return Err(YtdlpError::Engine("invalid url".into()));
    }
    let parsed = url::Url::parse(url).map_err(|_| YtdlpError::Engine("invalid url".into()))?;
    let ok = matches!(parsed.scheme(), "http" | "https" | "ftp")
        && parsed.host_str().map(|h| !h.is_empty()).unwrap_or(false);
    if !ok {
        return Err(YtdlpError::Engine("unsupported url scheme".into()));
    }
    Ok(())
}

/// Magnet links: strict prefix + no leading dash (argument injection).
pub fn validate_magnet(magnet: &str) -> Result<(), YtdlpError> {
    let lower = magnet.to_lowercase();
    let ok = lower.starts_with("magnet:?xt=urn:btih:")
        || lower.starts_with("magnet:?xt=urn:sha1:")
        || lower.starts_with("magnet:?xt=urn:btmh:");
    if ok && magnet.trim_start_matches('-').len() == magnet.len() {
        Ok(())
    } else {
        Err(YtdlpError::Engine("invalid magnet link".into()))
    }
}

/// Cookie file must be an existing .txt path without leading dash.
pub fn validate_cookies_file(path: &str) -> Result<(), YtdlpError> {
    let p = PathBuf::from(path);
    let ok = !path.trim_start_matches('-').ne(path)
        && p.is_file()
        && p.extension()
            .map(|e| e.eq_ignore_ascii_case("txt"))
            .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(YtdlpError::Engine("invalid cookies file".into()))
    }
}

/// Parses ffmpeg's `time=HH:MM:SS.xx` (from a progress line) into seconds.
pub fn ffmpeg_time_seconds(line: &str) -> Option<f64> {
    let idx = line.find("time=")?;
    let rest = &line[idx + 5..];
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == ':' || c == '.'))
        .unwrap_or(rest.len());
    let stamp = &rest[..end];
    if stamp.is_empty() {
        return None;
    }
    let parts: Vec<f64> = stamp
        .split(':')
        .filter_map(|p| p.parse::<f64>().ok())
        .collect();
    let seconds: f64 = parts
        .iter()
        .rev()
        .enumerate()
        .map(|(i, v)| v * 60f64.powi(i as i32))
        .sum();
    if seconds > 0.0 {
        Some(seconds)
    } else {
        None
    }
}

/// FFmpeg prints cumulative output size beside its media timestamp.
pub fn ffmpeg_output_bytes(line: &str) -> Option<f64> {
    let (_, value) = line.split_once("size=")?;
    let value = value.split_whitespace().next()?;
    let unit_start = value.find(|c: char| !c.is_ascii_digit() && c != '.')?;
    let size: f64 = value[..unit_start].parse().ok()?;
    let multiplier = match &value[unit_start..] {
        "B" => 1.0,
        "kB" | "KiB" => 1024.0,
        "MB" | "MiB" => 1024.0 * 1024.0,
        "GB" | "GiB" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some(size * multiplier).filter(|bytes| bytes.is_finite())
}

pub const PROGRESS_PREFIX: &str = "gruzly-progress:";
pub const OUTPUT_PREFIX: &str = "gruzly-output:";

pub fn parse_download_progress(line: &str) -> Option<YtdlpProgress> {
    let line = line.trim();
    let json = line.strip_prefix(PROGRESS_PREFIX).unwrap_or(line);
    let progress: YtdlpProgress = serde_json::from_str(json).ok()?;
    progress.status.is_some().then_some(progress)
}

/// Only known browsers for --cookies-from-browser (IPC values are untrusted).
pub fn validate_cookies_browser(browser: &str) -> Result<(), YtdlpError> {
    if COOKIE_BROWSERS.contains(&browser.to_lowercase().as_str()) {
        Ok(())
    } else {
        Err(YtdlpError::Engine("unknown browser".into()))
    }
}

/// Output templates must stay inside the destination folder.
pub fn sanitize_output_template(template: &str) -> Result<String, YtdlpError> {
    let t = template.trim();
    if t.is_empty() {
        return Ok("%(title)s.%(ext)s".into());
    }
    if t.starts_with(['/', '\\']) || t.contains("..") || t.contains(':') {
        return Err(YtdlpError::Engine("invalid output template".into()));
    }
    Ok(t.to_string())
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

fn base_analysis_args() -> Vec<&'static str> {
    vec![
        "--ignore-config",
        "--dump-single-json",
        "--no-warnings",
        "--socket-timeout",
        "30",
    ]
}

/// Runs `yt-dlp` and returns parsed stdout JSON. Output is drained on a
/// separate thread so a noisy stderr cannot deadlock the child, while the
/// parent enforces a real wall-clock timeout around the blocking read.
fn run_ytdlp(binary: &PathBuf, args: &[String]) -> Result<String, YtdlpError> {
    use std::io::Read;
    use std::sync::mpsc;
    use std::thread;

    let mut cmd = std::process::Command::new(binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = stdout;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        let result = loop {
            match reader.read(&mut chunk) {
                Ok(0) => break Ok(buf),
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.len() > 64 * 1024 * 1024 {
                        break Err("output too large".to_string());
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => break Err(e.to_string()),
            }
        };
        let _ = tx.send(result);
    });
    thread::spawn(move || {
        let mut reader = stderr;
        let mut sink = [0u8; 8192];
        while reader.read(&mut sink).ok().filter(|n| *n > 0).is_some() {}
    });

    let deadline = std::time::Instant::now() + ANALYZE_TIMEOUT;
    let stdout = loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(YtdlpError::Timeout);
        }
        match rx.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(result) => break result.map_err(YtdlpError::Engine)?,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if child.try_wait()?.is_some() {
                    match rx.recv_timeout(Duration::from_secs(1)) {
                        Ok(result) => break result.map_err(YtdlpError::Engine)?,
                        Err(_) => {
                            return Err(YtdlpError::Engine("yt-dlp output unavailable".into()))
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(YtdlpError::Engine("yt-dlp output unavailable".into()));
            }
        }
    };
    let status = child.wait()?;
    if !status.success() {
        return Err(YtdlpError::Engine(format!("yt-dlp exited with {status}")));
    }
    Ok(String::from_utf8_lossy(&stdout).to_string())
}

/// Analyzes a video URL: either a single video with formats or a playlist.
pub fn analyze(binary: &PathBuf, url: &str) -> Result<Analysis, YtdlpError> {
    validate_url(url)?;
    // 1. Try as a single video.
    let mut args: Vec<String> = base_analysis_args().into_iter().map(String::from).collect();
    args.push("--no-playlist".into());
    args.push(url.into());

    match run_ytdlp(binary, &args) {
        Ok(out) => return parse_analysis(&out),
        Err(YtdlpError::Engine(msg)) => {
            // Playlist links fail with --no-playlist ("Entry is not a single video");
            // retry with a flat playlist scan before surfacing the error.
            if !msg.to_lowercase().contains("playlist") {
                return Err(YtdlpError::Engine(msg));
            }
        }
        Err(other) => return Err(other),
    }

    // 2. Flat playlist scan.
    let mut args: Vec<String> = base_analysis_args().into_iter().map(String::from).collect();
    args.push("--flat-playlist".into());
    args.push(url.into());
    let out = run_ytdlp(binary, &args)?;
    parse_analysis(&out)
}

fn parse_analysis(json: &str) -> Result<Analysis, YtdlpError> {
    let raw: RawInfo = serde_json::from_str(json.trim())
        .map_err(|e| YtdlpError::Engine(format!("bad JSON from yt-dlp: {e}")))?;

    let is_playlist = raw
        ._type
        .as_deref()
        .map(|t| t == "playlist" || t == "multi_video")
        .unwrap_or(false)
        || (raw.formats.is_none() && raw.entries.is_some());

    if is_playlist {
        let entries = raw
            .entries
            .unwrap_or_default()
            .into_iter()
            .filter_map(|e| {
                let id = e.id.clone();
                let title = e.title.clone().unwrap_or_else(|| id.clone());
                let url = e.webpage_url.clone().or(e.url.clone()).unwrap_or_default();
                if url.is_empty() {
                    None
                } else {
                    Some(PlaylistEntry {
                        id,
                        title,
                        url,
                        duration: e.duration,
                    })
                }
            })
            .collect();
        return Ok(Analysis::Playlist {
            title: raw.title.unwrap_or_else(|| "Playlist".into()),
            webpage_url: raw.webpage_url.unwrap_or_default(),
            entries,
        });
    }

    let meta = VideoMeta {
        id: raw.id.clone(),
        title: raw.title.clone().unwrap_or_else(|| raw.id.clone()),
        webpage_url: raw.webpage_url.clone().unwrap_or_default(),
        extractor: raw.extractor_key.clone(),
        uploader: raw.uploader.clone(),
        channel: raw.channel.clone(),
        duration: raw.duration,
        view_count: raw.view_count,
        upload_date: raw.upload_date,
        thumbnail: raw.thumbnail,
        is_live: raw.is_live.unwrap_or(false),
    };
    let duration = raw.duration;
    let mut formats: Vec<FormatInfo> = raw
        .formats
        .unwrap_or_default()
        .into_iter()
        .map(|f| f.into_format(duration))
        .filter(|f| f.has_video || f.has_audio)
        .collect();
    // best first: video by height, then fps; audio-only rows sink
    formats.sort_by(|a, b| {
        b.height
            .cmp(&a.height)
            .then(
                b.fps
                    .partial_cmp(&a.fps)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(b.has_video.cmp(&a.has_video))
    });

    let mut subtitles: Vec<SubtitleTrack> = Vec::new();
    if let Some(subs) = raw.subtitles {
        for (lang, val) in subs {
            let name = val
                .get(0)
                .and_then(|v| v.get("name"))
                .and_then(|n| n.as_str())
                .map(String::from);
            subtitles.push(SubtitleTrack { lang, name });
        }
        subtitles.sort_by(|a, b| a.lang.cmp(&b.lang));
    }

    Ok(Analysis::Video {
        meta,
        formats,
        subtitles,
    })
}

// ---------------------------------------------------------------------------
// Download spec & progress
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDownloadSpec {
    pub url: String,
    /// yt-dlp format selector, e.g. "bv*[height<=1080]+ba/b".
    pub format_selector: Option<String>,
    pub audio_only: bool,
    pub audio_format: Option<String>, // mp3 | m4a | opus
    pub folder: Option<String>,
    pub output_template: Option<String>,
    pub subtitles: Vec<String>,
    pub embed_subtitles: bool,
    pub sponsorblock: bool,
    pub cookies_browser: Option<String>,
    /// Path to an exported cookies.txt (reliable on Windows with Chrome 127+).
    #[serde(default)]
    pub cookies_file: Option<String>,
    /// Video duration in seconds (for HLS progress via ffmpeg time=).
    #[serde(default)]
    pub duration: Option<f64>,
    /// e.g. "5M" — yt-dlp --limit-rate
    #[serde(default)]
    pub limit_rate: Option<String>,
    /// e.g. "http://127.0.0.1:8080" — yt-dlp --proxy
    #[serde(default)]
    pub proxy: Option<String>,
}

fn de_f64_lenient<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    let number = match value {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    };
    Ok(number.filter(|number| number.is_finite() && *number >= 0.0))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct YtdlpProgress {
    // NOTE: no rename_all — yt-dlp emits snake_case keys in %(progress)j.
    // A camelCase rename silently made every field None ("0 KB, no bar").
    pub status: Option<String>, // downloading | finished
    pub filename: Option<String>,
    #[serde(
        default,
        rename = "downloaded_bytes",
        alias = "downloadedBytes",
        deserialize_with = "de_f64_lenient"
    )]
    pub downloaded_bytes: Option<f64>,
    #[serde(
        default,
        rename = "total_bytes",
        alias = "totalBytes",
        deserialize_with = "de_f64_lenient"
    )]
    pub total_bytes: Option<f64>,
    #[serde(
        default,
        rename = "total_bytes_estimate",
        alias = "totalBytesEstimate",
        deserialize_with = "de_f64_lenient"
    )]
    pub total_bytes_estimate: Option<f64>,
    #[serde(default, deserialize_with = "de_f64_lenient")]
    pub speed: Option<f64>,
    #[serde(default, deserialize_with = "de_f64_lenient")]
    pub eta: Option<f64>,
    #[serde(default, rename = "fragment_index", alias = "fragmentIndex")]
    pub fragment_index: Option<u64>,
    #[serde(default, rename = "fragment_count", alias = "fragmentCount")]
    pub fragment_count: Option<u64>,
}

impl YtdlpProgress {
    pub fn total(&self) -> Option<f64> {
        self.total_bytes.or(self.total_bytes_estimate)
    }
}

/// Builds the full argument vector for a download.
pub fn download_args(
    spec: &VideoDownloadSpec,
    ffmpeg_location: Option<&PathBuf>,
) -> Result<Vec<String>, YtdlpError> {
    validate_url(&spec.url)?;
    if let Some(browser) = &spec.cookies_browser {
        validate_cookies_browser(browser)?;
    }
    if let Some(file) = &spec.cookies_file {
        validate_cookies_file(file)?;
    }
    let template = match &spec.output_template {
        Some(t) => Some(sanitize_output_template(t)?),
        None => None,
    };

    let mut args: Vec<String> = vec![
        "--ignore-config".into(),
        "--newline".into(),
        "--no-warnings".into(),
        "--socket-timeout".into(),
        "30".into(),
        "--retries".into(),
        "5".into(),
        "--fragment-retries".into(),
        "10".into(),
        "--no-mtime".into(),
        // Native HLS/DASH downloaders emit no progress events when piped;
        // ffmpeg does (stderr "time=HH:MM:SS.xx"), which the queue parses
        // into a real progress bar.
        "--downloader".into(),
        "m3u8:ffmpeg".into(),
        "--progress-template".into(),
        format!("download:{PROGRESS_PREFIX}%(progress)j"),
        "--progress".into(),
        "--no-simulate".into(),
        "--print".into(),
        format!("after_move:{OUTPUT_PREFIX}%(filepath)j"),
        "--downloader-args".into(),
        "ffmpeg:-stats".into(),
        // Keep readable unicode filenames; yt-dlp sanitizes illegal chars
        // per-platform itself (--restrict-filenames would mangle Cyrillic).
    ];

    // Bundled ffmpeg is not on PATH — point yt-dlp at it explicitly so
    // video+audio muxing works out of the box.
    if let Some(ffmpeg) = ffmpeg_location {
        args.push("--ffmpeg-location".into());
        args.push(ffmpeg.to_string_lossy().to_string());
    }

    if spec.audio_only {
        args.push("-x".into());
        if let Some(fmt) = &spec.audio_format {
            args.push("--audio-format".into());
            args.push(fmt.clone());
        }
        args.push("--audio-quality".into());
        args.push("0".into());
    } else {
        // Prefer direct HTTP formats: the native HLS/DASH downloaders emit
        // no progress-template events, which would leave the UI at "0 KB".
        let selector = spec.format_selector.clone().unwrap_or_else(|| {
            "bv*[protocol!~=m3u8]+ba[protocol!~=m3u8]/b[protocol!~=m3u8]/bv*+ba/b".into()
        });
        args.push("-f".into());
        args.push(selector);
        args.push("--merge-output-format".into());
        args.push("mp4".into());
    }

    if !spec.subtitles.is_empty() {
        args.push("--sub-langs".into());
        args.push(spec.subtitles.join(","));
        args.push("--write-subs".into());
        if spec.embed_subtitles {
            args.push("--embed-subs".into());
        }
    }

    if spec.sponsorblock {
        args.push("--sponsorblock-remove".into());
        args.push("sponsor".into());
    }

    if let Some(file) = &spec.cookies_file {
        // Exported cookies.txt is the most reliable source on Windows
        // (Chrome 127+ encrypts its database with App-Bound Encryption).
        if !file.trim().is_empty() {
            args.push("--cookies".into());
            args.push(file.clone());
        }
    } else if let Some(browser) = &spec.cookies_browser {
        if !browser.is_empty() {
            args.push("--cookies-from-browser".into());
            args.push(browser.clone());
        }
    }

    if let Some(rate) = &spec.limit_rate {
        if !rate.is_empty() {
            args.push("--limit-rate".into());
            args.push(rate.clone());
        }
    }

    if let Some(proxy) = &spec.proxy {
        if !proxy.is_empty() {
            args.push("--proxy".into());
            args.push(proxy.clone());
        }
    }

    match (&spec.folder, &template) {
        (Some(folder), Some(tmpl)) => {
            args.push("-P".into());
            args.push(folder.clone());
            args.push("-o".into());
            args.push(tmpl.clone());
        }
        (Some(folder), None) => {
            args.push("-P".into());
            args.push(folder.clone());
        }
        (None, Some(tmpl)) => {
            args.push("-o".into());
            args.push(tmpl.clone());
        }
        (None, None) => {}
    }

    args.push(spec.url.clone());
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> VideoDownloadSpec {
        serde_json::from_value(serde_json::json!({
            "url": "https://youtu.be/x",
            "audioOnly": false,
            "subtitles": ["en"],
            "embedSubtitles": true,
            "sponsorblock": true
        }))
        .unwrap()
    }

    #[test]
    fn download_args_are_array_and_ordered() {
        let args = download_args(&spec(), None).unwrap();
        assert!(args.iter().all(|a| !a.contains(" && ")));
        assert!(args.iter().any(|a| a == "--ignore-config"));
        assert!(args.iter().any(|a| a == "--retries"));
        assert!(args.iter().any(|a| a == "--fragment-retries"));
        assert_eq!(*args.last().unwrap(), "https://youtu.be/x");
        // progress template must be the value after its flag
        let idx = args
            .iter()
            .position(|a| a == "--progress-template")
            .unwrap();
        assert_eq!(args[idx + 1], "download:gruzly-progress:%(progress)j");
    }

    #[test]
    fn ffmpeg_location_is_passed_when_present() {
        let ff = PathBuf::from("/opt/ffmpeg/ffmpeg");
        let args = download_args(&spec(), Some(&ff)).unwrap();
        let idx = args.iter().position(|a| a == "--ffmpeg-location").unwrap();
        assert_eq!(args[idx + 1], "/opt/ffmpeg/ffmpeg");
    }

    #[test]
    fn cookies_and_folder_flags() {
        let mut s = spec();
        s.cookies_browser = Some("chrome".into());
        s.folder = Some("D:/Downloads".into());
        s.output_template = Some("%(title)s.%(ext)s".into());
        let args = download_args(&s, None).unwrap();
        let has = |needle: &str| args.iter().any(|a| a == needle);
        assert!(has("--cookies-from-browser"));
        assert!(args.iter().any(|a| a == "D:/Downloads"));
    }

    #[test]
    fn parses_analysis_json() {
        let json = r#"{
            "_type": "video", "id": "abc", "title": "Test", "duration": 61.5,
            "view_count": 1234, "formats": [
                {"format_id": "137", "ext": "mp4", "height": 1080, "fps": 30,
                 "vcodec": "avc1", "acodec": "none", "filesize": 1000000},
                {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a",
                 "tbr": 128, "format_note": "tiny"}
            ],
            "subtitles": {"en": [{"name": "English", "ext": "vtt"}]}
        }"#;
        let analysis = parse_analysis(json).unwrap();
        match analysis {
            Analysis::Video {
                meta,
                formats,
                subtitles,
            } => {
                assert_eq!(meta.title, "Test");
                assert_eq!(formats.len(), 2);
                assert!(formats[0].has_video);
                assert!(!formats[0].hdr);
                assert!(formats[1].has_audio && !formats[1].has_video);
                assert_eq!(subtitles[0].lang, "en");
            }
            _ => panic!("expected video"),
        }
    }

    #[test]
    fn parses_playlist_json() {
        let json = r#"{
            "_type": "playlist", "id": "pl", "title": "My List",
            "entries": [
                {"_type": "url", "id": "v1", "title": "One", "url": "https://youtu.be/v1"},
                {"_type": "url", "id": "v2", "title": "Two", "url": "https://youtu.be/v2"}
            ]
        }"#;
        let analysis = parse_analysis(json).unwrap();
        match analysis {
            Analysis::Playlist { title, entries, .. } => {
                assert_eq!(title, "My List");
                assert_eq!(entries.len(), 2);
                assert_eq!(entries[0].url, "https://youtu.be/v1");
            }
            _ => panic!("expected playlist"),
        }
    }

    #[test]
    fn url_validation_rejects_injection_and_bad_schemes() {
        assert!(validate_url("https://youtu.be/x").is_ok());
        assert!(validate_url("ftp://example.org/f.iso").is_ok());
        assert!(validate_url("--config-file=/etc/passwd").is_err());
        assert!(validate_url("file:///C:/Windows").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
        assert!(validate_url("not a url").is_err());
        assert!(validate_url("https://").is_err()); // no host
    }

    #[test]
    fn magnet_validation() {
        assert!(validate_magnet("magnet:?xt=urn:btih:abcdef&dn=t").is_ok());
        assert!(validate_magnet("MAGNET:?xt=urn:btih:abc").is_ok());
        assert!(validate_magnet("https://example.org/x.torrent").is_err());
        assert!(validate_magnet("magnet:?dn=no-hash").is_err());
        assert!(validate_magnet("--magnet:?xt=urn:btih:abc").is_err());
    }

    #[test]
    fn cookies_browser_allowlist() {
        assert!(validate_cookies_browser("Chrome").is_ok());
        assert!(validate_cookies_browser("firefox").is_ok());
        assert!(validate_cookies_browser("--proxy=evil").is_err());
        assert!(validate_cookies_browser("").is_err());
    }

    #[test]
    fn output_template_stays_in_folder() {
        assert_eq!(
            sanitize_output_template("%(title)s.%(ext)s").unwrap(),
            "%(title)s.%(ext)s"
        );
        assert_eq!(sanitize_output_template("  ").unwrap(), "%(title)s.%(ext)s");
        assert!(sanitize_output_template("../evil.%(ext)s").is_err());
        assert!(sanitize_output_template("/abs/path.%(ext)s").is_err());
        assert!(sanitize_output_template(r"C:\x.%(ext)s").is_err());
    }

    #[test]
    fn parses_progress_snake_case() {
        // Regression: yt-dlp emits snake_case keys — a camelCase rename made
        // every field silently None ("0 KB, no progress bar").
        let p: YtdlpProgress = serde_json::from_str(
            r#"{"status":"downloading","downloaded_bytes":15360,"total_bytes":15298808,"speed":100.5,"eta":12,"filename":"x.part"}"#,
        )
        .unwrap();
        assert_eq!(p.status.as_deref(), Some("downloading"));
        assert_eq!(p.downloaded_bytes, Some(15360.0));
        assert_eq!(p.total(), Some(15298808.0));
        assert_eq!(p.speed, Some(100.5));
        assert_eq!(p.eta, Some(12.0));
        assert_eq!(p.filename.as_deref(), Some("x.part"));
    }

    #[test]
    fn progress_numbers_as_strings_parse() {
        let p: YtdlpProgress = serde_json::from_str(
            r#"{"status":"downloading","downloaded_bytes":"1024","total_bytes":"4096","speed":"128"}"#,
        )
        .unwrap();
        assert_eq!(p.downloaded_bytes, Some(1024.0));
        assert_eq!(p.total(), Some(4096.0));
        assert_eq!(p.speed, Some(128.0));
    }

    #[test]
    fn fragment_fields_parse() {
        let p: YtdlpProgress = serde_json::from_str(
            r#"{"status":"downloading","fragment_index":3,"fragment_count":40}"#,
        )
        .unwrap();
        assert_eq!(p.fragment_index, Some(3));
        assert_eq!(p.fragment_count, Some(40));
    }

    #[test]
    fn parses_ffmpeg_time_stamps() {
        assert_eq!(
            ffmpeg_time_seconds("frame= 125 size= 0KiB time=00:00:08.49 x"),
            Some(8.49)
        );
        assert_eq!(ffmpeg_time_seconds("time=01:02:03.00"), Some(3723.0));
        assert_eq!(ffmpeg_time_seconds("time=12.34"), Some(12.34));
        assert_eq!(ffmpeg_time_seconds("no time here"), None);
        assert_eq!(ffmpeg_time_seconds("time=00:00:00.00"), None);
    }

    #[test]
    fn hdr_detection() {
        let json = r#"{
            "_type": "video", "id": "h", "title": "HDR", "formats": [
                {"format_id": "617", "ext": "mp4", "height": 2160, "vcodec": "vp9.2",
                 "acodec": "none", "dynamic_range": "HDR10"}
            ]
        }"#;
        match parse_analysis(json).unwrap() {
            Analysis::Video { formats, .. } => assert!(formats[0].hdr),
            _ => panic!("expected video"),
        }
    }
}
