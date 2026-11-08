//! System-level commands: app info, resolved paths, opening folders.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
use crate::paths::{BasePaths, ResolvedPaths};
use crate::state::AppState;

/// Information about the running application and its environment.
///
/// Serialized with `camelCase` keys so it maps directly to the TypeScript
/// `AppInfo` type in `src/lib/types.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Application name as defined for the bundle.
    pub name: String,
    /// Application version, kept in sync with `package.json`.
    pub version: String,
    /// Version of the Tauri runtime the app is linked against.
    pub tauri_version: String,
    /// Target operating system (`windows`, `macos`, `linux`, ...).
    pub os: String,
    /// Target CPU architecture (`x86_64`, `aarch64`, ...).
    pub arch: String,
    /// `true` for debug builds.
    pub debug: bool,
}

/// Directory or file that [`open_path`] can reveal in Explorer.
///
/// Matches `OpenTarget` in `src/lib/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenTarget {
    InstallDir,
    SteamcmdDir,
    BackupsDir,
    LogsDir,
    SaveDir,
    WorldsDir,
    ConfigFile,
    BepinexDir,
}

/// Returns metadata about the app, the Tauri runtime and the host platform.
#[tauri::command]
// Tauri injects `AppHandle` by value for command arguments.
#[allow(clippy::needless_pass_by_value)]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    let package_info = app.package_info();

    AppInfo {
        name: package_info.name.clone(),
        version: package_info.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        debug: cfg!(debug_assertions),
    }
}

/// Returns every computed absolute path of the application.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects `State` by value
pub fn get_paths(state: State<'_, AppState>) -> ResolvedPaths {
    state.resolved_paths()
}

/// Opens a directory (or reveals the config file) in Windows Explorer.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri injects arguments by value
pub fn open_path(state: State<'_, AppState>, target: OpenTarget) -> Result<(), AppError> {
    let paths = state.resolved_paths();
    let path = resolve_open_target(&paths, state.base(), target);

    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "Каталог или файл не найден: {}",
            path.display()
        )));
    }

    open_in_file_manager(&path, target == OpenTarget::ConfigFile)
}

/// Maps an [`OpenTarget`] to an absolute path.
#[must_use]
pub fn resolve_open_target(paths: &ResolvedPaths, base: &BasePaths, target: OpenTarget) -> PathBuf {
    match target {
        OpenTarget::InstallDir => PathBuf::from(&paths.install_dir),
        OpenTarget::SteamcmdDir => PathBuf::from(&paths.steamcmd_dir),
        OpenTarget::BackupsDir => PathBuf::from(&paths.backups_dir),
        OpenTarget::LogsDir => PathBuf::from(&paths.logs_dir),
        OpenTarget::SaveDir => PathBuf::from(&paths.save_dir),
        OpenTarget::WorldsDir => PathBuf::from(&paths.worlds_dir),
        OpenTarget::ConfigFile => base.config_file.clone(),
        OpenTarget::BepinexDir => Path::new(&paths.install_dir).join("BepInEx"),
    }
}

/// Starts Explorer (or the platform file manager) for the given path.
#[cfg(windows)]
fn open_in_file_manager(path: &Path, select_file: bool) -> Result<(), AppError> {
    use std::process::{Command, Stdio};

    let mut command = Command::new("explorer.exe");
    if select_file {
        command.arg(format!("/select,{}", path.display()));
    } else {
        command.arg(path);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            AppError::Process(format!(
                "не удалось открыть {} в Проводнике: {error}",
                path.display()
            ))
        })?;

    Ok(())
}

/// Fallback for non-Windows builds: the manager targets Windows only.
#[cfg(not(windows))]
fn open_in_file_manager(path: &Path, _select_file: bool) -> Result<(), AppError> {
    Err(AppError::Unsupported(format!(
        "открытие каталогов поддерживается только в Windows: {}",
        path.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_serializes_to_camel_case() {
        let info = AppInfo {
            name: "Valheim Server Manager".to_string(),
            version: "0.1.0".to_string(),
            tauri_version: "2.12.5".to_string(),
            os: "windows".to_string(),
            arch: "x86_64".to_string(),
            debug: false,
        };

        let payload = serde_json::to_value(&info).expect("app info serializes");

        assert_eq!(payload["name"], "Valheim Server Manager");
        assert_eq!(payload["tauriVersion"], "2.12.5");
        assert_eq!(payload["debug"], false);
        assert!(payload.get("tauri_version").is_none());
    }

    #[test]
    fn open_target_deserializes_from_frontend_strings() {
        for (raw, expected) in [
            ("installDir", OpenTarget::InstallDir),
            ("steamcmdDir", OpenTarget::SteamcmdDir),
            ("backupsDir", OpenTarget::BackupsDir),
            ("logsDir", OpenTarget::LogsDir),
            ("saveDir", OpenTarget::SaveDir),
            ("worldsDir", OpenTarget::WorldsDir),
            ("configFile", OpenTarget::ConfigFile),
            ("bepinexDir", OpenTarget::BepinexDir),
        ] {
            let json = serde_json::to_string(raw).expect("quote");
            let parsed: OpenTarget = serde_json::from_str(&json).expect("parses");
            assert_eq!(parsed, expected);
        }
    }

    #[test]
    fn resolve_open_target_returns_absolute_paths() {
        let base = BasePaths::new(
            Path::new(r"D:\cfg"),
            Path::new(r"D:\data"),
            Path::new(r"D:\data\logs"),
            Path::new(r"D:\root"),
        );
        let config = crate::config::AppConfig::defaults(&base);
        let paths = ResolvedPaths::resolve(&base, &config);

        assert_eq!(
            resolve_open_target(&paths, &base, OpenTarget::ConfigFile),
            Path::new(r"D:\cfg").join("config.json")
        );
        assert_eq!(
            resolve_open_target(&paths, &base, OpenTarget::InstallDir),
            PathBuf::from(&paths.install_dir)
        );
        assert!(
            resolve_open_target(&paths, &base, OpenTarget::WorldsDir).ends_with("worlds_local")
        );
        assert!(resolve_open_target(&paths, &base, OpenTarget::BepinexDir).ends_with("BepInEx"));
    }
}
