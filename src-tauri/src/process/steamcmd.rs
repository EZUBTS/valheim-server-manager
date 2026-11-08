//! SteamCMD integration: download/extract SteamCMD itself and update the
//! Valheim Dedicated Server (`appid 896660`, anonymous login).
//!
//! Facts from `docs/valheim-server-reference.md` §2:
//! - SteamCMD for Windows is a self-updating zip with `steamcmd.exe` in the root;
//! - update command: `+force_install_dir <dir> +login anonymous +app_update
//!   896660 [validate] +quit`;
//! - `validate` verifies files against Steam and never deletes user files;
//! - update only when the server is stopped.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::config::AppConfig;
use crate::error::AppError;
use crate::logs::{
    LogLevel, LogSource, classify_line, parse_steamcmd_phase, parse_steamcmd_progress,
};
use crate::process::hidden_command;
use crate::process::server::{SERVER_APP_ID, ensure_steam_appid};
use crate::state::{AppState, InstallPhase, InstallProgress};

/// Direct download URL for the Windows SteamCMD archive.
pub const STEAMCMD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

/// Name of the SteamCMD executable.
pub const STEAMCMD_EXE: &str = "steamcmd.exe";

/// State of the SteamCMD/server installation.
///
/// Matches `InstallStatus` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStatus {
    pub steamcmd_installed: bool,
    pub server_installed: bool,
    pub steamcmd_path: String,
    pub server_exe_path: String,
    pub install_dir: String,
    pub install_size_bytes: u64,
}

/// Computes the install status of SteamCMD and the dedicated server.
#[must_use]
pub fn install_status(config: &AppConfig) -> InstallStatus {
    let steamcmd_exe = config.steamcmd_exe_path();
    let server_exe = config.server_exe_path();
    let server_installed = server_exe.is_file();

    let install_size_bytes = if server_installed {
        directory_size(Path::new(&config.install_dir))
    } else {
        0
    };

    InstallStatus {
        steamcmd_installed: steamcmd_exe.is_file(),
        server_installed,
        steamcmd_path: steamcmd_exe.display().to_string(),
        server_exe_path: server_exe.display().to_string(),
        install_dir: config.install_dir.clone(),
        install_size_bytes,
    }
}

/// Recursively sums the size of regular files in a directory.
#[must_use]
pub fn directory_size(directory: &Path) -> u64 {
    walkdir::WalkDir::new(directory)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| entry.metadata().ok())
        .map(|metadata| metadata.len())
        .sum()
}

/// Builds the SteamCMD update arguments in the documented order.
#[must_use]
pub fn build_update_args(install_dir: &Path, validate: bool) -> Vec<String> {
    let mut args = vec![
        "+force_install_dir".to_string(),
        install_dir.display().to_string(),
        "+login".to_string(),
        "anonymous".to_string(),
        "+app_update".to_string(),
        SERVER_APP_ID.to_string(),
    ];

    if validate {
        args.push("validate".to_string());
    }

    args.push("+quit".to_string());
    args
}

/// Downloads SteamCMD and extracts it into the configured directory.
pub fn install_steamcmd(app: &AppHandle, state: &AppState) -> Result<InstallProgress, AppError> {
    let config = state.config();
    let steamcmd_dir = Path::new(&config.steamcmd_dir);
    std::fs::create_dir_all(steamcmd_dir)
        .map_err(|error| AppError::io("создание каталога SteamCMD", &error))?;

    state.log_app(
        app,
        LogLevel::Info,
        format!("Скачивание SteamCMD: {STEAMCMD_URL}"),
    );
    state.set_progress(
        app,
        InstallPhase::Downloading,
        "Скачивание SteamCMD…",
        Some(0),
    );

    let staging_dir = state.base().data_dir.join("tmp");
    std::fs::create_dir_all(&staging_dir)
        .map_err(|error| AppError::io("создание временного каталога", &error))?;
    let archive = steamcmd_archive_path(&staging_dir, crate::state::now_ms());
    let download_result = download_file(
        app,
        state,
        STEAMCMD_URL,
        &archive,
        InstallPhase::Downloading,
        "Скачивание SteamCMD",
    );

    let downloaded = match download_result {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = std::fs::remove_file(&archive);
            state.set_progress(app, InstallPhase::Error, error.to_string(), None);
            return Err(error);
        }
    };
    state.log_app(
        app,
        LogLevel::Info,
        format!("SteamCMD скачан ({downloaded} байт), распаковка…"),
    );

    state.set_progress(
        app,
        InstallPhase::Extracting,
        "Распаковка SteamCMD…",
        Some(0),
    );
    let extract_result = extract_zip(
        &archive,
        steamcmd_dir,
        Some(&mut |done, total| {
            let percent = progress_percent(done, total);
            state.set_progress(
                app,
                InstallPhase::Extracting,
                "Распаковка SteamCMD…",
                Some(percent),
            );
        }),
    );
    let _ = std::fs::remove_file(&archive);

    if let Err(error) = extract_result {
        state.set_progress(app, InstallPhase::Error, error.to_string(), None);
        return Err(error);
    }

    let steamcmd_exe = steamcmd_dir.join(STEAMCMD_EXE);
    if !steamcmd_exe.is_file() {
        let error = AppError::Process(format!(
            "в архиве SteamCMD не найден {STEAMCMD_EXE} — скачайте SteamCMD вручную"
        ));
        state.set_progress(app, InstallPhase::Error, error.to_string(), None);
        return Err(error);
    }

    state.log_app(
        app,
        LogLevel::Info,
        format!("SteamCMD установлен в {}", steamcmd_dir.display()),
    );
    state.set_progress(app, InstallPhase::Done, "SteamCMD установлен", Some(100));

    Ok(state.install_progress().clone())
}

/// Updates (or installs) the Valheim Dedicated Server via SteamCMD.
#[allow(clippy::too_many_lines)] // one linear sequence: checks, backup, SteamCMD, verification
pub fn update_server(
    app: &AppHandle,
    state: &AppState,
    validate: bool,
) -> Result<InstallProgress, AppError> {
    let config = state.config();

    if state.server_is_active() {
        return Err(AppError::Process(
            "Остановите сервер Valheim перед обновлением".to_string(),
        ));
    }

    let steamcmd_exe = config.steamcmd_exe_path();
    if !steamcmd_exe.is_file() {
        return Err(AppError::SteamcmdNotInstalled(format!(
            "не найден {} — сначала установите SteamCMD",
            steamcmd_exe.display()
        )));
    }

    let install_dir = Path::new(&config.install_dir);
    std::fs::create_dir_all(install_dir)
        .map_err(|error| AppError::io("создание каталога установки", &error))?;

    if config.auto_backup_before_update {
        match crate::backups::create_backup(app, state, Some("before-update")) {
            Ok(info) => state.log_app(
                app,
                LogLevel::Info,
                format!("Резервная копия перед обновлением: {}", info.name),
            ),
            Err(error) => state.log_app(
                app,
                LogLevel::Warn,
                format!("Не удалось создать резервную копию перед обновлением: {error}"),
            ),
        };
    }

    let args = build_update_args(install_dir, validate);
    let mode = if validate {
        "с проверкой файлов"
    } else {
        ""
    };
    state.log_app(
        app,
        LogLevel::Info,
        format!(
            "Запуск SteamCMD: app_update {SERVER_APP_ID} {mode} в {}",
            install_dir.display()
        ),
    );
    state.set_progress(
        app,
        InstallPhase::Updating,
        "Обновление Valheim Dedicated Server…",
        Some(0),
    );

    let mut command = hidden_command(&steamcmd_exe);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        AppError::Process(format!(
            "не удалось запустить {}: {error}",
            steamcmd_exe.display()
        ))
    })?;

    if let Some(stderr) = child.stderr.take() {
        let stderr_app = app.clone();
        std::thread::spawn(move || {
            let state = stderr_app.state::<AppState>();
            let _ = read_stream_lines(stderr, |line| {
                let level = classify_line(line);
                state.ingest(&stderr_app, LogSource::Steamcmd, level, line.to_string());
            });
        });
    }

    let mut failure_line: Option<String> = None;
    let mut reported_success = false;
    let mut last_phase = InstallPhase::Updating;

    if let Some(stdout) = child.stdout.take() {
        let result = read_stream_lines(stdout, |line| {
            let level = classify_line(line);
            state.ingest(app, LogSource::Steamcmd, level, line.to_string());

            if let Some(percent) = parse_steamcmd_progress(line) {
                let percent = percent_to_u32(percent);
                let phase = match parse_steamcmd_phase(line) {
                    Some(crate::logs::SteamcmdPhase::Verifying) => InstallPhase::Verifying,
                    _ => InstallPhase::Updating,
                };
                last_phase = phase;
                state.set_progress(app, phase, line.to_string(), Some(percent));
            } else if let Some(crate::logs::SteamcmdPhase::Verifying) = parse_steamcmd_phase(line) {
                if last_phase != InstallPhase::Verifying {
                    last_phase = InstallPhase::Verifying;
                    state.set_progress(
                        app,
                        InstallPhase::Verifying,
                        "Проверка файлов сервера…",
                        None,
                    );
                }
            }

            // SteamCMD for Windows often exits with code 7 after updating
            // itself, even when the requested app was updated successfully.
            // The stable success marker in the output is the source of truth.
            if let Some(crate::logs::SteamcmdPhase::Done) = parse_steamcmd_phase(line) {
                reported_success = true;
            }

            if crate::logs::is_steamcmd_failure(line) {
                failure_line = Some(line.to_string());
            }
        });

        if let Err(error) = result {
            state.log_app(
                app,
                LogLevel::Warn,
                format!("Ошибка чтения вывода SteamCMD: {error}"),
            );
        }
    }

    let status = child
        .wait()
        .map_err(|error| AppError::Process(format!("ошибка ожидания SteamCMD: {error}")))?;

    if !update_is_success(status.success(), reported_success, failure_line.is_some()) {
        let details = failure_line.unwrap_or_else(|| {
            format!(
                "код выхода {status} (SteamCMD иногда возвращает 7 после самообновления — повторите обновление)"
            )
        });
        let error = AppError::Process(format!(
            "SteamCMD не смог обновить сервер: {details}. Проверьте интернет и повторите обновление."
        ));
        state.log_app(app, LogLevel::Error, error.to_string());
        state.set_progress(app, InstallPhase::Error, error.to_string(), None);
        return Err(error);
    }

    if !status.success() {
        state.log_app(
            app,
            LogLevel::Info,
            format!(
                "SteamCMD завершился с кодом {status}, но подтвердил успешное обновление — это штатное поведение Windows-клиента."
            ),
        );
    }
    if let (true, Some(failure)) = (reported_success, failure_line.as_ref()) {
        state.log_app(
            app,
            LogLevel::Warn,
            format!(
                "SteamCMD сообщил об ошибке «{failure}», но затем завершил обновление успешно."
            ),
        );
    }

    ensure_steam_appid(install_dir)?;

    let server_exe = config.server_exe_path();
    if !server_exe.is_file() {
        let error = AppError::ServerNotInstalled(format!(
            "после обновления не найден {}",
            server_exe.display()
        ));
        state.log_app(app, LogLevel::Error, error.to_string());
        state.set_progress(app, InstallPhase::Error, error.to_string(), None);
        return Err(error);
    }

    state.log_app(
        app,
        LogLevel::Info,
        format!("Сервер обновлён: {}", server_exe.display()),
    );
    state.set_progress(
        app,
        InstallPhase::Done,
        "Valheim Dedicated Server обновлён",
        Some(100),
    );

    Ok(state.install_progress().clone())
}

/// Downloads a file with progress events, returning the number of bytes.
///
/// Shared by the SteamCMD installer and the server-mod installer.
pub(crate) fn download_file(
    app: &AppHandle,
    state: &AppState,
    url: &str,
    destination: &Path,
    phase: InstallPhase,
    label: &str,
) -> Result<u64, AppError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(900)))
        .build()
        .into();

    let mut response = agent
        .get(url)
        .call()
        .map_err(|error| AppError::Network(format!("не удалось скачать {url}: {error}")))?;
    let content_length = response.body_mut().content_length();

    let mut file = std::fs::File::create(destination)
        .map_err(|error| AppError::io("создание файла загрузки", &error))?;
    let mut reader = response.body_mut().as_reader();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_percent: Option<u32> = None;

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| AppError::Network(format!("ошибка чтения ответа: {error}")))?;
        if read == 0 {
            break;
        }

        file.write_all(&buffer[..read])
            .map_err(|error| AppError::io("запись скачанного файла", &error))?;
        downloaded = downloaded.saturating_add(u64::try_from(read).unwrap_or(u64::MAX));

        if let Some(total) = content_length.filter(|total| *total > 0) {
            let percent = progress_percent(downloaded, total);
            if last_percent != Some(percent) {
                last_percent = Some(percent);
                state.set_progress(
                    app,
                    phase,
                    format!("{label}: {percent}% из {}", human_bytes(total)),
                    Some(percent),
                );
            }
        }
    }

    file.flush()
        .map_err(|error| AppError::io("сохранение скачанного файла", &error))?;

    Ok(downloaded)
}

/// Progress percentage from a downloaded/total pair.
#[must_use]
pub fn progress_percent(done: u64, total: u64) -> u32 {
    if total == 0 {
        return 0;
    }
    let percent = done.saturating_mul(100).checked_div(total).unwrap_or(0);
    u32::try_from(percent.min(100)).unwrap_or(100)
}

/// Converts a SteamCMD percentage (`0.0..=100.0`) into the IPC `u32` value.
#[must_use]
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn percent_to_u32(percent: f32) -> u32 {
    percent.round().clamp(0.0, 100.0) as u32
}

/// Human-readable byte size used in status messages.
#[must_use]
#[allow(clippy::cast_precision_loss)] // byte sizes are far below f64 precision limits in practice
pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }

    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

/// Extracts a zip archive into `target`, rejecting unsafe entry paths.
pub fn extract_zip(
    archive: &Path,
    target: &Path,
    mut on_progress: Option<&mut dyn FnMut(u64, u64)>,
) -> Result<u64, AppError> {
    let file = std::fs::File::open(archive)
        .map_err(|error| AppError::io("открытие ZIP-архива", &error))?;
    let mut zip = zip::ZipArchive::new(file).map_err(AppError::from)?;
    let total = u64::try_from(zip.len()).unwrap_or(0);

    std::fs::create_dir_all(target)
        .map_err(|error| AppError::io("создание каталога распаковки", &error))?;

    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(AppError::from)?;
        let relative = match entry.enclosed_name() {
            Some(path) => path.clone(),
            None => {
                return Err(AppError::BackupFailed(format!(
                    "недопустимый путь в архиве: {}",
                    entry.name()
                )));
            }
        };
        let out_path = target.join(&relative);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|error| AppError::io("создание каталога из архива", &error))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| AppError::io("создание каталога из архива", &error))?;
            }
            let mut out_file = std::fs::File::create(&out_path)
                .map_err(|error| AppError::io("создание файла из архива", &error))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|error| AppError::io("распаковка файла", &error))?;
        }

        if let Some(callback) = on_progress.as_mut() {
            callback(u64::try_from(index).unwrap_or(0).saturating_add(1), total);
        }
    }

    Ok(total)
}

/// Reads a stream and calls `callback` for every line separated by `\n` or `\r`.
///
/// SteamCMD updates in-place progress lines separated by `\r`, so a plain
/// `BufRead::lines` would buffer them until the very end of the update.
pub fn read_stream_lines<R, F>(reader: R, mut callback: F) -> std::io::Result<()>
where
    R: Read,
    F: FnMut(&str),
{
    let mut reader = std::io::BufReader::new(reader);
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];

    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        pending.extend_from_slice(&chunk[..read]);

        let mut start = 0usize;
        for index in 0..pending.len() {
            if pending[index] == b'\n' || pending[index] == b'\r' {
                if index > start {
                    let line = String::from_utf8_lossy(&pending[start..index]).to_string();
                    callback(&line);
                }
                start = index + 1;
            }
        }
        if start > 0 {
            pending.drain(..start);
        }
    }

    if !pending.is_empty() {
        let line = String::from_utf8_lossy(&pending).to_string();
        callback(&line);
    }

    Ok(())
}

/// Absolute path of the downloaded SteamCMD archive for a timestamp.
#[must_use]
pub fn steamcmd_archive_path(staging_dir: &Path, epoch_ms: i64) -> PathBuf {
    staging_dir.join(format!("steamcmd-{epoch_ms}.zip"))
}

/// Decides whether a SteamCMD `app_update` run actually succeeded.
///
/// On Windows SteamCMD often exits with code 7 after updating itself even when
/// the requested app was updated successfully (observed with SteamCMD
/// 11.15.70.27: `Success! App '896660' fully installed.` followed by exit
/// code 7). The explicit success marker in the output is therefore the source
/// of truth; a failure line only makes the run fail when no success marker was
/// printed at all.
#[must_use]
fn update_is_success(exit_success: bool, reported_success: bool, failure_seen: bool) -> bool {
    reported_success || (exit_success && !failure_seen)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn walk_files(directory: &Path) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = walkdir::WalkDir::new(directory)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.path().to_path_buf())
            .collect();
        files.sort();
        files
    }

    #[test]
    fn update_arguments_follow_the_documented_order() {
        let install_dir = Path::new(r"D:\Servers\Valheim\server");
        assert_eq!(
            build_update_args(install_dir, true),
            vec![
                "+force_install_dir",
                r"D:\Servers\Valheim\server",
                "+login",
                "anonymous",
                "+app_update",
                "896660",
                "validate",
                "+quit",
            ]
        );

        let without_validate = build_update_args(install_dir, false);
        assert_eq!(without_validate[6], "+quit");
        assert_eq!(without_validate.len(), 7);
    }

    #[test]
    fn progress_percent_is_clamped() {
        assert_eq!(progress_percent(0, 100), 0);
        assert_eq!(progress_percent(50, 100), 50);
        assert_eq!(progress_percent(100, 100), 100);
        assert_eq!(progress_percent(200, 100), 100);
        assert_eq!(progress_percent(10, 0), 0);
    }

    #[test]
    fn human_bytes_formats_values() {
        assert_eq!(human_bytes(512), "512 Б");
        assert_eq!(human_bytes(1024), "1.0 КБ");
        assert_eq!(human_bytes(2 * 1024 * 1024), "2.0 МБ");
    }

    #[test]
    fn directory_size_sums_files_recursively() {
        let temp = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(temp.path().join("nested")).expect("mkdir");
        std::fs::write(temp.path().join("a.bin"), vec![0u8; 100]).expect("write");
        std::fs::write(temp.path().join("nested").join("b.bin"), vec![0u8; 250]).expect("write");

        assert_eq!(directory_size(temp.path()), 350);
        assert_eq!(directory_size(&temp.path().join("missing")), 0);
    }

    #[test]
    fn install_status_reports_missing_installation() {
        let config = AppConfig {
            install_dir: r"D:\test\missing-server".to_string(),
            steamcmd_dir: r"D:\test\missing-steamcmd".to_string(),
            ..AppConfig::default()
        };
        let status = install_status(&config);

        assert!(!status.steamcmd_installed);
        assert!(!status.server_installed);
        assert_eq!(status.install_size_bytes, 0);
        assert!(status.server_exe_path.ends_with("valheim_server.exe"));
        assert!(status.steamcmd_path.ends_with("steamcmd.exe"));
    }

    fn write_test_zip(path: &Path) {
        let file = std::fs::File::create(path).expect("create zip");
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("steamcmd.exe", options).expect("entry");
        writer.write_all(b"fake exe").expect("write");
        writer
            .start_file("package/readme.txt", options)
            .expect("entry");
        writer.write_all(b"hello").expect("write");
        writer.finish().expect("finish");
    }

    #[test]
    fn extract_zip_creates_the_file_tree() {
        let temp = tempfile::tempdir().expect("temp dir");
        let archive = temp.path().join("steamcmd.zip");
        write_test_zip(&archive);
        let target = temp.path().join("steamcmd");

        let entries = extract_zip(&archive, &target, None).expect("extract");
        assert_eq!(entries, 2);
        assert_eq!(
            std::fs::read_to_string(target.join("steamcmd.exe")).expect("read"),
            "fake exe"
        );
        assert_eq!(
            std::fs::read_to_string(target.join("package").join("readme.txt")).expect("read"),
            "hello"
        );
        assert_eq!(walk_files(&target).len(), 2);
    }

    #[test]
    fn extract_zip_rejects_path_traversal() {
        let temp = tempfile::tempdir().expect("temp dir");
        let archive = temp.path().join("evil.zip");
        let file = std::fs::File::create(&archive).expect("create zip");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("../escaped.txt", zip::write::SimpleFileOptions::default())
            .expect("entry");
        writer.write_all(b"evil").expect("write");
        writer.finish().expect("finish");

        let target = temp.path().join("out");
        let error = extract_zip(&archive, &target, None).expect_err("zip slip is rejected");
        assert_eq!(error.code(), "BACKUP_FAILED");
        assert!(!temp.path().join("escaped.txt").exists());
    }

    #[test]
    fn read_stream_lines_handles_cr_and_lf() {
        let input = b"first\rsecond\nthird\r\nfourth";
        let mut lines: Vec<String> = Vec::new();
        read_stream_lines(&input[..], |line| lines.push(line.to_string())).expect("read");

        assert_eq!(lines, vec!["first", "second", "third", "fourth"]);
    }

    #[test]
    fn steamcmd_archive_path_is_unique_per_timestamp() {
        let staging = Path::new(r"D:\tmp");
        assert_eq!(
            steamcmd_archive_path(staging, 1000),
            PathBuf::from(r"D:\tmp\steamcmd-1000.zip")
        );
    }

    #[test]
    fn update_is_success_accepts_exit_code_seven_after_success_marker() {
        // Real case (SteamCMD 11.15.70.27 on Windows): the app was updated and
        // SteamCMD printed the success marker, then exited with code 7 because
        // it had updated itself.
        assert!(update_is_success(false, true, false));
        // A failure line followed the success marker (transient retry): keep
        // the success outcome, the command logs the warning.
        assert!(update_is_success(false, true, true));
        // Normal successful run.
        assert!(update_is_success(true, false, false));
        // Exit code 0 but SteamCMD reported a fatal error.
        assert!(!update_is_success(true, false, true));
        // No success marker and a non-zero exit code.
        assert!(!update_is_success(false, false, false));
        assert!(!update_is_success(false, false, true));
    }
}
