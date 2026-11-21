//! Where the library lives, as seen by the desktop shell (T2).
//!
//! The app and its library sit together on the external drive: the library is the `data`
//! folder next to the app. `SECUREPHOTOS_DATA_DIR` and `data_location.txt` point elsewhere for
//! development and tests. The shell keeps the window's browser profile inside the library, so
//! nothing about the user's photos is left on a computer the drive was plugged into.

use std::path::{Path, PathBuf};

/// Name of the browser profile folder inside the library.
pub const WEBVIEW_FOLDER: &str = "webview";

/// Picks the library folder, in the same order the engine uses.
///
/// Args: the `SECUREPHOTOS_DATA_DIR` value, the folder named in `data_location.txt`, the
/// project folder (development builds only) and the folder the app runs from.
pub fn choose_library_dir(
    env_dir: Option<&Path>,
    location_file_dir: Option<&Path>,
    project_root: Option<&Path>,
    app_dir: Option<&Path>,
) -> PathBuf {
    if let Some(dir) = env_dir.filter(|d| !d.as_os_str().is_empty()) {
        return dir.to_path_buf();
    }
    if let Some(dir) = location_file_dir {
        return dir.to_path_buf();
    }
    if let Some(root) = project_root {
        return root.join("data");
    }
    match app_dir {
        Some(dir) => dir.join("data"),
        None => PathBuf::from("data"),
    }
}

/// The window's browser profile folder (local storage, cache) inside the library.
pub fn webview_profile_dir(library: &Path) -> PathBuf {
    library.join(WEBVIEW_FOLDER)
}

/// The argument that makes an update install into the folder the app runs from, so an update
/// on any computer replaces the copy on the drive instead of adding one to that computer.
/// NSIS reads `/D=` without quotes, and it must come last.
pub fn update_install_dir_arg(app_dir: &Path) -> String {
    format!("/D={}", app_dir.display())
}
