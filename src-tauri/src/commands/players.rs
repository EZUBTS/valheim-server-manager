//! Player access list commands.

use tauri::{AppHandle, Emitter, State};

use crate::error::AppError;
use crate::logs::LogLevel;
use crate::players::{self, PlayerListKind, PlayerLists};
use crate::state::{AppState, EVENT_LISTS_CHANGED};

/// Human-readable Russian name of a list kind.
#[must_use]
pub const fn list_label(kind: PlayerListKind) -> &'static str {
    match kind {
        PlayerListKind::Admins => "админов",
        PlayerListKind::Banned => "бана",
        PlayerListKind::Permitted => "допущенных",
    }
}

/// Reads all three access lists from the save directory.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects `State` by value
pub fn get_player_lists(state: State<'_, AppState>) -> Result<PlayerLists, AppError> {
    let config = state.config();
    players::read_lists(&config, &state.base().data_dir)
}

/// Adds a player to one of the lists.
///
/// The lists are read by Valheim only at server startup, so a warning is
/// logged when the server is running.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn add_player(
    app: AppHandle,
    state: State<'_, AppState>,
    list: PlayerListKind,
    id: String,
    name: Option<String>,
) -> Result<PlayerLists, AppError> {
    let config = state.config();
    let lists = players::add_entry(&config, &state.base().data_dir, list, &id, name.as_deref())?;

    state.log_app(
        &app,
        LogLevel::Info,
        format!("Игрок {id} добавлен в список {}", list_label(list)),
    );
    if state.server_is_active() {
        state.log_app(
            &app,
            LogLevel::Warn,
            "Списки игроков читаются сервером только при старте — перезапустите сервер, чтобы изменения применились.",
        );
    }
    if list == PlayerListKind::Permitted && !lists.permitted.is_empty() {
        state.log_app(
            &app,
            LogLevel::Warn,
            "В permittedlist.txt есть записи: сервер работает как whitelist, остальные игроки не смогут войти.",
        );
    }

    emit_lists_changed(&app, &lists);
    Ok(lists)
}

/// Removes a player from one of the lists.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn remove_player(
    app: AppHandle,
    state: State<'_, AppState>,
    list: PlayerListKind,
    id: String,
) -> Result<PlayerLists, AppError> {
    let config = state.config();
    let lists = players::remove_entry(&config, &state.base().data_dir, list, &id)?;

    state.log_app(
        &app,
        LogLevel::Info,
        format!("Игрок {id} удалён из списка {}", list_label(list)),
    );
    if state.server_is_active() {
        state.log_app(
            &app,
            LogLevel::Warn,
            "Списки игроков читаются сервером только при старте — перезапустите сервер, чтобы изменения применились.",
        );
    }

    emit_lists_changed(&app, &lists);
    Ok(lists)
}

/// Emits the optional `server-lists-changed` event after a list modification.
fn emit_lists_changed(app: &AppHandle, lists: &PlayerLists) {
    if let Err(error) = app.emit(EVENT_LISTS_CHANGED, lists) {
        log::warn!(target: "valheim-server", "Не удалось отправить server-lists-changed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_labels_are_russian() {
        assert_eq!(list_label(PlayerListKind::Admins), "админов");
        assert_eq!(list_label(PlayerListKind::Banned), "бана");
        assert_eq!(list_label(PlayerListKind::Permitted), "допущенных");
    }
}
