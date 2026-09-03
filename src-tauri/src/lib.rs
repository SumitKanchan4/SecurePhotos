use std::net::TcpStream;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub struct BackendManager(pub Arc<Mutex<Option<std::process::Child>>>);

#[derive(serde::Serialize, Clone)]
pub struct SystemVolumeInfo {
    pub drive_letter: String,
    pub volume_name: String,
    pub is_ready: bool,
    pub free_bytes: u64,
    pub total_bytes: u64,
}

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
        "version": "0.0.5"
    })
}

#[tauri::command]
fn relaunch_app(app: AppHandle) {
    let state = app.state::<BackendManager>();
    if let Ok(mut lock) = state.0.lock() {
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
        }
    }
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

#[tauri::command]
fn start_backend_engine(state: tauri::State<BackendManager>) -> serde_json::Value {
    if TcpStream::connect_timeout(
        &"127.0.0.1:8000".parse().unwrap(),
        Duration::from_millis(300),
    ).is_ok() {
        return serde_json::json!({
            "status": "running",
            "message": "Engine is already active on port 8000"
        });
    }

    let candidates = ["python", "python3", "py"];
    let mut python_cmd: Option<String> = None;
    for cmd in candidates {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            let ver = String::from_utf8_lossy(&output.stdout);
            if ver.to_lowercase().contains("python") {
                python_cmd = Some(cmd.to_string());
                break;
            }
        }
    }

    let Some(py) = python_cmd else {
        return serde_json::json!({
            "status": "missing_python",
            "message": "Python runtime not found on host"
        });
    };

    let mut cmd = Command::new(py);
    cmd.args(["-m", "uvicorn", "engine.main:app", "--port", "8000"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    match cmd.spawn() {
        Ok(child) => {
            if let Ok(mut lock) = state.0.lock() {
                *lock = Some(child);
            }
            serde_json::json!({
                "status": "starting",
                "message": "Background engine started"
            })
        }
        Err(err) => {
            serde_json::json!({
                "status": "error",
                "message": format!("Failed to start engine: {}", err)
            })
        }
    }
}

#[tauri::command]
fn stop_backend_engine(state: tauri::State<BackendManager>) -> bool {
    if let Ok(mut lock) = state.0.lock() {
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
            return true;
        }
    }
    false
}

#[tauri::command]
fn select_import_folder() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let ps_script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select a folder containing photos to import"
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
"#;
        if let Ok(out) = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

#[tauri::command]
fn get_system_drives() -> Vec<SystemVolumeInfo> {
    vec![
        SystemVolumeInfo {
            drive_letter: "C:\\".to_string(),
            volume_name: "Local Storage".to_string(),
            is_ready: true,
            free_bytes: 120 * 1024 * 1024 * 1024,
            total_bytes: 512 * 1024 * 1024 * 1024,
        }
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendManager(Arc::new(Mutex::new(None))))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_engine_status,
            check_system_prerequisites,
            relaunch_app,
            start_backend_engine,
            stop_backend_engine,
            select_import_folder,
            get_system_drives
        ])
        .setup(|app| {
            // Auto-launch backend engine silently in the background
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<BackendManager>();
                let _ = start_backend_engine(state);
            });

            let quit_i = MenuItem::with_id(app, "quit", "Quit SecurePhotos", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open Library", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
                    "quit" => {
                        let state = app.state::<BackendManager>();
                        if let Ok(mut lock) = state.0.lock() {
                            if let Some(mut child) = lock.take() {
                                let _ = child.kill();
                            }
                        }
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
