//! Backup commands: list, create, restore, delete.

use tauri::{AppHandle, Manager};

use crate::backups::{self, BackupInfo};
use crate::error::AppError;
use crate::state::AppState;

/// Lists the backup archives in the configured directory, newest first.
#[tauri::command]
pub async fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        Ok(backups::list_backups(&state))
    })
    .await
}

/// Creates a zip backup of the worlds and access lists.
#[tauri::command]
pub async fn create_backup(app: AppHandle, label: Option<String>) -> Result<BackupInfo, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        backups::create_backup(&app, &state, label.as_deref())
    })
    .await
}

/// Restores a backup; only allowed while the server is stopped.
#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    name: String,
    create_safety_backup: bool,
) -> Result<(), AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        backups::restore_backup(&app, &state, &name, create_safety_backup)
    })
    .await
}

/// Deletes one backup archive.
#[tauri::command]
pub async fn delete_backup(app: AppHandle, name: String) -> Result<(), AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        backups::delete_backup(&app, &state, &name)
    })
    .await
}
