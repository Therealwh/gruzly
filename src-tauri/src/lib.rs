//! Gruzly — Rust core (Tauri 2).
//!
//! The core is the orchestrator: a single download queue, URL→engine
//! routing and a unified progress event stream for the UI. Engines
//! (yt-dlp, aria2, ffmpeg) run as sidecar processes; arguments are always
//! passed as arrays, never shell strings.

mod commands;
pub mod core;

use std::sync::Arc;

use core::aria2::Aria2Daemon;
use core::db::Db;
use core::queue::QueueManager;
use core::tray;
use tauri::Manager;
use tauri_plugin_log::Target;
use tauri_plugin_log::TargetKind;

/// Shared app state: the lazy aria2 daemon and the local database.
pub struct AppState {
    pub aria2: tokio::sync::Mutex<Option<Arc<Aria2Daemon>>>,
    pub db: Arc<Db>,
    /// Settings → General → "Close to tray": hide instead of exiting.
    pub close_to_tray: std::sync::atomic::AtomicBool,
    /// Whether yt-dlp should be updated automatically at startup.
    pub engine_auto_update: std::sync::atomic::AtomicBool,
    /// Prevents tray quit and RunEvent::Exit from shutting down twice.
    pub shutdown_started: std::sync::atomic::AtomicBool,
    /// Links that arrived before the webview could listen.
    pub pending_links: std::sync::Mutex<Vec<String>>,
    /// Last delivered link and when it arrived, to collapse duplicate reports.
    pub recent_link: std::sync::Mutex<Option<(String, std::time::Instant)>>,
}

/// Fire-and-forget yt-dlp self-update at startup: extractors break
/// regularly, the app must self-heal. Only when the binary is bundled
/// (PATH copies belong to the system package manager).
/// Runs on Tauri's async runtime — setup() has no ambient Tokio context.
fn schedule_ytdlp_auto_update(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let enabled = app
            .state::<AppState>()
            .engine_auto_update
            .load(std::sync::atomic::Ordering::SeqCst);
        if !enabled {
            log::info!("yt-dlp auto-update disabled in settings");
            return;
        }
        let probe_app = app.clone();
        let bundled =
            tauri::async_runtime::spawn_blocking(move || core::engines::probe_all(&probe_app))
                .await
                .unwrap_or_default()
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

/// Graceful shutdown shared by tray quit and Tauri exit.
async fn shutdown_engines(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if state
            .shutdown_started
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_err()
        {
            return;
        }
    }
    // Stop video engine process trees before releasing the aria2 daemon. The
    // queue owns the yt-dlp runners, while AppState owns aria2.
    if let Some(queue) = app.try_state::<QueueManager>() {
        queue.shutdown_engine_processes().await;
    }
    if let Some(state) = app.try_state::<AppState>() {
        if let Some(daemon) = state.aria2.lock().await.take() {
            let _ = daemon.shutdown().await;
        }
    }
}

/// Tray-facing shutdown hook; keeps process cleanup in one place.
pub(crate) async fn shutdown_for_tray(app: &tauri::AppHandle) {
    shutdown_engines(app).await;
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
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch focuses the existing window; its arguments may
            // carry a gruzly:// link or a plain URL from the browser or CLI.
            crate::core::links::deliver(app, crate::core::links::urls_from_args(args));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            commands::retry_job,
            commands::cancel_job,
            commands::remove_job,
            commands::list_jobs,
            commands::queue_slots,
            commands::take_pending_links,
            commands::open_completed_download,
            commands::extract_archive,
            commands::list_history,
            commands::delete_history_record,
            commands::check_files_exist,
            commands::clear_history,
            commands::update_ytdlp,
            commands::prepare_shutdown,
            commands::set_parallel,
            commands::set_speed_limit,
            commands::set_seed_ratio,
            commands::set_proxy,
            commands::set_engine_autoupdate,
            commands::set_job_order,
            commands::set_close_to_tray,
            commands::set_tray_language,
        ])
        .setup(|app| {
            // Local DB (history) in the app data dir.
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let db = Db::open(&data_dir.join("gruzly.db")).expect("open local db");
            let db = Arc::new(db);
            let auto_update = db
                .get_setting("enginesAutoUpdate")
                .ok()
                .flatten()
                .map(|value| value != "0")
                .unwrap_or(true);
            app.manage(AppState {
                aria2: tokio::sync::Mutex::new(None),
                db,
                close_to_tray: std::sync::atomic::AtomicBool::new(true),
                engine_auto_update: std::sync::atomic::AtomicBool::new(auto_update),
                shutdown_started: std::sync::atomic::AtomicBool::new(false),
                pending_links: std::sync::Mutex::new(Vec::new()),
                recent_link: std::sync::Mutex::new(None),
            });

            let handle = app.handle().clone();
            // Browser handoff: Windows and Linux register the scheme per user
            // at runtime, macOS gets it from Info.plist at build time.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(windows, target_os = "linux"))]
                if let Err(error) = app.deep_link().register(core::links::SCHEME) {
                    log::warn!("could not register the gruzly:// scheme: {error}");
                }
                let link_app = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event
                        .urls()
                        .into_iter()
                        .map(|url| url.to_string())
                        .collect();
                    core::links::deliver(&link_app, urls);
                });
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let urls = urls.into_iter().map(|url| url.to_string()).collect();
                    core::links::deliver(&handle, urls);
                }
                core::links::deliver(
                    &handle,
                    core::links::urls_from_args(std::env::args().skip(1)),
                );
            }
            app.state::<QueueManager>()
                .emit_slot_changes(handle.clone());
            let _ = app.state::<AppState>().db.mark_interrupted();
            tray::build_tray(&handle, "en").expect("build tray");

            // Close-to-tray: hide the main window instead of exiting when
            // the setting is on.
            let handle_for_close = handle.clone();
            app.get_webview_window("main")
                .expect("main window")
                .on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let close_to_tray = handle_for_close
                            .state::<AppState>()
                            .close_to_tray
                            .load(std::sync::atomic::Ordering::SeqCst);
                        if close_to_tray {
                            api.prevent_close();
                            if let Some(window) = handle_for_close.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    }
                });

            schedule_ytdlp_auto_update(handle.clone());

            // Restore unfinished downloads as paused tasks.
            {
                let handle2 = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                    let restored = core::queue::restore_pending_jobs(handle2.clone()).await;
                    log::info!("queue restore: {restored}");
                });
            }

            // The window starts hidden (no white flash while WebView2 warms
            // up); the frontend shows it when rendered. Safety net: show it
            // after 6 s no matter what.
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(6)).await;
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Gruzly")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let app = app.clone();
                tauri::async_runtime::block_on(shutdown_engines(&app));
            }
        });
}
