//! Persistent application configuration.
//!
//! `AppConfig` mirrors `AppConfig` in `src/lib/types.ts` one to one: every
//! structure is serialized with `camelCase` field names, so the JSON file and
//! the IPC payload use exactly the same shape.
//!
//! The configuration is stored atomically (write to a temporary file, then
//! rename) in the Tauri config directory.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::paths::{BasePaths, DefaultDirs, SAVEDIR_NAME, WORLDS_DIR_NAME};

/// Version of the on-disk configuration schema.
pub const CONFIG_SCHEMA_VERSION: u32 = 1;

/// Default UDP port of a Valheim server.
pub const DEFAULT_PORT: u16 = 2456;

/// Default autosave interval used by the manager (seconds).
pub const DEFAULT_SAVE_INTERVAL_SEC: u32 = 300;

/// Minimum accepted port (closed/privileged ports are rejected).
pub const MIN_PORT: u16 = 1024;

/// Maximum accepted port (the server also occupies `port + 1` and `port + 2`).
pub const MAX_PORT: u16 = 65535;

/// Maximum length of `-name`.
pub const MAX_NAME_CHARS: usize = 53;

/// Minimum length of `-password`.
pub const MIN_PASSWORD_CHARS: usize = 5;

/// Maximum length of `-password`.
pub const MAX_PASSWORD_CHARS: usize = 20;

/// Maximum length of `-world`.
pub const MAX_WORLD_CHARS: usize = 20;

/// Minimum accepted `-saveinterval` (seconds).
pub const MIN_SAVE_INTERVAL_SEC: u32 = 60;

/// Maximum number of `extraArgs` entries.
pub const MAX_EXTRA_ARGS: usize = 64;

/// Maximum length of a single `extraArgs` entry.
pub const MAX_EXTRA_ARG_CHARS: usize = 200;

/// Whitelist of `-setkey` world cheat keys supported by Valheim 1.0.21.
///
/// The official dedicated-server manual (`docs/ADMIN-REFERENCE.md` §4.3,
/// verified against the PDF shipped with the server) documents exactly four
/// keys: `nobuildcost`, `playerevents`, `passivemobs`, `nomap`.
/// `fire` and `noportals` are NOT server arguments (they exist only as
/// in-game console commands, which vanilla dedicated servers reject).
pub const WORLD_SET_KEYS: [&str; 4] = ["nobuildcost", "playerevents", "passivemobs", "nomap"];

/// Minimum number of backups to keep.
pub const MIN_KEEP_BACKUPS: u32 = 1;

/// Maximum number of backups to keep.
pub const MAX_KEEP_BACKUPS: u32 = 100;

/// Default number of backups to keep.
pub const DEFAULT_KEEP_BACKUPS: u32 = 10;

/// Difficulty preset passed via `-preset`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum WorldPreset {
    /// Standard Valheim balance.
    #[default]
    Normal,
    /// Very easy combat, no raids, more resources.
    Casual,
    /// Weaker enemies, fewer raids.
    Easy,
    /// Stronger enemies, more raids.
    Hard,
    /// Very strong enemies, lost inventory and skills on death, no map.
    Hardcore,
    /// No map and no portals, fire spreads.
    Immersive,
    /// Free building (creative-like preset).
    Hammer,
    /// Custom modifiers are used instead of a preset.
    Custom,
}

impl WorldPreset {
    /// CLI value of the preset.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Casual => "casual",
            Self::Easy => "easy",
            Self::Hard => "hard",
            Self::Hardcore => "hardcore",
            Self::Immersive => "immersive",
            Self::Hammer => "hammer",
            Self::Custom => "custom",
        }
    }
}

/// Values of the `combat` world modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CombatLevel {
    VeryEasy,
    Easy,
    #[default]
    Normal,
    Hard,
    VeryHard,
}

impl CombatLevel {
    /// CLI value of the modifier.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::VeryEasy => "veryeasy",
            Self::Easy => "easy",
            Self::Normal => "normal",
            Self::Hard => "hard",
            Self::VeryHard => "veryhard",
        }
    }
}

/// Values of the `deathpenalty` world modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DeathPenalty {
    Casual,
    VeryEasy,
    Easy,
    #[default]
    Normal,
    Hard,
    Hardcore,
}

impl DeathPenalty {
    /// CLI value of the modifier.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Casual => "casual",
            Self::VeryEasy => "veryeasy",
            Self::Easy => "easy",
            Self::Normal => "normal",
            Self::Hard => "hard",
            Self::Hardcore => "hardcore",
        }
    }
}

/// Values of the `resources` world modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ResourcesAmount {
    MuchLess,
    Less,
    #[default]
    Normal,
    More,
    MuchMore,
}

impl ResourcesAmount {
    /// CLI value of the modifier.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MuchLess => "muchless",
            Self::Less => "less",
            Self::Normal => "normal",
            Self::More => "more",
            Self::MuchMore => "muchmore",
        }
    }
}

/// Values of the `raids` world modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RaidsFrequency {
    None,
    MuchLess,
    Less,
    #[default]
    Normal,
    More,
    MuchMore,
}

impl RaidsFrequency {
    /// CLI value of the modifier.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::MuchLess => "muchless",
            Self::Less => "less",
            Self::Normal => "normal",
            Self::More => "more",
            Self::MuchMore => "muchmore",
        }
    }
}

/// Values of the `portals` world modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PortalsRule {
    Casual,
    Easy,
    #[default]
    Normal,
    Hard,
    VeryHard,
}

impl PortalsRule {
    /// CLI value of the modifier.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Casual => "casual",
            Self::Easy => "easy",
            Self::Normal => "normal",
            Self::Hard => "hard",
            Self::VeryHard => "veryhard",
        }
    }
}

/// World modifiers for `-modifier` flags (`preset: custom`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorldModifiers {
    pub combat: CombatLevel,
    pub death_penalty: DeathPenalty,
    pub resources: ResourcesAmount,
    pub raids: RaidsFrequency,
    pub portals: PortalsRule,
}

impl Default for WorldModifiers {
    fn default() -> Self {
        Self {
            combat: CombatLevel::Normal,
            death_penalty: DeathPenalty::Normal,
            resources: ResourcesAmount::Normal,
            raids: RaidsFrequency::Normal,
            portals: PortalsRule::Normal,
        }
    }
}

impl WorldModifiers {
    /// `(key, value)` pairs in the fixed order used by the launch arguments.
    #[must_use]
    pub fn pairs(self) -> [(&'static str, &'static str); 5] {
        [
            ("combat", self.combat.as_str()),
            ("deathpenalty", self.death_penalty.as_str()),
            ("resources", self.resources.as_str()),
            ("raids", self.raids.as_str()),
            ("portals", self.portals.as_str()),
        ]
    }
}

/// Dedicated server settings (`-name`, `-port`, `-world`, ...).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerSettings {
    /// `-name`: name of the server in the server list.
    pub name: String,
    /// `-world`: name of the world directory / legacy `.fwl` file.
    pub world: String,
    /// `-port`: main UDP port; `port + 1` and `port + 2` are used too.
    pub port: u16,
    /// `-password`: 5–20 characters, must not be part of the server name.
    pub password: String,
    /// `-public 1|0`: publish the server in the Steam server browser.
    pub is_public: bool,
    /// `-crossplay`: enable the PlayFab relay (console players).
    pub crossplay: bool,
    /// `-preset`: world difficulty preset.
    pub preset: WorldPreset,
    /// `-modifier` values, used when `preset` is [`WorldPreset::Custom`].
    pub modifiers: WorldModifiers,
    /// `-setkey` world cheat keys (see [`WORLD_SET_KEYS`]).
    #[serde(default)]
    pub set_keys: Vec<String>,
    /// `-saveinterval`: autosave interval in seconds (`None` = server default).
    pub save_interval_sec: Option<u32>,
    /// Extra command line arguments appended after the managed ones.
    pub extra_args: Vec<String>,
}

impl Default for ServerSettings {
    fn default() -> Self {
        Self {
            name: "Valheim Server".to_string(),
            world: "Dedicated".to_string(),
            port: DEFAULT_PORT,
            password: "change_me".to_string(),
            is_public: true,
            crossplay: false,
            preset: WorldPreset::Normal,
            modifiers: WorldModifiers::default(),
            set_keys: Vec::new(),
            save_interval_sec: Some(DEFAULT_SAVE_INTERVAL_SEC),
            extra_args: Vec::new(),
        }
    }
}

impl ServerSettings {
    /// Trims user-provided strings and drops empty extra arguments.
    pub fn normalize(&mut self) {
        self.name = self.name.trim().to_string();
        self.world = self.world.trim().to_string();
        self.password = self.password.trim().to_string();

        let normalized: Vec<String> = self
            .extra_args
            .iter()
            .map(|argument| argument.trim().to_string())
            .filter(|argument| !argument.is_empty())
            .collect();
        self.extra_args = normalized;

        // Canonical, lower-case, deduplicated `-setkey` values preserving the
        // user's order (the order becomes the command line order).
        let mut set_keys: Vec<String> = Vec::with_capacity(self.set_keys.len());
        for key in &self.set_keys {
            let normalized = key.trim().to_ascii_lowercase();
            if normalized.is_empty() || set_keys.contains(&normalized) {
                continue;
            }
            set_keys.push(normalized);
        }
        self.set_keys = set_keys;
    }

    /// Validates every setting that is passed to the server process.
    ///
    /// Rules come from `docs/valheim-server-reference.md` §3.4 and §12.2.
    pub fn validate(&self) -> Result<(), AppError> {
        validate_name(&self.name)?;
        validate_world(&self.world)?;
        validate_password(&self.password, &self.name)?;
        validate_port(self.port)?;

        if let Some(seconds) = self.save_interval_sec {
            if seconds < MIN_SAVE_INTERVAL_SEC {
                return Err(AppError::validation(format!(
                    "Интервал автосохранения должен быть не меньше {MIN_SAVE_INTERVAL_SEC} секунд"
                )));
            }
        }

        if self.extra_args.len() > MAX_EXTRA_ARGS {
            return Err(AppError::validation(format!(
                "Слишком много дополнительных аргументов ({}, максимум {MAX_EXTRA_ARGS})",
                self.extra_args.len()
            )));
        }

        for argument in &self.extra_args {
            if argument.trim().is_empty() {
                return Err(AppError::validation(
                    "Дополнительные аргументы не должны быть пустыми",
                ));
            }
            if argument.chars().count() > MAX_EXTRA_ARG_CHARS {
                return Err(AppError::validation(format!(
                    "Дополнительный аргумент длиннее {MAX_EXTRA_ARG_CHARS} символов"
                )));
            }
            if argument.chars().any(char::is_control) {
                return Err(AppError::validation(
                    "Дополнительные аргументы не должны содержать управляющих символов",
                ));
            }
        }

        let mut seen_keys: Vec<&'static str> = Vec::with_capacity(self.set_keys.len());
        for key in &self.set_keys {
            let normalized = key.trim().to_ascii_lowercase();
            let Some(canonical) = WORLD_SET_KEYS
                .iter()
                .copied()
                .find(|candidate| *candidate == normalized)
            else {
                return Err(AppError::validation(format!(
                    "Неизвестный ключ -setkey «{}». Допустимые значения: {}",
                    key.trim(),
                    WORLD_SET_KEYS.join(", ")
                )));
            };
            if seen_keys.contains(&canonical) {
                return Err(AppError::validation(format!(
                    "Ключ -setkey «{canonical}» указан несколько раз"
                )));
            }
            seen_keys.push(canonical);
        }

        Ok(())
    }
}

/// Full application configuration (`config.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    /// Version of the configuration schema.
    pub schema_version: u32,
    /// Files of the dedicated server (`valheim_server.exe`).
    pub install_dir: String,
    /// SteamCMD directory (`steamcmd.exe`).
    pub steamcmd_dir: String,
    /// Directory for zip backups.
    pub backups_dir: String,
    /// How many latest backups are kept.
    pub keep_backups: u32,
    /// Create a backup before installing/updating the server.
    pub auto_backup_before_update: bool,
    /// Create a backup before stopping the server.
    pub auto_backup_before_stop: bool,
    /// Dedicated server settings.
    pub server: ServerSettings,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            install_dir: String::new(),
            steamcmd_dir: String::new(),
            backups_dir: String::new(),
            keep_backups: DEFAULT_KEEP_BACKUPS,
            auto_backup_before_update: true,
            auto_backup_before_stop: true,
            server: ServerSettings::default(),
        }
    }
}

impl AppConfig {
    /// Builds the default configuration for a layout root.
    #[must_use]
    pub fn defaults(base: &BasePaths) -> Self {
        let dirs = DefaultDirs::under(&base.layout_root);

        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            install_dir: dirs.install_dir.display().to_string(),
            steamcmd_dir: dirs.steamcmd_dir.display().to_string(),
            backups_dir: dirs.backups_dir.display().to_string(),
            keep_backups: DEFAULT_KEEP_BACKUPS,
            auto_backup_before_update: true,
            auto_backup_before_stop: true,
            server: ServerSettings::default(),
        }
    }

    /// Absolute path of the `-savedir` directory (`<installDir>/savedir`).
    #[must_use]
    pub fn save_dir_path(&self) -> PathBuf {
        Path::new(&self.install_dir).join(SAVEDIR_NAME)
    }

    /// Absolute path of `worlds_local` inside the save directory.
    #[must_use]
    pub fn worlds_dir_path(&self) -> PathBuf {
        self.save_dir_path().join(WORLDS_DIR_NAME)
    }

    /// Absolute path of `valheim_server.exe`.
    #[must_use]
    pub fn server_exe_path(&self) -> PathBuf {
        Path::new(&self.install_dir).join("valheim_server.exe")
    }

    /// Absolute path of `steamcmd.exe`.
    #[must_use]
    pub fn steamcmd_exe_path(&self) -> PathBuf {
        Path::new(&self.steamcmd_dir).join("steamcmd.exe")
    }

    /// Fills missing directories from the layout defaults and trims strings.
    pub fn normalize(&mut self, base: &BasePaths) {
        let dirs = DefaultDirs::under(&base.layout_root);

        if self.install_dir.trim().is_empty() {
            self.install_dir = dirs.install_dir.display().to_string();
        }
        if self.steamcmd_dir.trim().is_empty() {
            self.steamcmd_dir = dirs.steamcmd_dir.display().to_string();
        }
        if self.backups_dir.trim().is_empty() {
            self.backups_dir = dirs.backups_dir.display().to_string();
        }

        self.install_dir = self.install_dir.trim().to_string();
        self.steamcmd_dir = self.steamcmd_dir.trim().to_string();
        self.backups_dir = self.backups_dir.trim().to_string();

        if self.keep_backups == 0 {
            self.keep_backups = DEFAULT_KEEP_BACKUPS;
        }
        if self.schema_version == 0 {
            self.schema_version = CONFIG_SCHEMA_VERSION;
        }

        self.server.normalize();
    }

    /// Validates the whole configuration before it is saved or used.
    pub fn validate(&self) -> Result<(), AppError> {
        validate_directory("Каталог установки сервера", &self.install_dir)?;
        validate_directory("Каталог SteamCMD", &self.steamcmd_dir)?;
        validate_directory("Каталог резервных копий", &self.backups_dir)?;

        if !(MIN_KEEP_BACKUPS..=MAX_KEEP_BACKUPS).contains(&self.keep_backups) {
            return Err(AppError::validation(format!(
                "Количество хранимых резервных копий должно быть от {MIN_KEEP_BACKUPS} до {MAX_KEEP_BACKUPS}"
            )));
        }

        self.server.validate()
    }

    /// Loads the configuration from disk.
    ///
    /// A missing or corrupt file never blocks the application: the defaults are
    /// returned instead, so the user can fix the settings from the UI.
    #[must_use]
    pub fn load(base: &BasePaths) -> Self {
        let path = &base.config_file;

        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) => {
                if error.kind() != std::io::ErrorKind::NotFound {
                    log::warn!(
                        target: "valheim-server",
                        "Не удалось прочитать конфигурацию {}: {error}; используются значения по умолчанию",
                        path.display()
                    );
                }
                let mut config = Self::defaults(base);
                config.normalize(base);
                return config;
            }
        };

        match serde_json::from_str::<Self>(&text) {
            Ok(mut config) => {
                config.normalize(base);
                config
            }
            Err(error) => {
                log::warn!(
                    target: "valheim-server",
                    "Файл конфигурации {} повреждён ({error}); используются значения по умолчанию",
                    path.display()
                );
                let mut config = Self::defaults(base);
                config.normalize(base);
                config
            }
        }
    }

    /// Saves the configuration atomically (temporary file + rename).
    pub fn save(&self, base: &BasePaths) -> Result<(), AppError> {
        self.validate()?;

        let parent = base.config_file.parent().ok_or_else(|| {
            AppError::Config("не удалось определить каталог конфигурации".to_string())
        })?;
        std::fs::create_dir_all(parent)
            .map_err(|error| AppError::io("создание каталога конфигов", &error))?;

        let json = serde_json::to_string_pretty(self).map_err(|error| {
            AppError::Config(format!("не удалось сериализовать конфигурацию: {error}"))
        })?;

        let temp_file = base.config_file.with_extension("json.tmp");
        std::fs::write(&temp_file, format!("{json}\n"))
            .map_err(|error| AppError::io("запись временного файла конфигурации", &error))?;
        std::fs::rename(&temp_file, &base.config_file)
            .map_err(|error| AppError::io("замена файла конфигурации", &error))?;

        Ok(())
    }
}

/// Validates the `-name` value.
fn validate_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(AppError::validation("Имя сервера не может быть пустым"));
    }
    if trimmed.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::validation(format!(
            "Имя сервера длиннее {MAX_NAME_CHARS} символов"
        )));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::validation(
            "Имя сервера не должно содержать управляющих символов",
        ));
    }

    Ok(())
}

/// Validates the `-world` value (it becomes a directory name in 1.0).
///
/// The contract restricts world names to latin letters, digits, `_` and `-`,
/// 1–20 characters (`docs/ARCHITECTURE.md` §5.2/§12); the same rule is used by
/// the frontend form.
fn validate_world(world: &str) -> Result<(), AppError> {
    let trimmed = world.trim();
    let length = trimmed.chars().count();

    if trimmed.is_empty() {
        return Err(AppError::validation("Имя мира не может быть пустым"));
    }
    if length > MAX_WORLD_CHARS {
        return Err(AppError::validation(format!(
            "Имя мира длиннее {MAX_WORLD_CHARS} символов"
        )));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::validation(
            "Имя мира может содержать только латиницу, цифры, «_» и «-»",
        ));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppError::validation("Недопустимое имя мира"));
    }

    Ok(())
}

/// Validates the `-password` value and its relation to the server name.
fn validate_password(password: &str, name: &str) -> Result<(), AppError> {
    let trimmed = password.trim();
    let length = trimmed.chars().count();

    if length < MIN_PASSWORD_CHARS {
        return Err(AppError::validation(format!(
            "Пароль должен быть не короче {MIN_PASSWORD_CHARS} символов"
        )));
    }
    if length > MAX_PASSWORD_CHARS {
        return Err(AppError::validation(format!(
            "Пароль должен быть не длиннее {MAX_PASSWORD_CHARS} символов"
        )));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::validation(
            "Пароль не должен содержать управляющих символов",
        ));
    }
    if name.to_lowercase().contains(&trimmed.to_lowercase()) {
        return Err(AppError::validation(
            "Пароль не может входить в имя сервера (Valheim завершится с ошибкой \"bad password\")",
        ));
    }

    Ok(())
}

/// Validates the `-port` value.
fn validate_port(port: u16) -> Result<(), AppError> {
    if port < MIN_PORT {
        return Err(AppError::validation(format!(
            "Порт должен быть в диапазоне {MIN_PORT}–{MAX_PORT}"
        )));
    }

    Ok(())
}

/// Validates a configured directory path.
fn validate_directory(label: &str, value: &str) -> Result<(), AppError> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(AppError::validation(format!("{label}: путь не указан")));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::validation(format!(
            "{label}: путь содержит управляющие символы"
        )));
    }
    if !Path::new(trimmed).is_absolute() {
        return Err(AppError::validation(format!(
            "{label}: нужен абсолютный путь"
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> (tempfile::TempDir, BasePaths) {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = BasePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
            temp.path().join("data").join("logs"),
            temp.path().join("root"),
        );
        (temp, base)
    }

    #[test]
    fn default_config_is_valid() {
        let (_temp, base) = base();
        let config = AppConfig::defaults(&base);
        config.validate().expect("defaults are valid");
    }

    #[test]
    fn default_dirs_follow_the_layout_root() {
        let (temp, base) = base();
        let config = AppConfig::defaults(&base);
        let root = temp.path().join("root");

        assert_eq!(
            config.install_dir,
            root.join("server").display().to_string()
        );
        assert_eq!(
            config.steamcmd_dir,
            root.join("steamcmd").display().to_string()
        );
        assert_eq!(
            config.backups_dir,
            root.join("backups").display().to_string()
        );
        assert_eq!(config.save_dir_path(), root.join("server").join("savedir"));
        assert_eq!(
            config.worlds_dir_path(),
            root.join("server").join("savedir").join("worlds_local")
        );
        assert_eq!(
            config.server_exe_path(),
            root.join("server").join("valheim_server.exe")
        );
    }

    #[test]
    fn save_and_load_round_trip() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.name = "  Мой сервер  ".to_string();
        config.server.world = "Midgard".to_string();
        config.server.password = "SuperSecret1".to_string();
        config.server.is_public = false;
        config.server.crossplay = true;
        config.server.preset = WorldPreset::Hard;
        config.keep_backups = 7;
        config.normalize(&base);
        config.save(&base).expect("saves");

        let loaded = AppConfig::load(&base);
        assert_eq!(loaded, config);
        assert_eq!(loaded.server.name, "Мой сервер");
    }

    #[test]
    fn atomic_save_leaves_no_temp_file() {
        let (_temp, base) = base();
        let config = AppConfig::defaults(&base);
        config.save(&base).expect("saves");

        assert!(base.config_file.is_file());
        assert!(!base.config_file.with_extension("json.tmp").exists());
    }

    #[test]
    fn missing_config_file_falls_back_to_defaults() {
        let (_temp, base) = base();
        let loaded = AppConfig::load(&base);
        assert_eq!(loaded, AppConfig::defaults(&base));
    }

    #[test]
    fn corrupt_config_file_falls_back_to_defaults() {
        let (_temp, base) = base();
        std::fs::create_dir_all(base.config_file.parent().expect("parent")).expect("mkdir");
        std::fs::write(&base.config_file, "{ not valid json").expect("write");

        let loaded = AppConfig::load(&base);
        assert_eq!(loaded, AppConfig::defaults(&base));
    }

    #[test]
    fn normalize_fills_empty_directories_and_drops_blank_extra_args() {
        let (_temp, base) = base();
        let mut config = AppConfig::default();
        config.server.extra_args = vec!["  -setkey nobuildcost ".to_string(), "   ".to_string()];
        config.normalize(&base);

        let defaults = AppConfig::defaults(&base);
        assert_eq!(config.install_dir, defaults.install_dir);
        assert_eq!(config.steamcmd_dir, defaults.steamcmd_dir);
        assert_eq!(config.backups_dir, defaults.backups_dir);
        assert_eq!(
            config.server.extra_args,
            vec!["-setkey nobuildcost".to_string()]
        );
    }

    #[test]
    fn rejects_short_password() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.password = "1234".to_string();
        let error = config.validate().expect_err("short password is rejected");
        assert_eq!(error.code(), "VALIDATION");
    }

    #[test]
    fn rejects_long_password() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.password = "a".repeat(MAX_PASSWORD_CHARS + 1);
        config.validate().expect_err("long password is rejected");
    }

    #[test]
    fn rejects_password_contained_in_server_name() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.name = "My Secret Server".to_string();
        config.server.password = "secret".to_string();
        let error = config.validate().expect_err("password in name is rejected");
        assert!(error.to_string().contains("Пароль"));
    }

    #[test]
    fn rejects_too_long_server_name() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.name = "a".repeat(MAX_NAME_CHARS + 1);
        config.validate().expect_err("long name is rejected");
    }

    #[test]
    fn rejects_empty_and_long_world_names() {
        let (_temp, base) = base();

        let mut config = AppConfig::defaults(&base);
        config.server.world = "   ".to_string();
        config.validate().expect_err("empty world is rejected");

        config.server.world = "a".repeat(MAX_WORLD_CHARS + 1);
        config.validate().expect_err("long world is rejected");
    }

    #[test]
    fn rejects_world_names_with_unsafe_characters() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);

        for world in [
            "bad/world",
            r"bad\world",
            "..",
            "a:b",
            "my world",
            "Мидгард",
        ] {
            config.server.world = world.to_string();
            config
                .validate()
                .expect_err("unsafe world name is rejected");
        }

        // The documented character set is accepted.
        for world in ["Midgard", "world_1", "world-2", "A1"] {
            config.server.world = world.to_string();
            config.validate().expect("safe world name is accepted");
        }
    }

    #[test]
    fn enforces_port_range() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);

        config.server.port = MIN_PORT - 1;
        config.validate().expect_err("privileged port is rejected");

        config.server.port = MIN_PORT;
        config.validate().expect("minimum port is valid");

        config.server.port = MAX_PORT;
        config.validate().expect("maximum port is valid");
    }

    #[test]
    fn enforces_save_interval_minimum() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);

        config.server.save_interval_sec = Some(MIN_SAVE_INTERVAL_SEC - 1);
        config
            .validate()
            .expect_err("too small save interval is rejected");

        config.server.save_interval_sec = None;
        config.validate().expect("no interval is valid");
    }

    #[test]
    fn rejects_control_characters_in_extra_args() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.extra_args = vec!["-preset\thard".to_string()];
        config
            .validate()
            .expect_err("control characters are rejected");
    }

    #[test]
    fn set_keys_default_to_empty_and_are_valid() {
        let (_temp, base) = base();
        let config = AppConfig::defaults(&base);

        assert_eq!(config.server.set_keys.len(), 0);
        config.validate().expect("empty setKeys is valid");
    }

    #[test]
    fn set_keys_normalize_lowercase_trim_and_dedupe() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.set_keys = vec![
            "  NoBuildCost ".to_string(),
            "nomap".to_string(),
            "nobuildcost".to_string(),
            String::new(),
            "PlayerEvents".to_string(),
        ];

        config.normalize(&base);
        assert_eq!(
            config.server.set_keys,
            vec![
                "nobuildcost".to_string(),
                "nomap".to_string(),
                "playerevents".to_string()
            ]
        );
        config.validate().expect("normalized keys are valid");
    }

    #[test]
    fn accepts_exactly_the_four_documented_set_keys() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.set_keys = WORLD_SET_KEYS
            .iter()
            .map(|key| (*key).to_string())
            .collect();

        assert_eq!(
            config.server.set_keys,
            vec![
                "nobuildcost".to_string(),
                "playerevents".to_string(),
                "passivemobs".to_string(),
                "nomap".to_string()
            ]
        );
        config.validate().expect("documented keys are valid");
    }

    #[test]
    fn rejects_unknown_set_key() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.set_keys = vec!["nobuildcost".to_string(), "maxplayers".to_string()];

        let error = config.validate().expect_err("unknown key is rejected");
        assert_eq!(error.code(), "VALIDATION");
        let message = error.to_string();
        assert!(message.contains("maxplayers"), "{message}");
        // The message lists every allowed value of the 1.0.21 manual.
        for allowed in WORLD_SET_KEYS {
            assert!(message.contains(allowed), "{allowed} missing in {message}");
        }
    }

    #[test]
    fn rejects_removed_set_keys_fire_and_noportals() {
        // `fire` and `noportals` are console commands, not `-setkey` arguments
        // (docs/ADMIN-REFERENCE.md §4.3, official 1.0.21 manual).
        let (_temp, base) = base();

        for removed in ["fire", "noportals"] {
            let mut config = AppConfig::defaults(&base);
            config.server.set_keys = vec![removed.to_string()];

            let error = config.validate().expect_err("removed key must be rejected");
            assert_eq!(error.code(), "VALIDATION");
            assert!(error.to_string().contains(removed), "{error}");
        }
    }

    #[test]
    fn legacy_config_with_removed_set_key_loads_but_fails_validation() {
        let (_temp, base) = base();
        // Older manager versions allowed `setKeys: ["fire"]`: loading must not
        // panic or silently drop data, saving must return VALIDATION.
        let mut config: AppConfig = serde_json::from_str(
            r#"{"installDir":"D:\\data","server":{"name":"Test","world":"Midgard","setKeys":["fire","nobuildcost"]}}"#,
        )
        .expect("legacy config parses");
        config.normalize(&base);

        assert_eq!(
            config.server.set_keys,
            vec!["fire".to_string(), "nobuildcost".to_string()]
        );
        let error = config
            .validate()
            .expect_err("fire is no longer a valid setkey");
        assert_eq!(error.code(), "VALIDATION");
        assert!(error.to_string().contains("fire"), "{error}");
    }

    #[test]
    fn rejects_duplicate_set_keys() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.set_keys = vec!["nomap".to_string(), "NoMap".to_string()];

        let error = config.validate().expect_err("duplicate key is rejected");
        assert!(error.to_string().contains("несколько раз"), "{error}");
    }

    #[test]
    fn legacy_config_without_set_keys_still_loads() {
        let (_temp, base) = base();
        // A config written before `setKeys` existed: the field must default.
        let mut config: AppConfig = serde_json::from_str(
            r#"{"installDir":"D:\\data","server":{"name":"Test","world":"Midgard"}}"#,
        )
        .expect("legacy config parses");
        config.normalize(&base);

        assert_eq!(config.server.set_keys.len(), 0);
        config.validate().expect("legacy config is valid");
    }

    #[test]
    fn rejects_relative_directories() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.install_dir = "relative/server".to_string();
        let error = config.validate().expect_err("relative path is rejected");
        assert!(error.to_string().contains("абсолютный"));
    }

    #[test]
    fn enforces_backup_retention_range() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);

        config.keep_backups = 0;
        config.validate().expect_err("zero retention is rejected");

        config.keep_backups = MAX_KEEP_BACKUPS + 1;
        config
            .validate()
            .expect_err("too large retention is rejected");
    }

    #[test]
    fn json_uses_camel_case_keys() {
        let (_temp, base) = base();
        let config = AppConfig::defaults(&base);
        let payload = serde_json::to_value(&config).expect("serializes");

        for key in [
            "schemaVersion",
            "installDir",
            "steamcmdDir",
            "backupsDir",
            "keepBackups",
            "autoBackupBeforeUpdate",
            "autoBackupBeforeStop",
        ] {
            assert!(payload.get(key).is_some(), "missing key {key}");
        }
        let server = &payload["server"];
        for key in [
            "isPublic",
            "saveIntervalSec",
            "extraArgs",
            "modifiers",
            "setKeys",
        ] {
            assert!(server.get(key).is_some(), "missing server key {key}");
        }
        assert!(server["setKeys"].is_array());
        assert!(server["modifiers"].get("deathPenalty").is_some());
        assert!(server["modifiers"].get("death_penalty").is_none());
    }

    #[test]
    fn preset_and_modifier_values_serialize_as_cli_values() {
        let (_temp, base) = base();
        let mut config = AppConfig::defaults(&base);
        config.server.preset = WorldPreset::Hardcore;
        config.server.modifiers = WorldModifiers {
            combat: CombatLevel::VeryEasy,
            death_penalty: DeathPenalty::Hardcore,
            resources: ResourcesAmount::MuchMore,
            raids: RaidsFrequency::None,
            portals: PortalsRule::VeryHard,
        };

        let payload = serde_json::to_value(&config).expect("serializes");
        assert_eq!(payload["server"]["preset"], "hardcore");
        assert_eq!(payload["server"]["modifiers"]["combat"], "veryeasy");
        assert_eq!(payload["server"]["modifiers"]["deathPenalty"], "hardcore");
        assert_eq!(payload["server"]["modifiers"]["resources"], "muchmore");
        assert_eq!(payload["server"]["modifiers"]["raids"], "none");
        assert_eq!(payload["server"]["modifiers"]["portals"], "veryhard");

        let pairs = config.server.modifiers.pairs();
        assert_eq!(pairs[0], ("combat", "veryeasy"));
        assert_eq!(pairs[1], ("deathpenalty", "hardcore"));
    }

    #[test]
    fn deserializes_partial_config_with_defaults() {
        let (_temp, base) = base();
        let json = format!(
            r#"{{"installDir": {}, "server": {{"name": "Test"}}}}"#,
            serde_json::to_string(&base.layout_root.join("server").display().to_string())
                .expect("path serializes")
        );

        let mut config: AppConfig = serde_json::from_str(&json).expect("partial config parses");
        config.normalize(&base);

        assert_eq!(config.server.name, "Test");
        assert_eq!(config.server.port, DEFAULT_PORT);
        assert!(config.auto_backup_before_stop);
        assert!(config.validate().is_ok());
    }
}
