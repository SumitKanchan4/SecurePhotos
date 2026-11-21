//! T2: the library and the window's browser profile stay together, next to the app.

#[path = "../src/library.rs"]
mod library;

use library::{choose_library_dir, update_install_dir_arg, webview_profile_dir};
use std::path::{Path, PathBuf};

#[test]
fn an_installed_app_keeps_its_library_next_to_it() {
    let app = Path::new(r"E:\SecurePhotos");
    assert_eq!(choose_library_dir(None, None, None, Some(app)), PathBuf::from(r"E:\SecurePhotos\data"));
}

#[test]
fn the_browser_profile_lives_inside_the_library() {
    let library = choose_library_dir(None, None, None, Some(Path::new(r"F:\SecurePhotos")));
    let profile = webview_profile_dir(&library);
    assert!(profile.starts_with(&library), "{profile:?} is outside {library:?}");
    assert_eq!(profile, PathBuf::from(r"F:\SecurePhotos\data\webview"));
}

#[test]
fn development_settings_come_first_in_the_engines_order() {
    let env = Path::new(r"C:\Temp\test-library");
    let file = Path::new(r"D:\JointTest");
    let root = Path::new(r"C:\Code\SecurePhotos");
    let app = Path::new(r"C:\Code\SecurePhotos\src-tauri\target\debug");
    assert_eq!(choose_library_dir(Some(env), Some(file), Some(root), Some(app)), env);
    assert_eq!(choose_library_dir(Some(Path::new("")), Some(file), Some(root), Some(app)), file);
    assert_eq!(choose_library_dir(None, None, Some(root), Some(app)), root.join("data"));
}

#[test]
fn an_update_installs_into_the_folder_the_app_runs_from() {
    assert_eq!(update_install_dir_arg(Path::new(r"G:\My Photos App")), r"/D=G:\My Photos App");
}
