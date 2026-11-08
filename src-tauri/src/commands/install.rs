//! Installation commands: install status, SteamCMD download, server update.

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::process::steamcmd::{self, InstallStatus};
use crate::state::{AppState, InstallProgress};

/// Returns whether SteamCMD and the dedicated server are installed.
#[tauri::command]
pub async fn get_install_status(app: AppHandle) -> Result<InstallStatus, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        Ok(steamcmd::install_status(&state.config()))
    })
    .await
}

/// Downloads `steamcmd.zip` and extracts it into the configured directory.
#[tauri::command]
pub async fn install_steamcmd(app: AppHandle) -> Result<InstallProgress, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        let _session = state.begin_install()?;
        steamcmd::install_steamcmd(&app, &state)
    })
    .await
}

/// Installs or updates the Valheim Dedicated Server via SteamCMD.
#[tauri::command]
pub async fn update_server(app: AppHandle, validate: bool) -> Result<InstallProgress, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        let _session = state.begin_install()?;
        steamcmd::update_server(&app, &state, validate)
    })
    .await
}
