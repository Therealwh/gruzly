//! Incoming links from the browser extension, `gruzly://` deep links and the
//! command line (`gruzly <url>`).
//!
//! The Rust side only validates and routes the link: the frontend decides
//! whether the URL opens video analysis or goes straight into the queue, so
//! browser handoff behaves exactly like a manual paste.

use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

/// Emitted once per accepted link; the payload is the URL string.
pub const EVENT_LINK: &str = "app://link";
/// The custom scheme the app registers for browser handoff.
pub const SCHEME: &str = "gruzly";
/// Ignore the same URL arriving twice within this window (the deep-link plugin
/// and the single-instance callback can both report one launch).
const DUPLICATE_WINDOW: std::time::Duration = std::time::Duration::from_secs(2);
const MAX_PENDING: usize = 20;

/// Returns a download target when the string is something the queue accepts.
pub fn valid_target(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 4096 {
        return None;
    }
    if value.to_ascii_lowercase().starts_with("magnet:?") {
        return Some(value.to_string());
    }
    let url = tauri::Url::parse(value).ok()?;
    match url.scheme() {
        "http" | "https" | "ftp" => Some(value.to_string()),
        _ => None,
    }
}

/// `gruzly://add?url=<percent-encoded>` → the target URL.
pub fn parse_deep_link(raw: &str) -> Option<String> {
    let url = tauri::Url::parse(raw.trim()).ok()?;
    if url.scheme() != SCHEME {
        return None;
    }
    let target = url
        .query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("url"))
        .map(|(_, value)| value.into_owned())?;
    valid_target(&target)
}

/// Collects links from process arguments: deep links and bare URLs.
pub fn urls_from_args<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut out: Vec<String> = Vec::new();
    for arg in args {
        let arg = arg.as_ref();
        let lower = arg.to_ascii_lowercase();
        let target = if lower.starts_with("gruzly:") {
            parse_deep_link(arg)
        } else {
            valid_target(arg)
        };
        if let Some(target) = target {
            if !out.contains(&target) {
                out.push(target);
            }
        }
    }
    out
}

/// Sends links to the frontend and focuses the window. Links that arrive
/// before the webview is listening stay queued for `take_pending`.
pub fn deliver(app: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let state = app.state::<AppState>();
    for url in urls {
        {
            let mut recent = state.recent_link.lock().expect("link lock");
            if recent
                .as_ref()
                .is_some_and(|(last, at)| last == &url && at.elapsed() < DUPLICATE_WINDOW)
            {
                continue;
            }
            *recent = Some((url.clone(), std::time::Instant::now()));
        }
        {
            let mut pending = state.pending_links.lock().expect("link queue");
            if !pending.contains(&url) {
                pending.push(url.clone());
            }
            if pending.len() > MAX_PENDING {
                let excess = pending.len() - MAX_PENDING;
                pending.drain(..excess);
            }
        }
        let _ = app.emit(EVENT_LINK, &url);
    }
}

/// Drains links that arrived before the frontend was ready.
pub fn take_pending(app: &AppHandle) -> Vec<String> {
    let state = app.state::<AppState>();
    let mut pending = state.pending_links.lock().expect("link queue");
    std::mem::take(&mut *pending)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_url_query_parameter() {
        assert_eq!(
            parse_deep_link("gruzly://add?url=https%3A%2F%2Fexample.org%2Ffile.zip").as_deref(),
            Some("https://example.org/file.zip")
        );
        assert_eq!(
            parse_deep_link("gruzly://add?url=magnet%3A%3Fxt%3Durn%3Abtih%3Aabc").as_deref(),
            Some("magnet:?xt=urn:btih:abc")
        );
        assert_eq!(parse_deep_link("gruzly://add"), None);
        assert_eq!(
            parse_deep_link("other://add?url=https%3A%2F%2Fexample.org"),
            None
        );
    }

    #[test]
    fn rejects_unsafe_schemes() {
        assert!(valid_target("javascript:alert(1)").is_none());
        assert!(valid_target("file:///C:/Windows/System32/calc.exe").is_none());
        assert!(valid_target("data:text/html,hello").is_none());
        assert_eq!(
            valid_target("https://example.org/a.mp4").as_deref(),
            Some("https://example.org/a.mp4")
        );
    }

    #[test]
    fn collects_arguments_without_duplicates() {
        let args = vec![
            "gruzly.exe".to_string(),
            "gruzly://add?url=https%3A%2F%2Fexample.org%2Fa.zip".to_string(),
            "https://example.org/a.zip".to_string(),
            "--flag".to_string(),
            "magnet:?xt=urn:btih:abc".to_string(),
        ];
        assert_eq!(
            urls_from_args(args),
            vec![
                "https://example.org/a.zip".to_string(),
                "magnet:?xt=urn:btih:abc".to_string(),
            ]
        );
    }
}
