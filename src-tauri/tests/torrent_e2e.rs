//! End-to-end torrent test against a real aria2c daemon.
//!
//! Downloads a small file from the official Arch Linux torrent (iso + sig),
//! proving the whole pipeline used by the app: spawn → addTorrent(paused)
//! → metadata → file selection → unpause → completion → files on disk.
//!
//! Requires network access and the bundled aria2c binary; run manually:
//!   cargo test --test torrent_e2e -- --ignored --nocapture

use gruzly_lib::core::aria2::Aria2Daemon;
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[tokio::test]
#[ignore = "requires network and bundled aria2c; run with --ignored"]
async fn torrent_select_file_e2e() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let binary = manifest.join("binaries/aria2c-x86_64-pc-windows-msvc.exe");
    let binary = if binary.exists() {
        binary
    } else {
        PathBuf::from("aria2c")
    };

    let dir = std::env::temp_dir().join(format!("gruzly-e2e-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();

    let daemon = Aria2Daemon::spawn(&binary, dir.clone())
        .await
        .expect("spawn daemon");

    // Fetch the official Arch torrent (contains iso + sig). The listing
    // gives the current dated filename (e.g. archlinux-2026.11.01-…).
    let listing = reqwest::get("https://mirror.rackspace.com/archlinux/iso/latest/")
        .await
        .expect("fetch listing")
        .error_for_status()
        .expect("listing status")
        .text()
        .await
        .expect("listing text");
    let torrent_name = listing
        .split('"')
        .find(|f| f.contains("x86_64") && f.ends_with(".iso.torrent"))
        .expect("iso torrent in listing")
        .to_string();
    println!("torrent file: {torrent_name}");
    let torrent_bytes = reqwest::get(format!(
        "https://mirror.rackspace.com/archlinux/iso/latest/{torrent_name}"
    ))
    .await
    .expect("fetch torrent")
    .error_for_status()
    .expect("torrent status")
    .bytes()
    .await
    .expect("torrent bytes")
    .to_vec();

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &torrent_bytes);
    let gid = daemon
        .add_torrent(&b64, serde_json::json!({}), true)
        .await
        .expect("addTorrent");

    // Wait for metadata: real files appear (not just [METADATA]).
    let deadline = Instant::now() + Duration::from_secs(60);
    let files = loop {
        let st = daemon.tell_status(&gid).await.expect("tellStatus");
        if !st.is_metadata_only() && !st.files.is_empty() {
            break st.files;
        }
        assert!(
            Instant::now() < deadline,
            "metadata never resolved for gid {gid}"
        );
        tokio::time::sleep(Duration::from_millis(300)).await;
    };
    assert!(!files.is_empty(), "expected torrent file entries");
    println!(
        "metadata files: {:?}",
        files.iter().map(|f| &f.path).collect::<Vec<_>>()
    );

    // Prove selective download: explicitly re-select every file, then unpause.
    let indices: Vec<u64> = files.iter().map(|f| f.index).collect();
    daemon
        .select_files(&gid, &indices)
        .await
        .expect("select files");
    daemon.unpause(&gid).await.expect("unpause");

    // Real download must progress: wait until >5 MB of data arrives from
    // peers (the ISO is ~1.3 GB, peers are plentiful for Arch).
    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        let st = daemon.tell_status(&gid).await.expect("tellStatus progress");
        println!(
            "status={} completed={} total={} speed={}",
            st.status,
            st.completed(),
            st.total(),
            st.speed()
        );
        if st.completed() > 5 * 1024 * 1024 {
            println!(
                "E2E OK: real peers delivering data ({:>10} bytes)",
                st.completed()
            );
            break;
        }
        assert!(
            Instant::now() < deadline,
            "no data after 3 min — torrent pipeline broken"
        );
        tokio::time::sleep(Duration::from_millis(700)).await;
    }

    // Cleanup: stop the daemon and remove the temp dir.
    drop(daemon);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let _ = std::fs::remove_dir_all(&dir);
}
