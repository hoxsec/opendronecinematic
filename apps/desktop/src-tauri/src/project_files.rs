//! Remember only project files the user has already authorized through a native dialog.
//! Tauri's dynamic dialog scopes otherwise disappear when the application restarts.
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use tauri_plugin_fs::FsExt;

pub struct ProjectFiles {
    index: PathBuf,
    paths: Mutex<Vec<PathBuf>>,
}

fn is_project_path(path: &std::path::Path) -> bool {
    path.is_absolute()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
}

pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    let index = directory.join("project-file-permissions.json");
    // The webview must not be able to edit the permission index, even if picked in a dialog.
    app.fs_scope().forbid_file(&index)?;
    let paths: Vec<PathBuf> = std::fs::read(&index)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let paths: Vec<PathBuf> = paths
        .into_iter()
        .filter(|path| is_project_path(path) && path != &index)
        .take(64)
        .collect();
    for path in &paths {
        let _ = app.fs_scope().allow_file(path);
    }
    app.manage(ProjectFiles {
        index,
        paths: Mutex::new(paths),
    });
    Ok(())
}

#[tauri::command]
pub fn remember_project_path(
    app: tauri::AppHandle,
    files: State<'_, ProjectFiles>,
    path: PathBuf,
) -> Result<(), String> {
    // This is not an arbitrary-path permission grant: verify the existing dialog scope first.
    if !is_project_path(&path) || !app.fs_scope().is_allowed(&path) || path == files.index {
        return Err("This project file has not been authorized in a file dialog.".into());
    }
    let mut paths = files.paths.lock().map_err(|e| e.to_string())?;
    paths.retain(|existing| existing != &path);
    paths.insert(0, path);
    paths.truncate(64);
    let bytes = serde_json::to_vec(&*paths).map_err(|e| e.to_string())?;
    // A damaged index fails closed on the next launch: Open can reauthorize the file.
    std::fs::write(&files.index, bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_project_path;
    use std::path::Path;

    #[test]
    fn only_absolute_json_paths_are_project_files() {
        assert!(!is_project_path(Path::new("relative.odc.json")));
        assert!(!is_project_path(&std::env::temp_dir().join("mission.csv")));
        assert!(is_project_path(&std::env::temp_dir().join("mission.odc.JSON")));
    }
}
