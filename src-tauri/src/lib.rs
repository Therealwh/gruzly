//! Gruzly — Rust core (Tauri 2).
//!
//! The core is the orchestrator: a single download queue, URL→engine
//! routing and a unified progress event stream for the UI. Engines
//! (yt-dlp, aria2, ffmpeg) run as sidecar processes; arguments are always
//! passed as arrays, never shell strings.

mod commands;
mod core;

use std::sync::Arc;

use core::aria2::Aria2Daemon;
use core::db::Db;
use core::queue::QueueManager;
use tauri::Manager;
use tauri_plugin_log::Target;
use tauri_plugin_log::TargetKind;

/// Shared app state: the lazy aria2 daemon and the local database.
pub struct AppState {
    pub aria2: tokio::sync::Mutex<Option<Arc<Aria2Daemon>>>,
    pub db: Arc<Db>,
}

/// Fire-and-forget yt-dlp self-update at startup: extractors break
/// regularly, the app must self-heal. Only when the binary is bundled
/// (PATH copies belong to the system package manager).
fn schedule_ytdlp_auto_update(app: tauri::AppHandle) {
    tokio::spawn(async move {
        let bundled = core::engines::probe_all(&app)
            .into_iter()
            .any(|e| e.id == "yt-dlp" && e.source.as_deref() == Some("bundled"));
        if !bundled {
            log::info!("yt-dlp not bundled; skipping auto-update");
            return;
        }
        match core::queue::update_ytdlp(app.clone()).await {
            Ok(summary) => log::info!("yt-dlp auto-update: {summary}"),
            Err(e) => log::warn!("yt-dlp auto-update failed (non-fatal): {e}"),
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("gruzly".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch focuses the existing window instead.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(QueueManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_engine_info,
            commands::analyze_url,
            commands::start_video_download,
            commands::start_file_download,
            commands::start_torrent,
            commands::torrent_files,
            commands::select_torrent_files,
            commands::pause_job,
            commands::resume_job,
            commands::cancel_job,
            commands::remove_job,
            commands::list_jobs,
            commands::list_history,
            commands::clear_history,
            commands::update_ytdlp,
            commands::set_parallel,
            commands::set_speed_limit,
        ])
        .setup(|app| {
            // Local DB (history) in the app data dir.
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let db = Db::open(&data_dir.join("gruzly.db")).expect("open local db");
            app.manage(AppState {
                aria2: tokio::sync::Mutex::new(None),
                db: Arc::new(db),
            });
            schedule_ytdlp_auto_update(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Gruzly");
}
