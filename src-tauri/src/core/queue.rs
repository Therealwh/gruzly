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
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, Notify, Semaphore};

use super::engines;
use super::ytdlp::{self, VideoDownloadSpec, YtdlpProgress};

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
    kill: Arc<Notify>,
    pause_requested: AtomicBool,
    cancel_requested: AtomicBool,
    created_at: i64,
}

impl Job {
    // (helpers land with M2 aria2 jobs)
}

fn make_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub struct QueueManager {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    order: Mutex<Vec<String>>,
    permits: Arc<Semaphore>,
}

impl QueueManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
            permits: Arc::new(Semaphore::new(3)), // parallel limit (M3: setting)
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

/// Signals pause; the runner kills the child and marks the job paused.
pub async fn pause_job(queue: State<'_, QueueManager>, id: String) -> Result<(), String> {
    let job = queue
        .jobs
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or("no such job")?;
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
    let _permit = queue.permits.acquire().await;
    if job.status.lock().await.0 == JobStatus::Canceled {
        return;
    }
    set_status(&app, &job, JobStatus::Downloading, None).await;

    let mut child = match Command::new(&binary)
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
        }
        (None, None) => {
            set_status(
                &app,
                &job,
                JobStatus::Failed,
                Some("engine stopped unexpectedly".into()),
            )
            .await;
        }
    }
}

/// Updates yt-dlp via its self-updater (`--update`).
pub async fn update_ytdlp(app: AppHandle) -> Result<String, String> {
    let binary =
        engines::find_engine(&app, "yt-dlp").ok_or_else(|| "yt-dlp not found".to_string())?;
    let out = tokio::process::Command::new(binary)
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
