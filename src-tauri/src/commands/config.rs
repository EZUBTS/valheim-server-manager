//! Configuration commands: read, validate + save, reset.

use tauri::{AppHandle, State};

use crate::config::AppConfig;
use crate::error::AppError;
use crate::logs::LogLevel;
use crate::state::AppState;

/// Returns the current configuration.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects `State` by value
pub fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config()
}

/// Validates, normalizes and saves the configuration atomically.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<AppConfig, AppError> {
    let mut config = config;
    config.normalize(state.base());
    config.validate()?;

    let was_running = state.server_is_active();
    config.save(state.base())?;
    state.set_config(config.clone());

    state.log_app(&app, LogLevel::Info, "Конфигурация сохранена");
    if was_running {
        state.log_app(
            &app,
            LogLevel::Warn,
            "Сервер уже запущен: изменения настроек вступят в силу после перезапуска.",
        );
    }

    Ok(config)
}

/// Resets the configuration to the layout defaults and saves it.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn reset_config(app: AppHandle, state: State<'_, AppState>) -> Result<AppConfig, AppError> {
    let config = AppConfig::defaults(state.base());
    config.validate()?;
    config.save(state.base())?;
    state.set_config(config.clone());

    state.log_app(
        &app,
        LogLevel::Info,
        "Конфигурация сброшена к значениям по умолчанию",
    );
    Ok(config)
}

#[cfg(test)]
mod tests {
    use crate::config::AppConfig;
    use crate::paths::BasePaths;

    #[test]
    fn saved_config_round_trips_through_the_state_format() {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = BasePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
            temp.path().join("data").join("logs"),
            temp.path().join("root"),
        );
        let mut config = AppConfig::defaults(&base);
        config.server.world = "Midgard".to_string();
        config.normalize(&base);
        config.validate().expect("valid");
        config.save(&base).expect("saves");

        let loaded = AppConfig::load(&base);
        assert_eq!(loaded.server.world, "Midgard");
    }
}
