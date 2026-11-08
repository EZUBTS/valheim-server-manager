//! Server mods: BepInEx + Server Devcommands.
//!
//! Vanilla Valheim disables `devcommands` (god/fly/item/spawn) on dedicated
//! servers, so "maximum admin" requires server-side mods:
//! - **BepInExPack_Valheim** (`denikson/BepInExPack_Valheim`) — the mod loader:
//!   `winhttp.dll`, `doorstop_config.ini`, `.doorstop_version` and `BepInEx/`
//!   are copied into the server install directory;
//! - **Server_devcommands** (`JereKuusela/Server_devcommands`) — the plugin that
//!   enables in-game admin commands on a dedicated server; it is unpacked into
//!   `<installDir>/BepInEx/plugins/ServerDevcommands/`.
//!
//! Packages are downloaded from the Thunderstore API (latest version) with a
//! pinned fallback URL when the API is unavailable. Installation requires the
//! server to be stopped: BepInEx is loaded by Doorstop at process startup via
//! `winhttp.dll`, so the files cannot be replaced while the server runs.
//!
//! Detection ([`detect_mod_status`]) is purely filesystem based and never
//! touches the network, so it is safe to call on every UI refresh.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config::AppConfig;
use crate::error::AppError;
use crate::logs::LogLevel;
use crate::process::steamcmd::{download_file, extract_zip};
use crate::state::{AppState, InstallPhase, now_ms};

/// Thunderstore package key of the BepInEx pack for Valheim.
pub const BEPINEX_PACKAGE_KEY: &str = "denikson/BepInExPack_Valheim";
/// Thunderstore package key of the Server Devcommands plugin.
pub const SERVER_DEVCOMMANDS_PACKAGE_KEY: &str = "JereKuusela/Server_devcommands";

/// Pinned BepInEx pack version used when the Thunderstore API is unavailable.
pub const BEPINEX_PINNED_VERSION: &str = "5.4.2360";
/// Pinned Server Devcommands version used when the API is unavailable.
pub const SERVER_DEVCOMMANDS_PINNED_VERSION: &str = "1.116.0";

/// Base URL of the Thunderstore experimental package API.
pub const THUNDERSTORE_API_BASE: &str = "https://thunderstore.io/api/experimental/package";
/// Base URL of the Thunderstore download endpoint.
pub const THUNDERSTORE_DOWNLOAD_BASE: &str = "https://thunderstore.io/package/download";

/// Directory name of the plugin inside `BepInEx/plugins`.
pub const SERVER_DEVCOMMANDS_DIR: &str = "ServerDevcommands";
/// File name of the plugin assembly.
pub const SERVER_DEVCOMMANDS_DLL: &str = "ServerDevcommands.dll";

/// Name of the file that stores versions of mods installed by the manager.
const MODS_MANIFEST_FILE: &str = "mods.json";

/// Server mod installation state.
///
/// Matches `ModStatus` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModStatus {
    /// `true` when Doorstop (`winhttp.dll`) and the BepInEx preloader are present.
    pub bepinex_installed: bool,
    /// Installed BepInEx pack version, when known.
    pub bepinex_version: Option<String>,
    /// `true` when `BepInEx/plugins/ServerDevcommands/ServerDevcommands.dll` exists.
    pub server_devcommands_installed: bool,
    /// Installed Server Devcommands version, when known.
    pub server_devcommands_version: Option<String>,
    /// Names of plugin files/folders inside `BepInEx/plugins`.
    pub plugins: Vec<String>,
    /// Install directory the status was computed for.
    pub install_dir: String,
}

/// Versions of the packages that are being installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModInstallVersions {
    /// BepInEx pack version.
    pub bepinex: String,
    /// Server Devcommands version.
    pub server_devcommands: String,
}

/// Result of resolving a package download from the Thunderstore API.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadTarget {
    /// Version asked from the API (or the pinned fallback version).
    pub version: String,
    /// Direct archive URL.
    pub url: String,
}

/// Versions of the mods installed by this manager, persisted next to the config.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledModsManifest {
    #[serde(default)]
    bepinex_version: Option<String>,
    #[serde(default)]
    server_devcommands_version: Option<String>,
    #[serde(default)]
    installed_at: i64,
}

/// Thunderstore API response (only the fields we need).
#[derive(Debug, Deserialize)]
struct ThunderstorePackage {
    latest: Option<ThunderstoreLatest>,
}

#[derive(Debug, Deserialize)]
struct ThunderstoreLatest {
    version_number: Option<String>,
    download_url: Option<String>,
}

/// `manifest.json` of a BepInEx plugin.
#[derive(Debug, Deserialize)]
struct PluginManifest {
    version_number: Option<String>,
}

// --- Paths -----------------------------------------------------------------

/// `<installDir>/BepInEx`.
#[must_use]
pub fn bepinex_dir(config: &AppConfig) -> PathBuf {
    Path::new(&config.install_dir).join("BepInEx")
}

/// `<installDir>/BepInEx/plugins`.
#[must_use]
pub fn plugins_dir(config: &AppConfig) -> PathBuf {
    bepinex_dir(config).join("plugins")
}

/// `<installDir>/BepInEx/plugins/ServerDevcommands`.
#[must_use]
pub fn server_devcommands_dir(config: &AppConfig) -> PathBuf {
    plugins_dir(config).join(SERVER_DEVCOMMANDS_DIR)
}

/// `<installDir>/BepInEx/core/BepInEx.Preloader.dll` — marker of a BepInEx install.
#[must_use]
pub fn bepinex_preloader_path(config: &AppConfig) -> PathBuf {
    bepinex_dir(config)
        .join("core")
        .join("BepInEx.Preloader.dll")
}

/// `<installDir>/winhttp.dll` — Doorstop proxy DLL loaded by the server.
#[must_use]
pub fn doorstop_proxy_path(config: &AppConfig) -> PathBuf {
    Path::new(&config.install_dir).join("winhttp.dll")
}

/// `<installDir>/.doorstop_version` — Doorstop version marker written by the pack.
#[must_use]
pub fn doorstop_version_path(config: &AppConfig) -> PathBuf {
    Path::new(&config.install_dir).join(".doorstop_version")
}

/// `<installDir>/BepInEx/plugins/ServerDevcommands/ServerDevcommands.dll`.
#[must_use]
pub fn server_devcommands_dll_path(config: &AppConfig) -> PathBuf {
    server_devcommands_dir(config).join(SERVER_DEVCOMMANDS_DLL)
}

/// `<dataDir>/mods.json` — versions installed by the manager.
#[must_use]
pub fn mods_manifest_path(data_dir: &Path) -> PathBuf {
    data_dir.join(MODS_MANIFEST_FILE)
}

// --- Detection -------------------------------------------------------------

/// Computes the current mod status from the filesystem (no network, no locks).
#[must_use]
pub fn detect_mod_status(config: &AppConfig, data_dir: &Path) -> ModStatus {
    let manifest = load_mods_manifest(data_dir);

    let bepinex_installed =
        doorstop_proxy_path(config).is_file() && bepinex_preloader_path(config).is_file();
    let server_devcommands_installed = server_devcommands_dll_path(config).is_file();

    let bepinex_version = if bepinex_installed {
        manifest
            .as_ref()
            .and_then(|manifest| manifest.bepinex_version.clone())
            .or_else(|| read_doorstop_version(config))
    } else {
        None
    };

    let server_devcommands_version = if server_devcommands_installed {
        read_plugin_manifest_version(&server_devcommands_dir(config).join("manifest.json")).or_else(
            || {
                manifest
                    .as_ref()
                    .and_then(|manifest| manifest.server_devcommands_version.clone())
            },
        )
    } else {
        None
    };

    ModStatus {
        bepinex_installed,
        bepinex_version,
        server_devcommands_installed,
        server_devcommands_version,
        plugins: list_plugins(&plugins_dir(config)),
        install_dir: config.install_dir.clone(),
    }
}

/// Reads the Doorstop version marker (best-effort BepInEx version fallback).
#[must_use]
fn read_doorstop_version(config: &AppConfig) -> Option<String> {
    let content = std::fs::read_to_string(doorstop_version_path(config)).ok()?;
    content.lines().find_map(normalize_version)
}

/// Reads `version_number` from a BepInEx plugin `manifest.json`.
#[must_use]
pub fn read_plugin_manifest_version(manifest_path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(manifest_path).ok()?;
    let manifest: PluginManifest = serde_json::from_str(&content).ok()?;
    normalize_version(manifest.version_number.as_deref()?)
}

/// Lists plugin entries inside `BepInEx/plugins`: folder names and DLL stems.
#[must_use]
pub fn list_plugins(plugins_dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(plugins_dir) else {
        return Vec::new();
    };

    let mut plugins: Vec<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            if path.is_dir() {
                return Some(name);
            }
            if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("dll"))
            {
                return Some(
                    path.file_stem()
                        .map_or(name.clone(), |stem| stem.to_string_lossy().to_string()),
                );
            }
            None
        })
        .collect();

    plugins.sort();
    plugins.dedup();
    plugins
}

/// Normalizes a version string (`v5.4.2360` → `5.4.2360`).
#[must_use]
pub fn normalize_version(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_start_matches('\u{feff}').trim();
    let without_prefix = trimmed.strip_prefix(['v', 'V']).unwrap_or(trimmed);
    if without_prefix.is_empty() || !without_prefix.starts_with(|c: char| c.is_ascii_digit()) {
        return None;
    }
    if !without_prefix.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+' | '_')
    }) {
        return None;
    }

    Some(without_prefix.to_string())
}

// --- Thunderstore ----------------------------------------------------------

/// API URL of a package: `…/api/experimental/package/<namespace>/<name>/`.
#[must_use]
pub fn package_api_url(package_key: &str) -> String {
    format!("{THUNDERSTORE_API_BASE}/{package_key}/")
}

/// Pinned download URL: `…/package/download/<namespace>/<name>/<version>/`.
#[must_use]
pub fn pinned_download_url(package_key: &str, version: &str) -> String {
    format!("{THUNDERSTORE_DOWNLOAD_BASE}/{package_key}/{version}/")
}

/// Parses the Thunderstore package JSON into a download target.
#[must_use]
pub fn parse_thunderstore_package(json: &str) -> Option<DownloadTarget> {
    let package: ThunderstorePackage = serde_json::from_str(json).ok()?;
    let latest = package.latest?;
    let version = normalize_version(latest.version_number.as_deref()?)?;
    let url = latest.download_url?.trim().to_string();
    if url.is_empty() {
        return None;
    }

    Some(DownloadTarget { version, url })
}

/// Asks the Thunderstore API for the latest package version.
pub fn fetch_package_target(package_key: &str) -> Result<DownloadTarget, AppError> {
    let url = package_api_url(package_key);
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .into();

    let mut response = agent
        .get(&url)
        .call()
        .map_err(|error| AppError::Network(format!("Thunderstore API ({package_key}): {error}")))?;
    let json = response
        .body_mut()
        .read_to_string()
        .map_err(|error| AppError::Network(format!("Thunderstore API ({package_key}): {error}")))?;

    parse_thunderstore_package(&json).ok_or_else(|| {
        AppError::Network(format!(
            "не удалось разобрать ответ Thunderstore для {package_key}"
        ))
    })
}

/// Resolves a package download, falling back to the pinned version on any error.
fn resolve_download_target(
    app: &AppHandle,
    state: &AppState,
    package_key: &str,
    pinned_version: &str,
) -> DownloadTarget {
    match fetch_package_target(package_key) {
        Ok(target) => target,
        Err(error) => {
            state.log_app(
                app,
                LogLevel::Warn,
                format!(
                    "Не удалось получить актуальную версию {package_key} из Thunderstore API ({error}); использую закреплённую версию {pinned_version}."
                ),
            );
            DownloadTarget {
                version: pinned_version.to_string(),
                url: pinned_download_url(package_key, pinned_version),
            }
        }
    }
}

// --- Filesystem helpers ----------------------------------------------------

/// Copies a directory tree into `destination`, overwriting existing files.
pub fn copy_tree(source: &Path, destination: &Path) -> Result<(), AppError> {
    for entry in walkdir::WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let relative = entry.path().strip_prefix(source).map_err(|error| {
            AppError::Process(format!("не удалось вычислить путь мода: {error}"))
        })?;
        let target = destination.join(relative);

        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|error| AppError::io("создание каталога модов", &error))?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| AppError::io("создание каталога модов", &error))?;
            }
            std::fs::copy(entry.path(), &target)
                .map_err(|error| AppError::io("копирование файла мода", &error))?;
        }
    }

    Ok(())
}

/// Finds the root of the extracted BepInEx pack (a directory with `winhttp.dll`
/// and a `BepInEx/` folder), looking at most two levels deep.
#[must_use]
pub fn find_bepinex_pack_root(extract_dir: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![extract_dir.to_path_buf()];

    for depth in 0..=2u8 {
        let mut next: Vec<PathBuf> = Vec::new();
        for candidate in candidates {
            if !candidate.is_dir() {
                continue;
            }
            if candidate.join("winhttp.dll").is_file() && candidate.join("BepInEx").is_dir() {
                return Some(candidate);
            }
            if depth < 2 {
                if let Ok(entries) = std::fs::read_dir(&candidate) {
                    for entry in entries.filter_map(Result::ok) {
                        if entry.path().is_dir() {
                            next.push(entry.path());
                        }
                    }
                }
            }
        }
        candidates = next;
    }

    None
}

/// Returns the real content root of an extracted package.
///
/// Thunderstore archives are usually flat, but some packs wrap everything into
/// a single top-level folder; both layouts are handled.
#[must_use]
pub fn package_content_root(extract_dir: &Path) -> PathBuf {
    let Ok(entries) = std::fs::read_dir(extract_dir) else {
        return extract_dir.to_path_buf();
    };

    let mut directories: Vec<PathBuf> = Vec::new();
    let mut files_count = 0usize;
    for entry in entries.filter_map(Result::ok) {
        if entry.path().is_dir() {
            directories.push(entry.path());
        } else {
            files_count += 1;
        }
    }

    if files_count == 0 && directories.len() == 1 {
        return directories.remove(0);
    }

    extract_dir.to_path_buf()
}

// --- Installation ----------------------------------------------------------

/// Installs mods from already downloaded archives into the server directory.
///
/// This is the testable core of [`install_server_mods`]: it does not touch the
/// network and works on any temporary directory tree. The versions are written
/// to `<dataDir>/mods.json` so the UI can display them later.
pub fn install_mods_into(
    config: &AppConfig,
    data_dir: &Path,
    bepinex_archive: &Path,
    devcommands_archive: &Path,
    versions: &ModInstallVersions,
) -> Result<ModStatus, AppError> {
    if !config.server_exe_path().is_file() {
        return Err(AppError::ServerNotInstalled(format!(
            "не найден {} — сначала установите сервер",
            config.server_exe_path().display()
        )));
    }

    let temp_dir = data_dir
        .join("tmp")
        .join(format!("mods-install-{}", now_ms()));
    if temp_dir.exists() {
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| AppError::io("создание временного каталога модов", &error))?;

    let result =
        install_mods_from_archives(config, &temp_dir, bepinex_archive, devcommands_archive);
    let _ = std::fs::remove_dir_all(&temp_dir);
    result?;

    save_mods_manifest(data_dir, versions)?;

    Ok(detect_mod_status(config, data_dir))
}

/// Extracts both archives into `temp_dir` and copies the payload into the install.
fn install_mods_from_archives(
    config: &AppConfig,
    temp_dir: &Path,
    bepinex_archive: &Path,
    devcommands_archive: &Path,
) -> Result<(), AppError> {
    let install_dir = Path::new(&config.install_dir);

    // 1. BepInEx pack: find the folder with `winhttp.dll` and copy its content
    //    into the install directory (Doorstop loads BepInEx via winhttp.dll).
    let bepinex_extract = temp_dir.join("bepinex");
    extract_zip(bepinex_archive, &bepinex_extract, None)?;
    let bepinex_root = find_bepinex_pack_root(&bepinex_extract).ok_or_else(|| {
        AppError::Process(
            "в архиве BepInExPack_Valheim не найден winhttp.dll — это не BepInEx-пак для Valheim"
                .to_string(),
        )
    })?;
    copy_tree(&bepinex_root, install_dir)?;

    // 2. Server_devcommands: a flat plugin package, unpack into its own folder.
    let devcommands_extract = temp_dir.join("server-devcommands");
    extract_zip(devcommands_archive, &devcommands_extract, None)?;
    let devcommands_source = package_content_root(&devcommands_extract);
    let devcommands_target = server_devcommands_dir(config);
    std::fs::create_dir_all(&devcommands_target)
        .map_err(|error| AppError::io("создание каталога плагина ServerDevcommands", &error))?;
    copy_tree(&devcommands_source, &devcommands_target)?;

    // 3. Verify the files the game needs; fail early with an actionable message.
    let required = [
        ("winhttp.dll", doorstop_proxy_path(config)),
        (
            "BepInEx/core/BepInEx.Preloader.dll",
            bepinex_preloader_path(config),
        ),
        (
            "BepInEx/plugins/ServerDevcommands/ServerDevcommands.dll",
            server_devcommands_dll_path(config),
        ),
    ];
    let missing: Vec<String> = required
        .into_iter()
        .filter(|(_, path)| !path.is_file())
        .map(|(label, _)| label.to_string())
        .collect();
    if !missing.is_empty() {
        return Err(AppError::Process(format!(
            "после установки модов не найдены файлы: {}",
            missing.join(", ")
        )));
    }

    Ok(())
}

/// Saves the installed mod versions to `<dataDir>/mods.json`.
fn save_mods_manifest(data_dir: &Path, versions: &ModInstallVersions) -> Result<(), AppError> {
    std::fs::create_dir_all(data_dir)
        .map_err(|error| AppError::io("создание каталога данных", &error))?;
    let manifest = InstalledModsManifest {
        bepinex_version: Some(versions.bepinex.clone()),
        server_devcommands_version: Some(versions.server_devcommands.clone()),
        installed_at: now_ms(),
    };
    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| AppError::Config(format!("не удалось сохранить mods.json: {error}")))?;
    std::fs::write(mods_manifest_path(data_dir), format!("{json}\n"))
        .map_err(|error| AppError::io("запись mods.json", &error))
}

/// Loads the manifest of mods installed by the manager.
#[must_use]
fn load_mods_manifest(data_dir: &Path) -> Option<InstalledModsManifest> {
    let content = std::fs::read_to_string(mods_manifest_path(data_dir)).ok()?;
    serde_json::from_str(&content).ok()
}

// --- Application-level commands -------------------------------------------

/// Downloads and installs BepInEx + Server Devcommands, emitting progress.
///
/// The server must be stopped: BepInEx is injected at process startup.
#[allow(clippy::too_many_lines)] // one linear download → extract → verify sequence
pub fn install_server_mods(app: &AppHandle, state: &AppState) -> Result<ModStatus, AppError> {
    if state.server_is_active() {
        return Err(AppError::Process(
            "Остановите сервер Valheim перед установкой модов: BepInEx загружается только при старте."
                .to_string(),
        ));
    }

    let config = state.config();
    if !config.server_exe_path().is_file() {
        return Err(AppError::ServerNotInstalled(format!(
            "не найден {} — сначала установите сервер",
            config.server_exe_path().display()
        )));
    }

    let download_dir = state
        .base()
        .data_dir
        .join("tmp")
        .join(format!("mods-download-{}", now_ms()));
    std::fs::create_dir_all(&download_dir)
        .map_err(|error| AppError::io("создание каталога загрузки модов", &error))?;

    let result = (|| -> Result<ModStatus, AppError> {
        state.log_app(
            app,
            LogLevel::Info,
            "Установка серверных модов: BepInEx + Server Devcommands",
        );
        state.set_progress(
            app,
            InstallPhase::Downloading,
            "Определение актуальных версий модов на Thunderstore…",
            None,
        );

        let bepinex =
            resolve_download_target(app, state, BEPINEX_PACKAGE_KEY, BEPINEX_PINNED_VERSION);
        let devcommands = resolve_download_target(
            app,
            state,
            SERVER_DEVCOMMANDS_PACKAGE_KEY,
            SERVER_DEVCOMMANDS_PINNED_VERSION,
        );

        let bepinex_archive = download_dir.join("BepInExPack_Valheim.zip");
        state.set_progress(
            app,
            InstallPhase::Downloading,
            format!("Скачивание BepInEx {}…", bepinex.version),
            Some(0),
        );
        download_file(
            app,
            state,
            &bepinex.url,
            &bepinex_archive,
            InstallPhase::Downloading,
            &format!("BepInEx {}", bepinex.version),
        )?;

        let devcommands_archive = download_dir.join("Server_devcommands.zip");
        state.set_progress(
            app,
            InstallPhase::Downloading,
            format!("Скачивание Server Devcommands {}…", devcommands.version),
            Some(0),
        );
        download_file(
            app,
            state,
            &devcommands.url,
            &devcommands_archive,
            InstallPhase::Downloading,
            &format!("Server Devcommands {}", devcommands.version),
        )?;

        state.set_progress(
            app,
            InstallPhase::Extracting,
            "Распаковка модов в каталог сервера…",
            None,
        );
        let versions = ModInstallVersions {
            bepinex: bepinex.version,
            server_devcommands: devcommands.version,
        };
        install_mods_into(
            &config,
            &state.base().data_dir,
            &bepinex_archive,
            &devcommands_archive,
            &versions,
        )
    })();

    let _ = std::fs::remove_dir_all(&download_dir);

    match result {
        Ok(status) => {
            state.log_app(
                app,
                LogLevel::Info,
                format!(
                    "Моды установлены: BepInEx {}, Server Devcommands {}. Перезапустите сервер, чтобы включить devcommands.",
                    status.bepinex_version.as_deref().unwrap_or("?"),
                    status
                        .server_devcommands_version
                        .as_deref()
                        .unwrap_or("?"),
                ),
            );
            state.set_progress(
                app,
                InstallPhase::Done,
                "Моды установлены — перезапустите сервер",
                Some(100),
            );
            Ok(status)
        }
        Err(error) => {
            state.log_app(
                app,
                LogLevel::Error,
                format!("Не удалось установить моды: {error}"),
            );
            state.set_progress(app, InstallPhase::Error, error.to_string(), None);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use crate::paths::BasePaths;
    use std::io::Write;

    fn write(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, contents).expect("write");
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).expect("create zip");
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        for (name, contents) in entries {
            writer.start_file(*name, options).expect("zip entry");
            writer.write_all(contents).expect("zip write");
        }
        writer.finish().expect("zip finish");
    }

    struct Fixture {
        temp: tempfile::TempDir,
        install_dir: PathBuf,
        data_dir: PathBuf,
        config: AppConfig,
    }

    fn fixture() -> Fixture {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = BasePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
            temp.path().join("data").join("logs"),
            temp.path().join("root"),
        );
        let mut config = AppConfig::defaults(&base);
        config.install_dir = temp.path().join("install").display().to_string();
        let install_dir = PathBuf::from(&config.install_dir);
        std::fs::create_dir_all(&install_dir).expect("mkdir install");
        std::fs::write(install_dir.join("valheim_server.exe"), b"fake exe").expect("write exe");

        Fixture {
            data_dir: temp.path().join("data"),
            install_dir,
            config,
            temp,
        }
    }

    fn bepinex_archive(path: &Path) {
        write_zip(
            path,
            &[
                ("BepInExPack_Valheim/winhttp.dll", b"proxy"),
                (
                    "BepInExPack_Valheim/doorstop_config.ini",
                    b"[General]\nenabled=true\n",
                ),
                ("BepInExPack_Valheim/.doorstop_version", b"4.4.0.0\n"),
                (
                    "BepInExPack_Valheim/BepInEx/core/BepInEx.Preloader.dll",
                    b"preloader",
                ),
                (
                    "BepInExPack_Valheim/BepInEx/config/BepInEx.cfg",
                    b"[Logging]\n",
                ),
            ],
        );
    }

    fn devcommands_archive(path: &Path) {
        write_zip(
            path,
            &[
                ("ServerDevcommands.dll", b"plugin"),
                (
                    "manifest.json",
                    br#"{"name":"Server_devcommands","version_number":"1.116.0"}"#,
                ),
                ("README.md", b"readme"),
            ],
        );
    }

    #[test]
    fn detects_nothing_on_an_empty_install() {
        let fixture = fixture();
        let status = detect_mod_status(&fixture.config, &fixture.data_dir);

        assert!(!status.bepinex_installed);
        assert!(!status.server_devcommands_installed);
        assert!(status.bepinex_version.is_none());
        assert!(status.server_devcommands_version.is_none());
        assert_eq!(status.plugins.len(), 0);
        assert_eq!(status.install_dir, fixture.config.install_dir);
    }

    #[test]
    fn detects_manually_installed_mods() {
        let fixture = fixture();
        write(&fixture.install_dir.join("winhttp.dll"), b"proxy");
        write(
            &fixture
                .install_dir
                .join("BepInEx")
                .join("core")
                .join("BepInEx.Preloader.dll"),
            b"preloader",
        );
        write(&fixture.install_dir.join(".doorstop_version"), b"4.4.0.0\n");
        write(
            &fixture
                .install_dir
                .join("BepInEx")
                .join("plugins")
                .join("ServerDevcommands")
                .join("ServerDevcommands.dll"),
            b"plugin",
        );
        write(
            &fixture
                .install_dir
                .join("BepInEx")
                .join("plugins")
                .join("ServerDevcommands")
                .join("manifest.json"),
            br#"{"version_number":"v1.116.0"}"#,
        );
        write(
            &fixture
                .install_dir
                .join("BepInEx")
                .join("plugins")
                .join("OtherMod.dll"),
            b"mod",
        );

        let status = detect_mod_status(&fixture.config, &fixture.data_dir);

        assert!(status.bepinex_installed);
        assert_eq!(status.bepinex_version.as_deref(), Some("4.4.0.0"));
        assert!(status.server_devcommands_installed);
        assert_eq!(
            status.server_devcommands_version.as_deref(),
            Some("1.116.0")
        );
        assert_eq!(
            status.plugins,
            vec!["OtherMod".to_string(), "ServerDevcommands".to_string()]
        );
    }

    #[test]
    fn installs_mods_from_fake_archives() {
        let fixture = fixture();
        let bepinex = fixture.temp.path().join("bepinex.zip");
        let devcommands = fixture.temp.path().join("devcommands.zip");
        bepinex_archive(&bepinex);
        devcommands_archive(&devcommands);

        let versions = ModInstallVersions {
            bepinex: "5.4.2360".to_string(),
            server_devcommands: "1.116.0".to_string(),
        };
        let status = install_mods_into(
            &fixture.config,
            &fixture.data_dir,
            &bepinex,
            &devcommands,
            &versions,
        )
        .expect("mods install");

        assert!(status.bepinex_installed);
        assert!(status.server_devcommands_installed);
        assert_eq!(status.bepinex_version.as_deref(), Some("5.4.2360"));
        assert_eq!(
            status.server_devcommands_version.as_deref(),
            Some("1.116.0")
        );
        assert!(status.plugins.contains(&"ServerDevcommands".to_string()));

        // Files are in the install directory expected by Doorstop/BepInEx.
        assert!(fixture.install_dir.join("winhttp.dll").is_file());
        assert!(
            fixture
                .install_dir
                .join("BepInEx")
                .join("core")
                .join("BepInEx.Preloader.dll")
                .is_file()
        );
        assert!(server_devcommands_dll_path(&fixture.config).is_file());
        assert!(mods_manifest_path(&fixture.data_dir).is_file());
        // Temporary directories are cleaned up.
        let leftovers: Vec<String> = std::fs::read_dir(fixture.data_dir.join("tmp"))
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default();
        assert!(leftovers.is_empty(), "temp leftovers: {leftovers:?}");
    }

    #[test]
    fn install_requires_the_server_to_be_installed() {
        let fixture = fixture();
        std::fs::remove_file(fixture.install_dir.join("valheim_server.exe")).expect("remove exe");
        let bepinex = fixture.temp.path().join("bepinex.zip");
        let devcommands = fixture.temp.path().join("devcommands.zip");
        bepinex_archive(&bepinex);
        devcommands_archive(&devcommands);

        let error = install_mods_into(
            &fixture.config,
            &fixture.data_dir,
            &bepinex,
            &devcommands,
            &ModInstallVersions {
                bepinex: "5.4.2360".to_string(),
                server_devcommands: "1.116.0".to_string(),
            },
        )
        .expect_err("server is required");

        assert_eq!(error.code(), "SERVER_NOT_INSTALLED");
    }

    #[test]
    fn install_rejects_archives_without_the_bepinex_root() {
        let fixture = fixture();
        let bepinex = fixture.temp.path().join("not-bepinex.zip");
        let devcommands = fixture.temp.path().join("devcommands.zip");
        write_zip(&bepinex, &[("readme.txt", b"nothing")]);
        devcommands_archive(&devcommands);

        let error = install_mods_into(
            &fixture.config,
            &fixture.data_dir,
            &bepinex,
            &devcommands,
            &ModInstallVersions {
                bepinex: "5.4.2360".to_string(),
                server_devcommands: "1.116.0".to_string(),
            },
        )
        .expect_err("invalid BepInEx archive");

        assert_eq!(error.code(), "PROCESS");
        // A failed installation must not leave helpers in the data dir.
        assert!(!mods_manifest_path(&fixture.data_dir).exists());
    }

    #[test]
    fn finds_the_bepinex_pack_root_at_depth_one_and_two() {
        let temp = tempfile::tempdir().expect("temp dir");
        let depth_one = temp.path().join("one").join("BepInExPack_Valheim");
        write(&depth_one.join("winhttp.dll"), b"proxy");
        std::fs::create_dir_all(depth_one.join("BepInEx")).expect("mkdir");

        assert_eq!(
            find_bepinex_pack_root(&temp.path().join("one")),
            Some(depth_one)
        );

        let depth_two = temp
            .path()
            .join("two")
            .join("a")
            .join("BepInExPack_Valheim");
        write(&depth_two.join("winhttp.dll"), b"proxy");
        std::fs::create_dir_all(depth_two.join("BepInEx")).expect("mkdir");
        assert_eq!(
            find_bepinex_pack_root(&temp.path().join("two")),
            Some(depth_two)
        );

        let empty = temp.path().join("empty");
        std::fs::create_dir_all(&empty).expect("mkdir");
        assert_eq!(find_bepinex_pack_root(&empty), None);
    }

    #[test]
    fn copy_tree_overwrites_existing_files() {
        let temp = tempfile::tempdir().expect("temp dir");
        let source = temp.path().join("source");
        write(&source.join("winhttp.dll"), b"new");
        write(&source.join("BepInEx").join("core").join("x.dll"), b"x");

        let destination = temp.path().join("destination");
        write(&destination.join("winhttp.dll"), b"old");

        copy_tree(&source, &destination).expect("copy");

        assert_eq!(
            std::fs::read_to_string(destination.join("winhttp.dll")).expect("read"),
            "new"
        );
        assert!(
            destination
                .join("BepInEx")
                .join("core")
                .join("x.dll")
                .is_file()
        );
    }

    #[test]
    fn package_content_root_unwraps_a_single_folder() {
        let temp = tempfile::tempdir().expect("temp dir");
        let flat = temp.path().join("flat");
        write(&flat.join("ServerDevcommands.dll"), b"plugin");
        assert_eq!(package_content_root(&flat), flat);

        let wrapped = temp.path().join("wrapped");
        write(
            &wrapped
                .join("Server_devcommands")
                .join("ServerDevcommands.dll"),
            b"plugin",
        );
        assert_eq!(
            package_content_root(&wrapped),
            wrapped.join("Server_devcommands")
        );
    }

    #[test]
    fn parses_thunderstore_api_response() {
        let json = r#"{
            "namespace": "denikson",
            "name": "BepInExPack_Valheim",
            "latest": {
                "version_number": "5.4.2360",
                "download_url": "https://thunderstore.io/package/download/denikson/BepInExPack_Valheim/5.4.2360/"
            }
        }"#;
        let target = parse_thunderstore_package(json).expect("target");
        assert_eq!(target.version, "5.4.2360");
        assert!(target.url.contains("BepInExPack_Valheim"));

        assert_eq!(parse_thunderstore_package("not json"), None);
        assert_eq!(parse_thunderstore_package("{}"), None);
        assert_eq!(
            parse_thunderstore_package(r#"{"latest":{"version_number":"1.0.0"}}"#),
            None
        );
    }

    #[test]
    fn builds_thunderstore_urls() {
        assert_eq!(
            package_api_url("JereKuusela/Server_devcommands"),
            "https://thunderstore.io/api/experimental/package/JereKuusela/Server_devcommands/"
        );
        assert_eq!(
            pinned_download_url("denikson/BepInExPack_Valheim", "5.4.2360"),
            "https://thunderstore.io/package/download/denikson/BepInExPack_Valheim/5.4.2360/"
        );
    }

    #[test]
    fn normalizes_versions() {
        assert_eq!(
            normalize_version(" 5.4.2360 "),
            Some("5.4.2360".to_string())
        );
        assert_eq!(normalize_version("v1.116.0"), Some("1.116.0".to_string()));
        assert_eq!(normalize_version("4.4.0.0\n"), Some("4.4.0.0".to_string()));
        assert_eq!(normalize_version(""), None);
        assert_eq!(normalize_version("version"), None);
        assert_eq!(normalize_version("1.0 beta!"), None);
    }

    #[test]
    fn reads_plugin_manifest_versions() {
        let temp = tempfile::tempdir().expect("temp dir");
        let manifest = temp.path().join("manifest.json");
        write(
            &manifest,
            br#"{"name":"Server_devcommands","version_number":"1.116.0"}"#,
        );
        assert_eq!(
            read_plugin_manifest_version(&manifest),
            Some("1.116.0".to_string())
        );

        write(&manifest, b"not json");
        assert_eq!(read_plugin_manifest_version(&manifest), None);
        assert_eq!(
            read_plugin_manifest_version(&temp.path().join("missing.json")),
            None
        );
    }

    #[test]
    fn mod_status_serializes_like_the_contract() {
        let status = ModStatus {
            bepinex_installed: true,
            bepinex_version: Some("5.4.2360".to_string()),
            server_devcommands_installed: true,
            server_devcommands_version: Some("1.116.0".to_string()),
            plugins: vec!["ServerDevcommands".to_string()],
            install_dir: r"D:\Servers\Valheim\server".to_string(),
        };
        let payload = serde_json::to_value(&status).expect("serializes");

        assert_eq!(payload["bepinexInstalled"], true);
        assert_eq!(payload["bepinexVersion"], "5.4.2360");
        assert_eq!(payload["serverDevcommandsInstalled"], true);
        assert_eq!(payload["serverDevcommandsVersion"], "1.116.0");
        assert_eq!(payload["plugins"][0], "ServerDevcommands");
        assert_eq!(payload["installDir"], r"D:\Servers\Valheim\server");
        assert!(payload.get("bepinex_installed").is_none());
    }
}
