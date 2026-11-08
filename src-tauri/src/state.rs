//! Shared application state and the event pipeline.
//!
//! [`AppState`] is managed by Tauri and shared by every command and by the
//! background threads that read process output and tail log files:
//! - `config` — the last loaded/saved [`AppConfig`];
//! - `runtime` — lifecycle of the dedicated server process;
//! - `logs` — bounded ring buffer streamed to the frontend;
//! - `install` — progress of SteamCMD download/update operations.
//!
//! All changes are pushed to the frontend through the three events declared in
//! `docs/ARCHITECTURE.md` §5.3.

use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::AppConfig;
use crate::error::AppError;
use crate::logs::{
    LogBuffer, LogEvent, LogLevel, LogLine, LogSource, classify_line, parse_server_line,
};
use crate::paths::{BasePaths, ResolvedPaths};

/// Event name for one log line.
pub const EVENT_SERVER_LOG: &str = "server-log";
/// Event name for the server state snapshot.
pub const EVENT_SERVER_STATE: &str = "server-state";
/// Event name for SteamCMD install/update progress.
pub const EVENT_INSTALL_PROGRESS: &str = "server-install-progress";
/// Event name emitted when the player lists change (optional contract event).
pub const EVENT_LISTS_CHANGED: &str = "server-lists-changed";

/// Current time in epoch milliseconds.
#[must_use]
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
        })
}

/// Lifecycle phase of the dedicated server process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerPhase {
    /// No process is running.
    Stopped,
    /// The process was spawned; it is loading the world.
    Starting,
    /// `Game server connected` was seen: players can join.
    Running,
    /// A graceful stop was requested.
    Stopping,
    /// The process exited unexpectedly or failed to start.
    Error,
}

impl ServerPhase {
    /// Returns `true` when a child process may exist.
    #[must_use]
    pub const fn is_active(self) -> bool {
        matches!(self, Self::Starting | Self::Running | Self::Stopping)
    }
}

/// Snapshot of the server process state delivered to the frontend.
///
/// Matches `ServerState` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    pub phase: ServerPhase,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
    pub uptime_sec: Option<u64>,
    pub world: Option<String>,
    pub port: Option<u16>,
    pub version: Option<String>,
    pub join_code: Option<String>,
    pub players_online: Option<u32>,
    pub last_exit_code: Option<i32>,
    pub last_error: Option<String>,
}

/// Phase of a SteamCMD download/update operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallPhase {
    /// Nothing is being installed.
    Idle,
    /// Downloading a zip archive (SteamCMD itself).
    Downloading,
    /// Extracting the downloaded archive.
    Extracting,
    /// SteamCMD is updating the dedicated server.
    Updating,
    /// SteamCMD is verifying existing files.
    Verifying,
    /// Operation finished successfully.
    Done,
    /// Operation failed.
    Error,
}

/// Progress of a SteamCMD download/update operation.
///
/// Matches `InstallProgress` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub phase: InstallPhase,
    pub message: String,
    pub percent: Option<u32>,
}

impl Default for InstallProgress {
    fn default() -> Self {
        Self {
            phase: InstallPhase::Idle,
            message: String::new(),
            percent: None,
        }
    }
}

/// Mutable lifecycle state of the dedicated server process.
#[derive(Debug)]
pub struct ServerRuntime {
    /// Current lifecycle phase.
    pub phase: ServerPhase,
    /// Process id while a child process is owned by the manager.
    pub pid: Option<u32>,
    /// Startup time in epoch milliseconds.
    pub started_at: Option<i64>,
    /// World reported by the server log.
    pub world: Option<String>,
    /// Port the server was started with.
    pub port: Option<u16>,
    /// Version reported by the server log.
    pub version: Option<String>,
    /// Crossplay join code reported by the server log.
    pub join_code: Option<String>,
    /// Join code that was already announced to the user in the app log.
    ///
    /// The server prints the same code in several lines (`registered with join
    /// code` and the `Session ... is active with ...` summary); the manager
    /// must announce it only once per run.
    pub last_announced_join_code: Option<String>,
    /// Number of players online, `None` when unknown.
    pub players_online: Option<u32>,
    /// Exit code of the last process, if it exited.
    pub last_exit_code: Option<i32>,
    /// Last error line or error message.
    pub last_error: Option<String>,
    /// Whether the world already existed on disk before the process was started.
    ///
    /// Used for readiness detection: a fresh world prints
    /// `Game server connected` before it is generated, so that line is only a
    /// readiness marker for a pre-existing world (crossplay servers never print
    /// `Opened Steam server`).
    pub world_existed: bool,
    /// `Loading: Generating locations` was seen during the current run.
    pub world_generated: bool,
    /// `ZNet.LoadWorld`/`Load world` was seen during the current run.
    pub world_loaded: bool,
    /// Child process while it is alive.
    pub child: Option<Child>,
    /// File the server writes its log to (`-logfile`).
    pub log_file: Option<PathBuf>,
    /// Time of the last `World saved` line, epoch milliseconds.
    pub last_save_at: Option<i64>,
    /// Time a stop was requested, epoch milliseconds.
    pub stop_requested_at: Option<i64>,
    /// Flag used to stop the log tail thread.
    pub log_tail_stop: Arc<AtomicBool>,
}

impl Default for ServerRuntime {
    fn default() -> Self {
        Self {
            phase: ServerPhase::Stopped,
            pid: None,
            started_at: None,
            world: None,
            port: None,
            version: None,
            join_code: None,
            last_announced_join_code: None,
            players_online: None,
            last_exit_code: None,
            last_error: None,
            world_existed: false,
            world_generated: false,
            world_loaded: false,
            child: None,
            log_file: None,
            last_save_at: None,
            stop_requested_at: None,
            log_tail_stop: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl ServerRuntime {
    /// Marks `code` as announced and returns `true` only the first time the
    /// current run sees that join code.
    fn take_join_code_announcement(&mut self, code: &str) -> bool {
        if self.last_announced_join_code.as_deref() == Some(code) {
            return false;
        }
        self.last_announced_join_code = Some(code.to_string());
        true
    }

    /// Builds the immutable snapshot sent to the frontend.
    #[must_use]
    pub fn snapshot(&self, now: i64) -> ServerState {
        let uptime_sec = if self.phase.is_active() {
            self.started_at
                .map(|started| u64::try_from((now - started).max(0) / 1000).unwrap_or(0))
        } else {
            None
        };

        ServerState {
            phase: self.phase,
            pid: self.pid,
            started_at: self.started_at,
            uptime_sec,
            world: self.world.clone(),
            port: self.port,
            version: self.version.clone(),
            join_code: self.join_code.clone(),
            players_online: self.players_online,
            last_exit_code: self.last_exit_code,
            last_error: self.last_error.clone(),
        }
    }
}

/// Applies a parsed log event to the runtime and reports whether the visible
/// state changed.
#[must_use]
pub fn apply_event(runtime: &mut ServerRuntime, event: &LogEvent, now: i64) -> bool {
    match event {
        LogEvent::Version(version) => {
            if runtime.version.as_deref() == Some(version.as_str()) {
                return false;
            }
            runtime.version = Some(version.clone());
            true
        }
        LogEvent::Ready => {
            if runtime.phase == ServerPhase::Starting {
                runtime.phase = ServerPhase::Running;
                true
            } else {
                false
            }
        }
        LogEvent::GameServerConnected => {
            // Non-crossplay servers print `Opened Steam server` shortly before
            // this line; crossplay servers never do (registration goes through
            // PlayFab). For a pre-existing world `Game server connected` after
            // `ZNet.LoadWorld` is therefore the readiness marker; for a freshly
            // generated world the same line appears ~20 s too early, and
            // `world_loaded` stays `false` in that case (no `ZNet.LoadWorld`).
            let ready = runtime.phase == ServerPhase::Starting
                && runtime.world_existed
                && runtime.world_loaded
                && !runtime.world_generated;
            if ready {
                runtime.phase = ServerPhase::Running;
                true
            } else {
                false
            }
        }
        LogEvent::WorldLoaded { world, .. } => {
            runtime.world_loaded = true;
            if runtime.world.as_deref() == Some(world.as_str()) {
                return false;
            }
            runtime.world = Some(world.clone());
            true
        }
        LogEvent::WorldSaved { .. } => {
            runtime.last_save_at = Some(now);
            false
        }
        LogEvent::WorldGenerating => {
            runtime.world_generated = true;
            false
        }
        LogEvent::WorldCreating(_) => {
            // `Get create world` is printed on every server start — including
            // when an existing world is loaded from disk (the actual generation
            // is signalled by `Loading: Generating locations`). Therefore this
            // marker must not claim that the world is new: the on-disk check in
            // `process::server` already sets `world_existed` correctly.
            runtime.world_loaded = false;
            false
        }
        LogEvent::PlayerJoined { .. } => {
            let players = runtime.players_online.unwrap_or(0).saturating_add(1);
            runtime.players_online = Some(players);
            true
        }
        LogEvent::PlayerLeft { .. } => {
            let players = runtime.players_online.unwrap_or(0).saturating_sub(1);
            runtime.players_online = Some(players);
            true
        }
        LogEvent::Session {
            join_code,
            players_online,
        } => {
            let code_changed = runtime.join_code.as_deref() != Some(join_code.as_str());
            let players_changed = runtime.players_online != Some(*players_online);
            runtime.join_code = Some(join_code.clone());
            runtime.players_online = Some(*players_online);
            // A published join code means the crossplay server finished its
            // registration and accepts players.
            let became_ready = runtime.phase == ServerPhase::Starting;
            if became_ready {
                runtime.phase = ServerPhase::Running;
            }
            code_changed || players_changed || became_ready
        }
        LogEvent::JoinCode(join_code) => {
            let code_changed = runtime.join_code.as_deref() != Some(join_code.as_str());
            runtime.join_code = Some(join_code.clone());
            let became_ready = runtime.phase == ServerPhase::Starting;
            if became_ready {
                runtime.phase = ServerPhase::Running;
            }
            code_changed || became_ready
        }
        LogEvent::BadPassword => {
            runtime.last_error =
                Some("Valheim отклонил пароль (\"bad password\"): пароль входит в имя сервера или слишком короткий".to_string());
            true
        }
        LogEvent::WorldLoadFailed => {
            runtime.last_error =
                Some("Не удалось загрузить мир (\"World load failed\")".to_string());
            true
        }
        LogEvent::PlayerConnected { .. }
        | LogEvent::ShutdownStarted
        | LogEvent::PresetApplied(_)
        | LogEvent::ModifierApplied { .. } => false,
    }
}

/// One managed log file written by the manager itself.
#[derive(Debug)]
struct ManagerLogFile {
    file: std::fs::File,
}

/// Shared state of the application, managed by Tauri.
#[derive(Debug)]
pub struct AppState {
    /// Fixed directories resolved once at startup.
    pub base: BasePaths,
    /// Current configuration.
    config: Mutex<AppConfig>,
    /// Lifecycle of the server process.
    runtime: Mutex<ServerRuntime>,
    /// Ring buffer of log lines.
    logs: LogBuffer,
    /// Progress of the current SteamCMD operation.
    install: Mutex<InstallProgress>,
    /// `true` while an install/update operation is running.
    install_busy: Mutex<bool>,
    /// Session log file for app/SteamCMD lines.
    manager_log: Mutex<Option<ManagerLogFile>>,
}

impl AppState {
    /// Creates the state and opens the per-session manager log file.
    #[must_use]
    pub fn new(base: BasePaths, config: AppConfig) -> Self {
        let state = Self {
            base,
            config: Mutex::new(config),
            runtime: Mutex::new(ServerRuntime::default()),
            logs: LogBuffer::default_capacity(),
            install: Mutex::new(InstallProgress::default()),
            install_busy: Mutex::new(false),
            manager_log: Mutex::new(None),
        };
        state.open_manager_log();
        state
    }

    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Opens `<logs>/manager-<stamp>.log` and writes a session header.
    fn open_manager_log(&self) {
        let result = (|| -> Result<ManagerLogFile, AppError> {
            std::fs::create_dir_all(&self.base.logs_dir)
                .map_err(|error| AppError::io("создание каталога логов", &error))?;
            let path = crate::paths::manager_log_file(&self.base.logs_dir, now_ms());
            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .map_err(|error| AppError::io("открытие файла лога менеджера", &error))?;
            Ok(ManagerLogFile { file })
        })();

        match result {
            Ok(manager_log) => {
                *Self::lock(&self.manager_log) = Some(manager_log);
            }
            Err(error) => {
                log::warn!(target: "valheim-server", "Файл лога менеджера недоступен: {error}");
            }
        }
    }

    /// Returns the fixed paths resolved at startup.
    #[must_use]
    pub fn base(&self) -> &BasePaths {
        &self.base
    }

    /// Returns the current configuration clone.
    #[must_use]
    pub fn config(&self) -> AppConfig {
        Self::lock(&self.config).clone()
    }

    /// Replaces the current configuration.
    pub fn set_config(&self, config: AppConfig) {
        *Self::lock(&self.config) = config;
    }

    /// Resolves all paths from the current configuration.
    #[must_use]
    pub fn resolved_paths(&self) -> ResolvedPaths {
        ResolvedPaths::resolve(&self.base, &self.config())
    }

    /// Returns a snapshot of the server state.
    #[must_use]
    pub fn state(&self) -> ServerState {
        Self::lock(&self.runtime).snapshot(now_ms())
    }

    /// Returns `true` when the manager owns a live server process.
    #[must_use]
    pub fn server_is_active(&self) -> bool {
        Self::lock(&self.runtime).phase.is_active()
    }

    /// Emits the current state to the frontend.
    pub fn emit_state(&self, app: &AppHandle) {
        let snapshot = self.state();
        if let Err(error) = app.emit(EVENT_SERVER_STATE, &snapshot) {
            log::warn!(target: "valheim-server", "Не удалось отправить server-state: {error}");
        }
    }

    /// Emits install progress to the frontend.
    pub fn emit_progress(&self, app: &AppHandle) {
        let progress = Self::lock(&self.install).clone();
        if let Err(error) = app.emit(EVENT_INSTALL_PROGRESS, &progress) {
            log::warn!(target: "valheim-server", "Не удалось отправить server-install-progress: {error}");
        }
    }

    /// Updates and emits install progress.
    pub fn set_progress(
        &self,
        app: &AppHandle,
        phase: InstallPhase,
        message: impl Into<String>,
        percent: Option<u32>,
    ) {
        *Self::lock(&self.install) = InstallProgress {
            phase,
            message: message.into(),
            percent,
        };
        self.emit_progress(app);
    }

    /// Marks an install/update operation as running.
    ///
    /// The returned guard resets the flag on drop, so every early return (or
    /// panic) releases it.
    pub fn begin_install(&self) -> Result<InstallSession<'_>, AppError> {
        {
            let mut busy = Self::lock(&self.install_busy);
            if *busy {
                return Err(AppError::Process(
                    "Операция установки уже выполняется, дождитесь её завершения".to_string(),
                ));
            }
            *busy = true;
        }
        Ok(InstallSession { state: self })
    }

    /// Appends a line to the ring buffer, emits it and updates the state.
    ///
    /// Server lines are deduplicated because the same text can arrive both
    /// from the `-logfile` tail and from the captured stdout/stderr pipes.
    pub fn ingest(
        &self,
        app: &AppHandle,
        source: LogSource,
        level: LogLevel,
        text: impl Into<String>,
    ) -> Option<LogLine> {
        let text = text.into();
        let ts = now_ms();

        let line = if source == LogSource::Server {
            self.logs.push_dedup(ts, source, level, text)?
        } else {
            self.logs.push(ts, source, level, text)
        };

        self.write_manager_log(&line);

        if let Err(error) = app.emit(EVENT_SERVER_LOG, &line) {
            log::warn!(target: "valheim-server", "Не удалось отправить server-log: {error}");
        }

        if source == LogSource::Server {
            self.apply_server_line(app, &line);
        }

        Some(line)
    }

    /// Ingests a raw server line, classifying its level automatically.
    pub fn ingest_server_line(&self, app: &AppHandle, text: impl Into<String>) -> Option<LogLine> {
        let text = text.into();
        let level = classify_line(&text);
        self.ingest(app, LogSource::Server, level, text)
    }

    /// Adds an application-level log line.
    pub fn log_app(
        &self,
        app: &AppHandle,
        level: LogLevel,
        text: impl Into<String>,
    ) -> Option<LogLine> {
        self.ingest(app, LogSource::App, level, text)
    }

    fn apply_server_line(&self, app: &AppHandle, line: &LogLine) {
        let events = parse_server_line(&line.line);
        if events.is_empty() {
            return;
        }

        let (changed, became_ready) = {
            let mut runtime = Self::lock(&self.runtime);
            let was_running = runtime.phase == ServerPhase::Running;
            let mut changed = false;
            for event in &events {
                changed |= apply_event(&mut runtime, event, line.ts);
            }
            (
                changed,
                !was_running && runtime.phase == ServerPhase::Running,
            )
        };

        if changed {
            self.emit_state(app);
        }

        for event in events {
            // Several readiness markers may arrive during one start
            // (`Opened Steam server`/`Opened PlayFab server`, then
            // `Loading: Done...`, then the crossplay join code line). The user
            // should see the readiness message only once.
            if matches!(event, LogEvent::Ready) && !became_ready {
                continue;
            }
            self.announce_event(app, event);
        }
    }

    /// Writes a human-readable application line for an important log event.
    fn announce_event(&self, app: &AppHandle, event: LogEvent) {
        match event {
            LogEvent::Ready => {
                self.log_app(app, LogLevel::Info, "Сервер готов принимать игроков");
            }
            LogEvent::GameServerConnected => {
                self.log_app(app, LogLevel::Debug, "Valheim: Game server connected");
            }
            LogEvent::ShutdownStarted => {
                self.log_app(
                    app,
                    LogLevel::Info,
                    "Valheim: получен сигнал завершения, сервер останавливается",
                );
            }
            LogEvent::WorldGenerating => {
                let world = self.config().server.world;
                self.log_app(
                    app,
                    LogLevel::Warn,
                    format!(
                        "Мир «{world}» не найден в savedir — Valheim создаёт новый мир. Проверьте имя мира в настройках."
                    ),
                );
            }
            LogEvent::WorldCreating(world) => {
                // Debug only: this marker appears on every start, existing or
                // new world, so it must not be phrased as "new world created".
                self.log_app(
                    app,
                    LogLevel::Debug,
                    format!("Valheim: загрузка мира «{world}»"),
                );
            }
            LogEvent::PresetApplied(preset) => {
                self.log_app(
                    app,
                    LogLevel::Info,
                    format!("Применён пресет сложности мира: {preset}"),
                );
            }
            LogEvent::ModifierApplied { key, value } => {
                self.log_app(
                    app,
                    LogLevel::Debug,
                    format!("Применён модификатор мира: {key} -> {value}"),
                );
            }
            LogEvent::WorldSaved { duration_ms } => {
                let suffix = duration_ms.map_or_else(String::new, |ms| format!(" ({ms} мс)"));
                self.log_app(app, LogLevel::Info, format!("Мир сохранён{suffix}"));
            }
            LogEvent::Session { join_code, .. } | LogEvent::JoinCode(join_code) => {
                let announce = {
                    let mut runtime = Self::lock(&self.runtime);
                    runtime.take_join_code_announcement(&join_code)
                };
                if announce {
                    self.log_app(
                        app,
                        LogLevel::Info,
                        format!("Код приглашения crossplay: {join_code}"),
                    );
                }
            }
            LogEvent::BadPassword => {
                self.log_app(
                    app,
                    LogLevel::Error,
                    "Valheim сообщил «Error bad password» и завершается. Пароль должен быть 5–20 символов и не входить в имя сервера.",
                );
            }
            LogEvent::WorldLoadFailed => {
                self.log_app(
                    app,
                    LogLevel::Error,
                    "Valheim не смог загрузить мир («World load failed»).",
                );
            }
            LogEvent::Version(_)
            | LogEvent::WorldLoaded { .. }
            | LogEvent::PlayerConnected { .. }
            | LogEvent::PlayerJoined { .. }
            | LogEvent::PlayerLeft { .. } => {}
        }
    }
    fn write_manager_log(&self, line: &LogLine) {
        use std::io::Write;

        if line.source == LogSource::Server {
            // The server already writes its own `-logfile`; do not duplicate it
            // in the manager session log.
            return;
        }

        let mut guard = Self::lock(&self.manager_log);
        if let Some(manager_log) = guard.as_mut() {
            let source = match line.source {
                LogSource::Server => "SERVER",
                LogSource::Steamcmd => "STEAMCMD",
                LogSource::App => "APP",
            };
            let level = match line.level {
                LogLevel::Debug => "DEBUG",
                LogLevel::Info => "INFO",
                LogLevel::Warn => "WARN",
                LogLevel::Error => "ERROR",
            };
            let _ = writeln!(
                manager_log.file,
                "{} {level:5} {source:8} {}",
                line.ts, line.line
            );
        }
    }

    /// Returns the last `limit` buffered lines (optionally filtered).
    #[must_use]
    pub fn get_logs(
        &self,
        limit: usize,
        source: Option<LogSource>,
        since_seq: Option<u64>,
    ) -> Vec<LogLine> {
        self.logs.get(limit, source, since_seq)
    }

    /// Clears the ring buffer (the log files are not touched).
    pub fn clear_logs(&self) {
        self.logs.clear();
    }

    /// Returns the runtime lock guard for process management.
    pub fn runtime(&self) -> MutexGuard<'_, ServerRuntime> {
        Self::lock(&self.runtime)
    }

    /// Returns the install progress guard.
    pub fn install_progress(&self) -> MutexGuard<'_, InstallProgress> {
        Self::lock(&self.install)
    }
}

/// RAII guard that releases the install lock on drop.
#[derive(Debug)]
pub struct InstallSession<'a> {
    state: &'a AppState,
}

impl Drop for InstallSession<'_> {
    fn drop(&mut self) {
        *AppState::lock(&self.state.install_busy) = false;
    }
}

/// Blocks the current thread for a short poll interval.
pub fn poll_interval() -> Duration {
    Duration::from_millis(150)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_serializes_in_camel_case_with_lowercase_phase() {
        let runtime = ServerRuntime::default();
        let snapshot = runtime.snapshot(now_ms());
        let payload = serde_json::to_value(&snapshot).expect("serializes");

        assert_eq!(payload["phase"], "stopped");
        assert!(payload.get("startedAt").is_some());
        assert!(payload.get("uptimeSec").is_some());
        assert!(payload.get("joinCode").is_some());
        assert!(payload.get("playersOnline").is_some());
        assert!(payload.get("lastExitCode").is_some());
        assert!(payload.get("started_at").is_none());
    }

    #[test]
    fn ready_event_moves_starting_to_running() {
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Starting,
            ..ServerRuntime::default()
        };

        // `Game server connected` is not readiness for a newly generated world.
        assert!(!apply_event(
            &mut runtime,
            &LogEvent::GameServerConnected,
            0
        ));
        assert_eq!(runtime.phase, ServerPhase::Starting);

        assert!(apply_event(&mut runtime, &LogEvent::Ready, 0));
        assert_eq!(runtime.phase, ServerPhase::Running);

        // A repeated ready line changes nothing.
        assert!(!apply_event(&mut runtime, &LogEvent::Ready, 0));
    }

    #[test]
    fn crossplay_existing_world_becomes_ready_on_game_server_connected() {
        // Crossplay servers never print `Opened Steam server`; for a world that
        // already exists, `Game server connected` after `ZNet.LoadWorld` is the
        // readiness marker.
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Starting,
            world_existed: true,
            ..ServerRuntime::default()
        };

        // `Game server connected` before the world is loaded is not enough.
        let _ = apply_event(&mut runtime, &LogEvent::GameServerConnected, 0);
        assert_eq!(runtime.phase, ServerPhase::Starting);

        let _ = apply_event(
            &mut runtime,
            &LogEvent::WorldLoaded {
                world: "Midgard".to_string(),
                save_number: Some(3),
            },
            0,
        );
        assert!(runtime.world_loaded);

        let _ = apply_event(&mut runtime, &LogEvent::GameServerConnected, 0);
        assert_eq!(runtime.phase, ServerPhase::Running);
    }

    #[test]
    fn crossplay_new_world_waits_for_the_join_code() {
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Starting,
            ..ServerRuntime::default()
        };

        // New world: `Game server connected` is printed before generation and
        // must not mark the server ready.
        let _ = apply_event(&mut runtime, &LogEvent::GameServerConnected, 0);
        assert_eq!(runtime.phase, ServerPhase::Starting);

        let _ = apply_event(&mut runtime, &LogEvent::WorldGenerating, 0);
        assert!(runtime.world_generated);
        let _ = apply_event(&mut runtime, &LogEvent::GameServerConnected, 0);
        assert_eq!(runtime.phase, ServerPhase::Starting);

        // Once the PlayFab registration publishes a join code, players can join.
        let _ = apply_event(&mut runtime, &LogEvent::JoinCode("483920".to_string()), 0);
        assert_eq!(runtime.phase, ServerPhase::Running);
        assert_eq!(runtime.join_code.as_deref(), Some("483920"));
    }

    #[test]
    fn crossplay_generated_world_becomes_ready_on_loading_done() {
        // Fallback for a new crossplay world: the join code may take long (or
        // never be captured), but `Loading: Done. Total seconds sinze ZNet
        // start:` is printed at the end of world generation in both Steam and
        // crossplay runs, so it must mark the server ready.
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Starting,
            ..ServerRuntime::default()
        };

        // Same-second ordering differs between runs: connected may come before
        // or after the generation marker; neither must mark the server ready.
        let _ = apply_event(&mut runtime, &LogEvent::GameServerConnected, 0);
        let _ = apply_event(&mut runtime, &LogEvent::WorldGenerating, 0);
        let _ = apply_event(&mut runtime, &LogEvent::GameServerConnected, 0);
        assert_eq!(runtime.phase, ServerPhase::Starting);

        assert!(apply_event(&mut runtime, &LogEvent::Ready, 0));
        assert_eq!(runtime.phase, ServerPhase::Running);
    }

    #[test]
    fn world_creating_event_keeps_the_existing_world_flag() {
        // `Get create world` is printed on every start (even when an existing
        // save is loaded), so it must not clear `world_existed`. The reset of
        // `world_loaded` still prevents `Game server connected` from marking
        // the server ready before `ZNet.LoadWorld`.
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Starting,
            world_existed: true,
            world_loaded: true,
            ..ServerRuntime::default()
        };

        let _ = apply_event(
            &mut runtime,
            &LogEvent::WorldCreating("Tankograd".to_string()),
            0,
        );
        assert!(runtime.world_existed);
        assert!(!runtime.world_loaded);

        let _ = apply_event(&mut runtime, &LogEvent::GameServerConnected, 0);
        assert_eq!(runtime.phase, ServerPhase::Starting);
    }

    #[test]
    fn existing_world_with_generation_is_not_ready_on_game_server_connected() {
        // A world directory may exist but be unreadable: the server then
        // generates a new world, so readiness must wait for a real marker.
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Starting,
            world_existed: true,
            ..ServerRuntime::default()
        };
        let _ = apply_event(
            &mut runtime,
            &LogEvent::WorldLoaded {
                world: "Midgard".to_string(),
                save_number: None,
            },
            0,
        );
        let _ = apply_event(&mut runtime, &LogEvent::WorldGenerating, 0);
        let _ = apply_event(&mut runtime, &LogEvent::GameServerConnected, 0);

        assert_eq!(runtime.phase, ServerPhase::Starting);
    }

    #[test]
    fn version_world_and_join_code_events_update_the_runtime() {
        let mut runtime = ServerRuntime::default();

        assert!(apply_event(
            &mut runtime,
            &LogEvent::Version("l-1.0.20".to_string()),
            0
        ));
        assert_eq!(runtime.version.as_deref(), Some("l-1.0.20"));
        assert!(!apply_event(
            &mut runtime,
            &LogEvent::Version("l-1.0.20".to_string()),
            0
        ));

        assert!(apply_event(
            &mut runtime,
            &LogEvent::WorldLoaded {
                world: "Midgard".to_string(),
                save_number: Some(7),
            },
            0
        ));
        assert_eq!(runtime.world.as_deref(), Some("Midgard"));

        assert!(apply_event(
            &mut runtime,
            &LogEvent::JoinCode("483920".to_string()),
            0
        ));
        assert_eq!(runtime.join_code.as_deref(), Some("483920"));
    }

    #[test]
    fn player_count_follows_joins_leaves_and_session_summaries() {
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Running,
            players_online: Some(0),
            ..ServerRuntime::default()
        };

        let _ = apply_event(
            &mut runtime,
            &LogEvent::PlayerJoined {
                name: "Sigrid".to_string(),
            },
            0,
        );
        let _ = apply_event(
            &mut runtime,
            &LogEvent::PlayerJoined {
                name: "Bjorn".to_string(),
            },
            0,
        );
        assert_eq!(runtime.players_online, Some(2));

        let _ = apply_event(
            &mut runtime,
            &LogEvent::PlayerLeft {
                id: "1".to_string(),
            },
            0,
        );
        assert_eq!(runtime.players_online, Some(1));

        let _ = apply_event(
            &mut runtime,
            &LogEvent::Session {
                join_code: "604510".to_string(),
                players_online: 4,
            },
            0,
        );
        assert_eq!(runtime.players_online, Some(4));
        assert_eq!(runtime.join_code.as_deref(), Some("604510"));
    }

    #[test]
    fn bad_password_is_reported_as_an_error() {
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Starting,
            ..ServerRuntime::default()
        };

        assert!(apply_event(&mut runtime, &LogEvent::BadPassword, 0));
        let error = runtime.last_error.expect("error is set");
        assert!(error.contains("bad password"));
    }

    #[test]
    fn world_saved_updates_the_timestamp_only() {
        let mut runtime = ServerRuntime::default();
        assert!(!apply_event(
            &mut runtime,
            &LogEvent::WorldSaved {
                duration_ms: Some(100),
            },
            1234
        ));
        assert_eq!(runtime.last_save_at, Some(1234));
    }

    #[test]
    fn snapshot_uptime_is_computed_only_for_active_phases() {
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Running,
            started_at: Some(1_000),
            ..ServerRuntime::default()
        };
        assert_eq!(runtime.snapshot(61_000).uptime_sec, Some(60));

        runtime.phase = ServerPhase::Stopped;
        assert_eq!(runtime.snapshot(61_000).uptime_sec, None);
    }

    #[test]
    fn join_code_is_announced_only_once_per_run() {
        let mut runtime = ServerRuntime::default();

        // Real 1.0.21 log prints the code twice: `registered with join code`
        // and the `Session ... is active with ...` summary.
        assert!(runtime.take_join_code_announcement("480362"));
        assert!(!runtime.take_join_code_announcement("480362"));

        // A new code (after a restart) is announced again...
        assert!(runtime.take_join_code_announcement("111111"));

        // ...and the start of a new run resets the announcement state.
        runtime.last_announced_join_code = None;
        assert!(runtime.take_join_code_announcement("480362"));
    }

    #[test]
    fn ready_event_transitions_to_running_only_once() {
        let mut runtime = ServerRuntime {
            phase: ServerPhase::Starting,
            ..ServerRuntime::default()
        };

        // First readiness marker moves the phase; later markers are no-ops,
        // so the user sees the "server is ready" message exactly once.
        assert!(apply_event(&mut runtime, &LogEvent::Ready, 1000));
        assert!(!apply_event(&mut runtime, &LogEvent::Ready, 2000));
        assert_eq!(runtime.phase, ServerPhase::Running);
    }

    #[test]
    fn install_progress_serializes_like_the_contract() {
        let progress = InstallProgress {
            phase: InstallPhase::Extracting,
            message: "Распаковка".to_string(),
            percent: Some(42),
        };
        let payload = serde_json::to_value(&progress).expect("serializes");

        assert_eq!(payload["phase"], "extracting");
        assert_eq!(payload["percent"], 42);
        assert_eq!(payload["message"], "Распаковка");
    }
}
