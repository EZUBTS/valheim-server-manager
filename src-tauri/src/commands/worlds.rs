//! World commands: scanning `worlds_local`.

use tauri::State;

use crate::state::AppState;
use crate::worlds::{WorldInfo, scan_worlds};

/// Lists every world found in `<savedir>\worlds_local`.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects `State` by value
pub fn list_worlds(state: State<'_, AppState>) -> Vec<WorldInfo> {
    let config = state.config();
    scan_worlds(&config.worlds_dir_path(), &config.server.world)
}
