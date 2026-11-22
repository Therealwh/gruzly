//! Gruzly — Rust core (Tauri 2).
//!
//! The core is the orchestrator: a single download queue, URL→engine
//! routing and a unified progress event stream for the UI. Engines
//! (yt-dlp, aria2, ffmpeg) run as sidecar processes; arguments are always
//! passed as arrays, never shell strings.

mod commands;
mod core;

use tauri::Manager;
use tauri_plugin_log::Target;
use tauri_plugin_log::TargetKind;

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
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_engine_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Gruzly");
}
