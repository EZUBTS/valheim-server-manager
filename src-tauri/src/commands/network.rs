//! Network and firewall commands.

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::network::{self, NetworkDiagnosis};
use crate::state::AppState;

/// Runs UDP port, firewall, local IP diagnostics and builds hints.
///
/// The backend uses fast `netsh` queries with hard timeouts and a short TTL
/// cache, so repeated calls (application startup + network page) stay below
/// ~2 seconds.
#[tauri::command]
pub async fn diagnose_network(app: AppHandle) -> Result<NetworkDiagnosis, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        let config = state.config();
        Ok(network::diagnose_network(&config))
    })
    .await
}

/// Adds an inbound UDP firewall rule for the server ports.
///
/// Requires administrator rights; a refusal is reported as
/// `ELEVATION_REQUIRED` so the frontend can show the elevation hint.
#[tauri::command]
pub async fn open_firewall_ports(app: AppHandle) -> Result<NetworkDiagnosis, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        let config = state.config();
        network::open_firewall_ports(&config)
    })
    .await
}

/// Quick check whether a UDP port is free (used by the settings form).
#[tauri::command]
pub fn is_port_available(port: u16) -> bool {
    network::is_udp_port_free(port)
}
