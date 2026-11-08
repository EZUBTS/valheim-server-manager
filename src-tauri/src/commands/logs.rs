//! Log commands: ring buffer snapshot for the first paint and clearing.

use tauri::State;

use crate::logs::{LOG_BUFFER_CAPACITY, LogLine, LogSource};
use crate::state::AppState;

/// Maximum number of lines accepted by [`get_logs`].
pub const MAX_LOG_LIMIT: usize = LOG_BUFFER_CAPACITY;

/// Returns the last `limit` buffered lines, optionally filtered by source.
///
/// `sinceSeq` is used by the frontend to fetch only lines newer than the last
/// one it has seen (for example after a re-mount of the page).
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn get_logs(
    state: State<'_, AppState>,
    limit: usize,
    source: Option<LogSource>,
    since_seq: Option<u64>,
) -> Vec<LogLine> {
    let limit = limit.clamp(1, MAX_LOG_LIMIT);
    state.get_logs(limit, source, since_seq)
}

/// Clears the in-memory ring buffer. Log files on disk are not touched.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects `State` by value
pub fn clear_logs(state: State<'_, AppState>) {
    state.clear_logs();
}
