//! Valheim dedicated server process: launch arguments, spawning, log capture,
//! the exit waiter and the stop sequence.
//!
//! Facts behind the implementation (see `docs/valheim-server-reference.md`):
//! - the executable is `<installDir>\valheim_server.exe`;
//! - the server is configured only through command line arguments;
//! - `-logfile` makes the server write a log file, which is tailed here;
//! - readiness is the `Game server connected` line, not the process existence;
//! - the server never reads stdin, so a graceful stop can only be a console
//!   control event; the manager tries `taskkill` without `/F` and falls back to
//!   `taskkill /F` after a timeout.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::config::{AppConfig, ServerSettings, WorldPreset};
use crate::error::AppError;
use crate::logs::LogLevel;
use crate::paths::server_log_file;
use crate::process::hidden_command;
use crate::state::{AppState, ServerPhase, ServerState, now_ms, poll_interval};

/// Steam app id of the dedicated server.
pub const SERVER_APP_ID: &str = "896660";

/// Steam app id of the client game.
///
/// The Windows build of the dedicated server uses this id in `steam_appid.txt`;
/// the wrong id breaks PlayFab (crossplay) authentication.
pub const CLIENT_APP_ID: &str = "892970";

/// How long the manager waits for the legacy `taskkill` graceful attempt
/// (used only when the Ctrl+C helper is unavailable).
pub const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(8);

/// How long the manager waits for the process to die after `taskkill /F`.
pub const FORCED_STOP_TIMEOUT: Duration = Duration::from_secs(10);

/// How long the console control event helper waits for the server to exit.
///
/// A big world may take seconds to save; the empirically verified graceful
/// shutdown on Valheim 1.0.21 takes 1–2 seconds.
pub const GRACEFUL_WAIT_SEC: u32 = 45;

/// Wait budget for the graceful stop when the application itself is closing.
pub const SHUTDOWN_GRACEFUL_WAIT_SEC: u32 = 2;

/// How long the manager waits for readiness (`Opened Steam server`) before it
/// logs a warning. Generating a new world takes ~20–40 s, big worlds longer.
pub const READY_TIMEOUT: Duration = Duration::from_secs(180);

/// PowerShell helper embedded into the binary and written next to the logs.
const STOP_GRACEFUL_HELPER: &str = include_str!("stop_graceful.ps1");

/// File name of the graceful-stop helper inside `<data>/helpers`.
const STOP_GRACEFUL_FILE: &str = "stop-graceful.ps1";

/// PowerShell executable used to run the helper.
#[cfg(windows)]
const POWERSHELL_EXE: &str = "powershell.exe";

/// Result of a console-control-event stop attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GracefulOutcome {
    /// Ctrl+C was sent and the process exited.
    Stopped,
    /// Ctrl+C was sent but the process is still running.
    StillRunning,
    /// The process no longer exists.
    NoProcess,
    /// The helper could not be prepared or run.
    Failed,
}

/// Everything needed to start the server process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    /// Absolute path of `valheim_server.exe`.
    pub program: PathBuf,
    /// Arguments in the fixed documented order.
    pub args: Vec<String>,
    /// Working directory of the process (the install directory).
    pub cwd: PathBuf,
    /// File passed to `-logfile`.
    pub log_file: PathBuf,
}

/// Builds the launch arguments in the fixed order defined by the contract.
///
/// Order: `-nographics -batchmode -name … -port … -world … -password …
/// -public 0|1 -savedir … -logfile …, [-crossplay], [-preset …] or
/// [-modifier key value]*, [-saveinterval …], extraArgs…`
#[must_use]
pub fn build_launch_args(
    settings: &ServerSettings,
    save_dir: &Path,
    log_file: &Path,
) -> Vec<String> {
    let mut args = vec!["-nographics".to_string(), "-batchmode".to_string()];

    args.extend(["-name".to_string(), settings.name.clone()]);
    args.extend(["-port".to_string(), settings.port.to_string()]);
    args.extend(["-world".to_string(), settings.world.clone()]);
    args.extend(["-password".to_string(), settings.password.clone()]);
    args.extend([
        "-public".to_string(),
        if settings.is_public { "1" } else { "0" }.to_string(),
    ]);
    args.extend(["-savedir".to_string(), save_dir.display().to_string()]);
    args.extend(["-logfile".to_string(), log_file.display().to_string()]);

    if settings.crossplay {
        args.push("-crossplay".to_string());
    }

    if settings.preset == WorldPreset::Custom {
        for (key, value) in settings.modifiers.pairs() {
            args.extend(["-modifier".to_string(), key.to_string(), value.to_string()]);
        }
    } else {
        args.extend(["-preset".to_string(), settings.preset.as_str().to_string()]);
    }

    for key in &settings.set_keys {
        args.extend(["-setkey".to_string(), key.clone()]);
    }

    if let Some(seconds) = settings.save_interval_sec {
        args.extend(["-saveinterval".to_string(), seconds.to_string()]);
    }

    args.extend(settings.extra_args.iter().cloned());
    args
}

/// Builds the complete launch plan for a configuration.
#[must_use]
pub fn build_launch_plan(config: &AppConfig, log_file: PathBuf) -> LaunchPlan {
    LaunchPlan {
        program: config.server_exe_path(),
        args: build_launch_args(&config.server, &config.save_dir_path(), &log_file),
        cwd: PathBuf::from(&config.install_dir),
        log_file,
    }
}

/// Ensures that `<installDir>\steam_appid.txt` contains the client app id.
///
/// Returns `true` when the file was created or rewritten. Valheim 1.0 uses the
/// value for PlayFab authentication, so a wrong value breaks crossplay.
pub fn ensure_steam_appid(install_dir: &Path) -> Result<bool, AppError> {
    let path = install_dir.join("steam_appid.txt");

    if let Ok(existing) = std::fs::read_to_string(&path) {
        if existing.trim() == CLIENT_APP_ID {
            return Ok(false);
        }
    }

    std::fs::write(&path, CLIENT_APP_ID)
        .map_err(|error| AppError::io("запись steam_appid.txt", &error))?;

    Ok(true)
}

/// Spawns the dedicated server and starts the background readers/waiter.
#[allow(clippy::too_many_lines)] // one linear sequence: validate, spawn, wire threads
pub fn spawn_server(app: &AppHandle, state: &AppState) -> Result<ServerState, AppError> {
    let config = state.config();
    config.validate().map_err(|error| match error {
        AppError::Validation(message) => AppError::Config(message),
        other => other,
    })?;

    let exe = config.server_exe_path();
    if !exe.is_file() {
        return Err(AppError::ServerNotInstalled(format!(
            "не найден {} — установите или обновите сервер",
            exe.display()
        )));
    }

    {
        let runtime = state.runtime();
        if runtime.phase.is_active() {
            return Err(AppError::AlreadyRunning);
        }
    }

    // Empirically (Valheim 1.0.21) the server binds only `port` (game, dual-stack
    // `::`) and `port + 1` (Steam query). `port + 2` is a firewall/port-forward
    // recommendation, not a bound socket, so it must not block the start.
    for offset in 0..2u16 {
        let Some(port) = config.server.port.checked_add(offset) else {
            break;
        };
        if !crate::network::is_udp_port_free(port) {
            return Err(AppError::PortInUse(format!(
                "UDP-порт {port} уже используется другой программой"
            )));
        }
    }

    std::fs::create_dir_all(config.save_dir_path())
        .map_err(|error| AppError::io("создание каталога сохранений", &error))?;
    let server_log_dir = state.base().logs_dir.join("server");
    std::fs::create_dir_all(&server_log_dir)
        .map_err(|error| AppError::io("создание каталога логов сервера", &error))?;
    if ensure_steam_appid(Path::new(&config.install_dir))? {
        state.log_app(
            app,
            LogLevel::Info,
            format!("Создан steam_appid.txt со значением {CLIENT_APP_ID}"),
        );
    }

    let started_at = now_ms();
    let log_file = server_log_file(&state.base().logs_dir, started_at);
    let plan = build_launch_plan(&config, log_file.clone());

    // Readiness depends on whether the world has to be generated: a fresh world
    // prints `Game server connected` long before it is playable.
    let world_existed =
        crate::worlds::world_exists(&config.worlds_dir_path(), &config.server.world);
    if !world_existed {
        state.log_app(
            app,
            LogLevel::Info,
            format!(
                "Мир «{}» не найден в savedir — Valheim создаст новый мир (генерация может занять до минуты).",
                config.server.world
            ),
        );
    }

    let mut command = hidden_command(&plan.program);
    command
        .args(&plan.args)
        .current_dir(&plan.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        AppError::Process(format!(
            "не удалось запустить {}: {error}",
            plan.program.display()
        ))
    })?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stop_flag = Arc::new(AtomicBool::new(false));

    {
        let mut runtime = state.runtime();
        runtime.phase = ServerPhase::Starting;
        runtime.pid = Some(pid);
        runtime.started_at = Some(started_at);
        runtime.world = Some(config.server.world.clone());
        runtime.port = Some(config.server.port);
        runtime.version = None;
        runtime.join_code = None;
        runtime.last_announced_join_code = None;
        runtime.players_online = Some(0);
        runtime.last_exit_code = None;
        runtime.last_error = None;
        runtime.world_existed = world_existed;
        runtime.world_generated = false;
        runtime.world_loaded = false;
        runtime.log_file = Some(log_file.clone());
        runtime.last_save_at = None;
        runtime.stop_requested_at = None;
        runtime.log_tail_stop = stop_flag.clone();
        runtime.child = Some(child);
    }

    if let Some(stdout) = stdout {
        spawn_output_reader(app.clone(), stdout);
    }
    if let Some(stderr) = stderr {
        spawn_output_reader(app.clone(), stderr);
    }
    spawn_log_tail(app.clone(), log_file, stop_flag);
    spawn_waiter(app.clone());
    spawn_readiness_watchdog(app.clone());

    state.log_app(
        app,
        LogLevel::Info,
        format!(
            "Запуск сервера: {} (порт {}, мир «{}»)",
            exe.display(),
            config.server.port,
            config.server.world
        ),
    );
    state.emit_state(app);

    if config.server.crossplay && !config.server.is_public {
        state.log_app(
            app,
            LogLevel::Warn,
            "Crossplay включён при -public 0: код приглашения может не публиковаться; для игры по коду включите публичный сервер.",
        );
    }
    if config.server.preset == WorldPreset::Custom {
        state.log_app(
            app,
            LogLevel::Info,
            "Пресет custom: применяются модификаторы combat/deathpenalty/resources/raids/portals.",
        );
    }

    Ok(state.state())
}

/// Stops the server: graceful attempt first, forced termination as a fallback.
pub fn stop_server(
    app: &AppHandle,
    state: &AppState,
    force: bool,
) -> Result<ServerState, AppError> {
    let (pid, phase) = {
        let runtime = state.runtime();
        (runtime.pid, runtime.phase)
    };

    if !phase.is_active() {
        return Err(AppError::NotRunning);
    }
    if phase == ServerPhase::Stopping {
        // Another stop is already in progress: wait until the waiter finalizes.
        wait_for_exit(state, FORCED_STOP_TIMEOUT + GRACEFUL_STOP_TIMEOUT);
        return Ok(state.state());
    }

    let stop_started = now_ms();
    {
        let mut runtime = state.runtime();
        runtime.phase = ServerPhase::Stopping;
        runtime.stop_requested_at = Some(stop_started);
    }
    state.log_app(app, LogLevel::Info, "Останавливаю сервер…");
    state.emit_state(app);

    if force {
        state.log_app(
            app,
            LogLevel::Warn,
            "Принудительная остановка сервера: прогресс с последнего сохранения может быть потерян.",
        );
    } else {
        let stopped = match pid {
            Some(pid) => match try_graceful_stop(app, state, pid, GRACEFUL_WAIT_SEC) {
                GracefulOutcome::Stopped => {
                    state.log_app(
                        app,
                        LogLevel::Info,
                        "Ctrl+C отправлен, сервер корректно завершается",
                    );
                    true
                }
                GracefulOutcome::NoProcess => {
                    state.log_app(app, LogLevel::Info, "Процесс сервера уже завершён");
                    true
                }
                GracefulOutcome::StillRunning => {
                    state.log_app(
                        app,
                        LogLevel::Warn,
                        format!(
                            "Сервер не завершился за {GRACEFUL_WAIT_SEC} с после Ctrl+C — принудительная остановка. Несохранённый прогресс может быть потерян."
                        ),
                    );
                    false
                }
                GracefulOutcome::Failed => {
                    state.log_app(
                        app,
                        LogLevel::Warn,
                        "Корректная остановка через консольное событие недоступна — пробую taskkill без /F.",
                    );
                    // A console application without a window loop usually
                    // ignores `WM_CLOSE`; the attempt is still harmless.
                    if let Err(error) = try_taskkill(pid, false) {
                        log::debug!(target: "valheim-server", "taskkill without /F failed: {error}");
                    }
                    wait_for_exit(state, GRACEFUL_STOP_TIMEOUT)
                }
            },
            None => wait_for_exit(state, Duration::from_secs(1)),
        };

        if stopped && wait_for_exit(state, Duration::from_secs(3)) {
            // The final `World save (5/5)` lines are written just before the
            // process exits; give the log tail a moment to ingest them before
            // reporting whether the world was saved.
            wait_for_stop_marker(state, stop_started, Duration::from_secs(2));
            report_stop_result(app, state, stop_started);
            return Ok(state.state());
        }
    }

    if let Some(pid) = pid {
        let _ = try_taskkill(pid, true);
    }
    {
        let mut runtime = state.runtime();
        if let Some(child) = runtime.child.as_mut() {
            let _ = child.kill();
        }
    }

    if !wait_for_exit(state, FORCED_STOP_TIMEOUT) {
        {
            let mut runtime = state.runtime();
            runtime.phase = ServerPhase::Error;
            runtime.last_error =
                Some("Не удалось подтвердить завершение процесса сервера".to_string());
        }
        state.log_app(
            app,
            LogLevel::Error,
            "Не удалось завершить процесс сервера — проверьте диспетчер задач.",
        );
        state.emit_state(app);
        return Err(AppError::Process(
            "не удалось завершить процесс сервера".to_string(),
        ));
    }

    report_stop_result(app, state, stop_started);
    Ok(state.state())
}

/// Stops a running server when the application is about to exit.
///
/// Called from the Tauri `RunEvent::ExitRequested` hook so no orphaned server
/// process is left behind. It must not block for long: the auto-backup gets a
/// short budget, then the process is forced down.
pub fn shutdown_blocking(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.server_is_active() {
        return;
    }

    state.log_app(
        app,
        LogLevel::Info,
        "Приложение закрывается — останавливаю сервер",
    );

    let config = state.config();
    if config.auto_backup_before_stop {
        let backup_app = app.clone();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let state = backup_app.state::<AppState>();
            let result = crate::backups::create_backup(&backup_app, &state, Some("before-exit"));
            let _ = sender.send(result.map(|info| info.name));
        });

        match receiver.recv_timeout(Duration::from_millis(1_500)) {
            Ok(Ok(name)) => state.log_app(
                app,
                LogLevel::Info,
                format!("Резервная копия перед выходом создана: {name}"),
            ),
            Ok(Err(error)) => state.log_app(
                app,
                LogLevel::Warn,
                format!("Не удалось создать резервную копию перед выходом: {error}"),
            ),
            Err(_) => state.log_app(
                app,
                LogLevel::Warn,
                "Резервная копия перед выходом не успела завершиться — продолжаю остановку",
            ),
        };
    }

    let pid = state.runtime().pid;
    let gracefully_stopped = match pid {
        Some(pid) => match try_graceful_stop(app, &state, pid, SHUTDOWN_GRACEFUL_WAIT_SEC) {
            GracefulOutcome::Stopped | GracefulOutcome::NoProcess => true,
            GracefulOutcome::StillRunning => {
                state.log_app(
                    app,
                    LogLevel::Warn,
                    "Сервер не завершился по Ctrl+C — принудительная остановка",
                );
                false
            }
            GracefulOutcome::Failed => {
                let _ = try_taskkill(pid, false);
                false
            }
        },
        None => true,
    };
    if gracefully_stopped && wait_for_exit(&state, Duration::from_millis(1_500)) {
        state.log_app(app, LogLevel::Info, "Сервер остановлен штатно");
        return;
    }

    if let Some(pid) = pid {
        let _ = try_taskkill(pid, true);
    }
    {
        let mut runtime = state.runtime();
        if let Some(child) = runtime.child.as_mut() {
            let _ = child.kill();
        }
    }
    if wait_for_exit(&state, Duration::from_millis(2_000)) {
        state.log_app(
            app,
            LogLevel::Warn,
            "Сервер остановлен принудительно при выходе приложения",
        );
    } else {
        state.log_app(
            app,
            LogLevel::Error,
            "Не удалось остановить сервер до выхода приложения",
        );
    }
}

/// Waits until the server is no longer active.
fn wait_for_exit(state: &AppState, budget: Duration) -> bool {
    let deadline = Instant::now() + budget;
    while Instant::now() < deadline {
        if !state.server_is_active() {
            return true;
        }
        std::thread::sleep(poll_interval());
    }
    !state.server_is_active()
}

/// Waits for the `World save` marker written right before process exit.
///
/// The tail thread and the exit waiter run independently; without this short
/// synchronization a fast graceful shutdown could be reported as "not saved"
/// even though the save lines are already in the log file.
fn wait_for_stop_marker(state: &AppState, stop_started: i64, budget: Duration) {
    let deadline = Instant::now() + budget;
    loop {
        let saved = {
            let runtime = state.runtime();
            runtime
                .last_save_at
                .is_some_and(|saved_at| saved_at >= stop_started)
        };
        if saved || Instant::now() >= deadline {
            return;
        }
        std::thread::sleep(poll_interval());
    }
}

/// Runs `taskkill` for a process id.
fn try_taskkill(pid: u32, force: bool) -> Result<(), String> {
    let mut command = hidden_command("taskkill");
    command.arg("/PID").arg(pid.to_string());
    if force {
        command.arg("/T").arg("/F");
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    match command.status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("taskkill завершился с кодом {status}")),
        Err(error) => Err(format!("не удалось запустить taskkill: {error}")),
    }
}

/// Path of the graceful-stop helper inside `<app data>/helpers`.
#[must_use]
pub fn graceful_helper_path(state: &AppState) -> PathBuf {
    state
        .base()
        .data_dir
        .join("helpers")
        .join(STOP_GRACEFUL_FILE)
}

/// Writes the embedded PowerShell helper to disk (refreshing an outdated copy).
fn ensure_graceful_helper(state: &AppState) -> Result<PathBuf, AppError> {
    let path = graceful_helper_path(state);
    let needs_write =
        std::fs::read_to_string(&path).map_or(true, |existing| existing != STOP_GRACEFUL_HELPER);

    if needs_write {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| AppError::io("создание каталога helpers", &error))?;
        }
        std::fs::write(&path, STOP_GRACEFUL_HELPER)
            .map_err(|error| AppError::io("запись helper-скрипта остановки", &error))?;
    }

    Ok(path)
}

/// Sends Ctrl+C to the server console through a separate PowerShell process.
///
/// The helper uses only Win32 console APIs (`AttachConsole` +
/// `GenerateConsoleCtrlEvent`) inside its own process, so the manager itself
/// needs no `unsafe` code and is never detached from its own console.
pub fn try_graceful_stop(
    app: &AppHandle,
    state: &AppState,
    pid: u32,
    wait_sec: u32,
) -> GracefulOutcome {
    let script = match ensure_graceful_helper(state) {
        Ok(path) => path,
        Err(error) => {
            state.log_app(
                app,
                LogLevel::Warn,
                format!("Не удалось подготовить helper остановки: {error}"),
            );
            return GracefulOutcome::Failed;
        }
    };

    let log_file = {
        let runtime = state.runtime();
        runtime.log_file.clone()
    };

    #[cfg(windows)]
    {
        let mut command = hidden_command(POWERSHELL_EXE);
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script)
            .args(["-ServerPid"])
            .arg(pid.to_string())
            .args(["-WaitSec"])
            .arg(wait_sec.to_string());
        if let Some(log_file) = &log_file {
            command.arg("-LogFile").arg(log_file);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        state.log_app(
            app,
            LogLevel::Info,
            format!("Отправляю Ctrl+C серверу (PID {pid}) через консольное событие…"),
        );

        match command.output() {
            Ok(output) => {
                for line in String::from_utf8_lossy(&output.stdout).lines() {
                    let line = line.trim();
                    if !line.is_empty() {
                        state.log_app(app, LogLevel::Debug, format!("stop-graceful: {line}"));
                    }
                }
                for line in String::from_utf8_lossy(&output.stderr).lines() {
                    let line = line.trim();
                    if !line.is_empty() {
                        state.log_app(
                            app,
                            LogLevel::Warn,
                            format!("stop-graceful (stderr): {line}"),
                        );
                    }
                }

                match output.status.code() {
                    Some(0) => GracefulOutcome::Stopped,
                    Some(2) => GracefulOutcome::StillRunning,
                    Some(3) => GracefulOutcome::NoProcess,
                    other => {
                        state.log_app(
                            app,
                            LogLevel::Warn,
                            format!(
                                "Helper остановки завершился с кодом {}",
                                other.map_or_else(
                                    || "неизвестно".to_string(),
                                    |code| code.to_string()
                                )
                            ),
                        );
                        GracefulOutcome::Failed
                    }
                }
            }
            Err(error) => {
                state.log_app(
                    app,
                    LogLevel::Warn,
                    format!("Не удалось запустить helper остановки: {error}"),
                );
                GracefulOutcome::Failed
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (app, pid, wait_sec, script, log_file);
        GracefulOutcome::Failed
    }
}

/// Warns once when the server has not reported readiness within
/// [`READY_TIMEOUT`] (a very big new world can take longer to generate).
fn spawn_readiness_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(READY_TIMEOUT);
        let state = app.state::<AppState>();

        let still_starting = {
            let runtime = state.runtime();
            runtime.phase == ServerPhase::Starting
        };

        if still_starting {
            state.log_app(
                &app,
                LogLevel::Warn,
                format!(
                    "Сервер не сообщил о готовности за {} с. У нового мира генерация может занимать дольше; при crossplay ждём регистрацию PlayFab и код приглашения — смотрите лог.",
                    READY_TIMEOUT.as_secs()
                ),
            );
        }
    });
}

/// Logs whether the stop was graceful and whether the world was saved.
fn report_stop_result(app: &AppHandle, state: &AppState, stop_started: i64) {
    let (last_save_at, exit_code, phase) = {
        let runtime = state.runtime();
        (runtime.last_save_at, runtime.last_exit_code, runtime.phase)
    };

    if phase == ServerPhase::Error {
        state.log_app(
            app,
            LogLevel::Error,
            "Сервер завершился с ошибкой — подробности в логе.",
        );
        return;
    }

    let exit = exit_code.map_or_else(|| "неизвестен".to_string(), |code| code.to_string());
    if last_save_at.is_some_and(|saved_at| saved_at >= stop_started) {
        state.log_app(
            app,
            LogLevel::Info,
            format!("Сервер остановлен, код выхода {exit}. Мир сохранён (строки World save/World saved в логе)."),
        );
    } else {
        state.log_app(
            app,
            LogLevel::Warn,
            format!(
                "Сервер остановлен, код выхода {exit}. Строки сохранения мира (World save/World saved) не появились — прогресс с последнего автосохранения мог быть потерян."
            ),
        );
    }
}

/// Reads captured stdout/stderr line by line and ingests every line.
fn spawn_output_reader<R>(app: AppHandle, reader: R)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let mut reader = std::io::BufReader::new(reader);
        let mut buffer = Vec::new();

        loop {
            buffer.clear();
            match read_until_newline(&mut reader, &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    while buffer
                        .last()
                        .is_some_and(|byte| *byte == b'\n' || *byte == b'\r')
                    {
                        buffer.pop();
                    }
                    if !buffer.is_empty() {
                        let line = String::from_utf8_lossy(&buffer).to_string();
                        state.ingest_server_line(&app, line);
                    }
                }
            }
        }
    });
}

/// Reads bytes until `\n` or EOF, returning the number of bytes read.
fn read_until_newline<R: std::io::BufRead>(
    reader: &mut R,
    buffer: &mut Vec<u8>,
) -> std::io::Result<usize> {
    reader.read_until(b'\n', buffer)
}

/// Tails the Valheim `-logfile` and ingests new lines.
fn spawn_log_tail(app: AppHandle, log_file: PathBuf, stop: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let mut tail: Option<LogTail> = None;
        let mut idle_after_stop = 0u8;

        loop {
            if tail.is_none() && log_file.is_file() {
                match LogTail::open(&log_file) {
                    Ok(opened) => tail = Some(opened),
                    Err(error) => {
                        log::warn!(target: "valheim-server", "Не удалось открыть лог сервера: {error}");
                        return;
                    }
                }
            }

            let mut got_lines = false;
            if let Some(tail) = tail.as_mut() {
                match tail.read_new_lines() {
                    Ok(lines) => {
                        got_lines = !lines.is_empty();
                        for line in lines {
                            state.ingest_server_line(&app, line);
                        }
                    }
                    Err(error) => {
                        log::warn!(target: "valheim-server", "Ошибка чтения лога сервера: {error}");
                        return;
                    }
                }

                if stop.load(Ordering::Relaxed) {
                    if let Some(pending) = tail.flush_pending() {
                        if !pending.trim().is_empty() {
                            state.ingest_server_line(&app, pending);
                            got_lines = true;
                        }
                    }
                }
            }

            if stop.load(Ordering::Relaxed) {
                if got_lines {
                    idle_after_stop = 0;
                } else {
                    idle_after_stop = idle_after_stop.saturating_add(1);
                    if idle_after_stop >= 3 {
                        break;
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

/// Polls the child process and finalizes the saved state when it exits.
fn spawn_waiter(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(poll_interval());
            let state = app.state::<AppState>();

            let outcome = {
                let mut runtime = state.runtime();
                let Some(child) = runtime.child.as_mut() else {
                    return;
                };
                match child.try_wait() {
                    Ok(Some(status)) => {
                        runtime.child = None;
                        runtime.pid = None;
                        Some(Ok(status.code()))
                    }
                    Ok(None) => None,
                    Err(error) => {
                        runtime.child = None;
                        runtime.pid = None;
                        Some(Err(error.to_string()))
                    }
                }
            };

            let Some(outcome) = outcome else {
                continue;
            };

            let (exit_code, wait_error) = match outcome {
                Ok(code) => (code, None),
                Err(error) => (None, Some(error)),
            };

            let (was_stopping, phase) = {
                let mut runtime = state.runtime();
                let was_stopping = runtime.stop_requested_at.is_some()
                    || matches!(runtime.phase, ServerPhase::Stopping | ServerPhase::Stopped);
                runtime.phase = if was_stopping {
                    ServerPhase::Stopped
                } else {
                    ServerPhase::Error
                };
                runtime.players_online = Some(0);
                runtime.last_exit_code = exit_code;
                runtime.log_tail_stop.store(true, Ordering::Relaxed);

                if !was_stopping && runtime.last_error.is_none() {
                    runtime.last_error = Some(match exit_code {
                        Some(code) => format!("Процесс завершился неожиданно (код выхода {code})"),
                        None => "Процесс завершился неожиданно".to_string(),
                    });
                }

                (was_stopping, runtime.phase)
            };

            let (level, message) = match (&wait_error, exit_code) {
                (Some(error), _) => (
                    LogLevel::Error,
                    format!("Ошибка ожидания процесса сервера: {error}"),
                ),
                (None, Some(code)) if was_stopping => (
                    LogLevel::Info,
                    format!("Процесс сервера завершён, код выхода {code}"),
                ),
                (None, Some(code)) => (
                    LogLevel::Error,
                    format!("Процесс сервера завершился неожиданно, код выхода {code}"),
                ),
                (None, None) => (LogLevel::Info, "Процесс сервера завершён".to_string()),
            };

            state.log_app(&app, level, message);
            if phase == ServerPhase::Error {
                let error = state.state().last_error;
                if let Some(error) = error {
                    state.log_app(&app, LogLevel::Error, error);
                }
            }
            state.emit_state(&app);
            return;
        }
    });
}

/// Incremental reader for a file that grows while the server writes it.
#[derive(Debug)]
pub struct LogTail {
    file: std::fs::File,
    pending: Vec<u8>,
}

impl LogTail {
    /// Opens a log file for reading from the beginning.
    pub fn open(path: &Path) -> Result<Self, AppError> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .open(path)
            .map_err(|error| AppError::io("открытие файла лога сервера", &error))?;
        Ok(Self {
            file,
            pending: Vec::new(),
        })
    }

    /// Reads all currently available bytes and returns complete lines.
    pub fn read_new_lines(&mut self) -> Result<Vec<String>, AppError> {
        let mut chunk = [0u8; 8192];
        loop {
            match self.file.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => self.pending.extend_from_slice(&chunk[..read]),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(error) => return Err(AppError::io("чтение файла лога сервера", &error)),
            }
        }

        let mut lines = Vec::new();
        while let Some(position) = self.pending.iter().position(|byte| *byte == b'\n') {
            let raw: Vec<u8> = self.pending.drain(..=position).collect();
            let mut line = String::from_utf8_lossy(&raw[..raw.len() - 1]).to_string();
            if line.ends_with('\r') {
                line.pop();
            }
            lines.push(line);
        }

        Ok(lines)
    }

    /// Returns an incomplete trailing line, if any, and clears the buffer.
    pub fn flush_pending(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            return None;
        }
        let raw = std::mem::take(&mut self.pending);
        Some(String::from_utf8_lossy(&raw).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use crate::paths::BasePaths;

    fn settings() -> ServerSettings {
        ServerSettings {
            name: "Valheim RU".to_string(),
            world: "Midgard".to_string(),
            port: 2456,
            password: "SuperSecret1".to_string(),
            is_public: true,
            crossplay: false,
            preset: WorldPreset::Normal,
            modifiers: crate::config::WorldModifiers::default(),
            set_keys: Vec::new(),
            save_interval_sec: Some(300),
            extra_args: Vec::new(),
        }
    }

    fn save_dir() -> PathBuf {
        PathBuf::from(r"D:\Servers\Valheim\server\savedir")
    }

    fn log_file() -> PathBuf {
        PathBuf::from(r"D:\Servers\Valheim\logs\server-1.log")
    }

    #[test]
    fn launch_arguments_have_the_fixed_order() {
        let args = build_launch_args(&settings(), &save_dir(), &log_file());

        assert_eq!(
            args,
            vec![
                "-nographics",
                "-batchmode",
                "-name",
                "Valheim RU",
                "-port",
                "2456",
                "-world",
                "Midgard",
                "-password",
                "SuperSecret1",
                "-public",
                "1",
                "-savedir",
                r"D:\Servers\Valheim\server\savedir",
                "-logfile",
                r"D:\Servers\Valheim\logs\server-1.log",
                "-preset",
                "normal",
                "-saveinterval",
                "300",
            ]
        );
    }

    #[test]
    fn launch_arguments_append_extra_args_last() {
        let mut settings = settings();
        settings.extra_args = vec!["-setkey".to_string(), "nobuildcost".to_string()];
        let args = build_launch_args(&settings, &save_dir(), &log_file());

        assert_eq!(args[args.len() - 2], "-setkey");
        assert_eq!(args[args.len() - 1], "nobuildcost");
        assert_eq!(args[args.len() - 4], "-saveinterval");
    }

    #[test]
    fn custom_preset_emits_modifiers_instead_of_preset() {
        let mut settings = settings();
        settings.preset = WorldPreset::Custom;
        settings.modifiers = crate::config::WorldModifiers {
            combat: crate::config::CombatLevel::Hard,
            death_penalty: crate::config::DeathPenalty::Casual,
            resources: crate::config::ResourcesAmount::More,
            raids: crate::config::RaidsFrequency::MuchLess,
            portals: crate::config::PortalsRule::Hard,
        };
        let args = build_launch_args(&settings, &save_dir(), &log_file());

        assert!(!args.iter().any(|argument| argument == "-preset"));
        let position = args
            .iter()
            .position(|argument| argument == "-modifier")
            .expect("modifiers are present");
        assert_eq!(
            &args[position..position + 3],
            ["-modifier", "combat", "hard"].map(String::from)
        );
        assert_eq!(
            args.iter()
                .filter(|argument| argument.as_str() == "-modifier")
                .count(),
            5
        );
    }

    #[test]
    fn set_keys_are_rendered_after_preset_and_before_saveinterval() {
        let mut settings = settings();
        // Exactly the four keys documented by the official 1.0.21 manual.
        settings.set_keys = crate::config::WORLD_SET_KEYS
            .iter()
            .map(|key| (*key).to_string())
            .collect();
        let args = build_launch_args(&settings, &save_dir(), &log_file());

        let preset = args
            .iter()
            .position(|argument| argument == "-preset")
            .expect("preset flag");
        let save_interval = args
            .iter()
            .position(|argument| argument == "-saveinterval")
            .expect("saveinterval flag");
        let set_key_positions: Vec<usize> = args
            .iter()
            .enumerate()
            .filter(|(_, argument)| argument.as_str() == "-setkey")
            .map(|(index, _)| index)
            .collect();

        assert_eq!(set_key_positions.len(), 4);
        assert!(set_key_positions[0] > preset);
        for window in set_key_positions.windows(2) {
            assert!(window[1] > window[0], "setkey order must be stable");
        }
        assert!(save_interval > set_key_positions[3]);
        for (position, expected) in set_key_positions.iter().zip(crate::config::WORLD_SET_KEYS) {
            assert_eq!(
                &args[*position..*position + 2],
                ["-setkey".to_string(), expected.to_string()]
            );
        }
    }

    #[test]
    fn custom_preset_renders_modifiers_then_set_keys() {
        let mut settings = settings();
        settings.preset = WorldPreset::Custom;
        settings.set_keys = vec!["passivemobs".to_string()];
        let args = build_launch_args(&settings, &save_dir(), &log_file());

        let last_modifier = args
            .iter()
            .rposition(|argument| argument == "-modifier")
            .expect("modifier flag");
        let set_key = args
            .iter()
            .position(|argument| argument == "-setkey")
            .expect("setkey flag");
        assert!(set_key > last_modifier);
        assert_eq!(args[set_key + 1], "passivemobs");
    }

    #[test]
    fn empty_set_keys_add_no_arguments() {
        let settings = settings();
        assert_eq!(settings.set_keys.len(), 0);
        let args = build_launch_args(&settings, &save_dir(), &log_file());
        assert!(!args.iter().any(|argument| argument == "-setkey"));
    }

    #[test]
    fn crossplay_and_private_flags_are_rendered_correctly() {
        let mut settings = settings();
        settings.crossplay = true;
        settings.is_public = false;
        settings.save_interval_sec = None;
        let args = build_launch_args(&settings, &save_dir(), &log_file());

        let public = args
            .iter()
            .position(|argument| argument == "-public")
            .expect("public flag");
        assert_eq!(args[public + 1], "0");

        let crossplay = args
            .iter()
            .position(|argument| argument == "-crossplay")
            .expect("crossplay flag");
        let preset = args
            .iter()
            .position(|argument| argument == "-preset")
            .expect("preset flag");
        assert!(crossplay < preset);
        assert!(!args.iter().any(|argument| argument == "-saveinterval"));
    }

    #[test]
    fn launch_plan_points_at_the_configured_directories() {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = BasePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
            temp.path().join("data").join("logs"),
            temp.path().join("root"),
        );
        let config = AppConfig::defaults(&base);
        let plan = build_launch_plan(&config, temp.path().join("server.log"));

        assert_eq!(plan.program, config.server_exe_path());
        assert_eq!(plan.cwd, Path::new(&config.install_dir));
        assert!(plan.args.windows(2).any(|pair| {
            pair[0] == "-savedir" && pair[1] == config.save_dir_path().display().to_string()
        }));
    }

    #[test]
    fn steam_appid_is_created_and_repaired() {
        let temp = tempfile::tempdir().expect("temp dir");
        let install_dir = temp.path();

        assert!(ensure_steam_appid(install_dir).expect("creates file"));
        assert_eq!(
            std::fs::read_to_string(install_dir.join("steam_appid.txt"))
                .expect("read")
                .trim(),
            CLIENT_APP_ID
        );

        // A correct file is left untouched.
        assert!(!ensure_steam_appid(install_dir).expect("checks file"));

        // A wrong id (the dedicated server appid is a common mistake) is fixed.
        std::fs::write(install_dir.join("steam_appid.txt"), "896660").expect("write");
        assert!(ensure_steam_appid(install_dir).expect("repairs file"));
        assert_eq!(
            std::fs::read_to_string(install_dir.join("steam_appid.txt"))
                .expect("read")
                .trim(),
            CLIENT_APP_ID
        );
    }

    #[test]
    fn log_tail_reads_complete_lines_and_keeps_partial_ones() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("server.log");
        std::fs::write(&path, "line1\nline2\r\npartial").expect("write");

        let mut tail = LogTail::open(&path).expect("open");
        assert_eq!(
            tail.read_new_lines().expect("read"),
            vec!["line1".to_string(), "line2".to_string()]
        );
        assert_eq!(tail.flush_pending(), Some("partial".to_string()));

        // The log keeps growing while the server writes it: the same tail must
        // pick up new lines without reopening the file.
        {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .expect("append");
            file.write_all(b"partial-after\nnext\n").expect("append");
        }
        let lines = tail.read_new_lines().expect("read more");
        assert_eq!(lines, vec!["partial-after".to_string(), "next".to_string()]);
    }

    #[test]
    fn log_tail_handles_utf8_and_crlf() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("server.log");
        std::fs::write(&path, "Привет, мир\r\nGame server connected\r\n").expect("write");

        let mut tail = LogTail::open(&path).expect("open");
        let lines = tail.read_new_lines().expect("read");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "Привет, мир");
    }
}
