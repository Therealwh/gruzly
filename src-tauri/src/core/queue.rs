//! Unified download queue: one structure owns every job regardless of the
//! engine that performs it. Progress reaches the UI as throttled Tauri
//! events (`job://progress` ≤4/s per job, `job://state` on transitions).
//!
//! Ownership: the job's runner task exclusively owns the spawned child
//! process. Pause/cancel commands set flags and signal a `Notify`; the
//! runner selects on that signal, kills the child and settles the status.
//! This keeps killing race-free without sharing the child handle.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, Notify};

use super::aria2::Aria2Daemon;
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
    pub downloaded_bytes: f64,
    pub total_bytes: Option<f64>,
    pub speed: f64,
    pub eta: f64,
    pub created_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub id: String,
    pub downloaded_bytes: f64,
    pub total_bytes: Option<f64>,
    pub speed: f64,
    pub eta: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StateEvent {
    pub id: String,
    pub status: JobStatus,
    pub title: Option<String>,
    pub error: Option<String>,
}

pub const EVENT_PROGRESS: &str = "job://progress";
pub const EVENT_STATE: &str = "job://state";
const EMIT_INTERVAL: Duration = Duration::from_millis(250); // ≤4 renders/sec

#[derive(Debug, Default, Clone)]
struct Progress {
    downloaded: f64,
    total: Option<f64>,
    speed: f64,
    eta: f64,
    filename: Option<String>,
    last_emit: Option<Instant>,
}

struct Job {
    id: String,
    kind: JobKind,
    engine: String,
    url: String,
    title: String,
    folder: Option<String>,
    status: Mutex<(JobStatus, Option<String>)>, // status + error
    progress: Mutex<Progress>,
    spec: Option<VideoDownloadSpec>,
    /// aria2 gid for file/torrent jobs; None for video jobs.
    gid: Mutex<Option<String>>,
    kill: Arc<Notify>,
    pause_requested: AtomicBool,
    cancel_requested: AtomicBool,
    created_at: i64,
}

fn make_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Resizable parallelism gate (tokio Semaphore cannot resize).
pub struct Gate {
    slots: Mutex<u32>,
    notify: Notify,
}

impl Gate {
    fn new(initial: u32) -> Self {
        Self {
            slots: Mutex::new(initial.max(1)),
            notify: Notify::new(),
        }
    }

    async fn acquire(&self) {
        loop {
            let granted = {
                let mut slots = self.slots.lock().await;
                if *slots > 0 {
                    *slots -= 1;
                    true
                } else {
                    false
                }
            };
            if granted {
                return;
            }
            self.notify.notified().await;
        }
    }

    fn release(&self) {
        if let Ok(mut slots) = self.slots.try_lock() {
            *slots = slots.saturating_add(1);
        }
        self.notify.notify_one();
    }

    async fn set_limit(&self, n: u32) {
        let mut slots = self.slots.lock().await;
        *slots = n.max(1);
        self.notify.notify_one();
    }
}

impl Drop for GateGuard {
    fn drop(&mut self) {
        self.gate.release();
    }
}

/// Held for the duration of a running job; releases its slot on drop.
pub struct GateGuard {
    gate: Arc<Gate>,
}

impl GateGuard {
    async fn acquire(gate: Arc<Gate>) -> Self {
        gate.acquire().await;
        Self { gate }
    }
}

pub struct QueueManager {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    order: Mutex<Vec<String>>,
    gate: Arc<Gate>,
}

impl QueueManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
            gate: Arc::new(Gate::new(3)), // parallel limit; adjustable from Settings
        }
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
        title: job.title.clone(),
        folder: job.folder.clone(),
        filename: progress.filename.clone(),
        status: status.0,
        error: status.1,
        downloaded_bytes: progress.downloaded,
        total_bytes: progress.total,
        speed: progress.speed,
        eta: progress.eta,
        created_at: job.created_at,
    }
}

async fn set_status(app: &AppHandle, job: &Job, status: JobStatus, error: Option<String>) {
    {
        let mut s = job.status.lock().await;
        s.0 = status.clone();
        s.1 = error.clone();
    }
    let _ = app.emit(
        EVENT_STATE,
        StateEvent {
            id: job.id.clone(),
            status,
            title: Some(job.title.clone()),
            error,
        },
    );
}

async fn on_progress(app: &AppHandle, job: &Job, p: YtdlpProgress) {
    let mut transitioning_to_merge = false;
    {
        let mut progress = job.progress.lock().await;
        if let Some(d) = p.downloaded_bytes {
            progress.downloaded = d;
        }
        if p.total().is_some() {
            progress.total = p.total();
        }
        if let Some(s) = p.speed {
            progress.speed = s;
        }
        if let Some(e) = p.eta {
            progress.eta = e;
        }
        if let Some(f) = p.filename.clone() {
            progress.filename = Some(f);
        }

        let throttled = progress
            .last_emit
            .map(|t| t.elapsed() >= EMIT_INTERVAL)
            .unwrap_or(true);
        if throttled {
            progress.last_emit = Some(Instant::now());
            let _ = app.emit(
                EVENT_PROGRESS,
                ProgressEvent {
                    id: job.id.clone(),
                    downloaded_bytes: progress.downloaded,
                    total_bytes: progress.total,
                    speed: progress.speed,
                    eta: progress.eta,
                },
            );
        }
    }

    // "finished" on the last stream means post-processing (mux) begins.
    if p.status.as_deref() == Some("finished") {
        let mut status = job.status.lock().await;
        if status.0 == JobStatus::Downloading {
            status.0 = JobStatus::Merging;
            transitioning_to_merge = true;
        }
    }
    if transitioning_to_merge {
        let (status, _) = job.status.lock().await.clone();
        let _ = app.emit(
            EVENT_STATE,
            StateEvent {
                id: job.id.clone(),
                status,
                title: None,
                error: None,
            },
        );
    }
}

fn emit_state(
    app: &AppHandle,
    id: &str,
    status: JobStatus,
    title: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        EVENT_STATE,
        StateEvent {
            id: id.to_string(),
            status,
            title,
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
    let job = Arc::new(Job {
        id: id.clone(),
        kind: JobKind::Video,
        engine: "yt-dlp".into(),
        url: spec.url.clone(),
        title: title.clone(),
        folder,
        status: Mutex::new((JobStatus::Queued, None)),
        progress: Mutex::new(Progress::default()),
        spec: Some(spec),
        gid: Mutex::new(None),
        kill: Arc::new(Notify::new()),
        pause_requested: AtomicBool::new(false),
        cancel_requested: AtomicBool::new(false),
        created_at: now_ms(),
    });

    queue.jobs.lock().await.insert(id.clone(), job.clone());
    queue.order.lock().await.push(id.clone());

    emit_state(&app, &id, JobStatus::Queued, Some(title.clone()), None);

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
        let gid = job.gid.lock().await.clone().ok_or("job has no gid yet")?;
        let daemon = ensure_aria2(&app).await?;
        daemon.pause(&gid).await.map_err(|e| e.to_string())?;
        return Ok(());
    }
    job.pause_requested.store(true, Ordering::SeqCst);
    job.kill.notify_waiters();
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
        let gid = job.gid.lock().await.clone().ok_or("job has no gid yet")?;
        let daemon = ensure_aria2(&app).await?;
        daemon.unpause(&gid).await.map_err(|e| e.to_string())?;
        return Ok(());
    }

    let spec = job.spec.clone().ok_or("job cannot be resumed")?;
    let binary =
        engines::find_engine(&app, "yt-dlp").ok_or_else(|| "yt-dlp not found".to_string())?;
    let ffmpeg = engines::find_engine(&app, "ffmpeg");
    let args = ytdlp::download_args(&spec, ffmpeg.as_ref()).map_err(|e| e.to_string())?;

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
    job.kill.notify_waiters();
    Ok(())
}

pub async fn remove_job(queue: State<'_, QueueManager>, id: String) -> Result<(), String> {
    let mut jobs = queue.jobs.lock().await;
    let removable = jobs
        .get(&id)
        .map(|j| {
            matches!(
                j.status.try_lock().map(|s| s.0.clone()),
                Ok(JobStatus::Completed) | Ok(JobStatus::Failed) | Ok(JobStatus::Canceled)
            )
        })
        .unwrap_or(false);
    if !removable {
        return Err("job is still running".into());
    }
    jobs.remove(&id);
    queue.order.lock().await.retain(|x| x != &id);
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

async fn requested_kill(job: &Job) -> Option<bool /* pause */> {
    if job.pause_requested.swap(false, Ordering::SeqCst) {
        Some(true)
    } else if job.cancel_requested.swap(false, Ordering::SeqCst) {
        Some(false)
    } else {
        None
    }
}

async fn run_video_job(
    app: AppHandle,
    queue: &QueueManager,
    job: Arc<Job>,
    binary: PathBuf,
    args: Vec<String>,
) {
    let _guard = GateGuard::acquire(queue.gate.clone()).await;
    if job.status.lock().await.0 == JobStatus::Canceled {
        return;
    }
    set_status(&app, &job, JobStatus::Downloading, None).await;

    let mut cmd = Command::new(&binary);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = match cmd
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            set_status(&app, &job, JobStatus::Failed, Some(e.to_string())).await;
            return;
        }
    };

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    // Drain stderr in the background so yt-dlp is never back-pressured;
    // keep the last lines as the error message source.
    let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_tail_reader = stderr_tail.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut tail = stderr_tail_reader.lock().await;
            tail.push(line);
            if tail.len() > 12 {
                tail.remove(0);
            }
        }
    });

    let mut stdout_lines = BufReader::new(stdout).lines();
    let kill = job.kill.clone();

    // Phase 1: stream progress until stdout closes or a kill is requested.
    let mut killed: Option<bool> = None;
    loop {
        tokio::select! {
            line = stdout_lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        if l.starts_with('{') {
                            if let Ok(p) = serde_json::from_str::<YtdlpProgress>(&l) {
                                on_progress(&app, &job, p).await;
                            }
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

    match (killed, exit.map(|c| c.success())) {
        (None, Some(true)) => {
            set_status(&app, &job, JobStatus::Completed, None).await;
            let progress = job.progress.lock().await.clone();
            let _ = app.emit(
                EVENT_PROGRESS,
                ProgressEvent {
                    id: job.id.clone(),
                    downloaded_bytes: progress.total.unwrap_or(progress.downloaded),
                    total_bytes: progress.total,
                    speed: 0.0,
                    eta: 0.0,
                },
            );
            record_history(
                &app,
                &job,
                JobStatus::Completed,
                progress.total.unwrap_or(progress.downloaded) as i64,
            )
            .await;
        }
        (Some(true), _) => {
            set_status(&app, &job, JobStatus::Paused, None).await;
        }
        (Some(false), _) => {
            set_status(&app, &job, JobStatus::Canceled, None).await;
        }
        (None, Some(false)) => {
            let tail = stderr_tail.lock().await.clone();
            let err = if tail.is_empty() {
                "yt-dlp exited with an error".to_string()
            } else {
                tail.join("\n").chars().take(1500).collect()
            };
            set_status(&app, &job, JobStatus::Failed, Some(err)).await;
            record_history(&app, &job, JobStatus::Failed, 0).await;
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
        }
    }
}

/// Updates yt-dlp via its self-updater (`--update`).
pub async fn update_ytdlp(app: AppHandle) -> Result<String, String> {
    let binary =
        engines::find_engine(&app, "yt-dlp").ok_or_else(|| "yt-dlp not found".to_string())?;
    let mut updater_cmd = tokio::process::Command::new(binary);
    #[cfg(windows)]
    updater_cmd.creation_flags(CREATE_NO_WINDOW);
    let out = updater_cmd
        .arg("--update")
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
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

/// Returns the shared aria2 daemon, spawning it on first use.
async fn ensure_aria2(app: &AppHandle) -> Result<Arc<Aria2Daemon>, String> {
    {
        let state: State<'_, crate::AppState> = app.state();
        let guard = state.aria2.lock().await;
        if let Some(daemon) = guard.as_ref() {
            return Ok(daemon.clone());
        }
    }
    let binary = engines::find_engine(app, "aria2").ok_or("aria2 not found")?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let session = data_dir.join("aria2.session");
    let daemon = Aria2Daemon::spawn(&binary, dir, session)
        .await
        .map_err(|e| e.to_string())?;

    let state: State<'_, crate::AppState> = app.state();
    *state.aria2.lock().await = Some(daemon.clone());
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

fn register_job(queue: &QueueManager, job: Arc<Job>) {
    let id = job.id.clone();
    if let Ok(mut jobs) = queue.jobs.try_lock() {
        jobs.insert(id.clone(), job.clone());
    }
    if let Ok(mut order) = queue.order.try_lock() {
        order.push(id);
    }
}

fn base_job(url: String, title: String, folder: Option<String>) -> Job {
    Job {
        id: make_id(),
        kind: JobKind::File, // caller narrows before sharing
        engine: "aria2".into(),
        url,
        title,
        folder,
        status: Mutex::new((JobStatus::Queued, None)),
        progress: Mutex::new(Progress::default()),
        spec: None,
        gid: Mutex::new(None),
        kill: Arc::new(Notify::new()),
        pause_requested: AtomicBool::new(false),
        cancel_requested: AtomicBool::new(false),
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
    let daemon = ensure_aria2(&app).await?;
    let mut options = json!({});
    if let Some(dir) = folder.as_ref().filter(|d| !d.trim().is_empty()) {
        options["dir"] = json!(dir);
    }
    let gid = daemon
        .add_uri(std::slice::from_ref(&url), options, false)
        .await
        .map_err(|e| e.to_string())?;
    if gid.is_empty() {
        return Err("aria2 refused the URI".into());
    }

    let mut job = Arc::new(base_job(
        url.clone(),
        title.unwrap_or_else(|| default_title_for_url(&url)),
        Some(folder.unwrap_or_else(|| daemon.download_dir.to_string_lossy().to_string())),
    ));
    if let Some(j) = Arc::get_mut(&mut job) {
        j.kind = JobKind::File;
    }

    emit_state(
        &app,
        &job.id,
        JobStatus::Queued,
        Some(job.title.clone()),
        None,
    );
    register_job(&queue, job.clone());

    let job_task = job.clone();
    tokio::spawn(async move {
        let queue: State<'_, QueueManager> = app.state();
        run_aria2_job(app.clone(), &queue, job_task, daemon, gid).await;
    });
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
    let daemon = ensure_aria2(&app).await?;
    let mut options = json!({});
    if let Some(dir) = folder.as_ref().filter(|d| !d.trim().is_empty()) {
        options["dir"] = json!(dir);
    }

    let (gid, url) = match &source {
        TorrentSource::Magnet(magnet) => (
            daemon
                .add_uri(std::slice::from_ref(magnet), options, true)
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
        Some(folder.unwrap_or_else(|| daemon.download_dir.to_string_lossy().to_string())),
    ));
    if let Some(j) = Arc::get_mut(&mut job) {
        j.kind = JobKind::Torrent;
    }

    emit_state(
        &app,
        &job.id,
        JobStatus::Queued,
        Some(job.title.clone()),
        None,
    );
    register_job(&queue, job.clone());

    let job_task = job.clone();
    tokio::spawn(async move {
        let queue: State<'_, QueueManager> = app.state();
        run_aria2_job(app.clone(), &queue, job_task, daemon, gid).await;
    });
    Ok(job.id.clone())
}

/// Polls aria2 for one job until it reaches a terminal state.
async fn run_aria2_job(
    app: AppHandle,
    queue: &QueueManager,
    job: Arc<Job>,
    daemon: Arc<Aria2Daemon>,
    gid: String,
) {
    *job.gid.lock().await = Some(gid.clone());
    let _guard = GateGuard::acquire(queue.gate.clone()).await;
    let mut metadata_announced = false;
    let mut last_emit: Option<Instant> = None;
    let mut consecutive_errors = 0u32;

    loop {
        tokio::time::sleep(Duration::from_millis(800)).await;

        // Local cancel signal (from the UI).
        if job.cancel_requested.swap(false, Ordering::SeqCst) {
            let _ = daemon.force_remove(&gid).await;
            set_status(&app, &job, JobStatus::Canceled, None).await;
            break;
        }

        let status = match daemon.tell_status(&gid).await {
            Ok(s) => {
                consecutive_errors = 0;
                s
            }
            Err(e) => {
                consecutive_errors += 1;
                if consecutive_errors > 10 {
                    set_status(&app, &job, JobStatus::Failed, Some(e.to_string())).await;
                    break;
                }
                continue;
            }
        };

        // Torrent metadata resolved → offer the file list to the UI once.
        if job.kind == JobKind::Torrent
            && !metadata_announced
            && status.status != "error"
            && !status.is_metadata_only()
        {
            metadata_announced = true;
            let files: Vec<TorrentFileInfo> = status
                .files
                .iter()
                .map(|f| TorrentFileInfo {
                    index: f.index,
                    path: f.path.clone(),
                    length: f.length,
                    selected: f.selected,
                })
                .collect();
            let _ = app.emit(
                EVENT_TORRENT_READY,
                TorrentReadyEvent {
                    job_id: job.id.clone(),
                    name: status.torrent_name().unwrap_or_else(|| "Torrent".into()),
                    files,
                },
            );
        }

        match status.status.as_str() {
            "active" => {
                {
                    let mut s = job.status.lock().await;
                    if s.0 != JobStatus::Downloading && s.0 != JobStatus::Merging {
                        s.0 = JobStatus::Downloading;
                    }
                }
                {
                    let mut progress = job.progress.lock().await;
                    progress.downloaded = status.completed() as f64;
                    progress.total = Some(status.total() as f64);
                    progress.speed = status.speed();
                    progress.eta = status.eta();
                    if let Some(f) = status.files.last() {
                        progress.filename = Some(f.path.clone());
                    }
                    let throttled = last_emit
                        .map(|t| t.elapsed() >= EMIT_INTERVAL)
                        .unwrap_or(true);
                    if throttled {
                        last_emit = Some(Instant::now());
                        let _ = app.emit(
                            EVENT_PROGRESS,
                            ProgressEvent {
                                id: job.id.clone(),
                                downloaded_bytes: progress.downloaded,
                                total_bytes: progress.total,
                                speed: progress.speed,
                                eta: progress.eta,
                            },
                        );
                    }
                }
            }
            "paused" | "waiting" => {
                let mut s = job.status.lock().await;
                if s.0 != JobStatus::Queued && s.0 != JobStatus::Paused {
                    s.0 = JobStatus::Paused;
                }
            }
            "complete" => {
                set_status(&app, &job, JobStatus::Completed, None).await;
                record_history(&app, &job, JobStatus::Completed, status.total() as i64).await;
                break;
            }
            "error" => {
                let msg = status
                    .error_message
                    .clone()
                    .unwrap_or_else(|| "aria2 reported an error".into());
                set_status(&app, &job, JobStatus::Failed, Some(msg)).await;
                record_history(&app, &job, JobStatus::Failed, status.completed() as i64).await;
                break;
            }
            "removed" => {
                set_status(&app, &job, JobStatus::Canceled, None).await;
                break;
            }
            _ => {}
        }
    }
    let _ = queue;
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
        title: job.title.clone(),
        folder: job.folder.clone(),
        filename: view.filename,
        status: match status {
            JobStatus::Completed => "completed".to_string(),
            JobStatus::Failed => "failed".to_string(),
            JobStatus::Canceled => "canceled".to_string(),
            _ => "unknown".to_string(),
        },
        total_bytes: Some(total_bytes),
        created_at: job.created_at,
        finished_at: now_ms(),
    };
    let db = state.db.clone();
    let _ = tokio::task::spawn_blocking(move || db.insert_history(&rec)).await;
}

/// Files of a torrent job (for the selection modal).
pub async fn torrent_files(
    app: AppHandle,
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
    let gid = job.gid.lock().await.clone().ok_or("job has no gid yet")?;
    let daemon = ensure_aria2(&app).await?;
    let status = daemon.tell_status(&gid).await.map_err(|e| e.to_string())?;
    Ok(TorrentReadyEvent {
        job_id: job.id.clone(),
        name: status.torrent_name().unwrap_or_else(|| job.title.clone()),
        files: status
            .files
            .iter()
            .map(|f| TorrentFileInfo {
                index: f.index,
                path: f.path.clone(),
                length: f.length,
                selected: f.selected,
            })
            .collect(),
    })
}

/// Confirms torrent file selection and starts the transfer.
pub async fn select_torrent_files(
    app: AppHandle,
    queue: State<'_, QueueManager>,
    job_id: String,
    indices: Vec<u64>,
) -> Result<(), String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(&job_id)
        .cloned()
        .ok_or("no such job")?;
    let gid = job.gid.lock().await.clone().ok_or("job has no gid yet")?;
    let daemon = ensure_aria2(&app).await?;
    if indices.is_empty() {
        return Err("no files selected".into());
    }
    daemon
        .select_files(&gid, &indices)
        .await
        .map_err(|e| e.to_string())?;
    daemon.unpause(&gid).await.map_err(|e| e.to_string())?;
    set_status(&app, &job, JobStatus::Queued, None).await;
    Ok(())
}

/// Adjusts the parallel-download gate (Settings → Downloads).
pub async fn set_parallel(queue: State<'_, QueueManager>, n: u32) -> Result<(), String> {
    queue.gate.set_limit(n.clamp(1, 16)).await;
    Ok(())
}

/// Applies the global aria2 download speed limit live (e.g. "10M", "" = off).
pub async fn set_speed_limit(app: AppHandle, limit: String) -> Result<(), String> {
    let daemon = ensure_aria2(&app).await?;
    daemon
        .set_global_option("max-overall-download-limit", &limit)
        .await
        .map_err(|e| e.to_string())
}
