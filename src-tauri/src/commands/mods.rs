//! Server mod commands: status and installation of BepInEx + Server Devcommands.

use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::mods::{self, ModStatus};
use crate::state::AppState;

/// Returns the current mod installation status (filesystem only, no network).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects `State` by value
pub fn get_mod_status(state: State<'_, AppState>) -> ModStatus {
    let config = state.config();
    mods::detect_mod_status(&config, &state.base().data_dir)
}

/// Downloads and installs BepInEx + Server Devcommands into the server directory.
///
/// The server must be stopped: Doorstop injects BepInEx via `winhttp.dll` only
/// at process startup. Progress is streamed through `server-install-progress`.
#[tauri::command]
pub async fn install_server_mods(app: AppHandle) -> Result<ModStatus, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        let _session = state.begin_install()?;
        mods::install_server_mods(&app, &state)
    })
    .await
}
