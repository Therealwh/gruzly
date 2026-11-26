//! Exercises file selection and resume with the bundled engine and a local web seed.

use base64::Engine;
use gruzly_lib::core::aria2::{Aria2Daemon, Aria2Status};
use serde_json::json;
use sha1::{Digest, Sha1};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

const PIECE: usize = 16 * 1024;
static DATA: [u8; PIECE * 64] = [42; PIECE * 64];

#[tokio::test]
#[ignore = "requires a local aria2c binary; run with --ignored"]
async fn torrent_selection_and_resume_preserve_the_payload() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let bundled = manifest.join("binaries/aria2c-x86_64-pc-windows-msvc.exe");
    let binary = if bundled.exists() {
        bundled
    } else {
        PathBuf::from("aria2c")
    };
    let dir = std::env::temp_dir().join(format!("gruzly-loopback-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let _temp = TempDir(dir.clone());
    let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let web_seed = format!("http://{}/", server.local_addr().unwrap());
    let server_task = tokio::spawn(async move {
        while let Ok((stream, _)) = server.accept().await {
            tokio::spawn(serve(stream));
        }
    });

    let daemon = Aria2Daemon::spawn(&binary, dir.clone()).await.unwrap();
    let b64 = base64::engine::general_purpose::STANDARD.encode(torrent(&web_seed));
    let gid = daemon
        .add_torrent(
            &b64,
            json!({"seed-time":"0", "max-download-limit":"512K"}),
            true,
        )
        .await
        .unwrap();
    let ready = wait_for(&daemon, &gid, |st| st.status == "paused").await;
    assert_eq!(ready.files.len(), 2);
    assert_eq!(ready.connections, Some(0));
    assert_eq!(ready.seeders, Some(0));
    assert_eq!(ready.upload_speed, Some(0));
    daemon.select_files(&gid, &[1]).await.unwrap();
    daemon.unpause(&gid).await.unwrap();
    let progress = wait_for(&daemon, &gid, |st| {
        st.status == "active" && st.completed() >= PIECE as u64
    })
    .await;
    assert!(progress.files[0].selected);
    assert!(!progress.files[1].selected);
    daemon.pause(&gid).await.unwrap();
    wait_for(&daemon, &gid, |st| st.status == "paused").await;
    daemon.unpause(&gid).await.unwrap();
    let completed = wait_for(&daemon, &gid, |st| st.status == "complete").await;
    assert_eq!(completed.completed(), DATA.len() as u64);
    assert_eq!(
        std::fs::read(dir.join("sample/keep.bin"))
            .unwrap()
            .as_slice(),
        &DATA
    );
    assert!(!dir.join("sample/skip.bin").exists());
    daemon.shutdown().await.unwrap();
    server_task.abort();
}

async fn wait_for(
    daemon: &Aria2Daemon,
    gid: &str,
    predicate: impl Fn(&Aria2Status) -> bool,
) -> Aria2Status {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let status = daemon.tell_status(gid).await.unwrap();
            assert_ne!(status.status, "error", "{:?}", status.error_message);
            if predicate(&status) {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("aria2 reached the expected state")
}

fn torrent(web_seed: &str) -> Vec<u8> {
    let mut pieces = Vec::new();
    for chunk in DATA.chunks(PIECE) {
        pieces.extend_from_slice(&Sha1::digest(chunk));
    }
    pieces.extend_from_slice(&Sha1::digest([0u8; PIECE]));
    let mut bytes = format!(
        "d4:infod5:filesld6:lengthi{}e4:pathl8:keep.bineed6:lengthi{PIECE}e4:pathl8:skip.bineee4:name6:sample12:piece lengthi{PIECE}e6:pieces{}:",
        DATA.len(), pieces.len(),
    ).into_bytes();
    bytes.extend(pieces);
    bytes.extend(format!("e8:url-list{}:{web_seed}e", web_seed.len()).into_bytes());
    bytes
}

async fn serve(mut stream: TcpStream) -> std::io::Result<()> {
    let mut reader = BufReader::new(&mut stream);
    let mut line = String::new();
    reader.read_line(&mut line).await?;
    let head = line.starts_with("HEAD ");
    if !line.contains("/sample/keep.bin ") {
        return stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
    }
    let mut range = None;
    loop {
        line.clear();
        if reader.read_line(&mut line).await? == 0 || line == "\r\n" {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
            range = value.trim().split_once('-').and_then(|(start, end)| {
                let start: usize = start.parse().ok()?;
                let end: usize = end.parse().unwrap_or(DATA.len() - 1);
                (start <= end && end < DATA.len()).then_some((start, end))
            });
        }
    }
    let (start, end) = range.unwrap_or((0, DATA.len() - 1));
    let (status, content_range) = if range.is_some() {
        (
            "206 Partial Content",
            format!("Content-Range: bytes {start}-{end}/{}\r\n", DATA.len()),
        )
    } else {
        ("200 OK", String::new())
    };
    stream.write_all(format!("HTTP/1.1 {status}\r\n{content_range}Content-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n", end - start + 1).as_bytes()).await?;
    if !head {
        for chunk in DATA[start..=end].chunks(PIECE / 2) {
            stream.write_all(chunk).await?;
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
    Ok(())
}

struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
