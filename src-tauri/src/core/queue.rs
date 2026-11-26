//! Unified download queue: one structure owns every job regardless of the
//! engine that performs it. Progress reaches the UI as throttled Tauri
//! events (`job://progress` ≤4/s per job, `job://state` on transitions).
//!
//! Ownership: the job's runner task exclusively owns the spawned child
//! process. Pause/cancel commands set flags and signal a `Notify`; the
//! runner selects on that signal, kills the child and settles the status.
//! This keeps killing race-free without sharing the child handle.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, Notify};

static YTDLP_UPDATE_LOCK: Mutex<()> = Mutex::const_new(());

use super::aria2::{Aria2Daemon, Aria2Error, Aria2Status};
use super::db::HistoryRecord;
use super::engines;
use super::ytdlp::{self, VideoDownloadSpec, YtdlpProgress};

/// CREATE_NO_WINDOW: engine processes run inside a GUI app on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobKind {
    Video,
    // M2 wires aria2 jobs into the same queue; variants exist on the wire already.
    #[allow(dead_code)]
    File,
    #[allow(dead_code)]
    Torrent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Downloading,
    Merging,
    Seeding,
    Paused,
    Completed,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: String,
    pub kind: JobKind,
    pub engine: String,
    pub url: String,
    pub title: String,
    pub folder: Option<String>,
    pub filename: Option<String>,
    pub status: JobStatus,
    pub error: Option<String>,
    pub error_code: Option<u64>,
    pub torrent_phase: Option<TorrentPhase>,
    pub thumbnail: Option<String>,
    pub can_retry: bool,
    pub retry_needs_torrent: bool,
    pub downloaded_bytes: f64,
    pub total_bytes: Option<f64>,
    pub fraction: Option<f64>,
    pub speed: f64,
    pub eta: f64,
    pub connections: Option<u64>,
    pub seeders: Option<u64>,
    pub upload_speed: Option<u64>,
    pub created_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub id: String,
    pub downloaded_bytes: f64,
    pub total_bytes: Option<f64>,
    pub fraction: Option<f64>,
    pub speed: f64,
    pub eta: f64,
    pub connections: Option<u64>,
    pub seeders: Option<u64>,
    pub upload_speed: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StateEvent {
    pub id: String,
    pub status: JobStatus,
    pub kind: JobKind,
    pub engine: String,
    pub title: Option<String>,
    pub folder: Option<String>,
    pub filename: Option<String>,
    pub error: Option<String>,
    pub error_code: Option<u64>,
    pub torrent_phase: Option<TorrentPhase>,
    pub thumbnail: Option<String>,
    pub can_retry: bool,
    pub retry_needs_torrent: bool,
}

pub const EVENT_PROGRESS: &str = "job://progress";
pub const EVENT_STATE: &str = "job://state";
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TorrentPhase {
    Metadata,
    SelectFiles,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSlots {
    pub in_use: u32,
    pub limit: u32,
}

pub const EVENT_SLOTS: &str = "queue://slots";
pub const EVENT_ACTIVITY: &str = "job://activity";
const EMIT_INTERVAL: Duration = Duration::from_millis(250); // ≤4 renders/sec

#[derive(Debug, Default, Clone)]
struct Progress {
    downloaded: f64,
    total: Option<f64>,
    fraction: Option<f64>,
    speed: f64,
    eta: f64,
    connections: Option<u64>,
    seeders: Option<u64>,
    upload_speed: Option<u64>,
    filename: Option<String>,
    last_emit: Option<Instant>,
}

struct Job {
    id: String,
    kind: JobKind,
    engine: String,
    url: String,
    /// Mutable: torrent titles arrive with metadata after the job starts.
    title: Mutex<String>,
    /// Preview image URL (video) — for history records.
    thumbnail: Option<String>,
    torrent_phase: StdMutex<Option<TorrentPhase>>,
    torrent: Mutex<TorrentData>,
    control: Mutex<()>,
    folder: Option<String>,
    status: Mutex<(JobStatus, Option<String>, Option<u64>)>, // status + error + engine code
    progress: Mutex<Progress>,
    spec: Option<VideoDownloadSpec>,
    /// aria2 gid for file/torrent jobs; None for video jobs.
    gid: Mutex<Option<String>>,
    daemon: Mutex<std::sync::Weak<Aria2Daemon>>,
    kill: Arc<Notify>,
    pause_requested: AtomicBool,
    pause_sequence: std::sync::atomic::AtomicU64,
    cancel_requested: AtomicBool,
    /// Torrent metadata is held paused until the file-selection modal confirms.
    torrent_selected: AtomicBool,
    runner_active: AtomicBool,
    created_at: i64,
}

fn make_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Resizable parallelism gate (tokio Semaphore cannot resize) that grants
/// slots in display-order: the queued job with the smallest pending rank
/// starts next, so drag-and-drop priorities control launch order.
struct GateState {
    limit: u32,
    in_use: u32,
    pending: Vec<(u64, String)>, // (token, job id)
    ranks: HashMap<String, usize>,
}

pub struct Gate {
    state: StdMutex<GateState>,
    next_token: std::sync::atomic::AtomicU64,
    notify: Notify,
    slots: tokio::sync::watch::Sender<QueueSlots>,
}

impl Gate {
    fn new(initial: u32) -> Self {
        let limit = initial.max(1);
        Self {
            state: StdMutex::new(GateState {
                limit,
                in_use: 0,
                pending: Vec::new(),
                ranks: HashMap::new(),
            }),
            next_token: std::sync::atomic::AtomicU64::new(0),
            notify: Notify::new(),
            slots: tokio::sync::watch::channel(QueueSlots { in_use: 0, limit }).0,
        }
    }

    fn snapshot(&self) -> QueueSlots {
        *self.slots.borrow()
    }

    fn publish(&self, state: &GateState) {
        let slots = QueueSlots {
            in_use: state.in_use,
            limit: state.limit,
        };
        self.slots.send_if_modified(|previous| {
            if *previous == slots {
                return false;
            }
            *previous = slots;
            true
        });
    }

    /// Registers a waiting job and returns its ticket token.
    fn register(&self, id: &str) -> u64 {
        let token = self
            .next_token
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.state
            .lock()
            .expect("gate lock")
            .pending
            .push((token, id.to_owned()));
        self.notify.notify_waiters();
        token
    }

    fn try_acquire(&self, token: u64) -> bool {
        let mut state = self.state.lock().expect("gate lock");
        let is_next = state
            .pending
            .iter()
            .min_by_key(|(_, id)| state.ranks.get(id).copied().unwrap_or(usize::MAX))
            .map(|(candidate, _)| *candidate == token)
            .unwrap_or(false);
        if !is_next || state.in_use >= state.limit {
            return false;
        }
        state.in_use += 1;
        self.publish(&state);
        state.pending.retain(|(candidate, _)| *candidate != token);
        self.notify.notify_waiters();
        true
    }

    fn cancel(&self, token: u64) {
        self.state
            .lock()
            .expect("gate lock")
            .pending
            .retain(|(candidate, _)| *candidate != token);
        self.notify.notify_waiters();
    }

    fn release(&self) {
        let mut state = self.state.lock().expect("gate lock");
        state.in_use = state.in_use.saturating_sub(1);
        self.publish(&state);
        drop(state);
        self.notify.notify_waiters();
    }

    fn set_order(&self, ids: &[String]) {
        self.state.lock().expect("gate lock").ranks = ids
            .iter()
            .enumerate()
            .map(|(rank, id)| (id.clone(), rank))
            .collect();
        self.notify.notify_waiters();
    }

    fn set_limit(&self, n: u32) {
        let mut state = self.state.lock().expect("gate lock");
        state.limit = n.max(1);
        self.publish(&state);
        drop(state);
        self.notify.notify_waiters();
    }
}

/// Held for the duration of a running job; releases its slot on drop.
pub struct GateGuard {
    gate: Arc<Gate>,
}

impl Drop for GateGuard {
    fn drop(&mut self) {
        self.gate.release();
    }
}

impl GateGuard {
    /// Registers with the job's display rank, waits in order, and removes its
    /// ticket when pause/cancel arrives while still queued.
    async fn acquire(gate: Arc<Gate>, job: &Job) -> Option<Self> {
        let token = gate.register(&job.id);
        loop {
            let gate_wake = gate.notify.notified();
            let kill_wake = job.kill.notified();
            if job.pause_requested.load(Ordering::SeqCst)
                || job.cancel_requested.load(Ordering::SeqCst)
            {
                gate.cancel(token);
                return None;
            }
            if gate.try_acquire(token) {
                drop(gate_wake);
                drop(kill_wake);
                return Some(Self { gate });
            }
            tokio::select! {
                _ = gate_wake => {},
                _ = kill_wake => {},
            }
        }
    }
}

struct ProcessRegistry {
    shutting_down: bool,
    ytdlp: HashMap<u32, Arc<Job>>,
}

pub struct QueueManager {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    order: Mutex<Vec<String>>,
    gate: Arc<Gate>,
    processes: Mutex<ProcessRegistry>,
    aria_add: Mutex<()>,
    process_exit: Notify,
}

impl Default for QueueManager {
    fn default() -> Self {
        Self::new()
    }
}

impl QueueManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
            gate: Arc::new(Gate::new(3)), // parallel limit; adjustable from Settings
            aria_add: Mutex::new(()),
            processes: Mutex::new(ProcessRegistry {
                shutting_down: false,
                ytdlp: HashMap::new(),
            }),
            process_exit: Notify::new(),
        }
    }

    pub fn slots(&self) -> QueueSlots {
        self.gate.snapshot()
    }

    pub fn emit_slot_changes(&self, app: AppHandle) {
        let mut slots = self.gate.slots.subscribe();
        tauri::async_runtime::spawn(async move {
            while slots.changed().await.is_ok() {
                let snapshot = *slots.borrow_and_update();
                let _ = app.emit(EVENT_SLOTS, snapshot);
            }
        });
    }

    async fn spawn_ytdlp_child(
        &self,
        job: Arc<Job>,
        mut command: Command,
    ) -> std::io::Result<Option<tokio::process::Child>> {
        let mut processes = self.processes.lock().await;
        if processes.shutting_down {
            return Ok(None);
        }
        let child = command.spawn()?;
        if let Some(pid) = child.id() {
            processes.ytdlp.insert(pid, job);
            Ok(Some(child))
        } else {
            Ok(None)
        }
    }

    async fn unregister_ytdlp(&self, pid: u32) {
        self.processes.lock().await.ytdlp.remove(&pid);
        self.process_exit.notify_waiters();
    }

    async fn is_shutting_down(&self) -> bool {
        self.processes.lock().await.shutting_down
    }

    /// Waits until currently running yt-dlp children have handled a pause.
    /// Unlike final shutdown, this keeps the queue usable if an update fails.
    pub async fn wait_for_video_pause(&self) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            let notified = self.process_exit.notified();
            if self.processes.lock().await.ytdlp.is_empty() {
                return;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                log::warn!("timed out waiting for yt-dlp pause before update");
                return;
            }
        }
    }

    /// Pauses and waits for every yt-dlp runner. The runner owns its Child,
    /// so normal cleanup preserves resumable state and includes descendants.
    pub async fn shutdown_engine_processes(&self) {
        let jobs: Vec<Arc<Job>> = {
            let mut processes = self.processes.lock().await;
            processes.shutting_down = true;
            processes.ytdlp.values().cloned().collect()
        };
        for job in jobs {
            job.pause_requested.store(true, Ordering::SeqCst);
            job.kill.notify_one();
        }

        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            let notified = self.process_exit.notified();
            if self.processes.lock().await.ytdlp.is_empty() {
                return;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                let pids: Vec<u32> = self.processes.lock().await.ytdlp.keys().copied().collect();
                log::warn!("timed out waiting for {} yt-dlp process(es)", pids.len());
                for pid in pids {
                    terminate_process_tree(pid).await;
                }
                return;
            }
        }
    }
}

impl Job {
    fn phase(&self) -> Option<TorrentPhase> {
        *self.torrent_phase.lock().expect("torrent phase lock")
    }

    fn set_phase(&self, phase: Option<TorrentPhase>) {
        *self.torrent_phase.lock().expect("torrent phase lock") = phase;
    }

    fn retry_needs_torrent(&self, status: &JobStatus) -> bool {
        *status == JobStatus::Failed && self.kind == JobKind::Torrent && self.url == "torrent"
    }

    fn can_retry(&self, status: &JobStatus) -> bool {
        *status == JobStatus::Failed && (self.spec.is_some() || self.engine == "aria2")
    }
}

async fn job_view(job: &Job) -> JobView {
    let status = job.status.lock().await.clone();
    let progress = job.progress.lock().await.clone();
    JobView {
        id: job.id.clone(),
        kind: job.kind,
        engine: job.engine.clone(),
        url: job.url.clone(),
        title: job.title.lock().await.clone(),
        folder: job.folder.clone(),
        filename: progress.filename.clone(),
        can_retry: job.can_retry(&status.0),
        retry_needs_torrent: job.retry_needs_torrent(&status.0),
        torrent_phase: job.phase(),
        thumbnail: job.thumbnail.clone(),
        status: status.0,
        error: status.1,
        error_code: status.2,
        downloaded_bytes: progress.downloaded,
        total_bytes: progress.total,
        fraction: progress.fraction,
        speed: progress.speed,
        eta: progress.eta,
        connections: progress.connections,
        seeders: progress.seeders,
        upload_speed: progress.upload_speed,
        created_at: job.created_at,
    }
}

async fn set_status(app: &AppHandle, job: &Job, status: JobStatus, error: Option<String>) {
    set_status_with_code(app, job, status, error, None).await;
}

async fn set_status_with_code(
    app: &AppHandle,
    job: &Job,
    status: JobStatus,
    error: Option<String>,
    error_code: Option<u64>,
) {
    if matches!(
        status,
        JobStatus::Failed | JobStatus::Canceled | JobStatus::Completed
    ) {
        job.set_phase(None);
    }
    {
        let mut s = job.status.lock().await;
        s.0 = status.clone();
        s.1 = error.clone();
        s.2 = error_code;
    }
    // Keep the persistent history in sync with every transition; started_at
    // is stamped the first time a job actually downloads.
    {
        let state: State<'_, crate::AppState> = app.state();
        let db = state.db.clone();
        let id = job.id.clone();
        let status_str = match status {
            JobStatus::Queued => "queued",
            JobStatus::Downloading => "downloading",
            JobStatus::Merging => "merging",
            JobStatus::Seeding => "seeding",
            JobStatus::Paused => "paused",
            JobStatus::Completed => "completed",
            JobStatus::Failed => "failed",
            JobStatus::Canceled => "canceled",
        }
        .to_string();
        let started_at = (status == JobStatus::Downloading).then(now_ms);
        let error_str = error.clone();
        let _ = tokio::task::spawn_blocking(move || {
            db.patch_history_status(&id, &status_str, started_at, error_str.as_deref())
        })
        .await;
    }
    let title = job.title.lock().await.clone();
    emit_state(app, job, status, Some(title), error).await;
}

/// Throttled live status line to the UI (used by stdout notes and stderr).
fn emit_activity(app: &AppHandle, id: &str, text: &str) {
    let _ = app.emit(
        EVENT_ACTIVITY,
        serde_json::json!({ "id": id, "text": text }),
    );
}

fn emit_progress(app: &AppHandle, job: &Job, progress: &mut Progress, force: bool) {
    if !force
        && progress
            .last_emit
            .is_some_and(|at| at.elapsed() < EMIT_INTERVAL)
    {
        return;
    }
    progress.last_emit = Some(Instant::now());
    let _ = app.emit(
        EVENT_PROGRESS,
        ProgressEvent {
            id: job.id.clone(),
            downloaded_bytes: progress.downloaded,
            total_bytes: progress.total,
            fraction: progress.fraction,
            speed: progress.speed,
            eta: progress.eta,
            connections: progress.connections,
            seeders: progress.seeders,
            upload_speed: progress.upload_speed,
        },
    );
}

async fn on_progress(app: &AppHandle, job: &Job, p: YtdlpProgress) {
    let mut progress = job.progress.lock().await;
    let total = p.total();
    if let Some(filename) = p.filename {
        if progress
            .filename
            .as_ref()
            .is_some_and(|previous| previous != &filename)
            && p.status.as_deref() == Some("downloading")
        {
            let last_emit = progress.last_emit;
            *progress = Progress {
                last_emit,
                ..Progress::default()
            };
        }
        progress.filename = Some(filename);
    }
    if let Some(bytes) = p.downloaded_bytes {
        progress.downloaded = bytes;
    }
    if let Some(total) = total.filter(|total| *total > 0.0) {
        progress.total = Some(total);
    } else if let (Some(index), Some(count)) = (p.fragment_index, p.fragment_count) {
        if count > 0 && index > 0 {
            progress.fraction = Some((index as f64 / count as f64).min(1.0));
        }
    }
    if let Some(speed) = p.speed {
        progress.speed = speed;
    }
    if let Some(eta) = p.eta {
        progress.eta = eta;
    }
    emit_progress(app, job, &mut progress, false);
}

/// FFmpeg uses carriage returns for live statistics and newlines for diagnostics.
async fn read_engine_record(
    reader: &mut (impl AsyncBufRead + Unpin),
) -> std::io::Result<Option<String>> {
    let mut record = Vec::new();
    loop {
        let bytes = reader.fill_buf().await?;
        if bytes.is_empty() {
            return Ok((!record.is_empty()).then(|| String::from_utf8_lossy(&record).into_owned()));
        }
        let end = bytes.iter().position(|byte| matches!(byte, b'\r' | b'\n'));
        let length = end.unwrap_or(bytes.len());
        record.extend_from_slice(&bytes[..length.min(256 * 1024 - record.len())]);
        reader.consume(length + usize::from(end.is_some()));
        if end.is_some() {
            return Ok(Some(String::from_utf8_lossy(&record).into_owned()));
        }
    }
}

#[derive(Default)]
struct FfmpegProgress {
    sample: Option<(Instant, f64, f64)>,
}

impl FfmpegProgress {
    fn update(
        &mut self,
        progress: &mut Progress,
        record: &str,
        duration: Option<f64>,
        now: Instant,
    ) -> bool {
        let Some(seconds) = ytdlp::ffmpeg_time_seconds(record) else {
            return false;
        };
        let Some(bytes) = ytdlp::ffmpeg_output_bytes(record) else {
            return false;
        };
        progress.downloaded = bytes;
        if let Some(duration) = duration {
            progress.fraction = Some((seconds / duration).clamp(0.0, 1.0));
        }
        if let Some((at, old_bytes, old_seconds)) = self.sample {
            let elapsed = now.duration_since(at).as_secs_f64();
            if elapsed > 0.0 && bytes >= old_bytes {
                progress.speed = (bytes - old_bytes) / elapsed;
                if let Some(duration) = duration.filter(|_| seconds > old_seconds) {
                    progress.eta =
                        (duration - seconds).max(0.0) * elapsed / (seconds - old_seconds);
                }
            }
        }
        self.sample = Some((now, bytes, seconds));
        true
    }
}

async fn emit_state(
    app: &AppHandle,
    job: &Job,
    status: JobStatus,
    title: Option<String>,
    error: Option<String>,
) {
    let filename = if status == JobStatus::Completed {
        job.progress.lock().await.filename.clone()
    } else {
        None
    };
    let error_code = job.status.lock().await.2;
    let _ = app.emit(
        EVENT_STATE,
        StateEvent {
            id: job.id.clone(),
            can_retry: job.can_retry(&status),
            retry_needs_torrent: job.retry_needs_torrent(&status),
            torrent_phase: job.phase(),
            thumbnail: job.thumbnail.clone(),
            error_code,
            status,
            kind: job.kind,
            engine: job.engine.clone(),
            title,
            folder: job.folder.clone(),
            filename,
            error,
        },
    );
}

/// Starts a yt-dlp video download. Returns the job id immediately.
pub async fn start_video(
    app: AppHandle,
    queue: State<'_, QueueManager>,
    spec: VideoDownloadSpec,
    title: String,
    thumbnail: Option<String>,
) -> Result<String, String> {
    let binary =
        engines::find_engine(&app, "yt-dlp").ok_or_else(|| "yt-dlp not found".to_string())?;
    let ffmpeg = engines::find_engine(&app, "ffmpeg");

    // Default destination: the user's Downloads folder.
    let folder = spec
        .folder
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            app.path()
                .download_dir()
                .ok()
                .map(|p| p.to_string_lossy().to_string())
        });

    let mut spec = spec;
    spec.folder = folder.clone();

    let args = ytdlp::download_args(&spec, ffmpeg.as_ref()).map_err(|e| e.to_string())?;

    let id = make_id();
    let job_thumbnail = thumbnail.clone();
    let job = Arc::new(Job {
        id: id.clone(),
        kind: JobKind::Video,
        engine: "yt-dlp".into(),
        url: spec.url.clone(),
        title: Mutex::new(title.clone()),
        thumbnail: job_thumbnail,
        torrent_phase: StdMutex::new(None),
        torrent: Mutex::new(TorrentData::default()),
        control: Mutex::new(()),
        folder,
        status: Mutex::new((JobStatus::Queued, None, None)),
        progress: Mutex::new(Progress::default()),
        spec: Some(spec),
        gid: Mutex::new(None),
        daemon: Mutex::new(std::sync::Weak::new()),
        kill: Arc::new(Notify::new()),
        pause_requested: AtomicBool::new(false),
        pause_sequence: std::sync::atomic::AtomicU64::new(0),
        cancel_requested: AtomicBool::new(false),
        torrent_selected: AtomicBool::new(false),
        runner_active: AtomicBool::new(false),
        created_at: now_ms(),
    });

    register_job(&queue, job.clone()).await;

    // Persist for restore-after-restart (removed on terminal states) and
    // create the history record at ADD time (patched on transitions).
    {
        let state: State<'_, crate::AppState> = app.state();
        let db = state.db.clone();
        let db2 = db.clone();
        let spec_json = job
            .spec
            .as_ref()
            .map(|s| serde_json::to_string(s).expect("spec json"))
            .unwrap_or_default();
        let format = job.spec.as_ref().and_then(|s| s.format_selector.clone());
        let pending = crate::core::db::PendingJob {
            id: id.clone(),
            kind: "video".into(),
            url: job.url.clone(),
            title: title.clone(),
            folder: job.folder.clone(),
            spec_json,
            created_at: job.created_at,
        };
        let _ = tokio::task::spawn_blocking(move || db.save_pending(&pending)).await;

        let hist = crate::core::db::HistoryRecord {
            id: id.clone(),
            kind: "video".into(),
            engine: "yt-dlp".into(),
            url: job.url.clone(),
            title: title.clone(),
            folder: job.folder.clone(),
            filename: None,
            status: "queued".into(),
            total_bytes: None,
            created_at: job.created_at,
            finished_at: 0,
            thumbnail: thumbnail.clone(),
            format,
            save_path: job.folder.clone(),
            started_at: None,
            error: None,
        };
        let _ = tokio::task::spawn_blocking(move || db2.upsert_history(&hist)).await;
    }

    emit_state(&app, &job, JobStatus::Queued, Some(title.clone()), None).await;
    let _ = job
        .runner_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst);

    tokio::spawn(async move {
        let queue: State<'_, QueueManager> = app.state();

        run_video_job(app.clone(), &queue, job, binary, args).await;
    });

    Ok(id)
}

/// Signals pause. Video jobs: the runner kills the child and marks the
/// job paused. aria2 jobs go through the daemon instead.
pub async fn pause_job(
    app: AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
) -> Result<(), String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or("no such job")?;
    if job.engine == "aria2" {
        return pause_aria2_job(&app, &job).await;
    }
    job.pause_requested.store(true, Ordering::SeqCst);
    job.kill.notify_one();
    Ok(())
}

pub async fn resume_job(
    app: AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
) -> Result<(), String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or("no such job")?;

    if job.engine == "aria2" {
        return resume_aria2_job(&app, &job).await;
    }

    let spec = job.spec.clone().ok_or("job cannot be resumed")?;
    let binary =
        engines::find_engine(&app, "yt-dlp").ok_or_else(|| "yt-dlp not found".to_string())?;
    let ffmpeg = engines::find_engine(&app, "ffmpeg");
    let args = safe_video_resume_args(&spec, ffmpeg.as_ref()).map_err(|e| e.to_string())?;
    if job.status.lock().await.0 != JobStatus::Paused || !claim_runner(&job) {
        return Err("job is not paused".into());
    }
    job.pause_requested.store(false, Ordering::SeqCst);

    set_status(&app, &job, JobStatus::Queued, None).await;
    tokio::spawn(async move {
        let queue: State<'_, QueueManager> = app.state();
        run_video_job(app.clone(), &queue, job, binary, args).await;
    });
    Ok(())
}

pub async fn cancel_job(queue: State<'_, QueueManager>, id: String) -> Result<(), String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or("no such job")?;
    job.cancel_requested.store(true, Ordering::SeqCst);
    job.kill.notify_one();
    Ok(())
}

pub async fn remove_job(queue: State<'_, QueueManager>, id: String) -> Result<(), String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or("no such job")?;
    let _control = job.control.lock().await;
    let status = job.status.lock().await.0.clone();
    if !matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Canceled
    ) {
        return Err("job is still running".into());
    }
    queue.jobs.lock().await.remove(&id);
    let mut order = queue.order.lock().await;
    order.retain(|x| x != &id);
    queue.gate.set_order(&order);
    Ok(())
}

pub async fn list_jobs(queue: State<'_, QueueManager>) -> Vec<JobView> {
    let jobs = queue.jobs.lock().await;
    let order = queue.order.lock().await;
    let mut views = Vec::with_capacity(order.len());
    for id in order.iter() {
        if let Some(job) = jobs.get(id) {
            views.push(job_view(job).await);
        }
    }
    views
}

/// Resolve actions from queue state without taking a path from the renderer.
pub async fn open_completed_download(
    queue: State<'_, QueueManager>,
    id: &str,
    play: bool,
) -> Result<(), String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or("Download not found")?;
    if job.status.lock().await.0 != JobStatus::Completed {
        return Err("Download is not complete".into());
    }
    if play && job.kind != JobKind::Video {
        return Err("Only a completed video can be played".into());
    }
    let folder = job.folder.clone().ok_or("Download folder unavailable")?;
    let filename = job.progress.lock().await.filename.clone();
    tokio::task::spawn_blocking(move || {
        let folder = Path::new(&folder)
            .canonicalize()
            .map_err(|_| "Download folder unavailable")?;
        if !folder.is_dir() {
            return Err("Download folder unavailable".into());
        }
        let file = filename
            .as_deref()
            .and_then(|name| completed_file_in(&folder, Path::new(name)));
        if play {
            let file = file
                .filter(|file| is_playable_media(file))
                .ok_or("Video file unavailable")?;
            return tauri_plugin_opener::open_path(file, None::<&str>)
                .map_err(|err| err.to_string());
        }
        if let Some(file) = file {
            if tauri_plugin_opener::reveal_item_in_dir(&file).is_ok() {
                return Ok(());
            }
            if let Some(parent) = file.parent() {
                return tauri_plugin_opener::open_path(parent, None::<&str>)
                    .map_err(|err| err.to_string());
            }
        }
        tauri_plugin_opener::open_path(folder, None::<&str>).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

fn completed_file_in(folder: &Path, filename: &Path) -> Option<PathBuf> {
    let path = if filename.is_absolute() {
        filename.to_path_buf()
    } else {
        folder.join(filename)
    };
    let path = path.canonicalize().ok()?;
    (path.starts_with(folder) && path.is_file()).then_some(path)
}

fn is_playable_media(file: &Path) -> bool {
    file.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "mp4"
                    | "mkv"
                    | "webm"
                    | "mov"
                    | "avi"
                    | "flv"
                    | "mpeg"
                    | "mpg"
                    | "m4v"
                    | "ts"
                    | "3gp"
                    | "ogv"
                    | "wmv"
                    | "mp3"
                    | "m4a"
                    | "opus"
                    | "ogg"
                    | "aac"
                    | "wav"
                    | "flac"
            )
        })
}

async fn requested_kill(job: &Job) -> Option<bool /* pause */> {
    if job.pause_requested.swap(false, Ordering::SeqCst) {
        Some(true)
    } else if job.cancel_requested.swap(false, Ordering::SeqCst) {
        Some(false)
    } else {
        None
    }
}

/// Stops a tracked engine process and its descendants without invoking a shell.
async fn terminate_process_tree(pid: u32) {
    #[cfg(windows)]
    let mut command = {
        let mut command = tokio::process::Command::new("taskkill.exe");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        command
    };
    #[cfg(unix)]
    let mut command = {
        let mut command = tokio::process::Command::new("kill");
        // The runner creates a dedicated process group so ffmpeg children
        // receive the same signal as their yt-dlp parent.
        command.args(["-TERM", &format!("-{pid}")]);
        command
    };

    let _ = tokio::time::timeout(Duration::from_secs(2), command.status()).await;
}

fn claim_runner(job: &Job) -> bool {
    job.runner_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
}

struct RunnerGuard<'a>(&'a AtomicBool);

impl Drop for RunnerGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

async fn run_video_job(
    app: AppHandle,
    queue: &QueueManager,
    job: Arc<Job>,
    binary: PathBuf,
    args: Vec<String>,
) {
    let _runner_guard = RunnerGuard(&job.runner_active);
    let Some(_guard) = GateGuard::acquire(queue.gate.clone(), &job).await else {
        if job.cancel_requested.swap(false, Ordering::SeqCst) {
            set_status(&app, &job, JobStatus::Canceled, None).await;
        } else {
            set_status(&app, &job, JobStatus::Paused, None).await;
        }
        return;
    };
    if job.cancel_requested.swap(false, Ordering::SeqCst) {
        set_status(&app, &job, JobStatus::Canceled, None).await;
        return;
    }
    if job.pause_requested.swap(false, Ordering::SeqCst) {
        set_status(&app, &job, JobStatus::Paused, None).await;
        return;
    }
    if queue.is_shutting_down().await {
        set_status(&app, &job, JobStatus::Paused, None).await;
        return;
    }
    set_status(&app, &job, JobStatus::Downloading, None).await;

    let mut cmd = Command::new(&binary);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = match queue
        .spawn_ytdlp_child(job.clone(), {
            cmd.args(&args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true);
            cmd
        })
        .await
    {
        Ok(Some(c)) => c,
        Ok(None) => {
            set_status(&app, &job, JobStatus::Paused, None).await;
            return;
        }
        Err(e) => {
            set_status(&app, &job, JobStatus::Failed, Some(e.to_string())).await;
            return;
        }
    };

    let child_pid = child.id();
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let stderr_job = job.clone();
    let stderr_app = app.clone();
    let duration = job
        .spec
        .as_ref()
        .and_then(|spec| spec.duration)
        .filter(|duration| duration.is_finite() && *duration > 0.0);
    let mut stderr_reader = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut ffmpeg = FfmpegProgress::default();
        let mut tail = std::collections::VecDeque::new();
        let mut last_activity = Instant::now() - EMIT_INTERVAL;
        while let Ok(Some(record)) = read_engine_record(&mut reader).await {
            let record = record.trim();
            if let Some(progress) = ytdlp::parse_download_progress(record) {
                on_progress(&stderr_app, &stderr_job, progress).await;
                continue;
            }
            {
                let mut progress = stderr_job.progress.lock().await;
                if ffmpeg.update(&mut progress, record, duration, Instant::now()) {
                    emit_progress(&stderr_app, &stderr_job, &mut progress, false);
                    continue;
                }
            }
            if !record.is_empty() {
                if last_activity.elapsed() >= EMIT_INTERVAL {
                    last_activity = Instant::now();
                    emit_activity(&stderr_app, &stderr_job.id, record);
                }
                if tail.len() == 12 {
                    tail.pop_front();
                }
                tail.push_back(record.chars().take(400).collect::<String>());
            }
        }
        tail.into_iter().collect::<Vec<_>>().join(
            "
",
        )
    });
    let mut output_path = None;
    let mut last_stdout_activity = Instant::now() - EMIT_INTERVAL;

    let mut stdout_lines = BufReader::new(stdout).lines();
    let kill = job.kill.clone();

    // Phase 1: stream progress until stdout closes or a kill is requested.
    let mut killed: Option<bool> = None;
    loop {
        tokio::select! {
            line = stdout_lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let record = l.trim();
                        if let Some(path) = record.strip_prefix(ytdlp::OUTPUT_PREFIX) {
                            output_path = serde_json::from_str::<String>(path).ok();
                        } else if let Some(progress) = ytdlp::parse_download_progress(record) {
                            on_progress(&app, &job, progress).await;
                        } else if !record.is_empty() && last_stdout_activity.elapsed() >= EMIT_INTERVAL {
                            last_stdout_activity = Instant::now();
                            emit_activity(&app, &job.id, record);
                        }
                    }
                    Ok(None) | Err(_) => break,
                }
            }
            _ = kill.notified() => {
                match requested_kill(&job).await {
                    Some(pause) => {
                        killed = Some(pause);
                        let _ = child.kill().await;
                        break;
                    }
                    None => continue, // spurious wakeup
                }
            }
        }
    }

    // Phase 2: wait for exit (still interruptible — e.g. cancel during merge).
    let exit = if killed.is_some() {
        child.wait().await.ok()
    } else {
        tokio::select! {
            res = child.wait() => res.ok(),
            _ = kill.notified() => {
                let pause = requested_kill(&job).await;
                killed = pause;
                let _ = child.kill().await;
                child.wait().await.ok()
            }
        }
    };

    let stderr_tail = match tokio::time::timeout(Duration::from_secs(1), &mut stderr_reader).await {
        Ok(result) => result.unwrap_or_default(),
        Err(_) => {
            stderr_reader.abort();
            let _ = stderr_reader.await;
            String::new()
        }
    };
    match (killed, exit.map(|c| c.success())) {
        (None, Some(true)) => {
            let final_file = match output_path {
                Some(path) => tokio::fs::metadata(&path)
                    .await
                    .ok()
                    .filter(|metadata| metadata.is_file())
                    .map(|metadata| (path, metadata.len())),
                None => None,
            };
            let total_bytes = {
                let mut progress = job.progress.lock().await;
                if let Some((path, bytes)) = final_file {
                    progress.filename = Some(path);
                    progress.downloaded = bytes as f64;
                    progress.total = Some(bytes as f64);
                } else {
                    progress.filename = None;
                    if progress.downloaded > 0.0 {
                        progress.total = Some(progress.downloaded);
                    }
                }
                progress.fraction = Some(1.0);
                progress.speed = 0.0;
                progress.eta = 0.0;
                emit_progress(&app, &job, &mut progress, true);
                progress.downloaded as i64
            };
            set_status(&app, &job, JobStatus::Completed, None).await;
            delete_pending(&app, &job.id).await;
            record_history(&app, &job, JobStatus::Completed, total_bytes).await;
        }
        (Some(true), _) => {
            set_status(&app, &job, JobStatus::Paused, None).await;
        }
        (Some(false), _) => {
            set_status(&app, &job, JobStatus::Canceled, None).await;
            delete_pending(&app, &job.id).await;
        }
        (None, Some(false)) => {
            let err = if stderr_tail.is_empty() {
                "yt-dlp exited with an error".to_string()
            } else {
                stderr_tail.chars().take(1500).collect()
            };
            set_status(&app, &job, JobStatus::Failed, Some(err)).await;
            record_history(&app, &job, JobStatus::Failed, 0).await;
            delete_pending(&app, &job.id).await;
        }
        (None, None) => {
            set_status(
                &app,
                &job,
                JobStatus::Failed,
                Some("engine stopped unexpectedly".into()),
            )
            .await;
            record_history(&app, &job, JobStatus::Failed, 0).await;
            delete_pending(&app, &job.id).await;
        }
    }
    if let Some(pid) = child_pid {
        queue.unregister_ytdlp(pid).await;
    }
}

/// Applies the display order to jobs already waiting for a transfer slot.
pub async fn set_job_order(
    _app: AppHandle,
    queue: State<'_, QueueManager>,
    ids: Vec<String>,
) -> Result<(), String> {
    let jobs = queue.jobs.lock().await;
    let mut order = queue.order.lock().await;

    // Sort: ids first (in the given order), then everything not mentioned.
    let mut next: Vec<String> = Vec::with_capacity(order.len());
    for id in &ids {
        if jobs.contains_key(id) && !next.contains(id) {
            next.push(id.clone());
        }
    }
    for id in order.iter() {
        if !next.contains(id) {
            next.push(id.clone());
        }
    }
    *order = next;
    queue.gate.set_order(&order);
    Ok(())
}

/// Restores unfinished video downloads from the database as PAUSED jobs.
/// Called once at startup — the user presses Resume to continue.
pub async fn restore_pending_jobs(app: AppHandle) -> usize {
    let state: State<'_, crate::AppState> = app.state();
    let rows = match state.db.list_pending() {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("could not read pending queue: {e}");
            return 0;
        }
    };

    let binary = engines::find_engine(&app, "yt-dlp");
    let queue = app.state::<QueueManager>();
    let mut restored = 0;

    for row in rows {
        if row.kind != "video" {
            continue;
        }
        let mut spec: VideoDownloadSpec = match serde_json::from_str(&row.spec_json) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("dropping corrupt pending job {}: {e}", row.id);
                let _ = state.db.delete_pending(&row.id);
                continue;
            }
        };
        // Older specs may carry an HLS-prone selector; the current default
        // avoids m3u8 so progress stays visible.
        spec.format_selector = None;
        if binary.is_none() {
            log::warn!("yt-dlp missing; cannot restore pending job {}", row.id);
            continue;
        }

        let job = Arc::new(Job {
            id: row.id.clone(),
            kind: JobKind::Video,
            engine: "yt-dlp".into(),
            url: row.url.clone(),
            title: Mutex::new(row.title.clone()),
            thumbnail: None,
            torrent_phase: StdMutex::new(None),
            torrent: Mutex::new(TorrentData::default()),
            control: Mutex::new(()),
            folder: row.folder.clone(),
            status: Mutex::new((JobStatus::Paused, None, None)),
            progress: Mutex::new(Progress::default()),
            spec: Some(spec),
            gid: Mutex::new(None),
            daemon: Mutex::new(std::sync::Weak::new()),
            kill: Arc::new(Notify::new()),
            pause_requested: AtomicBool::new(false),
            pause_sequence: std::sync::atomic::AtomicU64::new(0),
            cancel_requested: AtomicBool::new(false),
            torrent_selected: AtomicBool::new(false),
            runner_active: AtomicBool::new(false),
            created_at: row.created_at,
        });
        register_job(&queue, job.clone()).await;
        emit_state(&app, &job, JobStatus::Paused, Some(row.title.clone()), None).await;
        restored += 1;
    }
    if restored > 0 {
        log::info!("restored {restored} unfinished download(s) as paused");
    }
    restored
}

/// Updates yt-dlp via its self-updater (`--update`). Only one updater runs
/// at a time and a stuck updater is killed after two minutes.
pub async fn update_ytdlp(app: AppHandle) -> Result<String, String> {
    let _guard = YTDLP_UPDATE_LOCK.lock().await;
    let binary =
        engines::find_engine(&app, "yt-dlp").ok_or_else(|| "yt-dlp not found".to_string())?;
    let mut updater_cmd = tokio::process::Command::new(binary);
    #[cfg(windows)]
    updater_cmd.creation_flags(CREATE_NO_WINDOW);
    let output = tokio::time::timeout(
        Duration::from_secs(120),
        updater_cmd
            .arg("--ignore-config")
            .arg("--update")
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "yt-dlp update timed out after 120 seconds".to_string())?
    .map_err(|e| e.to_string())?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(text.lines().last().unwrap_or("update failed").to_string());
    }
    let _ = app.emit("engine://updated", "yt-dlp");
    Ok(text.lines().last().unwrap_or("updated").to_string())
}

// ---------------------------------------------------------------------------
// aria2 jobs (files & torrents) — one shared daemon, one poller per gid
// ---------------------------------------------------------------------------

pub const EVENT_TORRENT_READY: &str = "torrent://ready";

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TorrentSource {
    Magnet(String),
    TorrentBase64(String),
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TorrentReadyEvent {
    pub job_id: String,
    pub name: String,
    pub files: Vec<TorrentFileInfo>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFileInfo {
    pub index: u64,
    pub path: String,
    pub length: u64,
    pub selected: bool,
}

#[derive(Default)]
struct TorrentData {
    hash: Option<String>,
    files: Vec<TorrentFileInfo>,
    selection: Vec<u64>,
    retry_selection: Vec<u64>,
    check_retry_paths: bool,
}

/// Returns the shared aria2 daemon, spawning it on first use.
/// The state lock is held across the spawn so concurrent callers (two
/// quick adds, tray actions) cannot race into two daemons — the loser of
/// the previous race died via kill_on_drop and jobs hung on dead RPC.
async fn ensure_aria2(app: &AppHandle) -> Result<Arc<Aria2Daemon>, String> {
    let state: State<'_, crate::AppState> = app.state();
    let mut guard = state.aria2.lock().await;
    if let Some(daemon) = guard.as_ref() {
        if daemon.is_running().await.map_err(|e| e.to_string())? {
            return Ok(daemon.clone());
        }
        log::warn!("aria2 exited; starting a new daemon for the next request");
    }
    let binary = engines::find_engine(app, "aria2").ok_or("aria2 not found")?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let daemon = Aria2Daemon::spawn(&binary, dir)
        .await
        .map_err(|e| e.to_string())?;
    *guard = Some(daemon.clone());
    Ok(daemon)
}

fn default_title_for_url(url: &str) -> String {
    url.rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(url)
        .split('?')
        .next()
        .unwrap_or(url)
        .to_string()
}

async fn register_job(queue: &QueueManager, job: Arc<Job>) {
    let id = job.id.clone();
    queue.jobs.lock().await.insert(id.clone(), job);
    let mut order = queue.order.lock().await;
    order.push(id);
    queue.gate.set_order(&order);
}

fn base_job(url: String, title: String, folder: Option<String>) -> Job {
    Job {
        id: make_id(),
        kind: JobKind::File, // caller narrows before sharing
        engine: "aria2".into(),
        url,
        title: Mutex::new(title),
        thumbnail: None,
        torrent_phase: StdMutex::new(None),
        torrent: Mutex::new(TorrentData::default()),
        control: Mutex::new(()),
        folder,
        status: Mutex::new((JobStatus::Queued, None, None)),
        progress: Mutex::new(Progress::default()),
        spec: None,
        gid: Mutex::new(None),
        daemon: Mutex::new(std::sync::Weak::new()),
        kill: Arc::new(Notify::new()),
        pause_requested: AtomicBool::new(false),
        pause_sequence: std::sync::atomic::AtomicU64::new(0),
        cancel_requested: AtomicBool::new(false),
        torrent_selected: AtomicBool::new(false),
        runner_active: AtomicBool::new(false),
        created_at: now_ms(),
    }
}

/// Starts a direct HTTP/FTP download through aria2.
pub async fn start_file(
    app: AppHandle,
    queue: State<'_, QueueManager>,
    url: String,
    title: Option<String>,
    folder: Option<String>,
) -> Result<String, String> {
    super::ytdlp::validate_url(&url).map_err(|e| e.to_string())?;
    let _add = queue.aria_add.lock().await;
    let daemon = ensure_aria2(&app).await?;
    let mut options = json!({});
    if let Some(dir) = folder.as_ref().filter(|d| !d.trim().is_empty()) {
        options["dir"] = json!(dir);
    }
    let gid = daemon
        .add_uri(std::slice::from_ref(&url), options, true)
        .await
        .map_err(|e| e.to_string())?;
    if gid.is_empty() {
        return Err("aria2 refused the URI".into());
    }

    let mut job = Arc::new(base_job(
        url.clone(),
        title.unwrap_or_else(|| default_title_for_url(&url)),
        Some(
            folder
                .filter(|dir| !dir.trim().is_empty())
                .unwrap_or_else(|| daemon.download_dir.to_string_lossy().to_string()),
        ),
    ));
    if let Some(j) = Arc::get_mut(&mut job) {
        j.kind = JobKind::File;
    }

    *job.daemon.lock().await = Arc::downgrade(&daemon);
    *job.gid.lock().await = Some(gid.clone());
    register_job(&queue, job.clone()).await;
    record_history_created(&app, &job).await;
    emit_state(
        &app,
        &job,
        JobStatus::Queued,
        Some(job.title.lock().await.clone()),
        None,
    )
    .await;

    spawn_aria2_runner(&app, job.clone(), daemon, gid).await;
    Ok(job.id.clone())
}

/// Starts a magnet or .torrent download. Files stay unselected (paused)
/// until the UI confirms the file selection.
pub async fn start_torrent(
    app: AppHandle,
    queue: State<'_, QueueManager>,
    source: TorrentSource,
    folder: Option<String>,
) -> Result<String, String> {
    if let TorrentSource::Magnet(magnet) = &source {
        super::ytdlp::validate_magnet(magnet).map_err(|e| e.to_string())?;
    }
    // Duplicate detection: a torrent with the same info-hash may already
    // live in the daemon (paused awaiting file selection, active, or a
    // dead stop that would make addTorrent fail with "already registered").
    let incoming_hash = match &source {
        TorrentSource::Magnet(magnet) => super::torrent::magnet_info_hash(magnet),
        TorrentSource::TorrentBase64(b64) => Some(torrent_payload_hash(b64)?),
    };
    let _add = queue.aria_add.lock().await;
    let daemon = ensure_aria2(&app).await?;
    if let Some(hash) = &incoming_hash {
        check_torrent_duplicates(&daemon, hash).await?;
    }

    let mut options = json!({});
    if let Some(dir) = folder.as_ref().filter(|d| !d.trim().is_empty()) {
        options["dir"] = json!(dir);
    }

    let (gid, url) = match &source {
        TorrentSource::Magnet(magnet) => (
            daemon
                .add_uri(
                    std::slice::from_ref(magnet),
                    {
                        options["pause-metadata"] = json!("true");
                        options
                    },
                    false,
                )
                .await
                .map_err(|e| e.to_string())?,
            magnet.clone(),
        ),
        TorrentSource::TorrentBase64(b64) => (
            daemon
                .add_torrent(b64, options, true)
                .await
                .map_err(|e| e.to_string())?,
            "torrent".into(),
        ),
    };
    if gid.is_empty() {
        return Err("aria2 refused the torrent".into());
    }

    let mut job = Arc::new(base_job(
        url,
        match &source {
            TorrentSource::Magnet(_) => "Magnet link".into(),
            TorrentSource::TorrentBase64(_) => "Torrent".into(),
        },
        Some(
            folder
                .filter(|dir| !dir.trim().is_empty())
                .unwrap_or_else(|| daemon.download_dir.to_string_lossy().to_string()),
        ),
    ));
    if let Some(j) = Arc::get_mut(&mut job) {
        j.kind = JobKind::Torrent;
    }

    if matches!(source, TorrentSource::Magnet(_)) {
        job.set_phase(Some(TorrentPhase::Metadata));
    }
    job.torrent.lock().await.hash = incoming_hash;
    *job.daemon.lock().await = Arc::downgrade(&daemon);
    *job.gid.lock().await = Some(gid.clone());
    register_job(&queue, job.clone()).await;
    record_history_created(&app, &job).await;
    emit_state(
        &app,
        &job,
        JobStatus::Queued,
        Some(job.title.lock().await.clone()),
        None,
    )
    .await;

    spawn_aria2_runner(&app, job.clone(), daemon, gid).await;
    Ok(job.id.clone())
}

#[derive(Debug, thiserror::Error)]
pub enum RetryError {
    #[error("{0}")]
    Unavailable(String),
    #[error("Select the original .torrent file to retry this download")]
    NeedsTorrent,
    #[error("The selected .torrent does not match the original download")]
    TorrentMismatch,
    #[error("{0}")]
    Failed(String),
}

impl RetryError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unavailable(_) => "retryUnavailable",
            Self::NeedsTorrent => "retryNeedsTorrent",
            Self::TorrentMismatch => "retryTorrentMismatch",
            Self::Failed(_) => "retryFailed",
        }
    }
}

fn validate_retry_torrent<'a>(
    payload: Option<&'a str>,
    expected: Option<&str>,
) -> Result<&'a str, RetryError> {
    let payload = payload.ok_or(RetryError::NeedsTorrent)?;
    let hash = torrent_payload_hash(payload).map_err(RetryError::Failed)?;
    if !expected.is_some_and(|expected| expected.eq_ignore_ascii_case(&hash)) {
        return Err(RetryError::TorrentMismatch);
    }
    Ok(payload)
}

fn retry_aria2_options(folder: Option<&str>, gid: &str) -> serde_json::Value {
    let mut options = json!({
        "gid": gid,
        "allow-overwrite": "false",
        "auto-file-renaming": "false",
        "continue": "false"
    });
    if let Some(folder) = folder {
        options["dir"] = json!(folder);
    }
    options
}

fn safe_video_resume_args(
    spec: &VideoDownloadSpec,
    ffmpeg: Option<&PathBuf>,
) -> Result<Vec<String>, ytdlp::YtdlpError> {
    let mut args = ytdlp::download_args(spec, ffmpeg)?;
    args.insert(0, "--no-overwrites".into());
    Ok(args)
}

pub async fn retry_job(
    app: AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
    torrent_base64: Option<String>,
) -> Result<String, RetryError> {
    let unavailable = |message: &str| RetryError::Unavailable(message.into());
    let job = queue
        .jobs
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| unavailable("Download not found"))?;
    let _control = job.control.lock().await;
    if !queue.jobs.lock().await.contains_key(&id)
        || !job.can_retry(&job.status.lock().await.0)
        || job.runner_active.load(Ordering::SeqCst)
        || queue.is_shutting_down().await
    {
        return Err(unavailable(
            "This download cannot be retried in its current state",
        ));
    }
    if let Some(spec) = &job.spec {
        let binary =
            engines::find_engine(&app, "yt-dlp").ok_or_else(|| unavailable("yt-dlp not found"))?;
        let ffmpeg = engines::find_engine(&app, "ffmpeg");
        let args = safe_video_resume_args(spec, ffmpeg.as_ref())
            .map_err(|e| RetryError::Failed(e.to_string()))?;
        let spec_json =
            serde_json::to_string(spec).map_err(|e| RetryError::Failed(e.to_string()))?;
        if !claim_runner(&job) {
            return Err(unavailable("Download is already running"));
        }
        let pending = crate::core::db::PendingJob {
            id: id.clone(),
            kind: "video".into(),
            url: job.url.clone(),
            title: job.title.lock().await.clone(),
            folder: job.folder.clone(),
            spec_json,
            created_at: job.created_at,
        };
        let db = app.state::<crate::AppState>().db.clone();
        let _ = tokio::task::spawn_blocking(move || db.save_pending(&pending)).await;
        reset_for_retry(&app, &job).await;
        let app = app.clone();
        let job = job.clone();
        tokio::spawn(async move {
            let queue = app.state::<QueueManager>();
            run_video_job(app.clone(), &queue, job, binary, args).await;
        });
        return Ok(id);
    }

    let hash = job.torrent.lock().await.hash.clone();
    let local_payload = if job.retry_needs_torrent(&JobStatus::Failed) {
        Some(validate_retry_torrent(
            torrent_base64.as_deref(),
            hash.as_deref(),
        )?)
    } else {
        None
    };
    let _add = queue.aria_add.lock().await;
    let daemon = ensure_aria2(&app).await.map_err(RetryError::Failed)?;
    let old = job.daemon.lock().await.upgrade();
    let old_gid = job.gid.lock().await.clone();
    let mut existing = None;
    if old.as_ref().is_some_and(|old| Arc::ptr_eq(old, &daemon)) {
        if let Some(gid) = old_gid {
            existing = reconcile_old_aria2_gid(&daemon, gid).await?;
        }
    }
    let (gid, recreated) = if let Some(gid) = existing {
        (gid, false)
    } else {
        if let Some(hash) = hash.as_deref() {
            check_torrent_duplicates(&daemon, hash)
                .await
                .map_err(RetryError::Unavailable)?;
        }
        // Reserve the gid before transmitting the add. If the response is lost,
        // the next call can reconcile this same task without adding a duplicate.
        let gid = make_id()[..16].to_owned();
        *job.gid.lock().await = Some(gid.clone());
        *job.daemon.lock().await = Arc::downgrade(&daemon);
        if job.kind == JobKind::Torrent {
            let mut torrent = job.torrent.lock().await;
            torrent.check_retry_paths = true;
            torrent.retry_selection = torrent.selection.clone();
        }
        let mut options = retry_aria2_options(job.folder.as_deref(), &gid);
        options["pause-metadata"] = json!("true");
        let result = if let Some(payload) = local_payload {
            daemon.add_torrent(payload, options, true).await
        } else {
            daemon
                .add_uri(std::slice::from_ref(&job.url), options, true)
                .await
        };
        match result {
            Ok(added) if added == gid => {}
            Ok(_) => {
                return Err(RetryError::Failed(
                    "Unexpected download ID returned by aria2".into(),
                ))
            }
            Err(error) => match daemon.tell_status(&gid).await {
                Ok(status) if status.status == "paused" => {}
                _ => return Err(RetryError::Failed(error.to_string())),
            },
        }
        (gid, true)
    };
    *job.gid.lock().await = Some(gid.clone());
    if job.kind == JobKind::Torrent {
        let mut torrent = job.torrent.lock().await;
        // Also refresh files if the add was applied but its RPC reply was lost.
        if recreated || torrent.check_retry_paths {
            torrent.files.clear();
            job.torrent_selected.store(false, Ordering::SeqCst);
        }
        if !job.torrent_selected.load(Ordering::SeqCst) {
            if local_payload.is_some() {
                job.set_phase(None);
            } else {
                job.set_phase(Some(TorrentPhase::Metadata));
            }
        }
    }
    reset_for_retry(&app, &job).await;
    spawn_aria2_runner(&app, job.clone(), daemon, gid).await;
    Ok(id)
}

async fn check_torrent_duplicates(daemon: &Aria2Daemon, hash: &str) -> Result<(), String> {
    let statuses = daemon
        .all_statuses()
        .await
        .map_err(|error| error.to_string())?;
    for status in statuses.into_iter().filter(|status| {
        status.followed_by.is_empty()
            && status
                .info_hash
                .as_deref()
                .is_some_and(|other| other.eq_ignore_ascii_case(hash))
    }) {
        match status.status.as_str() {
            "complete" => return Err("torrentComplete".into()),
            "error" | "removed" => daemon
                .remove_result(&status.gid)
                .await
                .map_err(|e| e.to_string())?,
            _ => return Err("torrentActive".into()),
        }
    }
    Ok(())
}

async fn reconcile_old_aria2_gid(
    daemon: &Aria2Daemon,
    mut gid: String,
) -> Result<Option<String>, RetryError> {
    let inspect = |e: Aria2Error| RetryError::Failed(e.to_string());
    loop {
        let status = match daemon.tell_status(&gid).await {
            Ok(status) => status,
            Err(Aria2Error::MissingGid(_)) => return Ok(None),
            Err(error) => return Err(inspect(error)),
        };
        if let Some(next) = status.followed_by.first().filter(|next| *next != &gid) {
            gid.clone_from(next);
            continue;
        }
        return match status.status.as_str() {
            "paused" => Ok(Some(gid)),
            "waiting" | "active" => {
                confirm_aria2_pause(daemon, &gid).await.map_err(inspect)?;
                Ok(Some(gid))
            }
            "error" | "removed" => {
                daemon.remove_result(&gid).await.map_err(inspect)?;
                Ok(None)
            }
            _ => Err(RetryError::Unavailable(
                "aria2 already finished this download".into(),
            )),
        };
    }
}

async fn reset_for_retry(app: &AppHandle, job: &Job) {
    job.pause_requested.store(false, Ordering::SeqCst);
    job.cancel_requested.store(false, Ordering::SeqCst);
    {
        let mut progress = job.progress.lock().await;
        *progress = Progress::default();
        emit_progress(app, job, &mut progress, true);
    }
    record_history_created(app, job).await;
    set_status(app, job, JobStatus::Queued, None).await;
}

fn torrent_payload_hash(payload: &str) -> Result<String, String> {
    use base64::Engine as _;
    const MAX_BYTES: usize = 10 * 1024 * 1024;
    if payload.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err("torrent payload exceeds 10 MiB".into());
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("bad torrent payload: {e}"))?;
    if raw.len() > MAX_BYTES {
        return Err("torrent payload exceeds 10 MiB".into());
    }
    super::torrent::info_hash(&raw)
        .map(|hash| hex_encode(&hash))
        .ok_or_else(|| "invalid torrent metadata".into())
}

async fn spawn_aria2_runner(app: &AppHandle, job: Arc<Job>, daemon: Arc<Aria2Daemon>, gid: String) {
    *job.daemon.lock().await = Arc::downgrade(&daemon);
    job.runner_active.store(true, Ordering::SeqCst);
    let app = app.clone();
    tokio::spawn(async move { run_aria2_job(app, job, daemon, gid).await });
}

async fn confirm_aria2_pause(daemon: &Aria2Daemon, gid: &str) -> Result<(), Aria2Error> {
    let result = daemon.pause(gid).await;
    // aria2 acknowledges the request before transitioning an active task.
    let settled = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let status = daemon.tell_status(gid).await?;
            match status.status.as_str() {
                "paused" => return Ok(()),
                "error" | "complete" | "removed" => {
                    return Err(Aria2Error::Rpc(
                        "Download stopped before it could be paused".into(),
                    ));
                }
                _ => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
    })
    .await;
    match settled {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => result.and(Err(error)),
        Err(_) => result.and(Err(Aria2Error::Rpc(
            "aria2 did not confirm the pause".into(),
        ))),
    }
}

async fn pause_aria2_job(app: &AppHandle, job: &Job) -> Result<(), String> {
    let _control = job.control.lock().await;
    if !matches!(
        job.status.lock().await.0,
        JobStatus::Queued | JobStatus::Downloading | JobStatus::Seeding
    ) {
        return Err("job is not running".into());
    }
    if job.phase() == Some(TorrentPhase::SelectFiles) {
        return Err("Select torrent files before pausing".into());
    }
    let daemon = job
        .daemon
        .lock()
        .await
        .upgrade()
        .ok_or("torrent engine unavailable")?;
    let gid = job.gid.lock().await.clone().ok_or("job has no gid yet")?;
    let status = daemon.tell_status(&gid).await.map_err(|e| e.to_string())?;
    let target = status.followed_by.first().unwrap_or(&gid);
    if target != &gid || status.status != "paused" {
        confirm_aria2_pause(&daemon, target)
            .await
            .map_err(|error| error.to_string())?;
    }
    job.pause_requested.store(true, Ordering::SeqCst);
    job.pause_sequence.fetch_add(1, Ordering::SeqCst);
    clear_transfer_stats(app, job).await;
    set_status(app, job, JobStatus::Paused, None).await;
    job.kill.notify_one();
    Ok(())
}

async fn resume_aria2_job(app: &AppHandle, job: &Job) -> Result<(), String> {
    let _control = job.control.lock().await;
    if job.status.lock().await.0 != JobStatus::Paused || !job.runner_active.load(Ordering::SeqCst) {
        return Err("job is not paused".into());
    }
    job.pause_requested.store(false, Ordering::SeqCst);
    set_status(app, job, JobStatus::Queued, None).await;
    job.kill.notify_one();
    Ok(())
}

async fn clear_transfer_stats(app: &AppHandle, job: &Job) {
    let mut progress = job.progress.lock().await;
    progress.speed = 0.0;
    progress.eta = 0.0;
    progress.connections = None;
    progress.seeders = None;
    progress.upload_speed = None;
    emit_progress(app, job, &mut progress, true);
}

/// Removes aria2 bookkeeping left behind by a torrent that was cancelled
/// before any payload byte arrived: the `<info hash>.torrent` metadata file
/// and the `<name>.aria2` control file. Payload files are never touched, and
/// only entries inside the job's own destination folder are considered.
async fn remove_abandoned_torrent_artifacts(job: &Job) {
    if job.kind != JobKind::Torrent {
        return;
    }
    let Some(folder) = job.folder.clone() else {
        return;
    };
    let name = job.title.lock().await.clone();
    let hash = job.torrent.lock().await.hash.clone();
    let _ = tokio::task::spawn_blocking(move || {
        let Ok(root) = std::fs::canonicalize(&folder) else {
            return;
        };
        let safe_name = || {
            let candidate = name.trim();
            (!candidate.is_empty() && candidate != "Torrent" && !candidate.contains(['/', '\\']))
                .then(|| candidate.to_string())
        };
        let mut candidates: Vec<String> = Vec::new();
        if let Some(name) = safe_name() {
            candidates.push(format!("{name}.aria2"));
        }
        if let Some(hash) =
            hash.filter(|h| h.len() == 40 && h.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            let hash = hash.to_ascii_lowercase();
            // aria2 stores magnet metadata as `<hash>.torrent`, with its own
            // control file while that small download is still in flight.
            candidates.push(format!("{hash}.torrent.aria2"));
            candidates.push(format!("{hash}.torrent"));
        }
        for candidate in candidates {
            let Ok(path) = std::fs::canonicalize(root.join(candidate)) else {
                continue;
            };
            if path.parent() != Some(root.as_path()) || !path.is_file() {
                continue;
            }
            if let Err(error) = std::fs::remove_file(&path) {
                log::warn!("could not remove {}: {error}", path.display());
            }
        }
        // A multi-file torrent may have created its target folder already.
        if let Some(name) = safe_name() {
            if let Ok(folder) = std::fs::canonicalize(root.join(name)) {
                let empty = folder.is_dir()
                    && std::fs::read_dir(&folder)
                        .map(|mut entries| entries.next().is_none())
                        .unwrap_or(false);
                if empty && folder.parent() == Some(root.as_path()) {
                    let _ = std::fs::remove_dir(&folder);
                }
            }
        }
    })
    .await;
}

/// The poller owns the slot and only unpauses data transfers after acquiring one.
async fn run_aria2_job(app: AppHandle, job: Arc<Job>, daemon: Arc<Aria2Daemon>, mut gid: String) {
    let _runner = RunnerGuard(&job.runner_active);
    let queue = app.state::<QueueManager>();
    let mut consecutive_errors = 0u32;
    let mut gate_guard = None;
    let mut saw_pause = job.pause_sequence.load(Ordering::SeqCst);
    let mut poll = tokio::time::interval(Duration::from_millis(500));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = poll.tick() => {},
            _ = job.kill.notified() => {},
        }
        let control = job.control.lock().await;
        let pause_sequence = job.pause_sequence.load(Ordering::SeqCst);
        if saw_pause != pause_sequence {
            drop(gate_guard.take());
            saw_pause = pause_sequence;
        }
        if job.cancel_requested.swap(false, Ordering::SeqCst) {
            let inspected = daemon.tell_status(&gid).await.ok();
            let next_gid = inspected
                .as_ref()
                .and_then(|status| status.followed_by.first().cloned());
            // A magnet parks metadata on the parent GID and transfers payload
            // on the followed task, so read the byte count from the right one.
            let mut payload_bytes = inspected
                .as_ref()
                .map(|status| status.completed())
                .unwrap_or(0);
            if let Some(child) = next_gid.as_deref() {
                if let Ok(child) = daemon.tell_status(child).await {
                    payload_bytes = child.completed();
                }
            }
            let target = next_gid.unwrap_or_else(|| gid.clone());
            let emptied_torrent = job.kind == JobKind::Torrent && payload_bytes == 0;
            let _ = daemon.force_remove(&target).await;
            drop(gate_guard.take());
            if emptied_torrent {
                remove_abandoned_torrent_artifacts(&job).await;
            }
            clear_transfer_stats(&app, &job).await;
            set_status(&app, &job, JobStatus::Canceled, None).await;
            record_history(&app, &job, JobStatus::Canceled, payload_bytes as i64).await;
            break;
        }
        if job.pause_requested.load(Ordering::SeqCst) {
            drop(gate_guard.take());
            if !matches!(daemon.is_running().await, Ok(false)) {
                continue;
            }
        }
        let status = match daemon.tell_status(&gid).await {
            Ok(s) => {
                consecutive_errors = 0;
                s
            }
            Err(e) => {
                consecutive_errors += 1;
                let engine_exited = matches!(daemon.is_running().await, Ok(false));
                if engine_exited
                    || matches!(e, Aria2Error::MissingGid(_))
                    || consecutive_errors > 10
                {
                    let error = if engine_exited {
                        "The torrent engine stopped.".into()
                    } else {
                        e.to_string()
                    };
                    drop(gate_guard.take());
                    clear_transfer_stats(&app, &job).await;
                    set_status(&app, &job, JobStatus::Failed, Some(error)).await;
                    record_history(&app, &job, JobStatus::Failed, 0).await;
                    break;
                }
                continue;
            }
        };
        if let Some(next_gid) = status.followed_by.first() {
            gid.clone_from(next_gid);
            *job.gid.lock().await = Some(gid.clone());
            job.kill.notify_one();
            continue;
        }

        if job.kind == JobKind::Torrent
            && !status.is_metadata_only()
            && matches!(status.status.as_str(), "paused" | "waiting" | "active")
            && job.torrent.lock().await.check_retry_paths
        {
            if let Err(error) = check_retry_torrent_paths(&status).await {
                let _ = daemon.force_remove(&gid).await;
                drop(gate_guard.take());
                clear_transfer_stats(&app, &job).await;
                set_status(&app, &job, JobStatus::Failed, Some(error)).await;
                record_history(&app, &job, JobStatus::Failed, 0).await;
                break;
            }
        }
        if job.kind == JobKind::Torrent && !status.is_metadata_only() {
            cache_torrent_files(&app, &job, &daemon, &gid, &status).await;
        }
        let transfer = job.kind == JobKind::File || job.torrent_selected.load(Ordering::SeqCst);
        let seeding = job.kind == JobKind::Torrent
            && transfer
            && status.total() > 0
            && status.completed() >= status.total();
        if transfer
            && !seeding
            && gate_guard.is_none()
            && matches!(status.status.as_str(), "paused" | "waiting" | "active")
        {
            drop(control);
            gate_guard = GateGuard::acquire(queue.gate.clone(), &job).await;
            job.kill.notify_one();
            continue;
        }
        match status.status.as_str() {
            "active" => {
                let want = if seeding {
                    drop(gate_guard.take());
                    JobStatus::Seeding
                } else if transfer {
                    JobStatus::Downloading
                } else {
                    JobStatus::Queued
                };
                if want != job.status.lock().await.0 {
                    set_status(&app, &job, want, None).await;
                }
                let mut progress = job.progress.lock().await;
                if transfer {
                    update_aria2_progress(&mut progress, &status, job.kind, seeding);
                }
                emit_progress(&app, &job, &mut progress, false);
            }
            "paused" => {
                let metadata =
                    job.phase() == Some(TorrentPhase::Metadata) && status.is_metadata_only();
                if (transfer || metadata) && !queue.is_shutting_down().await {
                    if let Err(error) = daemon.unpause(&gid).await {
                        if let Ok(current) = daemon.tell_status(&gid).await {
                            if current.status != "paused" {
                                if transfer
                                    && matches!(current.status.as_str(), "active" | "waiting")
                                {
                                    job.torrent.lock().await.check_retry_paths = false;
                                }
                                job.kill.notify_one();
                                continue;
                            }
                        }
                        drop(gate_guard.take());
                        clear_transfer_stats(&app, &job).await;
                        set_status(&app, &job, JobStatus::Failed, Some(error.to_string())).await;
                        record_history(&app, &job, JobStatus::Failed, 0).await;
                        break;
                    }
                    if transfer {
                        job.torrent.lock().await.check_retry_paths = false;
                    }
                }
            }
            "waiting" => {
                if job.status.lock().await.0 != JobStatus::Queued {
                    clear_transfer_stats(&app, &job).await;
                    set_status(&app, &job, JobStatus::Queued, None).await;
                }
            }
            "complete" => {
                drop(gate_guard.take());
                let mut selected = status
                    .files
                    .iter()
                    .filter(|file| file.selected && !file.path.is_empty());
                let filename = selected
                    .next()
                    .filter(|_| selected.next().is_none())
                    .map(|file| file.path.clone());
                {
                    let mut progress = job.progress.lock().await;
                    progress.filename = filename;
                    progress.downloaded = status.completed() as f64;
                    progress.total = Some(status.total() as f64);
                    progress.fraction = Some(1.0);
                    progress.speed = 0.0;
                    progress.connections = None;
                    progress.seeders = None;
                    progress.upload_speed = None;
                    progress.eta = 0.0;
                    emit_progress(&app, &job, &mut progress, true);
                }
                set_status(&app, &job, JobStatus::Completed, None).await;
                record_history(&app, &job, JobStatus::Completed, status.total() as i64).await;
                break;
            }
            "error" => {
                drop(gate_guard.take());
                clear_transfer_stats(&app, &job).await;
                let msg = status
                    .error_message
                    .clone()
                    .unwrap_or_else(|| "aria2 reported an error".into());
                set_status_with_code(&app, &job, JobStatus::Failed, Some(msg), status.error_code)
                    .await;
                record_history(&app, &job, JobStatus::Failed, status.completed() as i64).await;
                delete_pending(&app, &job.id).await;
                break;
            }
            "removed" => {
                drop(gate_guard.take());
                clear_transfer_stats(&app, &job).await;
                set_status(&app, &job, JobStatus::Canceled, None).await;
                delete_pending(&app, &job.id).await;
                break;
            }
            _ => {}
        }
    }
}

fn update_aria2_progress(
    progress: &mut Progress,
    status: &Aria2Status,
    kind: JobKind,
    finished: bool,
) {
    progress.downloaded = status.completed() as f64;
    progress.total = (status.total() > 0).then(|| status.total() as f64);
    progress.speed = if finished { 0.0 } else { status.speed() };
    progress.eta = if finished { 0.0 } else { status.eta() };
    progress.connections = status.connections;
    if kind == JobKind::Torrent {
        progress.seeders = status.seeders;
        progress.upload_speed = status.upload_speed;
    }
    if let Some(file) = status
        .files
        .iter()
        .find(|file| file.selected && !file.path.is_empty())
    {
        progress.filename = Some(file.path.clone());
    }
}

async fn check_retry_torrent_paths(status: &Aria2Status) -> Result<(), String> {
    for file in &status.files {
        match tokio::fs::symlink_metadata(&file.path).await {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !file.path.is_empty() => {
            }
            _ => return Err("Retry cannot safely write to an existing torrent destination".into()),
        }
    }
    Ok(())
}

async fn cache_torrent_files(
    app: &AppHandle,
    job: &Job,
    daemon: &Aria2Daemon,
    gid: &str,
    status: &Aria2Status,
) {
    let mut torrent = job.torrent.lock().await;
    if torrent.hash.is_none() {
        torrent.hash.clone_from(&status.info_hash);
    }
    if !torrent.files.is_empty() {
        return;
    }
    torrent.files = status
        .files
        .iter()
        .map(|file| TorrentFileInfo {
            index: file.index,
            path: file.path.clone(),
            length: file.length,
            selected: file.selected,
        })
        .collect();
    let name = status.torrent_name().unwrap_or_else(|| "Torrent".into());
    *job.title.lock().await = name.clone();
    if name != "Torrent" {
        // The record was created at add time with a placeholder title.
        let state: State<'_, crate::AppState> = app.state();
        let db = state.db.clone();
        let id = job.id.clone();
        let title = name.clone();
        let _ = tokio::task::spawn_blocking(move || db.patch_history_title(&id, &title)).await;
    }
    if matches!(status.status.as_str(), "error" | "complete" | "removed") {
        return;
    }
    let proposed = std::mem::take(&mut torrent.retry_selection);
    let keep_selection = !proposed.is_empty()
        && torrent
            .hash
            .as_ref()
            .zip(status.info_hash.as_ref())
            .is_some_and(|(old, new)| old.eq_ignore_ascii_case(new))
        && proposed
            .iter()
            .all(|index| torrent.files.iter().any(|file| file.index == *index))
        && daemon.select_files(gid, &proposed).await.is_ok();
    if keep_selection {
        remember_selection(&mut torrent, proposed);
        job.torrent_selected.store(true, Ordering::SeqCst);
        job.set_phase(None);
    } else if !job.torrent_selected.load(Ordering::SeqCst) {
        job.set_phase(Some(TorrentPhase::SelectFiles));
    }
    let files = torrent.files.clone();
    drop(torrent);
    let current = job.status.lock().await.0.clone();
    emit_state(app, job, current, Some(name.clone()), None).await;
    if job.phase() == Some(TorrentPhase::SelectFiles) {
        let _ = app.emit(
            EVENT_TORRENT_READY,
            TorrentReadyEvent {
                job_id: job.id.clone(),
                name,
                files,
            },
        );
    }
}

fn remember_selection(torrent: &mut TorrentData, indices: Vec<u64>) {
    for file in &mut torrent.files {
        file.selected = indices.binary_search(&file.index).is_ok();
    }
    torrent.selection = indices;
}

/// Removes a job from the persistent pending queue (non-fatal).
async fn delete_pending(app: &AppHandle, id: &str) {
    let state: State<'_, crate::AppState> = app.state();
    let db = state.db.clone();
    let id = id.to_string();
    let _ = tokio::task::spawn_blocking(move || db.delete_pending(&id)).await;
}

async fn record_history_created(app: &AppHandle, job: &Job) {
    let state: State<'_, crate::AppState> = app.state();
    let kind = match job.kind {
        JobKind::Video => "video",
        JobKind::File => "file",
        JobKind::Torrent => "torrent",
    };
    let rec = HistoryRecord {
        id: job.id.clone(),
        kind: kind.into(),
        engine: job.engine.clone(),
        url: job.url.clone(),
        title: job.title.lock().await.clone(),
        folder: job.folder.clone(),
        filename: None,
        status: "queued".into(),
        total_bytes: None,
        created_at: job.created_at,
        finished_at: 0,
        thumbnail: job.thumbnail.clone(),
        format: job.spec.as_ref().and_then(|s| s.format_selector.clone()),
        save_path: job.folder.clone(),
        started_at: None,
        error: None,
    };
    let db = state.db.clone();
    let _ = tokio::task::spawn_blocking(move || db.upsert_history(&rec)).await;
}

/// Persists a finished job to history (non-fatal on error).
async fn record_history(app: &AppHandle, job: &Job, status: JobStatus, total_bytes: i64) {
    let state: State<'_, crate::AppState> = app.state();
    let view = job_view(job).await;
    let rec = HistoryRecord {
        id: view.id,
        kind: match job.kind {
            JobKind::Video => "video".to_string(),
            JobKind::File => "file".to_string(),
            JobKind::Torrent => "torrent".to_string(),
        },
        engine: job.engine.clone(),
        url: job.url.clone(),
        title: job.title.lock().await.clone(),
        folder: job.folder.clone(),
        filename: view.filename.clone(),
        status: match status {
            JobStatus::Completed => "completed".to_string(),
            JobStatus::Failed => "failed".to_string(),
            JobStatus::Canceled => "canceled".to_string(),
            JobStatus::Seeding => "seeding".to_string(),
            _ => "unknown".to_string(),
        },
        total_bytes: Some(total_bytes),
        created_at: job.created_at,
        finished_at: now_ms(),
        thumbnail: job.thumbnail.clone(),
        format: job.spec.as_ref().and_then(|s| s.format_selector.clone()),
        save_path: view
            .filename
            .as_ref()
            .map(|f| {
                std::path::Path::new(f)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| f.clone())
            })
            .or_else(|| job.folder.clone()),
        started_at: None,
        error: view.error,
    };
    let db = state.db.clone();
    let filename = rec.filename.clone();
    let save_path = rec.save_path.clone();
    let error = rec.error.clone();
    let status_name = rec.status.clone();
    let id = rec.id.clone();
    let finished = tokio::task::spawn_blocking(move || {
        db.finish_history(
            &id,
            &status_name,
            total_bytes,
            filename.as_deref(),
            save_path.as_deref(),
            error.as_deref(),
        )
    })
    .await;
    if matches!(finished, Ok(Err(_)) | Err(_)) {
        let state: State<'_, crate::AppState> = app.state();
        let db = state.db.clone();
        let _ = tokio::task::spawn_blocking(move || db.upsert_history(&rec)).await;
    }
}

/// Files of a torrent job (for the selection modal).
pub async fn torrent_files(
    _app: AppHandle,
    queue: State<'_, QueueManager>,
    job_id: String,
) -> Result<TorrentReadyEvent, String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(&job_id)
        .cloned()
        .ok_or("no such job")?;
    if job.kind != JobKind::Torrent {
        return Err("job is not a torrent".into());
    }
    let torrent = job.torrent.lock().await;
    if torrent.files.is_empty() {
        return Err("torrent metadata unavailable".into());
    }
    let name = job.title.lock().await.clone();
    Ok(TorrentReadyEvent {
        job_id,
        name,
        files: torrent.files.clone(),
    })
}

/// Confirms torrent file selection and starts the transfer.
pub async fn select_torrent_files(
    app: AppHandle,
    queue: State<'_, QueueManager>,
    job_id: String,
    mut indices: Vec<u64>,
) -> Result<(), String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(&job_id)
        .cloned()
        .ok_or("no such job")?;
    let _control = job.control.lock().await;
    if job.phase() != Some(TorrentPhase::SelectFiles) {
        return Err("torrent is not awaiting file selection".into());
    }
    let mut torrent = job.torrent.lock().await;
    indices.sort_unstable();
    indices.dedup();
    if indices.is_empty()
        || !indices
            .iter()
            .all(|i| torrent.files.iter().any(|file| file.index == *i))
    {
        return Err("invalid torrent file selection".into());
    }
    let daemon = job
        .daemon
        .lock()
        .await
        .upgrade()
        .ok_or("torrent engine unavailable")?;
    let gid = job.gid.lock().await.clone().ok_or("job has no gid yet")?;
    daemon
        .select_files(&gid, &indices)
        .await
        .map_err(|e| e.to_string())?;
    remember_selection(&mut torrent, indices);
    drop(torrent);
    job.set_phase(None);
    job.torrent_selected.store(true, Ordering::SeqCst);
    job.pause_requested.store(false, Ordering::SeqCst);
    set_status(&app, &job, JobStatus::Queued, None).await;
    job.kill.notify_one();
    Ok(())
}

/// Adjusts the shared transfer gate.
pub async fn set_parallel(
    _app: AppHandle,
    queue: State<'_, QueueManager>,
    n: u32,
) -> Result<(), String> {
    queue.gate.set_limit(n.clamp(1, 16));
    Ok(())
}

/// Pauses every running or queued download without holding queue locks over RPC.
pub async fn pause_all_jobs(app: AppHandle, queue: State<'_, QueueManager>) -> usize {
    let jobs: Vec<Arc<Job>> = queue.jobs.lock().await.values().cloned().collect();
    let mut paused = 0;
    for job in jobs {
        let status = job.status.lock().await.0.clone();
        if !matches!(
            status,
            JobStatus::Queued | JobStatus::Downloading | JobStatus::Merging
        ) {
            continue;
        }
        if job.engine == "aria2" {
            if pause_aria2_job(&app, &job).await.is_err() {
                continue;
            }
        } else {
            job.pause_requested.store(true, Ordering::SeqCst);
            job.kill.notify_one();
        }
        paused += 1;
    }
    paused
}

/// Resumes every paused download without holding queue locks over awaits.
pub async fn resume_all_jobs(app: AppHandle, queue: State<'_, QueueManager>) -> usize {
    let jobs: Vec<Arc<Job>> = queue.jobs.lock().await.values().cloned().collect();
    let mut resumed = 0;
    for job in jobs {
        if job.status.lock().await.0 != JobStatus::Paused {
            continue;
        }
        let app = app.clone();
        if job.engine == "aria2" {
            if resume_aria2_job(&app, &job).await.is_ok() {
                resumed += 1;
            }
        } else if let Some(spec) = job.spec.clone() {
            let binary = engines::find_engine(&app, "yt-dlp");
            let ffmpeg = engines::find_engine(&app, "ffmpeg");
            if let Some(binary) = binary {
                if let Ok(args) = safe_video_resume_args(&spec, ffmpeg.as_ref()) {
                    if !claim_runner(&job) {
                        continue;
                    }
                    job.pause_requested.store(false, Ordering::SeqCst);
                    set_status(&app, &job, JobStatus::Queued, None).await;
                    tokio::spawn(async move {
                        let queue: State<'_, QueueManager> = app.state();
                        run_video_job(app.clone(), &queue, job, binary, args).await;
                    });
                    resumed += 1;
                }
            }
        }
    }
    resumed
}

fn valid_speed_limit(limit: &str) -> bool {
    let limit = limit.trim().to_ascii_uppercase();
    limit.is_empty()
        || limit.chars().all(|c| c.is_ascii_digit())
        || (limit.len() > 1
            && limit.ends_with(['K', 'M'])
            && limit[..limit.len() - 1].chars().all(|c| c.is_ascii_digit()))
}

fn valid_seed_ratio(ratio: &str) -> bool {
    ratio
        .trim()
        .parse::<f64>()
        .map(|value| value.is_finite() && value >= 0.0)
        .unwrap_or(false)
}

/// Applies the global aria2 download speed limit live (e.g. "10M", "" = off).
pub async fn set_speed_limit(app: AppHandle, limit: String) -> Result<(), String> {
    let limit = limit.trim().to_ascii_uppercase();
    if !valid_speed_limit(&limit) {
        return Err("speed limit must match digits with optional K or M suffix".into());
    }
    let daemon = ensure_aria2(&app).await?;
    daemon
        .set_global_option(
            "max-overall-download-limit",
            if limit.is_empty() { "0" } else { &limit },
        )
        .await
        .map_err(|e| e.to_string())
}

/// Applies aria2's seeding ratio. Zero disables the ratio limit.
pub async fn set_seed_ratio(app: AppHandle, ratio: String) -> Result<(), String> {
    let ratio = ratio.trim();
    if !valid_seed_ratio(ratio) {
        return Err("seed ratio must be a number >= 0".into());
    }
    let daemon = ensure_aria2(&app).await?;
    daemon
        .set_global_option("seed-ratio", ratio)
        .await
        .map_err(|e| e.to_string())
}

/// Applies aria2's proxy to file and torrent downloads. Empty disables it.
pub async fn set_proxy(app: AppHandle, proxy: String) -> Result<(), String> {
    let proxy = proxy.trim();
    if !proxy.is_empty() {
        let parsed = url::Url::parse(proxy).map_err(|_| "invalid proxy URL".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https" | "socks5")
            || parsed.host_str().is_none()
            || parsed.username().is_empty() && parsed.password().is_some()
        {
            return Err("proxy must be an http or socks5 URL with a host".into());
        }
    }
    let daemon = ensure_aria2(&app).await?;
    daemon
        .set_global_option("all-proxy", proxy)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod queue_tests {
    use super::*;

    #[test]
    fn recreated_download_cannot_overwrite_a_destination() {
        let options = retry_aria2_options(Some("downloads"), "0000000000001234");
        assert_eq!(options["dir"], "downloads");
        assert_eq!(options["gid"], "0000000000001234");
        assert_eq!(options["allow-overwrite"], "false");
        assert_eq!(options["auto-file-renaming"], "false");
        assert_eq!(options["continue"], "false");
    }

    #[tokio::test]
    async fn failed_local_torrent_requires_the_original_torrent() {
        let mut job = base_job("torrent".into(), "Example".into(), None);
        job.kind = JobKind::Torrent;
        let payload = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            b"d4:infod4:name4:test6:lengthi1eee",
        );
        let hash = torrent_payload_hash(&payload).unwrap();
        let failed = JobStatus::Failed;
        assert!(job.retry_needs_torrent(&failed));
        assert!(job.can_retry(&failed));
        assert_eq!(
            validate_retry_torrent(None, Some(&hash))
                .unwrap_err()
                .code(),
            "retryNeedsTorrent"
        );
        assert_eq!(
            validate_retry_torrent(Some(&payload), Some("different"))
                .unwrap_err()
                .code(),
            "retryTorrentMismatch"
        );
        assert!(validate_retry_torrent(Some(&payload), Some(&hash)).is_ok());
    }

    #[tokio::test]
    async fn canceled_torrent_cleanup_keeps_payload_files() {
        let root = std::env::temp_dir().join(format!("gruzly-cancel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let hash = "7a42d4aa43a6a309fe5979e0a29320cf08bb1234";
        std::fs::write(root.join(format!("{hash}.torrent")), b"metadata").unwrap();
        std::fs::write(root.join("Sample Pack.aria2"), b"control").unwrap();
        std::fs::write(root.join("keep.bin"), b"payload").unwrap();
        std::fs::create_dir(root.join("Sample Pack")).unwrap();

        let mut job = base_job(
            "magnet:?xt=urn:btih:placeholder".into(),
            "Sample Pack".into(),
            Some(root.to_string_lossy().to_string()),
        );
        job.kind = JobKind::Torrent;
        job.torrent.lock().await.hash = Some(hash.to_string());

        remove_abandoned_torrent_artifacts(&job).await;

        assert!(!root.join(format!("{hash}.torrent")).exists());
        assert!(!root.join("Sample Pack.aria2").exists());
        assert!(!root.join("Sample Pack").exists());
        assert!(root.join("keep.bin").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn changing_the_order_reprioritizes_already_waiting_jobs() {
        let gate = Gate::new(1);
        gate.set_order(&["first".into(), "second".into()]);
        let active = gate.register("active");
        assert!(gate.try_acquire(active));
        let first = gate.register("first");
        let second = gate.register("second");
        assert!(!gate.try_acquire(second));
        gate.set_order(&["second".into(), "first".into()]);
        gate.release();
        assert!(!gate.try_acquire(first));
        assert!(gate.try_acquire(second));
    }

    #[tokio::test]
    async fn gate_snapshot_tracks_pause_release_and_reacquisition() {
        let gate = Arc::new(Gate::new(1));
        let first = base_job("first".into(), "first".into(), None);
        let next = base_job("next".into(), "next".into(), None);
        let held = GateGuard::acquire(gate.clone(), &first).await.unwrap();
        assert_eq!(
            serde_json::to_value(gate.snapshot()).unwrap(),
            json!({"inUse": 1, "limit": 1})
        );
        drop(held);
        assert_eq!(gate.snapshot().in_use, 0);
        let held = GateGuard::acquire(gate.clone(), &next).await.unwrap();
        gate.set_limit(3);
        assert_eq!(
            gate.snapshot(),
            QueueSlots {
                in_use: 1,
                limit: 3
            }
        );
        drop(held);
        assert_eq!(
            gate.snapshot(),
            QueueSlots {
                in_use: 0,
                limit: 3
            }
        );
    }

    #[tokio::test]
    async fn job_snapshot_keeps_torrent_phase_separate_from_queue_status() {
        let mut job = base_job("torrent".into(), "Example".into(), None);
        job.kind = JobKind::Torrent;
        *job.torrent_phase.lock().unwrap() = Some(TorrentPhase::Metadata);
        let view = serde_json::to_value(job_view(&job).await).unwrap();
        assert_eq!(view["status"], "queued");
        assert_eq!(view["torrentPhase"], "metadata");
        assert!(view["connections"].is_null());
        assert!(view["thumbnail"].is_null());
        assert_eq!(view["canRetry"], false);
        *job.torrent_phase.lock().unwrap() = Some(TorrentPhase::SelectFiles);
        assert_eq!(
            serde_json::to_value(job_view(&job).await).unwrap()["torrentPhase"],
            "selectFiles"
        );
    }
}

#[cfg(test)]
mod settings_tests {
    use super::{
        completed_file_in, is_playable_media, read_engine_record, valid_seed_ratio,
        valid_speed_limit, FfmpegProgress, Progress,
    };
    use std::path::Path;
    use std::time::{Duration, Instant};

    #[test]
    fn completed_actions_only_resolve_files_inside_the_download_folder() {
        let root = std::env::temp_dir().join(format!("gruzly-opener-{}", uuid::Uuid::new_v4()));
        let folder = root.join("downloads");
        std::fs::create_dir_all(folder.join("nested")).unwrap();
        std::fs::write(folder.join("nested/movie.MP4"), []).unwrap();
        std::fs::write(root.join("outside.mp4"), []).unwrap();
        let canonical = folder.canonicalize().unwrap();
        let movie = completed_file_in(&canonical, Path::new("nested/movie.MP4"));
        let outside = completed_file_in(&canonical, &root.join("outside.mp4"));
        let missing = completed_file_in(&canonical, Path::new("missing.mp4"));
        std::fs::remove_dir_all(root).unwrap();

        assert!(movie.is_some_and(|file| is_playable_media(&file)));
        assert!(outside.is_none());
        assert!(missing.is_none());
        assert!(!is_playable_media(Path::new("movie.mp4.exe")));
    }
    use tokio::io::{AsyncWriteExt, BufReader};

    #[tokio::test]
    async fn reads_ffmpeg_progress_before_pipe_closes() {
        let (mut writer, reader) = tokio::io::duplex(256);
        let mut reader = BufReader::new(reader);
        writer
            .write_all(b"size= 256KiB time=00:00:02.00\rsize= 512KiB time=00:00:04.00\r")
            .await
            .unwrap();
        let mut ffmpeg = FfmpegProgress::default();
        let mut progress = Progress::default();
        let now = Instant::now();
        for i in 0..2 {
            let record =
                tokio::time::timeout(Duration::from_secs(1), read_engine_record(&mut reader))
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap();
            assert!(ffmpeg.update(
                &mut progress,
                &record,
                Some(8.0),
                now + Duration::from_secs(i)
            ));
        }
        assert_eq!(progress.downloaded, 512.0 * 1024.0);
        assert_eq!(progress.total, None);
        assert_eq!(progress.fraction, Some(0.5));
        assert_eq!(progress.speed, 256.0 * 1024.0);
        assert_eq!(progress.eta, 2.0);
    }

    #[test]
    fn validates_speed_limits() {
        assert!(valid_speed_limit(""));
        assert!(valid_speed_limit("500K"));
        assert!(valid_speed_limit("10m"));
        assert!(!valid_speed_limit("10.5M"));
        assert!(!valid_speed_limit("M"));
    }

    #[test]
    fn validates_seed_ratios() {
        assert!(valid_seed_ratio("0"));
        assert!(valid_seed_ratio("1.5"));
        assert!(!valid_seed_ratio("-1"));
        assert!(!valid_seed_ratio("NaN"));
    }
}
