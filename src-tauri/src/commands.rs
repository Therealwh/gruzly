//! Tauri IPC commands exposed to the frontend.

use serde::Serialize;

use crate::core::engines::{self, EngineInfo};

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub os: String,
    pub arch: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
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
