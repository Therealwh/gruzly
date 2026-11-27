//! Browser extension support: where the unpacked MV3 extension ships, which
//! browsers are installed, and how to open their extensions pages.
//!
//! Browsers never allow a desktop app to install an unpacked extension
//! silently, so this module only prepares the manual flow: open the browser's
//! extensions page and hand the user the folder path.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::Manager;

/// Stable error codes shared with the frontend.
pub const BROWSER_NOT_FOUND: &str = "browserNotFound";
pub const EXTENSION_MISSING: &str = "extensionMissing";

/// CREATE_NO_WINDOW: launching a browser must not flash a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A browser we can guide the user to install the extension into.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserOption {
    pub id: String,
    pub name: String,
    pub available: bool,
}

/// Supported browsers, in the order shown to the user.
const BROWSERS: &[(&str, &str)] = &[
    ("chrome", "Chrome"),
    ("edge", "Microsoft Edge"),
    ("brave", "Brave"),
    ("vivaldi", "Vivaldi"),
    ("opera", "Opera"),
    ("firefox", "Firefox"),
];

/// Folder with manifest.json, background.js, … bundled as a resource.
/// In development the in-repo `extension/` folder is used instead.
pub fn extension_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource = app
        .path()
        .resolve("extension", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|dir| dir.join("manifest.json").is_file());
    resource.or_else(dev_extension_dir)
}

/// Development fallback: `extension/` next to the Cargo manifest directory.
fn dev_extension_dir() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dir = manifest_dir.parent()?.join("extension");
    dir.join("manifest.json").is_file().then_some(dir)
}

/// Every supported browser, marked available when its executable is found.
pub fn detect_browsers() -> Vec<BrowserOption> {
    BROWSERS
        .iter()
        .map(|&(id, name)| BrowserOption {
            id: id.to_string(),
            name: name.to_string(),
            available: browser_binary(id).is_some(),
        })
        .collect()
}

/// Opens the browser's own extensions page. Unknown ids and browsers that are
/// not installed both return [`BROWSER_NOT_FOUND`].
pub fn open_extensions_page(browser: &str) -> Result<(), String> {
    let url = extensions_url(browser).ok_or_else(|| BROWSER_NOT_FOUND.to_string())?;
    let binary = browser_binary(browser).ok_or_else(|| BROWSER_NOT_FOUND.to_string())?;

    let mut command = Command::new(binary);
    command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    // Drop the child: the browser outlives this short-lived command.
    command
        .spawn()
        .map(|_| ())
        .map_err(|_| BROWSER_NOT_FOUND.to_string())
}

/// The page that loads unpacked extensions in each browser.
fn extensions_url(browser: &str) -> Option<&'static str> {
    match browser {
        "chrome" | "brave" => Some("chrome://extensions/"),
        "edge" => Some("edge://extensions/"),
        "opera" => Some("opera://extensions/"),
        "vivaldi" => Some("vivaldi://extensions/"),
        "firefox" => Some("about:debugging#/runtime/this-firefox"),
        _ => None,
    }
}

fn browser_binary(browser: &str) -> Option<PathBuf> {
    candidate_paths(browser)
        .into_iter()
        .find(|path| is_launchable(path))
}

fn is_launchable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        path.metadata()
            .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg(windows)]
fn env_root(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

#[cfg(windows)]
fn under(root: &Path, parts: &[&str]) -> PathBuf {
    parts
        .iter()
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

#[cfg(windows)]
fn candidate_paths(browser: &str) -> Vec<PathBuf> {
    let program_files = env_root("ProgramFiles");
    let program_files_x86 = env_root("ProgramFiles(x86)");
    let local_app_data = env_root("LOCALAPPDATA");

    let mut paths = Vec::new();
    match browser {
        "chrome" => {
            for root in [program_files, program_files_x86, local_app_data]
                .into_iter()
                .flatten()
            {
                paths.push(under(
                    &root,
                    &["Google", "Chrome", "Application", "chrome.exe"],
                ));
            }
        }
        "edge" => {
            for root in [program_files_x86, program_files].into_iter().flatten() {
                paths.push(under(
                    &root,
                    &["Microsoft", "Edge", "Application", "msedge.exe"],
                ));
            }
        }
        "brave" => {
            for root in [program_files, local_app_data].into_iter().flatten() {
                paths.push(under(
                    &root,
                    &["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
                ));
            }
        }
        "vivaldi" => {
            if let Some(root) = local_app_data {
                paths.push(under(&root, &["Vivaldi", "Application", "vivaldi.exe"]));
            }
        }
        "opera" => {
            if let Some(root) = local_app_data {
                paths.push(under(&root, &["Programs", "Opera", "opera.exe"]));
            }
        }
        "firefox" => {
            for root in [program_files, program_files_x86].into_iter().flatten() {
                paths.push(under(&root, &["Mozilla Firefox", "firefox.exe"]));
            }
        }
        _ => {}
    }
    paths
}

#[cfg(target_os = "macos")]
fn candidate_paths(browser: &str) -> Vec<PathBuf> {
    let (bundle, binary) = match browser {
        "chrome" => ("Google Chrome.app", "Google Chrome"),
        "edge" => ("Microsoft Edge.app", "Microsoft Edge"),
        "brave" => ("Brave Browser.app", "Brave Browser"),
        "vivaldi" => ("Vivaldi.app", "Vivaldi"),
        "opera" => ("Opera.app", "Opera"),
        "firefox" => ("Firefox.app", "firefox"),
        _ => return Vec::new(),
    };
    vec![PathBuf::from("/Applications")
        .join(bundle)
        .join("Contents")
        .join("MacOS")
        .join(binary)]
}

#[cfg(all(unix, not(target_os = "macos")))]
fn candidate_paths(browser: &str) -> Vec<PathBuf> {
    let names: &[&str] = match browser {
        "chrome" => &[
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
        ],
        "edge" => &["microsoft-edge"],
        "brave" => &["brave-browser"],
        "vivaldi" => &["vivaldi"],
        "opera" => &["opera"],
        "firefox" => &["firefox"],
        _ => return Vec::new(),
    };
    names.iter().filter_map(|name| path_lookup(name)).collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn path_lookup(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| is_launchable(candidate))
}

#[cfg(not(any(windows, unix)))]
fn candidate_paths(_browser: &str) -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_ids_are_unique_and_include_the_majors() {
        let browsers = detect_browsers();
        let mut ids: Vec<&str> = browsers.iter().map(|browser| browser.id.as_str()).collect();

        assert_eq!(ids.len(), 6);
        assert!(ids.contains(&"chrome"));
        assert!(ids.contains(&"firefox"));

        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 6, "browser ids must be unique");
    }

    #[test]
    fn unknown_browser_returns_the_stable_code() {
        assert_eq!(
            open_extensions_page("nonsense"),
            Err(BROWSER_NOT_FOUND.to_string())
        );
    }

    #[test]
    fn dev_extension_dir_resolves_this_checkout() {
        let dir = dev_extension_dir().expect("extension/ exists in this checkout");
        assert!(dir.join("manifest.json").is_file());
        assert_eq!(
            dir.file_name().and_then(|name| name.to_str()),
            Some("extension")
        );
    }

    #[test]
    fn extensions_urls_match_each_browser() {
        assert_eq!(extensions_url("chrome"), Some("chrome://extensions/"));
        assert_eq!(extensions_url("brave"), Some("chrome://extensions/"));
        assert_eq!(extensions_url("edge"), Some("edge://extensions/"));
        assert_eq!(extensions_url("opera"), Some("opera://extensions/"));
        assert_eq!(extensions_url("vivaldi"), Some("vivaldi://extensions/"));
        assert_eq!(
            extensions_url("firefox"),
            Some("about:debugging#/runtime/this-firefox")
        );
        assert_eq!(extensions_url("nonsense"), None);
    }
}
