use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub struct AppEngineState {
    pub port: AtomicU16,
    pub token: RwLock<String>,
    pub process: Arc<Mutex<Option<std::process::Child>>>,
}

#[derive(serde::Serialize, Clone)]
pub struct EngineConfigDto {
    pub port: u16,
    pub token: String,
    pub base_url: String,
}

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

#[derive(serde::Serialize, Clone)]
pub struct VcRedistPrerequisite {
    pub installed: bool,
    pub download_url: String,
}

#[derive(serde::Serialize)]
pub struct SystemPrerequisites {
    pub python: PythonPrerequisite,
    pub backend: BackendPrerequisite,
    pub vcredist: VcRedistPrerequisite,
    pub all_ready: bool,
    pub error_message: Option<String>,
}

#[cfg(target_os = "windows")]
fn check_vcredist_installed() -> bool {
    let win_dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let sys32 = std::path::Path::new(&win_dir).join("System32");
    sys32.join("vcruntime140.dll").exists() && sys32.join("msvcp140.dll").exists()
}

#[cfg(not(target_os = "windows"))]
fn check_vcredist_installed() -> bool {
    true
}

fn resolve_custom_data_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(curr) = std::env::current_exe() {
        if let Some(parent) = curr.parent() {
            candidates.push(parent.join("data_location.txt"));
        }
    }
    candidates.push(PathBuf::from("data_location.txt"));
    candidates.push(PathBuf::from("../data_location.txt"));

    for loc_file in candidates {
        if loc_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&loc_file) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("path=") {
                        let path_str = trimmed.trim_start_matches("path=").trim();
                        let custom = PathBuf::from(path_str);
                        if custom.exists() {
                            return Some(custom);
                        }
                    }
                }
            }
        }
    }
    None
}

fn get_or_prepare_log_file() -> Option<std::fs::File> {
    let mut dir = resolve_custom_data_dir().unwrap_or_else(|| PathBuf::from("data"));
    if !dir.exists() {
        if let Ok(curr) = std::env::current_exe() {
            if let Some(parent) = curr.parent() {
                dir = parent.join("data");
            }
        }
    }
    let _ = std::fs::create_dir_all(&dir);
    let log_path = dir.join("engine_startup.log");

    // Strictly enforce log bounds: truncate if larger than 1MB so it stays small
    if let Ok(meta) = std::fs::metadata(&log_path) {
        if meta.len() > 1024 * 1024 {
            let _ = std::fs::remove_file(&log_path);
        }
    }

    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(&log_path)
        .ok()
}

#[tauri::command]
fn get_engine_logs() -> String {
    let mut candidates = vec![
        PathBuf::from("data/engine_startup.log"),
        PathBuf::from("../data/engine_startup.log"),
    ];
    if let Ok(curr) = std::env::current_exe() {
        if let Some(parent) = curr.parent() {
            candidates.push(parent.join("data").join("engine_startup.log"));
        }
    }
    for path in candidates {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(path) {
                let lines: Vec<&str> = content.lines().collect();
                let count = lines.len();
                let start = if count > 80 { count - 80 } else { 0 };
                return lines[start..].join("\n");
            }
        }
    }
    "No engine startup logs recorded yet.".to_string()
}

fn find_available_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(8000)
}

#[cfg(target_os = "windows")]
fn generate_secure_token() -> String {
    #[link(name = "bcrypt")]
    extern "system" {
        fn BCryptGenRandom(
            h_algorithm: *mut std::ffi::c_void,
            pb_buffer: *mut u8,
            cb_buffer: u32,
            dw_flags: u32,
        ) -> i32;
    }
    let mut buf = [0u8; 32];
    unsafe {
        let status = BCryptGenRandom(
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            0x00000002, // BCRYPT_USE_SYSTEM_PREFERRED_RNG
        );
        if status == 0 {
            return buf.iter().map(|b| format!("{:02x}", b)).collect();
        }
    }
    fallback_token()
}

#[cfg(not(target_os = "windows"))]
fn generate_secure_token() -> String {
    if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let mut buf = [0u8; 32];
        if file.read_exact(&mut buf).is_ok() {
            return buf.iter().map(|b| format!("{:02x}", b)).collect();
        }
    }
    fallback_token()
}

fn fallback_token() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    format!("{:032x}{:032x}", now, pid)
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
fn get_engine_config(state: tauri::State<AppEngineState>) -> EngineConfigDto {
    let port = state.port.load(Ordering::SeqCst);
    let token = state.token.read().unwrap().clone();
    EngineConfigDto {
        port,
        token,
        base_url: format!("http://127.0.0.1:{}", port),
    }
}

#[tauri::command]
fn relaunch_app(app: AppHandle) {
    let state = app.state::<AppEngineState>();
    if let Ok(mut lock) = state.process.lock() {
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
fn check_system_prerequisites(state: tauri::State<AppEngineState>) -> SystemPrerequisites {
    let current_port = state.port.load(Ordering::SeqCst);
    let target_port = if current_port > 0 { current_port } else { 8000 };
    let addr_str = format!("127.0.0.1:{}", target_port);

    let backend_running = addr_str
        .parse()
        .map(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok())
        .unwrap_or(false);

    let vcredist_installed = check_vcredist_installed();
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

    let mut error_message: Option<String> = None;
    if !vcredist_installed {
        error_message = Some("Microsoft Visual C++ 2015-2022 Redistributable (x64) is not installed. This is required on Windows for local AI super-resolution and face recognition.".to_string());
    } else if !backend_running {
        // Inspect if child process has exited prematurely
        if let Ok(mut lock) = state.process.lock() {
            if let Some(ref mut child) = *lock {
                if let Ok(Some(exit_status)) = child.try_wait() {
                    error_message = Some(format!("AI Engine process exited prematurely ({exit_status}). Check startup logs for details."));
                }
            }
        }
    }

    let all_ready = backend_running && vcredist_installed;

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
            port: target_port,
            url: format!("http://127.0.0.1:{}", target_port),
        },
        vcredist: VcRedistPrerequisite {
            installed: vcredist_installed,
            download_url: "https://aka.ms/vs/17/release/vc_redist.x64.exe".to_string(),
        },
        all_ready,
        error_message,
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
fn start_backend_engine(state: tauri::State<AppEngineState>) -> serde_json::Value {
    let current_port = state.port.load(Ordering::SeqCst);
    if current_port > 0 {
        let addr_str = format!("127.0.0.1:{}", current_port);
        if let Ok(addr) = addr_str.parse() {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
                return serde_json::json!({
                    "status": "running",
                    "port": current_port,
                    "message": format!("Engine is already active on port {}", current_port)
                });
            }
        }
    }

    let chosen_port = find_available_port();
    let token = generate_secure_token();

    state.port.store(chosen_port, Ordering::SeqCst);
    if let Ok(mut t_lock) = state.token.write() {
        *t_lock = token.clone();
    }

    let project_root = find_project_root();
    let log_file = get_or_prepare_log_file();

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
                if let Some(ref c_dir) = resolve_custom_data_dir() {
                    cmd.env("SECUREPHOTOS_DATA_DIR", c_dir.to_string_lossy().to_string());
                }
                cmd.env("SECUREPHOTOS_IPC_SECRET", &token);
                cmd.args(["-m", "uvicorn", "engine.main:app", "--port", &chosen_port.to_string(), "--reload"]);
                if let Some(ref file) = log_file {
                    if let Ok(f1) = file.try_clone() {
                        cmd.stdout(Stdio::from(f1));
                    }
                    if let Ok(f2) = file.try_clone() {
                        cmd.stderr(Stdio::from(f2));
                    }
                }
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                }
                if let Ok(child) = cmd.spawn() {
                    if let Ok(mut lock) = state.process.lock() {
                        *lock = Some(child);
                    }
                    return serde_json::json!({
                        "status": "starting",
                        "port": chosen_port,
                        "message": format!("Development Python engine started on port {}", chosen_port)
                    });
                }
            }
        }
    }

    // Priority 1: Launch compiled standalone sidecar binary
    if let Some(sidecar_path) = find_sidecar_executable() {
        let mut cmd = Command::new(&sidecar_path);
        let custom_dir = resolve_custom_data_dir();
        let data_dir = custom_dir.unwrap_or_else(|| {
            sidecar_path.parent().map(|p| p.join("data")).unwrap_or_else(|| std::path::PathBuf::from("data"))
        });
        cmd.env("SECUREPHOTOS_IPC_SECRET", &token);
        cmd.args(["--port", &chosen_port.to_string(), "--data-dir", data_dir.to_str().unwrap_or("data")]);
        if let Some(ref file) = log_file {
            if let Ok(f1) = file.try_clone() {
                cmd.stdout(Stdio::from(f1));
            }
            if let Ok(f2) = file.try_clone() {
                cmd.stderr(Stdio::from(f2));
            }
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        match cmd.spawn() {
            Ok(child) => {
                if let Ok(mut lock) = state.process.lock() {
                    *lock = Some(child);
                }
                return serde_json::json!({
                    "status": "starting",
                    "port": chosen_port,
                    "message": format!("Bundled engine sidecar started on port {}", chosen_port)
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
    cmd.env("SECUREPHOTOS_IPC_SECRET", &token);
    cmd.args(["-m", "uvicorn", "engine.main:app", "--port", &chosen_port.to_string()]);
    if let Some(ref file) = log_file {
        if let Ok(f1) = file.try_clone() {
            cmd.stdout(Stdio::from(f1));
        }
        if let Ok(f2) = file.try_clone() {
            cmd.stderr(Stdio::from(f2));
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    match cmd.spawn() {
        Ok(child) => {
            if let Ok(mut lock) = state.process.lock() {
                *lock = Some(child);
            }
            serde_json::json!({
                "status": "starting",
                "port": chosen_port,
                "message": format!("Background engine started on port {}", chosen_port)
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
fn stop_backend_engine(state: tauri::State<AppEngineState>) -> bool {
    if let Ok(mut lock) = state.process.lock() {
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

/// Prompts the user with a native, non-blocking multiple media file selection dialog.
#[tauri::command]
async fn select_import_files() -> Option<Vec<String>> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("Select Photos & Videos to Import")
        .add_filter(
            "Media Files",
            &[
                "jpg", "jpeg", "png", "webp", "avif", "heic", "bmp", "tiff",
                "mp4", "mov", "mkv", "avi", "webm", "m4v",
            ],
        )
        .pick_files()
        .await;

    files.map(|handles| {
        handles
            .into_iter()
            .map(|h| h.path().to_string_lossy().to_string())
            .collect()
    })
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

#[tauri::command]
fn prepare_for_update(state: tauri::State<AppEngineState>) -> bool {
    if let Ok(mut lock) = state.process.lock() {
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
        }
    }
    true
}

#[derive(serde::Serialize, Clone)]
pub struct LibraryLocationDto {
    pub path: String,
    pub is_custom: bool,
    pub has_database: bool,
}

#[tauri::command]
fn get_library_location() -> LibraryLocationDto {
    if let Some(custom) = resolve_custom_data_dir() {
        let has_db = custom.join("database").join("securephotos.db").exists();
        return LibraryLocationDto {
            path: custom.to_string_lossy().to_string(),
            is_custom: true,
            has_database: has_db,
        };
    }
    let mut default_dir = PathBuf::from("data");
    if let Ok(curr) = std::env::current_exe() {
        if let Some(parent) = curr.parent() {
            default_dir = parent.join("data");
        }
    }
    let has_db = default_dir.join("database").join("securephotos.db").exists();
    LibraryLocationDto {
        path: default_dir.to_string_lossy().to_string(),
        is_custom: false,
        has_database: has_db,
    }
}

#[tauri::command]
fn reconnect_library(app: AppHandle, new_path: String) -> Result<bool, String> {
    let target = PathBuf::from(&new_path);
    if !target.exists() {
        return Err(format!("The specified directory does not exist: {}", new_path));
    }
    let db_path = target.join("database").join("securephotos.db");
    if !db_path.exists() {
        return Err("No SecurePhotos database (database/securephotos.db) was found in the selected folder. Please choose a valid SecurePhotos data directory.".to_string());
    }

    let mut loc_file = PathBuf::from("data_location.txt");
    if let Ok(curr) = std::env::current_exe() {
        if let Some(parent) = curr.parent() {
            loc_file = parent.join("data_location.txt");
        }
    }
    if let Err(e) = std::fs::write(&loc_file, format!("path={}\n", target.to_string_lossy())) {
        return Err(format!("Failed to record library location: {}", e));
    }

    // Kill existing engine process so restart cleanly binds to the new library
    let state = app.state::<AppEngineState>();
    if let Ok(mut lock) = state.process.lock() {
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
        }
    }
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine_state = AppEngineState {
        port: AtomicU16::new(0),
        token: RwLock::new(String::new()),
        process: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .manage(engine_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_engine_status,
            get_engine_config,
            get_engine_logs,
            check_system_prerequisites,
            relaunch_app,
            prepare_for_update,
            get_library_location,
            reconnect_library,
            start_backend_engine,
            stop_backend_engine,
            select_import_folder,
            select_import_files,
            get_system_drives
        ])
        .setup(|app| {
            // Auto-launch backend engine silently in the background
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<AppEngineState>();
                let _ = start_backend_engine(state);
            });

            let quit_i = MenuItem::with_id(app, "quit", "Quit SecurePhotos", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open Library", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
                    "quit" => {
                        let state = app.state::<AppEngineState>();
                        if let Ok(mut lock) = state.process.lock() {
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
