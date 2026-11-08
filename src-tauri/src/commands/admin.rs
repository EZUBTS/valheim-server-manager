//! Admin helpers: players known from the server log and the access lists.

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::logs::{LOG_BUFFER_CAPACITY, LogSource};
use crate::players::{self, KnownPlayer};
use crate::state::AppState;

/// Returns players seen in the server logs plus the admins from the access lists.
///
/// Two sources are merged:
/// 1. the newest `server-*.log` file from `<logsDir>/server` — this restores the
///    list right after an application restart, before the server is started
///    again (the in-memory ring buffer is empty at that point);
/// 2. the in-memory ring buffer of the current application session.
///
/// `source` tells the frontend how the player was discovered: `history`
/// (server "Player history" lines), `live` (session log lines) or `list`
/// (present only in the access lists). The work is done on a blocking thread
/// because the log file may be a few megabytes.
#[tauri::command]
pub async fn get_known_players(app: AppHandle) -> Result<Vec<KnownPlayer>, AppError> {
    super::run_blocking(move || {
        let state = app.state::<AppState>();
        let config = state.config();
        let lists = players::read_lists(&config, &state.base().data_dir)?;

        let mut log_lines =
            players::load_server_log_lines(&state.base().logs_dir, players::MAX_SERVER_LOG_LINES);
        // The live ring buffer goes last so it wins for equal timestamps.
        log_lines.extend(state.get_logs(LOG_BUFFER_CAPACITY, Some(LogSource::Server), None));

        Ok(players::parse_known_players(&log_lines, &lists.admins))
    })
    .await
}
