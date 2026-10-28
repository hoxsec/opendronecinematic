use odc_localdata::{DownloadRequest, GeofabrikRegion, LocalData, RegionMeta};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

type Local<'a> = State<'a, Arc<LocalData>>;

/// Run blocking local-data work off the main thread and turn errors into strings for the UI.
async fn blocking<T: Send + 'static>(
    data: &Arc<LocalData>,
    f: impl FnOnce(&LocalData) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    let data = data.clone();
    tauri::async_runtime::spawn_blocking(move || f(&data))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn local_server_url(data: Local<'_>) -> String {
    data.base_url().to_string()
}

#[tauri::command]
async fn geofabrik_regions(data: Local<'_>) -> Result<Vec<GeofabrikRegion>, String> {
    blocking(&data, |d| d.geofabrik_regions()).await
}

#[tauri::command]
async fn region_pbf_size(data: Local<'_>, id: String) -> Result<Option<u64>, String> {
    blocking(&data, move |d| d.pbf_size(&id)).await
}

#[tauri::command]
fn local_regions(data: Local<'_>) -> Vec<RegionMeta> {
    data.regions()
}

#[tauri::command]
fn download_region(
    app: tauri::AppHandle,
    data: Local<'_>,
    request: DownloadRequest,
) -> Result<(), String> {
    data.download(request, move |p| {
        let _ = app.emit("local-data-progress", p);
    })
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
fn cancel_region_download(data: Local<'_>, key: String) {
    data.cancel(&key);
}

#[tauri::command]
fn delete_region(data: Local<'_>, key: String) -> Result<(), String> {
    data.delete(&key).map_err(|e| format!("{e:#}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Offline country data lives in the app data dir and is served on 127.0.0.1.
            let root = app.path().app_data_dir()?.join("localdata");
            app.manage(Arc::new(LocalData::start(root)?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            local_server_url,
            geofabrik_regions,
            region_pbf_size,
            local_regions,
            download_region,
            cancel_region_download,
            delete_region,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenDroneCinematic");
}
