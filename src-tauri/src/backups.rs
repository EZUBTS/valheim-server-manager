//! World backups: create zip archives, list, restore, delete and prune.
//!
//! A backup archive contains the whole `worlds_local` directory (all worlds,
//! both 1.0 directories and legacy `.fwl`/`.db` pairs) plus the three access
//! list files from the save directory. This matches the recommendation from
//! `docs/valheim-server-reference.md` §5.2: a 1.0 world is a directory and must
//! be copied as a whole, never file by file.
//!
//! Archives are written to a `.part` temporary file first and renamed when
//! complete, so an interrupted backup (for example when the application exits
//! while capturing a backup) never produces a corrupt `.zip` in the list.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::AppHandle;

use crate::config::AppConfig;
use crate::error::AppError;
use crate::logs::LogLevel;
use crate::paths::format_timestamp;
use crate::players::{ADMIN_FILE, BANNED_FILE, PERMITTED_FILE};
use crate::state::{AppState, now_ms};

/// Prefix of backup archive file names created by the manager.
pub const BACKUP_PREFIX: &str = "valheim-backup-";

/// Extension of backup archives.
pub const BACKUP_EXTENSION: &str = "zip";

/// Directory name inside an archive that holds the worlds.
const ARCHIVE_WORLDS_DIR: &str = "worlds_local";

/// Description of one backup archive.
///
/// Matches `BackupInfo` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    /// File name of the archive (used as its id).
    pub name: String,
    /// File size in bytes.
    pub size_bytes: u64,
    /// Creation time, epoch milliseconds.
    pub created_at: i64,
    /// Worlds contained in the archive.
    pub worlds: Vec<String>,
}

/// Filesystem locations used by the backup operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupContext {
    /// `-savedir` base: contains `worlds_local` and the access lists.
    pub save_dir: PathBuf,
    /// `worlds_local` directory.
    pub worlds_dir: PathBuf,
    /// Directory with zip archives.
    pub backups_dir: PathBuf,
    /// How many latest archives are kept.
    pub keep_backups: u32,
}

impl BackupContext {
    /// Builds the context from the current configuration.
    #[must_use]
    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            save_dir: config.save_dir_path(),
            worlds_dir: config.worlds_dir_path(),
            backups_dir: PathBuf::from(&config.backups_dir),
            keep_backups: config.keep_backups,
        }
    }
}

/// Builds a backup archive name: `valheim-backup-YYYYMMDD-HHMMSS[-label].zip`.
#[must_use]
pub fn backup_file_name(epoch_ms: i64, label: Option<&str>) -> String {
    match label.and_then(sanitize_label) {
        Some(label) => format!(
            "{BACKUP_PREFIX}{}-{label}.{BACKUP_EXTENSION}",
            format_timestamp(epoch_ms)
        ),
        None => format!(
            "{BACKUP_PREFIX}{}.{BACKUP_EXTENSION}",
            format_timestamp(epoch_ms)
        ),
    }
}

/// Normalizes a user label into a safe file name fragment.
///
/// Returns `None` when nothing usable is left after sanitizing.
#[must_use]
pub fn sanitize_label(label: &str) -> Option<String> {
    let mut result = String::new();
    let mut previous_dash = false;

    for character in label.trim().chars() {
        let mapped = if character.is_ascii_alphanumeric() || character == '_' {
            Some(character)
        } else if character.is_whitespace() || character == '-' {
            Some('-')
        } else if character.is_alphanumeric() {
            // Non-ASCII letters (e.g. Cyrillic) are acceptable in file names on
            // Windows, but keep archive names ASCII-simple.
            None
        } else {
            None
        };

        match mapped {
            Some('-') => {
                if !previous_dash && !result.is_empty() {
                    result.push('-');
                    previous_dash = true;
                }
            }
            Some(character) => {
                result.push(character);
                previous_dash = false;
            }
            None => {}
        }
    }

    let trimmed = result.trim_matches('-').to_string();
    if trimmed.is_empty() {
        return None;
    }

    let mut truncated: String = trimmed.chars().take(32).collect();
    while truncated.ends_with('-') {
        truncated.pop();
    }
    if truncated.is_empty() {
        None
    } else {
        Some(truncated)
    }
}

/// Creates a backup archive and returns its description.
///
/// The caller is responsible for logging and for pruning old archives.
pub fn create_backup_archive(
    context: &BackupContext,
    epoch_ms: i64,
    label: Option<&str>,
) -> Result<BackupInfo, AppError> {
    if !context.worlds_dir.is_dir() {
        return Err(AppError::BackupFailed(format!(
            "папка миров не найдена ({}): сначала запустите сервер, чтобы Valheim создал мир",
            context.worlds_dir.display()
        )));
    }

    std::fs::create_dir_all(&context.backups_dir)
        .map_err(|error| AppError::io("создание каталога резервных копий", &error))?;

    let name = backup_file_name(epoch_ms, label);
    let final_path = context.backups_dir.join(&name);
    if final_path.exists() {
        return Err(AppError::BackupFailed(format!(
            "резервная копия {name} уже существует — попробуйте ещё раз через секунду"
        )));
    }

    let temp_path = context.backups_dir.join(format!("{name}.part"));
    let worlds = match write_archive(context, &temp_path) {
        Ok(worlds) => worlds,
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(error);
        }
    };

    std::fs::rename(&temp_path, &final_path)
        .map_err(|error| AppError::io("сохранение архива резервной копии", &error))?;

    let size_bytes = std::fs::metadata(&final_path).map_or(0, |metadata| metadata.len());

    Ok(BackupInfo {
        name,
        size_bytes,
        created_at: epoch_ms,
        worlds,
    })
}

/// Writes the archive contents, returning the list of included worlds.
fn write_archive(context: &BackupContext, temp_path: &Path) -> Result<Vec<String>, AppError> {
    let file = std::fs::File::create(temp_path)
        .map_err(|error| AppError::io("создание временного архива", &error))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let worlds = world_names(&context.worlds_dir);

    // 1. The whole `worlds_local` directory, preserving its relative layout.
    for entry in walkdir::WalkDir::new(&context.worlds_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_dir() {
            continue;
        }

        let relative = entry
            .path()
            .strip_prefix(&context.worlds_dir)
            .map_err(|error| {
                AppError::BackupFailed(format!("не удалось вычислить путь файла: {error}"))
            })?;
        let archive_name = format!(
            "{ARCHIVE_WORLDS_DIR}/{}",
            relative.to_string_lossy().replace('\\', "/")
        );

        writer
            .start_file(&archive_name, options)
            .map_err(|error| AppError::BackupFailed(format!("ошибка ZIP-архива: {error}")))?;
        let mut source = std::fs::File::open(entry.path())
            .map_err(|error| AppError::io("открытие файла мира", &error))?;
        std::io::copy(&mut source, &mut writer)
            .map_err(|error| AppError::io("запись файла мира в архив", &error))?;
    }

    // 2. The access lists live next to `worlds_local` and must be restored too.
    for file_name in [ADMIN_FILE, BANNED_FILE, PERMITTED_FILE] {
        let list_path = context.save_dir.join(file_name);
        if !list_path.is_file() {
            continue;
        }
        writer
            .start_file(file_name, options)
            .map_err(|error| AppError::BackupFailed(format!("ошибка ZIP-архива: {error}")))?;
        let mut source = std::fs::File::open(&list_path)
            .map_err(|error| AppError::io("открытие списка игроков", &error))?;
        std::io::copy(&mut source, &mut writer)
            .map_err(|error| AppError::io("запись списка игроков в архив", &error))?;
    }

    writer.finish().map_err(|error| {
        AppError::BackupFailed(format!("ошибка завершения ZIP-архива: {error}"))
    })?;

    Ok(worlds)
}

/// Collects world names from a `worlds_local` directory.
fn world_names(worlds_dir: &Path) -> Vec<String> {
    crate::worlds::scan_worlds(worlds_dir, "")
        .into_iter()
        .map(|world| world.name)
        .collect()
}

/// Lists backup archives, newest first.
pub fn list_backups_in(context: &BackupContext) -> Vec<BackupInfo> {
    remove_stale_part_files(&context.backups_dir);

    let files = archive_files(&context.backups_dir);
    let mut backups = Vec::with_capacity(files.len());

    for (path, created_at) in files {
        let name = path
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().to_string());
        if name.is_empty() {
            continue;
        }
        let size_bytes = std::fs::metadata(&path).map_or(0, |metadata| metadata.len());
        let worlds = backup_worlds_from_zip(&path);

        backups.push(BackupInfo {
            name,
            size_bytes,
            created_at,
            worlds,
        });
    }

    backups
}

/// Reads world names stored in a backup archive.
#[must_use]
pub fn backup_worlds_from_zip(archive: &Path) -> Vec<String> {
    let Ok(file) = std::fs::File::open(archive) else {
        return Vec::new();
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return Vec::new();
    };

    let mut worlds = BTreeSet::new();
    for index in 0..zip.len() {
        let Ok(entry) = zip.by_index(index) else {
            continue;
        };
        if let Some(world) = world_name_from_archive_path(entry.name()) {
            worlds.insert(world);
        }
    }

    worlds.into_iter().collect()
}

/// Extracts a world name from an archive entry path.
fn world_name_from_archive_path(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let mut parts = normalized.split('/');

    if parts.next()? != ARCHIVE_WORLDS_DIR {
        return None;
    }

    let mut name = parts.next()?.to_string();
    while let Some(stripped) = name.strip_suffix(".old") {
        name = stripped.to_string();
    }
    for extension in [".fwl2", ".fwl", ".db2", ".db", ".chunks", ".ok"] {
        if let Some(stripped) = name.strip_suffix(extension) {
            name = stripped.to_string();
            break;
        }
    }

    if name.is_empty() || name.starts_with('_') || name.starts_with('.') {
        return None;
    }

    Some(name)
}

/// Deletes one backup archive.
pub fn delete_backup_file(context: &BackupContext, name: &str) -> Result<(), AppError> {
    let path = resolve_backup_path(&context.backups_dir, name)?;
    std::fs::remove_file(&path)
        .map_err(|error| AppError::io(format!("удаление архива {}", path.display()), &error))
}

/// Restores a backup archive into the save directory.
///
/// The current `worlds_local` directory is swapped atomically-ish: it is renamed
/// away, the archived copy is moved in, and only then the old copy is deleted.
/// If the swap fails, the old directory is renamed back.
pub fn restore_backup_archive(context: &BackupContext, name: &str) -> Result<(), AppError> {
    let archive = resolve_backup_path(&context.backups_dir, name)?;

    std::fs::create_dir_all(&context.save_dir)
        .map_err(|error| AppError::io("создание каталога сохранений", &error))?;

    let stamp = now_ms();
    let staging = context.save_dir.join(format!(".restore-{stamp}"));
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }

    let result = restore_from_staging(context, &archive, &staging, stamp);
    let _ = std::fs::remove_dir_all(&staging);
    result
}

/// Applies a staged restore: swaps `worlds_local` and copies the access lists.
fn restore_from_staging(
    context: &BackupContext,
    archive: &Path,
    staging: &Path,
    stamp: i64,
) -> Result<(), AppError> {
    crate::process::steamcmd::extract_zip(archive, staging, None)?;

    let staged_worlds = staging.join(ARCHIVE_WORLDS_DIR);
    if !staged_worlds.is_dir() {
        return Err(AppError::BackupFailed(
            "архив не содержит папку worlds_local — это не резервная копия Valheim".to_string(),
        ));
    }

    let old_worlds = context.save_dir.join(format!(".worlds-old-{stamp}"));
    if old_worlds.exists() {
        let _ = std::fs::remove_dir_all(&old_worlds);
    }

    let had_worlds = context.worlds_dir.exists();
    if had_worlds {
        std::fs::rename(&context.worlds_dir, &old_worlds)
            .map_err(|error| AppError::io("отложить текущие миры в сторону", &error))?;
    }

    if let Err(error) = std::fs::rename(&staged_worlds, &context.worlds_dir) {
        if had_worlds {
            let _ = std::fs::rename(&old_worlds, &context.worlds_dir);
        }
        return Err(AppError::io("перенести восстановленные миры", &error));
    }

    if had_worlds {
        let _ = std::fs::remove_dir_all(&old_worlds);
    }

    for file_name in [ADMIN_FILE, BANNED_FILE, PERMITTED_FILE] {
        let archived = staging.join(file_name);
        if archived.is_file() {
            let target = context.save_dir.join(file_name);
            std::fs::copy(&archived, &target)
                .map_err(|error| AppError::io("восстановление списка игроков", &error))?;
        }
    }

    Ok(())
}

/// Deletes the oldest archives so that at most `keep` remain.
///
/// Returns the names of the removed archives. Deletion is best effort: files
/// that cannot be removed (for example because they are open) are skipped.
pub fn prune_backups(backups_dir: &Path, keep: u32) -> Vec<String> {
    let files = archive_files(backups_dir);
    let keep = usize::try_from(keep).unwrap_or(usize::MAX);
    let start = keep.min(files.len());

    let mut removed = Vec::new();
    for (path, _) in files.into_iter().skip(start) {
        let name = path
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().to_string());
        if std::fs::remove_file(&path).is_ok() && !name.is_empty() {
            removed.push(name);
        }
    }

    removed
}

/// Resolves a backup name into a safe path inside the backup directory.
pub fn resolve_backup_path(backups_dir: &Path, name: &str) -> Result<PathBuf, AppError> {
    let name = name.trim();

    if name.is_empty() {
        return Err(AppError::BackupFailed("имя архива не указано".to_string()));
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(AppError::BackupFailed(format!(
            "недопустимое имя архива: {name}"
        )));
    }
    if !name.to_ascii_lowercase().ends_with(".zip") {
        return Err(AppError::BackupFailed(format!(
            "файл {name} не является ZIP-архивом"
        )));
    }

    let path = backups_dir.join(name);
    if !path.is_file() {
        return Err(AppError::NotFound(format!(
            "резервная копия {name} не найдена"
        )));
    }

    Ok(path)
}

/// Returns `(path, modified_at_ms)` for every archive, newest first.
fn archive_files(directory: &Path) -> Vec<(PathBuf, i64)> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };

    let mut files: Vec<(PathBuf, i64)> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(".zip")
        })
        .map(|entry| {
            let path = entry.path();
            let modified_at = std::fs::metadata(&path).ok().map_or(0, |metadata| {
                metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |duration| {
                        i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
                    })
            });
            (path, modified_at)
        })
        .collect();

    files.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| right.0.cmp(&left.0)));
    files
}

/// Removes unfinished `*.part` archives left behind by a crash or app exit.
fn remove_stale_part_files(backups_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(backups_dir) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        if entry
            .file_name()
            .to_string_lossy()
            .to_ascii_lowercase()
            .ends_with(".zip.part")
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Creates a backup, logs it and prunes old archives.
pub fn create_backup(
    app: &AppHandle,
    state: &AppState,
    label: Option<&str>,
) -> Result<BackupInfo, AppError> {
    let config = state.config();
    let context = BackupContext::from_config(&config);

    state.log_app(app, LogLevel::Info, "Создание резервной копии мира…");
    let info = create_backup_archive(&context, now_ms(), label)?;

    let removed = prune_backups(&context.backups_dir, config.keep_backups);
    state.log_app(
        app,
        LogLevel::Info,
        format!(
            "Резервная копия создана: {} ({})",
            info.name,
            crate::process::steamcmd::human_bytes(info.size_bytes)
        ),
    );
    if !removed.is_empty() {
        state.log_app(
            app,
            LogLevel::Info,
            format!("Удалены старые резервные копии: {}", removed.join(", ")),
        );
    }

    Ok(info)
}

/// Lists backup archives of the current installation.
pub fn list_backups(state: &AppState) -> Vec<BackupInfo> {
    let context = BackupContext::from_config(&state.config());
    list_backups_in(&context)
}

/// Deletes a backup archive and logs the operation.
pub fn delete_backup(app: &AppHandle, state: &AppState, name: &str) -> Result<(), AppError> {
    let context = BackupContext::from_config(&state.config());
    delete_backup_file(&context, name)?;
    state.log_app(
        app,
        LogLevel::Info,
        format!("Резервная копия удалена: {name}"),
    );
    Ok(())
}

/// Restores a backup archive, optionally creating a safety backup first.
pub fn restore_backup(
    app: &AppHandle,
    state: &AppState,
    name: &str,
    create_safety_backup: bool,
) -> Result<(), AppError> {
    if state.server_is_active() {
        return Err(AppError::Process(
            "Остановите сервер Valheim перед восстановлением резервной копии".to_string(),
        ));
    }

    if create_safety_backup {
        create_backup(app, state, Some("before-restore"))?;
    }

    let context = BackupContext::from_config(&state.config());
    restore_backup_archive(&context, name)?;
    state.log_app(
        app,
        LogLevel::Info,
        format!(
            "Резервная копия восстановлена: {name}. Перезапустите сервер, чтобы загрузить мир."
        ),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::BasePaths;
    use std::io::Write;

    fn context() -> (tempfile::TempDir, BackupContext, AppConfig) {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = BasePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
            temp.path().join("data").join("logs"),
            temp.path().join("root"),
        );
        let config = AppConfig::defaults(&base);
        let context = BackupContext::from_config(&config);
        (temp, context, config)
    }

    fn write_world(context: &BackupContext, world: &str, payload: &[u8]) {
        let path = context.worlds_dir.join(world).join("_main.1.db2");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, payload).expect("write world");
    }

    #[test]
    fn backup_name_contains_timestamp_and_sanitized_label() {
        assert_eq!(
            backup_file_name(0, None),
            "valheim-backup-19700101-000000.zip"
        );
        assert_eq!(
            backup_file_name(0, Some("Before Update!")),
            "valheim-backup-19700101-000000-Before-Update.zip"
        );
        assert_eq!(
            backup_file_name(0, Some("   ")),
            "valheim-backup-19700101-000000.zip"
        );
    }

    #[test]
    fn label_sanitizer_is_ascii_and_bounded() {
        assert_eq!(
            sanitize_label("Hello World"),
            Some("Hello-World".to_string())
        );
        assert_eq!(sanitize_label("a--b"), Some("a-b".to_string()));
        assert_eq!(sanitize_label("***"), None);
        assert_eq!(sanitize_label(""), None);
        let long = "a".repeat(100);
        assert_eq!(sanitize_label(&long).expect("label").chars().count(), 32);
    }

    #[test]
    fn create_backup_zips_worlds_and_lists() {
        let (_temp, context, _config) = context();
        write_world(&context, "Midgard", b"world data");
        std::fs::write(context.save_dir.join("adminlist.txt"), "V_1\r\n").expect("write list");

        let info = create_backup_archive(&context, 1_700_000_000_000, Some("test"))
            .expect("backup created");

        assert_eq!(info.name, "valheim-backup-20231114-221320-test.zip");
        assert!(info.size_bytes > 0);
        assert_eq!(info.worlds, vec!["Midgard".to_string()]);
        assert!(context.backups_dir.join(&info.name).is_file());
        assert!(
            !context
                .backups_dir
                .join(format!("{}.part", info.name))
                .exists()
        );
    }

    #[test]
    fn create_backup_fails_without_worlds() {
        let (_temp, context, _config) = context();
        let error = create_backup_archive(&context, 0, None).expect_err("no worlds");
        assert_eq!(error.code(), "BACKUP_FAILED");
    }

    #[test]
    fn list_returns_worlds_and_skips_part_files() {
        let (_temp, context, _config) = context();
        write_world(&context, "Midgard", b"data");
        let info = create_backup_archive(&context, 1_700_000_000_000, None).expect("backup");
        std::fs::write(
            context.backups_dir.join("valheim-backup-x.zip.part"),
            b"partial",
        )
        .expect("write part");

        let backups = list_backups_in(&context);
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].name, info.name);
        assert_eq!(backups[0].worlds, vec!["Midgard".to_string()]);
        assert!(
            !context
                .backups_dir
                .join("valheim-backup-x.zip.part")
                .exists()
        );
    }

    #[test]
    fn restore_replaces_worlds_and_restores_lists() {
        let (_temp, context, _config) = context();
        write_world(&context, "Midgard", b"original");
        std::fs::write(context.save_dir.join("adminlist.txt"), "V_1\r\n").expect("write list");
        let info = create_backup_archive(&context, 1_700_000_000_000, None).expect("backup");

        // Damage the current state.
        write_world(&context, "Midgard", b"damaged");
        let extra_dir = context.worlds_dir.join("Extra");
        std::fs::create_dir_all(&extra_dir).expect("mkdir");
        std::fs::write(extra_dir.join("_main.1.db2"), b"x").expect("write");
        std::fs::write(context.save_dir.join("adminlist.txt"), "V_2\r\n").expect("write list");

        restore_backup_archive(&context, &info.name).expect("restore");

        let world_payload =
            std::fs::read_to_string(context.worlds_dir.join("Midgard").join("_main.1.db2"))
                .expect("read world");
        assert_eq!(world_payload, "original");
        assert!(!context.worlds_dir.join("Extra").exists());
        let adminlist =
            std::fs::read_to_string(context.save_dir.join("adminlist.txt")).expect("read");
        assert_eq!(adminlist, "V_1\r\n");
        // No staging leftovers.
        let leftovers: Vec<String> = std::fs::read_dir(&context.save_dir)
            .expect("read dir")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.starts_with(".restore-") || name.starts_with(".worlds-old-"))
            .collect();
        assert!(leftovers.is_empty(), "leftovers: {leftovers:?}");
    }

    #[test]
    fn restore_rejects_archives_without_worlds() {
        let (_temp, context, _config) = context();
        std::fs::create_dir_all(&context.backups_dir).expect("mkdir");
        let archive = context.backups_dir.join("empty.zip");
        let file = std::fs::File::create(&archive).expect("create zip");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("readme.txt", zip::write::SimpleFileOptions::default())
            .expect("entry");
        writer.write_all(b"nothing").expect("write");
        writer.finish().expect("finish");

        let error = restore_backup_archive(&context, "empty.zip").expect_err("not a world backup");
        assert_eq!(error.code(), "BACKUP_FAILED");
    }

    #[test]
    fn delete_removes_the_archive_only() {
        let (_temp, context, _config) = context();
        write_world(&context, "Midgard", b"data");
        let info = create_backup_archive(&context, 1_700_000_000_000, None).expect("backup");

        delete_backup_file(&context, &info.name).expect("delete");
        assert!(!context.backups_dir.join(&info.name).exists());
        assert!(context.worlds_dir.join("Midgard").is_dir());
    }

    #[test]
    fn resolve_rejects_path_traversal_and_foreign_files() {
        let (_temp, context, _config) = context();
        for name in [
            "../evil.zip",
            r"..\evil.zip",
            "sub/evil.zip",
            "evil.txt",
            "",
        ] {
            resolve_backup_path(&context.backups_dir, name).expect_err("rejected");
        }
        resolve_backup_path(&context.backups_dir, "missing.zip").expect_err("missing");
    }

    #[test]
    fn prune_keeps_the_newest_archives() {
        let (_temp, context, _config) = context();
        write_world(&context, "Midgard", b"data");
        std::fs::create_dir_all(&context.backups_dir).expect("mkdir");

        for index in 0..4 {
            std::fs::write(
                context
                    .backups_dir
                    .join(format!("valheim-backup-2026010{index}-000000.zip")),
                b"zip",
            )
            .expect("write");
            // Ensure distinct modification times for the prune order.
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        let removed = prune_backups(&context.backups_dir, 2);
        assert_eq!(removed.len(), 2);
        let remaining = archive_files(&context.backups_dir);
        assert_eq!(remaining.len(), 2);
        let names: Vec<String> = remaining
            .iter()
            .map(|(path, _)| {
                path.file_name()
                    .expect("name")
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert!(names.iter().any(|name| name.contains("20260103")));
        assert!(names.iter().any(|name| name.contains("20260102")));
        assert!(removed.iter().all(|name| !name.contains("20260103")));
    }

    #[test]
    fn world_names_are_extracted_from_archive_paths() {
        assert_eq!(
            world_name_from_archive_path("worlds_local/Midgard/_main.1.db2"),
            Some("Midgard".to_string())
        );
        assert_eq!(
            world_name_from_archive_path("worlds_local/OldWorld.fwl"),
            Some("OldWorld".to_string())
        );
        assert_eq!(
            world_name_from_archive_path("worlds_local/OldWorld.fwl.old"),
            Some("OldWorld".to_string())
        );
        assert_eq!(world_name_from_archive_path("adminlist.txt"), None);
        assert_eq!(
            world_name_from_archive_path("worlds_local/_main.1.fwl2"),
            None
        );
    }
}
