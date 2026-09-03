use std::net::TcpStream;
use std::process::Command;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

#[derive(serde::Serialize)]
pub struct PythonPrerequisite {
    pub installed: bool,
    pub version: Option<String>,
    pub executable: Option<String>,
    pub meets_minimum_version: bool,
    pub minimum_required: String,
}

#[derive(serde::Serialize)]
pub struct BackendPrerequisite {
    pub running: bool,
    pub port: u16,
    pub url: String,
}

#[derive(serde::Serialize)]
pub struct SystemPrerequisites {
    pub python: PythonPrerequisite,
    pub backend: BackendPrerequisite,
    pub all_ready: bool,
}

#[tauri::command]
fn get_engine_status() -> serde_json::Value {
    serde_json::json!({
        "status": "active",
        "container": "tauri_2.0",
        "version": "0.0.2"
    })
}

#[tauri::command]
fn relaunch_app(app: AppHandle) {
    app.restart();
}

#[tauri::command]
fn check_system_prerequisites() -> SystemPrerequisites {
    // 1. Probe Python presence and version
    let mut python_installed = false;
    let mut detected_version: Option<String> = None;
    let mut detected_executable: Option<String> = None;
    let mut meets_min_ver = false;

    // Probe candidate executable names across Windows environments
    let candidates = ["python", "python3", "py"];
    for cmd in candidates {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let ver_str = if !stdout.is_empty() { stdout } else { stderr };

            if ver_str.to_lowercase().contains("python") {
                python_installed = true;
                detected_version = Some(ver_str.clone());

                // Parse version numbers (e.g., "Python 3.14.7" -> 3, 14)
                let parts: Vec<&str> = ver_str.split_whitespace().collect();
                if let Some(ver_nums) = parts.get(1) {
                    let segments: Vec<&str> = ver_nums.split('.').collect();
                    if segments.len() >= 2 {
                        let major = segments[0].parse::<u32>().unwrap_or(0);
                        let minor = segments[1].parse::<u32>().unwrap_or(0);
                        if major == 3 && minor >= 10 {
                            meets_min_ver = true;
                        }
                    }
                }

                // Check executable path using 'where'
                if let Ok(where_out) = Command::new("where.exe").arg(cmd).output() {
                    let path = String::from_utf8_lossy(&where_out.stdout).trim().to_string();
                    if !path.is_empty() {
                        let first_line = path.lines().next().unwrap_or("").to_string();
                        detected_executable = Some(first_line);
                    }
                }
                break;
            }
        }
    }

    // 2. Probe FastAPI Engine responsiveness on localhost:8000
    let backend_running = TcpStream::connect_timeout(
        &"127.0.0.1:8000".parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok();

    let all_ready = python_installed && meets_min_ver && backend_running;

    SystemPrerequisites {
        python: PythonPrerequisite {
            installed: python_installed,
            version: detected_version,
            executable: detected_executable,
            meets_minimum_version: meets_min_ver,
            minimum_required: "3.10".to_string(),
        },
        backend: BackendPrerequisite {
            running: backend_running,
            port: 8000,
            url: "http://127.0.0.1:8000".to_string(),
        },
        all_ready,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_engine_status,
            check_system_prerequisites,
            relaunch_app
        ])
        .setup(|app| {

            let quit_i = MenuItem::with_id(app, "quit", "Quit SecurePhotos", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open Library", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SecurePhotos application");
}
