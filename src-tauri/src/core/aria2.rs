//! aria2 integration: sidecar daemon + JSON-RPC client over loopback HTTP.
//!
//! The RPC secret is generated per launch, used only in the params of RPC
//! calls against 127.0.0.1, and never logged.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum Aria2Error {
    #[error("aria2 not found")]
    NotFound,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("rpc error: {0}")]
    Rpc(String),
}

/// A running aria2 daemon with its connection details.
pub struct Aria2Daemon {
    pub child: Mutex<Child>,
    pub port: u16,
    pub secret: String,
    pub download_dir: PathBuf,
}

impl Aria2Daemon {
    /// Spawns aria2c with an RPC listener on an ephemeral port.
    pub async fn spawn(
        binary: &Path,
        download_dir: PathBuf,
        session_file: PathBuf,
    ) -> Result<Arc<Aria2Daemon>, Aria2Error> {
        let port = free_port()?;
        // 32 hex chars — aria2 requires 6..=32; random per launch.
        let secret = uuid::Uuid::new_v4().simple().to_string();

        // aria2 refuses a missing --input-file; seed an empty session.
        if !session_file.exists() {
            std::fs::File::create(&session_file)?;
        }

        let args: Vec<String> = vec![
            "--enable-rpc".into(),
            "--rpc-listen-all=false".into(),
            format!("--rpc-listen-port={port}"),
            format!("--dir={}", download_dir.to_string_lossy()),
            "--continue".into(),
            "--file-allocation=none".into(),
            "--max-connection-per-server=16".into(),
            "--split=16".into(),
            "--min-split-size=1M".into(),
            "--summary-interval=0".into(),
            "--auto-save-interval=30".into(),
            "--force-save=true".into(),
            format!("--save-session={}", session_file.to_string_lossy()),
            format!("--input-file={}", session_file.to_string_lossy()),
            "--enable-dht=true".into(),
            "--listen-port=0".into(),
            "--quiet=true".into(),
        ];

        let child = Command::new(binary)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let _ = &args;

        let daemon = Arc::new(Aria2Daemon {
            child: Mutex::new(child),
            port,
            secret,
            download_dir,
        });

        // Wait until the RPC answers (aria2 binds quickly; retry ~2s).
        for _ in 0..20 {
            if daemon.version().await.is_ok() {
                log::info!("aria2 RPC ready on port {port}");
                return Ok(daemon);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err(Aria2Error::Rpc("daemon did not answer RPC in time".into()))
    }

    async fn rpc(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, Aria2Error> {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": format!("g{method}"),
            "method": format!("aria2.{method}"),
            "params": params,
        });
        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:{}/jsonrpc", self.port);
        let resp = client
            .post(url)
            .timeout(Duration::from_secs(5))
            .json(&payload)
            .send()
            .await
            .map_err(|e| Aria2Error::Rpc(e.to_string()))?
            .error_for_status()
            .map_err(|e| Aria2Error::Rpc(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| Aria2Error::Rpc(e.to_string()))?;

        if let Some(err) = resp.get("error") {
            return Err(Aria2Error::Rpc(err.to_string()));
        }
        Ok(resp
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }

    fn authed(&self, extra: serde_json::Value) -> serde_json::Value {
        let token = json!(format!("token:{}", self.secret));
        if let serde_json::Value::Array(arr) = extra {
            let mut params = vec![token];
            params.extend(arr);
            json!(params)
        } else {
            json!([token, extra])
        }
    }

    pub async fn version(&self) -> Result<String, Aria2Error> {
        let r = self.rpc("getVersion", self.authed(json!([]))).await?;
        Ok(r["version"].as_str().unwrap_or("?").to_string())
    }

    /// Adds URIs (http/ftp/magnet). Returns the gid.
    /// `paused` keeps the download waiting (used for torrent file selection).
    pub async fn add_uri(
        &self,
        uris: &[String],
        options: serde_json::Value,
        paused: bool,
    ) -> Result<String, Aria2Error> {
        let mut opts = options.as_object().cloned().unwrap_or_default();
        if paused {
            opts.insert("pause".into(), json!("true"));
        }
        let r = self.rpc("addUri", self.authed(json!([uris, opts]))).await?;
        Ok(r.as_str().unwrap_or("").to_string())
    }

    /// Adds a base64-encoded .torrent. Returns the gid.
    pub async fn add_torrent(
        &self,
        torrent_b64: &str,
        options: serde_json::Value,
        paused: bool,
    ) -> Result<String, Aria2Error> {
        let mut opts = options.as_object().cloned().unwrap_or_default();
        if paused {
            opts.insert("pause".into(), json!("true"));
        }
        let params = vec![json!(torrent_b64), json!([]), json!(opts)];
        let r = self.rpc("addTorrent", self.authed(json!(params))).await?;
        Ok(r.as_str().unwrap_or("").to_string())
    }

    pub async fn tell_status(&self, gid: &str) -> Result<Aria2Status, Aria2Error> {
        let r = self
            .rpc(
                "tellStatus",
                self.authed(json!([
                    gid,
                    [
                        "gid",
                        "status",
                        "totalLength",
                        "completedLength",
                        "downloadSpeed",
                        "files",
                        "bittorrent",
                        "errorMessage"
                    ]
                ])),
            )
            .await?;
        serde_json::from_value(r).map_err(|e| Aria2Error::Rpc(e.to_string()))
    }

    pub async fn pause(&self, gid: &str) -> Result<(), Aria2Error> {
        self.rpc("pause", self.authed(json!([gid])))
            .await
            .map(|_| ())
    }

    pub async fn unpause(&self, gid: &str) -> Result<(), Aria2Error> {
        self.rpc("unpause", self.authed(json!([gid])))
            .await
            .map(|_| ())
    }

    pub async fn force_remove(&self, gid: &str) -> Result<(), Aria2Error> {
        self.rpc("forceRemove", self.authed(json!([gid])))
            .await
            .map(|_| ())
    }

    /// Selects which files of a torrent to download (indices are 1-based).
    pub async fn select_files(&self, gid: &str, indices: &[u64]) -> Result<(), Aria2Error> {
        let joined = indices
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        self.rpc(
            "changeOption",
            self.authed(json!([gid, {"select-file": joined}])),
        )
        .await
        .map(|_| ())
    }
}

fn free_port() -> Result<u16, Aria2Error> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

// ---------------------------------------------------------------------------
// tellStatus model
// ---------------------------------------------------------------------------

/// aria2 sends integers/booleans as JSON strings — accept both forms.
fn de_u64_lenient<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    match v {
        serde_json::Value::Number(n) => Ok(n.as_u64().unwrap_or(0)),
        serde_json::Value::String(s) => Ok(s.parse().unwrap_or(0)),
        _ => Ok(0),
    }
}

fn de_bool_lenient<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    match v {
        serde_json::Value::Bool(b) => Ok(b),
        serde_json::Value::String(s) => Ok(s == "true" || s == "1"),
        serde_json::Value::Number(n) => Ok(n.as_i64().unwrap_or(0) != 0),
        _ => Ok(false),
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Aria2File {
    #[serde(deserialize_with = "de_u64_lenient")]
    pub index: u64,
    pub path: String,
    #[serde(default, deserialize_with = "de_u64_lenient")]
    pub length: u64,
    #[serde(
        default,
        rename = "completedLength",
        deserialize_with = "de_u64_lenient"
    )]
    pub completed_length: u64,
    #[serde(default, deserialize_with = "de_bool_lenient")]
    pub selected: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct Aria2Status {
    pub gid: String,
    pub status: String, // active | waiting | paused | error | complete | removed
    #[serde(default, rename = "totalLength")]
    pub total_length: String,
    #[serde(default, rename = "completedLength")]
    pub completed_length: String,
    #[serde(default, rename = "downloadSpeed")]
    pub download_speed: String,
    #[serde(default, rename = "files")]
    pub files: Vec<Aria2File>,
    #[serde(default)]
    pub bittorrent: Option<serde_json::Value>,
    #[serde(default, rename = "errorMessage")]
    pub error_message: Option<String>,
}

impl Aria2Status {
    fn parse_u64(value: &str) -> u64 {
        value.parse().unwrap_or(0)
    }

    pub fn total(&self) -> u64 {
        Self::parse_u64(&self.total_length)
    }

    pub fn completed(&self) -> u64 {
        Self::parse_u64(&self.completed_length)
    }

    pub fn speed(&self) -> f64 {
        Self::parse_u64(&self.download_speed) as f64
    }

    pub fn eta(&self) -> f64 {
        let s = self.speed();
        if s > 0.0 && self.total() > self.completed() {
            (self.total() - self.completed()) as f64 / s
        } else {
            0.0
        }
    }

    /// True until torrent metadata resolves into concrete files.
    pub fn is_metadata_only(&self) -> bool {
        self.files.iter().all(|f| f.path.contains("[METADATA]"))
    }

    /// Torrent display name from the bittorrent.info.name field.
    pub fn torrent_name(&self) -> Option<String> {
        self.bittorrent
            .as_ref()?
            .get("info")?
            .get("name")?
            .as_str()
            .map(String::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_status_fields() {
        let s: Aria2Status = serde_json::from_value(json!({
            "gid": "abc",
            "status": "active",
            "totalLength": "1000",
            "completedLength": "250",
            "downloadSpeed": "500",
            "files": [
                {"index": "1", "path": "/d/a.mkv", "length": "1000", "completedLength": "250", "selected": "true"}
            ]
        }))
        .unwrap();
        assert_eq!(s.total(), 1000);
        assert_eq!(s.completed(), 250);
        assert_eq!(s.speed(), 500.0);
        assert!((s.eta() - 1.5).abs() < 1e-9);
        assert!(!s.is_metadata_only());
        // aria2 sends integers/booleans as strings — must parse leniently
        assert_eq!(s.files[0].index, 1);
        assert_eq!(s.files[0].length, 1000);
        assert!(s.files[0].selected);
    }

    #[test]
    fn detects_metadata_only() {
        let s: Aria2Status = serde_json::from_value(json!({
            "gid": "abc", "status": "active",
            "files": [{"index": "1", "path": "/d/[METADATA]/m", "length": "0", "completedLength": "0", "selected": "true"}]
        }))
        .unwrap();
        assert!(s.is_metadata_only());
    }

    #[test]
    fn torrent_name_extracted() {
        let s: Aria2Status = serde_json::from_value(json!({
            "gid": "abc", "status": "active",
            "bittorrent": {"info": {"name": "Ubuntu 24.04"}}
        }))
        .unwrap();
        assert_eq!(s.torrent_name(), Some("Ubuntu 24.04".into()));
    }
}
