//! System tray: icon, context menu, close-to-tray behavior. The menu is
//! rebuilt when the UI language changes (set_tray_language command).

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

/// Tray menu labels per supported UI language.
fn labels(lang: &str) -> [&'static str; 4] {
    if lang.to_lowercase().starts_with("ru") {
        [
            "Открыть Gruzly",
            "Пауза всех",
            "Продолжить все",
            "Выйти из Gruzly",
        ]
    } else {
        ["Open Gruzly", "Pause all", "Resume all", "Quit Gruzly"]
    }
}

/// (Re)builds the tray icon and menu.
pub fn build_tray(app: &AppHandle, lang: &str) -> tauri::Result<()> {
    let [open, pause, resume, quit] = labels(lang);

    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", open, true, None::<&str>)?,
            &MenuItem::with_id(app, "pause_all", pause, true, None::<&str>)?,
            &MenuItem::with_id(app, "resume_all", resume, true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", quit, true, None::<&str>)?,
        ],
    )?;

    TrayIconBuilder::with_id("gruzly-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "pause_all" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let queue = app.state::<crate::core::queue::QueueManager>();
                    crate::core::queue::pause_all_jobs(app.clone(), queue).await;
                });
            }
            "resume_all" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let queue = app.state::<crate::core::queue::QueueManager>();
                    crate::core::queue::resume_all_jobs(app.clone(), queue).await;
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .icon(app.default_window_icon().expect("window icon").clone())
        .on_tray_icon_event(|tray, event| {
            // Left click — bring the window up (Windows-style behavior).
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
