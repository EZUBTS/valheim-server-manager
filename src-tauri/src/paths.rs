//! Filesystem layout of the application.
//!
//! The layout root is chosen once, on first launch (see `docs/ARCHITECTURE.md`
//! §4):
//! 1. `VALHEIM_SERVER_ROOT`, when set;
//! 2. `D:\Servers\Valheim`, when the directory exists (portable layout);
//! 3. otherwise `%LOCALAPPDATA%\<identifier>` (Tauri local data dir).
//!
//! Everything inside the application (server, SteamCMD, backups) is derived
//! from that root, while the config file and logs live in the Tauri directories.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config::AppConfig;
use crate::error::AppError;

/// Name of the configuration file inside the Tauri config directory.
pub const CONFIG_FILE_NAME: &str = "config.json";

/// Environment variable overriding the layout root.
pub const ROOT_ENV_VAR: &str = "VALHEIM_SERVER_ROOT";

/// Portable layout root used on the development machine.
pub const PORTABLE_ROOT: &str = r"D:\Servers\Valheim";

/// Name of the server subdirectory inside the layout root.
pub const SERVER_DIR_NAME: &str = "server";

/// Name of the SteamCMD subdirectory inside the layout root.
pub const STEAMCMD_DIR_NAME: &str = "steamcmd";

/// Name of the backups subdirectory inside the layout root.
pub const BACKUPS_DIR_NAME: &str = "backups";

/// Name of the save subdirectory inside the install directory.
pub const SAVEDIR_NAME: &str = "savedir";

/// Name of the worlds subdirectory inside the save directory.
pub const WORLDS_DIR_NAME: &str = "worlds_local";

/// Directories that are fixed for the lifetime of one application run.
///
/// They come from the Tauri path API and do not depend on the configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BasePaths {
    /// `%APPDATA%\<identifier>\config.json` — the JSON configuration file.
    pub config_file: PathBuf,
    /// `%LOCALAPPDATA%\<identifier>` — application data / log root.
    pub data_dir: PathBuf,
    /// `%LOCALAPPDATA%\<identifier>\logs` — application and server logs.
    pub logs_dir: PathBuf,
    /// Layout root (`server/`, `steamcmd/`, `backups/` are created inside).
    pub layout_root: PathBuf,
}

impl BasePaths {
    /// Builds the base paths from the Tauri-provided directories.
    #[must_use]
    pub fn new(
        config_dir: impl AsRef<Path>,
        data_dir: impl AsRef<Path>,
        log_dir: impl AsRef<Path>,
        layout_root: impl AsRef<Path>,
    ) -> Self {
        Self {
            config_file: config_dir.as_ref().join(CONFIG_FILE_NAME),
            data_dir: data_dir.as_ref().to_path_buf(),
            logs_dir: log_dir.as_ref().to_path_buf(),
            layout_root: layout_root.as_ref().to_path_buf(),
        }
    }
}

/// Default directories derived from the layout root.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::struct_field_names)] // `dir` is meaningful: server/steamcmd/backups
pub struct DefaultDirs {
    /// `<root>/server` — files of the dedicated server.
    pub install_dir: PathBuf,
    /// `<root>/steamcmd` — SteamCMD installation.
    pub steamcmd_dir: PathBuf,
    /// `<root>/backups` — zip archives.
    pub backups_dir: PathBuf,
}

impl DefaultDirs {
    /// Computes the default directories for a layout root.
    #[must_use]
    pub fn under(root: &Path) -> Self {
        Self {
            install_dir: root.join(SERVER_DIR_NAME),
            steamcmd_dir: root.join(STEAMCMD_DIR_NAME),
            backups_dir: root.join(BACKUPS_DIR_NAME),
        }
    }
}

/// Chooses the layout root according to the documented precedence.
///
/// The portable directory is only used when it actually exists, so a fresh
/// machine falls back to the Tauri local data directory.
#[must_use]
pub fn choose_layout_root(env_root: Option<&OsStr>, local_data_dir: &Path) -> PathBuf {
    if let Some(raw) = env_root {
        let trimmed = raw.to_string_lossy();
        let trimmed = trimmed.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let portable = Path::new(PORTABLE_ROOT);
    if portable.is_dir() {
        return portable.to_path_buf();
    }

    local_data_dir.to_path_buf()
}

/// Format used for log file names: `<prefix>-YYYYMMDD-HHMMSS.log`.
#[must_use]
pub fn format_timestamp(epoch_ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(epoch_ms)
        .unwrap_or_default()
        .format("%Y%m%d-%H%M%S")
        .to_string()
}

/// Path of a per-launch server log file: `<logs>/server/server-<stamp>.log`.
#[must_use]
pub fn server_log_file(logs_dir: &Path, epoch_ms: i64) -> PathBuf {
    logs_dir
        .join("server")
        .join(format!("server-{}.log", format_timestamp(epoch_ms)))
}

/// Path of a per-launch manager log file: `<logs>/manager-<stamp>.log`.
#[must_use]
pub fn manager_log_file(logs_dir: &Path, epoch_ms: i64) -> PathBuf {
    logs_dir.join(format!("manager-{}.log", format_timestamp(epoch_ms)))
}

/// All absolute paths the frontend and the commands work with.
///
/// Serialized with `camelCase` keys, matching `ResolvedPaths` in
/// `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPaths {
    pub config_file: String,
    pub logs_dir: String,
    pub data_dir: String,
    pub install_dir: String,
    pub steamcmd_dir: String,
    pub backups_dir: String,
    pub save_dir: String,
    pub worlds_dir: String,
}

impl ResolvedPaths {
    /// Resolves every path from the fixed base paths and the current config.
    #[must_use]
    pub fn resolve(base: &BasePaths, config: &AppConfig) -> Self {
        let save_dir = config.save_dir_path();
        let worlds_dir = save_dir.join(WORLDS_DIR_NAME);

        Self {
            config_file: base.config_file.display().to_string(),
            logs_dir: base.logs_dir.display().to_string(),
            data_dir: base.data_dir.display().to_string(),
            install_dir: config.install_dir.clone(),
            steamcmd_dir: config.steamcmd_dir.clone(),
            backups_dir: config.backups_dir.clone(),
            save_dir: save_dir.display().to_string(),
            worlds_dir: worlds_dir.display().to_string(),
        }
    }
}

/// Resolves the fixed directories from a Tauri application handle.
pub fn base_paths_from_app(app: &tauri::AppHandle) -> Result<BasePaths, AppError> {
    use tauri::Manager;

    let path = app.path();
    let config_dir = path.app_config_dir().map_err(|error| {
        AppError::Config(format!("не удалось определить каталог конфигов: {error}"))
    })?;
    let data_dir = path.app_local_data_dir().map_err(|error| {
        AppError::Config(format!("не удалось определить каталог данных: {error}"))
    })?;
    let log_dir = path.app_log_dir().map_err(|error| {
        AppError::Config(format!("не удалось определить каталог логов: {error}"))
    })?;

    let layout_root = choose_layout_root(std::env::var_os(ROOT_ENV_VAR).as_deref(), &data_dir);

    Ok(BasePaths::new(config_dir, data_dir, log_dir, layout_root))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp dir")
    }

    #[test]
    fn env_root_wins_over_everything() {
        let temp = temp_dir();
        let local = temp.path().join("local");
        let root = choose_layout_root(Some(OsStr::new(r"E:\Custom Valheim")), &local);
        assert_eq!(root, PathBuf::from(r"E:\Custom Valheim"));
    }

    #[test]
    fn blank_env_root_is_ignored() {
        let temp = temp_dir();
        let local = temp.path().join("local");
        let root = choose_layout_root(Some(OsStr::new("   ")), &local);
        // A blank value must behave exactly like an unset variable.
        assert_eq!(root, choose_layout_root(None, &local));
    }

    #[test]
    fn portable_root_is_used_when_it_exists() {
        // `D:\Servers\Valheim` exists on the development machine only; the
        // fallback branch is what matters on a clean machine.
        let temp = temp_dir();
        let local = temp.path().join("local");
        let root = choose_layout_root(None, &local);
        if Path::new(PORTABLE_ROOT).is_dir() {
            assert_eq!(root, PathBuf::from(PORTABLE_ROOT));
        } else {
            assert_eq!(root, local);
        }
    }

    #[test]
    fn default_dirs_live_under_the_layout_root() {
        let root = Path::new(r"D:\Servers\Valheim");
        let dirs = DefaultDirs::under(root);

        assert_eq!(dirs.install_dir, Path::new(r"D:\Servers\Valheim\server"));
        assert_eq!(dirs.steamcmd_dir, Path::new(r"D:\Servers\Valheim\steamcmd"));
        assert_eq!(dirs.backups_dir, Path::new(r"D:\Servers\Valheim\backups"));
    }

    #[test]
    fn server_log_name_has_expected_shape() {
        let logs = Path::new(r"D:\logs");
        let path = server_log_file(logs, 1_700_000_000_000);

        assert_eq!(
            path,
            Path::new(r"D:\logs\server\server-20231114-221320.log")
        );
        assert_eq!(format_timestamp(0), "19700101-000000");
    }

    #[test]
    fn manager_log_name_has_expected_shape() {
        let logs = Path::new(r"D:\logs");
        let path = manager_log_file(logs, 0);
        assert_eq!(path, Path::new(r"D:\logs\manager-19700101-000000.log"));
    }

    #[test]
    fn resolved_paths_are_serialized_in_camel_case() {
        let temp = temp_dir();
        let base = BasePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
            temp.path().join("data").join("logs"),
            temp.path().join("root"),
        );
        let config = AppConfig::defaults(&base);
        let paths = ResolvedPaths::resolve(&base, &config);

        let payload = serde_json::to_value(&paths).expect("serializes");
        for key in [
            "configFile",
            "logsDir",
            "dataDir",
            "installDir",
            "steamcmdDir",
            "backupsDir",
            "saveDir",
            "worldsDir",
        ] {
            assert!(payload.get(key).is_some(), "missing key {key}");
        }
        assert!(payload.get("config_file").is_none());
        assert!(paths.save_dir.ends_with("savedir"));
        assert!(paths.worlds_dir.ends_with("worlds_local"));
    }
}
