//! RPC authorization smoke test against a real aria2c daemon.
//!
//! Run manually with the bundled binary:
//!   cargo test --test aria2_rpc_auth -- --ignored --nocapture

use gruzly_lib::core::aria2::Aria2Daemon;
use serde_json::{json, Value};
use std::path::PathBuf;
use tempfile_dir::TempDir;

async fn rpc(port: u16, params: Value) -> Value {
    reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/jsonrpc"))
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "auth-test",
            "method": "aria2.getVersion",
            "params": params,
        }))
        .send()
        .await
        .expect("RPC request")
        .json()
        .await
        .expect("RPC JSON response")
}

#[tokio::test]
#[ignore = "requires a local aria2c binary; run with --ignored"]
async fn rpc_requires_secret_and_accepts_correct_secret() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let bundled = manifest.join("binaries/aria2c-x86_64-pc-windows-msvc.exe");
    let binary = if bundled.exists() {
        bundled
    } else {
        PathBuf::from("aria2c")
    };
    let temp = TempDir::new("gruzly-rpc-auth").expect("temp directory");
    let daemon = Aria2Daemon::spawn(&binary, temp.path().to_path_buf())
        .await
        .expect("spawn aria2c");

    let unauthorized = rpc(daemon.port, json!([])).await;
    let message = unauthorized["error"]["message"]
        .as_str()
        .unwrap_or_default();
    assert!(
        !message.is_empty(),
        "missing unauthorized RPC error: {unauthorized}"
    );
    assert!(
        message.to_ascii_lowercase().contains("unauthorized"),
        "expected Unauthorized, got {unauthorized}"
    );

    let authorized = rpc(daemon.port, json!([format!("token:{}", daemon.secret)])).await;
    assert_eq!(
        authorized["error"],
        Value::Null,
        "authorized RPC failed: {authorized}"
    );
    assert!(authorized["result"]["version"].is_string());

    let error = daemon
        .tell_status("0000000000000001")
        .await
        .expect_err("unknown task should fail")
        .to_string();
    assert!(error.contains("tellStatus:"), "{error}");
    assert!(error.contains("is not found"), "{error}");

    daemon.shutdown().await.expect("shutdown aria2c");
    assert!(!daemon.is_running().await.expect("check stopped daemon"));
    assert!(matches!(
        daemon.version().await,
        Err(gruzly_lib::core::aria2::Aria2Error::Transport("getVersion"))
    ));

    let replacement = Aria2Daemon::spawn(&binary, temp.path().to_path_buf())
        .await
        .expect("restart aria2c");
    assert!(replacement
        .is_running()
        .await
        .expect("check replacement daemon"));
    replacement
        .version()
        .await
        .expect("replacement RPC responds");
    replacement
        .shutdown()
        .await
        .expect("shutdown replacement aria2c");
}

// Keep the integration test independent of the app's runtime filesystem.
mod tempfile_dir {
    use std::path::{Path, PathBuf};

    pub struct TempDir(PathBuf);

    impl TempDir {
        pub fn new(prefix: &str) -> std::io::Result<Self> {
            let path =
                std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4().simple()));
            std::fs::create_dir_all(&path)?;
            Ok(Self(path))
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
