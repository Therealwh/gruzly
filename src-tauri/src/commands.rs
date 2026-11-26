//! Tauri IPC commands exposed to the frontend.

use serde::Serialize;
use tauri::State;

use crate::core::db::HistoryRecord;
use crate::core::engines::{self, EngineInfo};
use crate::core::queue::{
    self, JobView, QueueManager, QueueSlots, TorrentReadyEvent, TorrentSource,
};
use crate::core::ytdlp::{self, Analysis, VideoDownloadSpec};
use crate::AppState;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub os: String,
    pub arch: String,
}

/// Error with a stable `code` the frontend maps to an i18n key.
#[derive(Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    fn of(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

type CmdResult<T> = Result<T, CommandError>;

#[tauri::command]
pub fn get_app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
pub async fn get_engine_info(app: tauri::AppHandle) -> Result<Vec<EngineInfo>, String> {
    tokio::task::spawn_blocking(move || engines::probe_all(&app))
        .await
        .map_err(|e| format!("probe task failed: {e}"))
}

#[tauri::command]
pub async fn analyze_url(app: tauri::AppHandle, url: String) -> CmdResult<Analysis> {
    let binary = engines::find_engine(&app, "yt-dlp")
        .ok_or_else(|| CommandError::of("engineMissing", "yt-dlp not found"))?;
    let url2 = url.clone();
    tokio::task::spawn_blocking(move || ytdlp::analyze(&binary, &url2))
        .await
        .map_err(|e| CommandError::of("analysisFailed", e.to_string()))?
        .map_err(|e| CommandError::of(e.code(), e.to_string()))
}

#[tauri::command]
pub async fn start_video_download(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    spec: VideoDownloadSpec,
    title: String,
    thumbnail: Option<String>,
) -> CmdResult<String> {
    queue::start_video(app, queue, spec, title, thumbnail)
        .await
        .map_err(|e| CommandError::of("downloadStart", e))
}

#[tauri::command]
pub async fn start_file_download(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    url: String,
    title: Option<String>,
    folder: Option<String>,
) -> CmdResult<String> {
    queue::start_file(app, queue, url, title, folder)
        .await
        .map_err(|e| CommandError::of("downloadStart", e))
}

#[tauri::command]
pub async fn start_torrent(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    source: TorrentSource,
    folder: Option<String>,
) -> CmdResult<String> {
    queue::start_torrent(app, queue, source, folder)
        .await
        .map_err(|e| {
            // duplicate-detection returns its own stable codes
            if e == "torrentActive" || e == "torrentComplete" {
                CommandError::of(&e, e.clone())
            } else {
                CommandError::of("downloadStart", e)
            }
        })
}

#[tauri::command]
pub async fn torrent_files(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    job_id: String,
) -> CmdResult<TorrentReadyEvent> {
    queue::torrent_files(app, queue, job_id)
        .await
        .map_err(|e| CommandError::of("jobOp", e))
}

#[tauri::command]
pub async fn select_torrent_files(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    job_id: String,
    indices: Vec<u64>,
) -> CmdResult<()> {
    queue::select_torrent_files(app, queue, job_id, indices)
        .await
        .map_err(|e| CommandError::of("jobOp", e))
}

#[tauri::command]
pub async fn pause_job(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
) -> CmdResult<()> {
    queue::pause_job(app, queue, id)
        .await
        .map_err(|e| CommandError::of("jobOp", e))
}

#[tauri::command]
pub async fn resume_job(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
) -> CmdResult<()> {
    queue::resume_job(app, queue, id)
        .await
        .map_err(|e| CommandError::of("jobOp", e))
}

#[tauri::command]
pub async fn retry_job(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
    torrent_base64: Option<String>,
) -> CmdResult<String> {
    queue::retry_job(app, queue, id, torrent_base64)
        .await
        .map_err(|e| CommandError::of(e.code(), e.to_string()))
}

#[tauri::command]
pub async fn cancel_job(queue: State<'_, QueueManager>, id: String) -> CmdResult<()> {
    queue::cancel_job(queue, id)
        .await
        .map_err(|e| CommandError::of("jobOp", e))
}

#[tauri::command]
pub async fn remove_job(queue: State<'_, QueueManager>, id: String) -> CmdResult<()> {
    queue::remove_job(queue, id)
        .await
        .map_err(|e| CommandError::of("jobOp", e))
}

#[tauri::command]
pub async fn list_jobs(queue: State<'_, QueueManager>) -> CmdResult<Vec<JobView>> {
    Ok(queue::list_jobs(queue).await)
}

#[tauri::command]
pub fn queue_slots(queue: State<'_, QueueManager>) -> QueueSlots {
    queue.slots()
}

#[tauri::command]
pub fn take_pending_links(app: tauri::AppHandle) -> Vec<String> {
    crate::core::links::take_pending(&app)
}

#[tauri::command]
pub async fn open_completed_download(
    queue: State<'_, QueueManager>,
    id: String,
    play: bool,
) -> CmdResult<()> {
    queue::open_completed_download(queue, &id, play)
        .await
        .map_err(|err| CommandError::of("jobOp", err))
}

#[tauri::command]
pub async fn list_history(
    state: State<'_, AppState>,
    query: Option<String>,
    kind: Option<String>,
    status: Option<String>,
    since_ms: Option<i64>,
) -> CmdResult<Vec<HistoryRecord>> {
    let db = state.db.clone();
    let query = query.unwrap_or_default();
    let kind = kind.unwrap_or_else(|| "all".into());
    let status = status.unwrap_or_else(|| "all".into());
    tokio::task::spawn_blocking(move || {
        db.list_history(&query, &kind, &status, since_ms, 1000)
            .map_err(|e| CommandError::of("db", e.to_string()))
    })
    .await
    .map_err(|e| CommandError::of("db", e.to_string()))?
}

#[tauri::command]
pub async fn delete_history_record(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        db.delete_history_record(&id)
            .map_err(|e| CommandError::of("db", e.to_string()))
    })
    .await
    .map_err(|e| CommandError::of("db", e.to_string()))?
}

#[tauri::command]
pub async fn check_files_exist(paths: Vec<String>) -> CmdResult<Vec<bool>> {
    Ok(paths
        .into_iter()
        .map(|p| std::path::Path::new(&p).is_file())
        .collect())
}

#[tauri::command]
pub async fn clear_history(state: State<'_, AppState>) -> CmdResult<u32> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        db.clear_history()
            .map(|n| n as u32)
            .map_err(|e| CommandError::of("db", e.to_string()))
    })
    .await
    .map_err(|e| CommandError::of("db", e.to_string()))?
}

#[tauri::command]
pub async fn prepare_shutdown(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
) -> CmdResult<()> {
    // The updater may fail and leave the current app running. Pause jobs so
    // their resumable state is persisted, but keep engines alive until the
    // updater hands off to relaunch; the normal Exit path shuts them down.
    queue::pause_all_jobs(app, queue.clone()).await;
    queue.wait_for_video_pause().await;
    Ok(())
}

#[tauri::command]
pub async fn update_ytdlp(app: tauri::AppHandle) -> CmdResult<String> {
    queue::update_ytdlp(app)
        .await
        .map_err(|e| CommandError::of("engineUpdate", e))
}

#[tauri::command]
pub async fn set_parallel(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    n: u32,
) -> CmdResult<()> {
    queue::set_parallel(app, queue, n)
        .await
        .map_err(|e| CommandError::of("settings", e))
}

#[tauri::command]
pub async fn set_job_order(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    ids: Vec<String>,
) -> CmdResult<()> {
    queue::set_job_order(app, queue, ids)
        .await
        .map_err(|e| CommandError::of("reorder", e))
}

#[tauri::command]
pub async fn set_close_to_tray(state: State<'_, AppState>, enabled: bool) -> CmdResult<()> {
    state
        .close_to_tray
        .store(enabled, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn set_tray_language(app: tauri::AppHandle, lang: String) -> CmdResult<()> {
    crate::core::tray::build_tray(&app, &lang).map_err(|e| CommandError::of("tray", e.to_string()))
}

#[tauri::command]
pub async fn set_speed_limit(app: tauri::AppHandle, limit: String) -> CmdResult<()> {
    queue::set_speed_limit(app, limit)
        .await
        .map_err(|e| CommandError::of("settings", e))
}

#[tauri::command]
pub async fn set_seed_ratio(app: tauri::AppHandle, ratio: String) -> CmdResult<()> {
    queue::set_seed_ratio(app, ratio)
        .await
        .map_err(|e| CommandError::of("settings", e))
}

#[tauri::command]
pub async fn set_proxy(app: tauri::AppHandle, proxy: String) -> CmdResult<()> {
    queue::set_proxy(app, proxy)
        .await
        .map_err(|e| CommandError::of("settings", e))
}

#[tauri::command]
pub async fn set_engine_autoupdate(state: State<'_, AppState>, enabled: bool) -> CmdResult<()> {
    state
        .engine_auto_update
        .store(enabled, std::sync::atomic::Ordering::SeqCst);
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        db.set_setting("enginesAutoUpdate", if enabled { "1" } else { "0" })
    })
    .await
    .map_err(|e| CommandError::of("settings", e.to_string()))?
    .map_err(|e| CommandError::of("settings", e.to_string()))
}
