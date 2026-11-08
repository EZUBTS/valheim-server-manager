//! Server process commands: state, start, stop.

use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::process::server;
use crate::state::{AppState, ServerState};

/// Returns the current server process state.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects `State` by value
pub fn get_server_state(state: State<'_, AppState>) -> ServerState {
    state.state()
}

/// Starts the dedicated server (validation, port checks, spawn).
///
/// The command returns as soon as the process exists; the `starting → running`
/// transition happens in the background when the server log reports
/// `Game server connected` and is delivered through the `server-state` event.
#[tauri::command]
pub async fn start_server(app: AppHandle) -> Result<ServerState, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        server::spawn_server(&app, &state)
    })
    .await
}

/// Stops the dedicated server: graceful attempt first, forced kill as fallback.
#[tauri::command]
pub async fn stop_server(app: AppHandle, force: bool) -> Result<ServerState, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        server::stop_server(&app, &state, force)
    })
    .await
}
