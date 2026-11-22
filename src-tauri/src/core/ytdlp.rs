//! yt-dlp integration: link analysis (--dump-single-json) and downloads
//! with machine-readable progress (--progress-template, one JSON object
//! per line). All process arguments are passed as arrays — never shell
//! strings — and no secrets (cookies) are ever logged.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

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
// Analysis
// ---------------------------------------------------------------------------

fn base_analysis_args() -> Vec<&'static str> {
    vec![
        "--dump-single-json",
        "--no-warnings",
        "--no-check-certificates",
        "--socket-timeout",
        "15",
    ]
}

/// Runs `yt-dlp` and returns parsed stdout JSON.
fn run_ytdlp(binary: &PathBuf, args: &[String]) -> Result<String, YtdlpError> {
    use std::io::Read;

    let mut child = std::process::Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let mut stdout = child.stdout.take().expect("stdout piped");
    let deadline = std::time::Instant::now() + ANALYZE_TIMEOUT;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            return Err(YtdlpError::Timeout);
        }
        match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e.into()),
        }
        if buf.len() > 64 * 1024 * 1024 {
            let _ = child.kill();
            return Err(YtdlpError::Engine("output too large".into()));
        }
    }
    let status = child.wait()?;
    if !status.success() {
        return Err(YtdlpError::Engine(format!("yt-dlp exited with {status}")));
    }
    Ok(String::from_utf8_lossy(&buf).to_string())
}

/// Analyzes a video URL: either a single video with formats or a playlist.
pub fn analyze(binary: &PathBuf, url: &str) -> Result<Analysis, YtdlpError> {
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
    /// e.g. "5M" — yt-dlp --limit-rate
    #[serde(default)]
    pub limit_rate: Option<String>,
    /// e.g. "http://127.0.0.1:8080" — yt-dlp --proxy
    #[serde(default)]
    pub proxy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpProgress {
    pub status: Option<String>, // downloading | finished
    pub filename: Option<String>,
    pub downloaded_bytes: Option<f64>,
    pub total_bytes: Option<f64>,
    pub total_bytes_estimate: Option<f64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
    pub fragment_index: Option<u64>,
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
    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-warnings".into(),
        "--no-mtime".into(),
        "--progress-template".into(),
        "download:%(progress)j".into(),
        "--restrict-filenames".into(),
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
        let selector = spec
            .format_selector
            .clone()
            .unwrap_or_else(|| "bv*+ba/b".into());
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

    if let Some(browser) = &spec.cookies_browser {
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

    match (&spec.folder, &spec.output_template) {
        (Some(folder), Some(template)) => {
            args.push("-P".into());
            args.push(folder.clone());
            args.push("-o".into());
            args.push(template.clone());
        }
        (Some(folder), None) => {
            args.push("-P".into());
            args.push(folder.clone());
        }
        (None, Some(template)) => {
            args.push("-o".into());
            args.push(template.clone());
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
        assert_eq!(*args.last().unwrap(), "https://youtu.be/x");
        // progress template must be the value after its flag
        let idx = args
            .iter()
            .position(|a| a == "--progress-template")
            .unwrap();
        assert_eq!(args[idx + 1], "download:%(progress)j");
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
