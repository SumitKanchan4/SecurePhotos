use std::net::TcpStream;
use std::path::PathBuf;
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
        "version": "0.1.0"
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

fn find_sidecar_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(curr) = std::env::current_exe() {
        if let Some(parent) = curr.parent() {
            candidates.push(parent.join("securephotos-engine.exe"));
            candidates.push(parent.join("securephotos-engine-x86_64-pc-windows-msvc.exe"));
            candidates.push(parent.join("binaries").join("securephotos-engine-x86_64-pc-windows-msvc.exe"));
        }
    }

    // Development path fallbacks
    candidates.push(PathBuf::from("src-tauri/binaries/securephotos-engine-x86_64-pc-windows-msvc.exe"));
    candidates.push(PathBuf::from("binaries/securephotos-engine-x86_64-pc-windows-msvc.exe"));

    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }
    None
}

#[tauri::command]
fn check_system_prerequisites() -> SystemPrerequisites {
    // 1. Probe FastAPI Engine responsiveness on localhost:8000
    let backend_running = TcpStream::connect_timeout(
        &"127.0.0.1:8000".parse().unwrap(),
        Duration::from_millis(400),
    )
    .is_ok();

    let sidecar_exists = find_sidecar_executable().is_some();

    let mut python_installed = sidecar_exists || backend_running;
    let mut detected_version = if sidecar_exists || backend_running {
        Some("Embedded Sidecar (Python 3.11 Runtime)".to_string())
    } else {
        None
    };
    let mut detected_executable = if sidecar_exists {
        Some("securephotos-engine.exe".to_string())
    } else {
        None
    };
    let mut meets_min_ver = python_installed;

    // Fallback: quick non-blocking probe with CREATE_NO_WINDOW if not detected yet
    if !python_installed {
        let candidates = ["python", "python3", "py"];
        for cmd_name in candidates {
            let mut check_cmd = Command::new(cmd_name);
            check_cmd.arg("--version");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                check_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            if let Ok(output) = check_cmd.output() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let ver_str = if !stdout.is_empty() { stdout } else { stderr };

                if ver_str.to_lowercase().contains("python") {
                    python_installed = true;
                    detected_version = Some(ver_str.clone());
                    detected_executable = Some(cmd_name.to_string());
                    meets_min_ver = true;
                    break;
                }
            }
        }
    }

    let all_ready = backend_running;

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

fn find_project_root() -> Option<PathBuf> {
    let mut check_dirs = Vec::new();

    if let Ok(curr) = std::env::current_dir() {
        check_dirs.push(curr.clone());
        if let Some(parent) = curr.parent() {
            check_dirs.push(parent.to_path_buf());
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut p = exe.as_path();
        while let Some(parent) = p.parent() {
            check_dirs.push(parent.to_path_buf());
            p = parent;
        }
    }

    check_dirs.push(PathBuf::from("."));
    check_dirs.push(PathBuf::from(".."));

    for dir in check_dirs {
        if dir.join("engine").join("main.py").exists() {
            if let Ok(canonical) = dir.canonicalize() {
                return Some(canonical);
            }
            return Some(dir);
        }
    }
    None
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

    let project_root = find_project_root();

    // In development mode (debug builds), prefer running directly from local .venv
    #[cfg(debug_assertions)]
    {
        let mut venv_candidates = Vec::new();
        if let Some(ref root) = project_root {
            venv_candidates.push(root.join(".venv/Scripts/python.exe"));
            venv_candidates.push(root.join(".venv/bin/python"));
        }
        venv_candidates.push(PathBuf::from(".venv/Scripts/python.exe"));
        venv_candidates.push(PathBuf::from("../.venv/Scripts/python.exe"));
        venv_candidates.push(PathBuf::from(".venv/bin/python"));
        venv_candidates.push(PathBuf::from("../.venv/bin/python"));

        for venv_py in venv_candidates {
            if venv_py.exists() {
                let mut cmd = Command::new(&venv_py);
                if let Some(ref root) = project_root {
                    cmd.current_dir(root);
                    cmd.env("PYTHONPATH", root);
                }
                cmd.args(["-m", "uvicorn", "engine.main:app", "--port", "8000", "--reload"]);
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                }
                if let Ok(child) = cmd.spawn() {
                    if let Ok(mut lock) = state.0.lock() {
                        *lock = Some(child);
                    }
                    return serde_json::json!({
                        "status": "starting",
                        "message": "Development Python engine started via .venv"
                    });
                }
            }
        }
    }

    // Priority 1: Launch compiled standalone sidecar binary
    if let Some(sidecar_path) = find_sidecar_executable() {
        let mut cmd = Command::new(&sidecar_path);
        let data_dir = sidecar_path.parent().map(|p| p.join("data")).unwrap_or_else(|| std::path::PathBuf::from("data"));
        cmd.args(["--port", "8000", "--data-dir", data_dir.to_str().unwrap_or("data")]);
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
                return serde_json::json!({
                    "status": "starting",
                    "message": "Bundled engine sidecar started"
                });
            }
            Err(err) => {
                eprintln!("Failed to spawn sidecar: {}", err);
            }
        }
    }

    // Priority 2: Fallback to local Python for development environment
    let candidates = ["python", "python3", "py"];
    let mut python_cmd: Option<String> = None;
    for cmd_name in candidates {
        let mut check_cmd = Command::new(cmd_name);
        check_cmd.arg("--version");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            check_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        if let Ok(output) = check_cmd.output() {
            let ver = String::from_utf8_lossy(&output.stdout);
            if ver.to_lowercase().contains("python") {
                python_cmd = Some(cmd_name.to_string());
                break;
            }
        }
    }

    let Some(py) = python_cmd else {
        return serde_json::json!({
            "status": "missing_python",
            "message": "Neither bundled engine nor Python runtime found"
        });
    };

    let mut cmd = Command::new(py);
    if let Some(ref root) = project_root {
        cmd.current_dir(root);
        cmd.env("PYTHONPATH", root);
    }
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
                "message": "Background engine started via Python"
            })
        }
        Err(err) => {
            serde_json::json!({
                "status": "error",
                "message": format!("Failed to spawn engine: {}", err)
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

/// Prompts the user with a native, non-blocking folder selection dialog.
///
/// Uses `rfd::AsyncFileDialog` to invoke the platform-native file picker
/// (Windows `IFileDialog` with `FOS_PICKFOLDERS`) directly in-process without
/// spawning external console processes or blocking the main event loop.
#[tauri::command]
async fn select_import_folder() -> Option<String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Select Folder to Import")
        .pick_folder()
        .await;

    folder.map(|handle| handle.path().to_string_lossy().to_string())
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
