//! Log buffer, classification and parsers for Valheim/SteamCMD output.
//!
//! Every line shown in the UI goes through [`LogBuffer`]: a bounded ring buffer
//! (maximum [`LOG_BUFFER_CAPACITY`] lines) with a monotonic `seq`, which is
//! streamed to the frontend through the `server-log` event.
//!
//! Line formats and markers are documented in `docs/valheim-server-reference.md`
//! §7. The parsers here are deliberately tolerant: Valheim log formatting has
//! changed between versions, so every marker is matched with a substring or a
//! permissive regex.

use std::collections::VecDeque;
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Maximum number of lines kept in the ring buffer.
pub const LOG_BUFFER_CAPACITY: usize = 2000;

/// Time window (milliseconds) used to collapse duplicated lines coming from
/// both the `-logfile` tail and the captured stdout/stderr pipes.
pub const DEDUPE_WINDOW_MS: i64 = 3_000;

/// Length of a crossplay join code (exactly six digits).
pub const JOIN_CODE_DIGITS: usize = 6;

/// Source of a log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogSource {
    /// Valheim dedicated server.
    Server,
    /// SteamCMD download/update output.
    Steamcmd,
    /// Messages emitted by the manager itself.
    App,
}

/// Severity of a log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// One log line delivered to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    /// Monotonic sequence number (starts at 1).
    pub seq: u64,
    /// Time of the line, epoch milliseconds.
    pub ts: i64,
    /// Where the line came from.
    pub source: LogSource,
    /// Severity.
    pub level: LogLevel,
    /// The text itself (without a trailing newline).
    pub line: String,
}

/// A semantic event recognized in a Valheim server log line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogEvent {
    /// `Valheim version: 1.0.21 (network version 41)`.
    Version(String),
    /// `Opened Steam server` / `Loading: Done. Total seconds sinze ZNet start:`.
    ///
    /// This is the real readiness marker: `Game server connected` appears much
    /// earlier (especially for a brand new world that is still being generated).
    Ready,
    /// `Game server connected` — the process is connected but may still be
    /// generating/loading the world. Intermediate marker only.
    GameServerConnected,
    /// `ZNet.LoadWorld: MyWorld (MyWorld), save number 7`.
    WorldLoaded {
        world: String,
        save_number: Option<u32>,
    },
    /// `Loading: Generating locations` — a new world is being generated.
    WorldGenerating,
    /// `Get create world <name>` — the server starts loading/creating a world (printed for both existing and new worlds).
    ///
    /// Printed before `Loading: Generating locations`; used defensively so a
    /// stale world directory on disk can never be mistaken for a loaded world.
    WorldCreating(String),
    /// A completed save: `World saved ( 412.5ms )` or Valheim 1.0's
    /// `World save (5/5) done. Total time [35ms]`.
    WorldSaved { duration_ms: Option<u32> },
    /// `Got connection SteamID 76561198012345678`.
    PlayerConnected { id: String },
    /// `Got character ZDOID from Sigrid : 1234567890:1`.
    PlayerJoined { name: String },
    /// `Closing socket 76561198012345678`.
    PlayerLeft { id: String },
    /// `Session "Ravenhold" with join code 483920 and IP … is active with 3 players`.
    Session {
        join_code: String,
        players_online: u32,
    },
    /// `join code 483920` alone (without a session summary).
    JoinCode(String),
    /// `Setting world modifier preset: hard`.
    PresetApplied(String),
    /// `Setting world modifier: combat->hard` (Valheim 1.0 logs `->`, not `:`).
    ModifierApplied { key: String, value: String },
    /// A shutdown was requested / the server is quitting.
    ShutdownStarted,
    /// `Error bad password:` — the server exits immediately.
    BadPassword,
    /// `World load failed`.
    WorldLoadFailed,
}

/// Thread-safe bounded ring buffer of [`LogLine`]s.
#[derive(Debug)]
pub struct LogBuffer {
    capacity: usize,
    inner: Mutex<BufferState>,
}

#[derive(Debug)]
struct BufferState {
    lines: VecDeque<LogLine>,
    next_seq: u64,
}

impl LogBuffer {
    /// Creates a buffer with the given maximum number of lines.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            inner: Mutex::new(BufferState {
                lines: VecDeque::new(),
                next_seq: 1,
            }),
        }
    }

    /// Creates a buffer with the default capacity ([`LOG_BUFFER_CAPACITY`]).
    #[must_use]
    pub fn default_capacity() -> Self {
        Self::new(LOG_BUFFER_CAPACITY)
    }

    fn lock(&self) -> MutexGuard<'_, BufferState> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Appends a line, evicting the oldest one when the buffer is full.
    pub fn push(
        &self,
        ts: i64,
        source: LogSource,
        level: LogLevel,
        line: impl Into<String>,
    ) -> LogLine {
        let mut state = self.lock();
        Self::push_locked(&mut state, self.capacity, ts, source, level, line.into())
    }

    /// Appends a line unless an identical line from the same source arrived
    /// within [`DEDUPE_WINDOW_MS`].
    ///
    /// The server writes its log both to `-logfile` and to stdout when the
    /// pipes are captured, so the same line reaches us twice; this method keeps
    /// the buffer readable.
    pub fn push_dedup(
        &self,
        ts: i64,
        source: LogSource,
        level: LogLevel,
        line: impl Into<String>,
    ) -> Option<LogLine> {
        let line = line.into();
        let mut state = self.lock();

        let duplicate = state.lines.iter().rev().take(64).any(|existing| {
            existing.source == source
                && existing.line == line
                && (ts - existing.ts).abs() <= DEDUPE_WINDOW_MS
        });
        if duplicate {
            return None;
        }

        Some(Self::push_locked(
            &mut state,
            self.capacity,
            ts,
            source,
            level,
            line,
        ))
    }

    fn push_locked(
        state: &mut BufferState,
        capacity: usize,
        ts: i64,
        source: LogSource,
        level: LogLevel,
        line: String,
    ) -> LogLine {
        let seq = state.next_seq;
        state.next_seq = state.next_seq.saturating_add(1);

        let entry = LogLine {
            seq,
            ts,
            source,
            level,
            line,
        };

        state.lines.push_back(entry.clone());
        while state.lines.len() > capacity {
            state.lines.pop_front();
        }

        entry
    }

    /// Returns at most `limit` lines, newest last.
    ///
    /// * `source` filters by origin when set;
    /// * `since_seq` returns only lines with a bigger sequence number.
    #[must_use]
    pub fn get(
        &self,
        limit: usize,
        source: Option<LogSource>,
        since_seq: Option<u64>,
    ) -> Vec<LogLine> {
        let limit = limit.clamp(1, self.capacity);
        let state = self.lock();

        let mut lines: Vec<LogLine> = state
            .lines
            .iter()
            .filter(|line| source.is_none_or(|expected| line.source == expected))
            .filter(|line| since_seq.is_none_or(|seq| line.seq > seq))
            .cloned()
            .collect();

        if lines.len() > limit {
            lines.drain(..lines.len() - limit);
        }

        lines
    }

    /// Removes every buffered line. Sequence numbers keep increasing, so the
    /// frontend can still deduplicate correctly after a clear.
    pub fn clear(&self) {
        let mut state = self.lock();
        state.lines.clear();
    }

    /// Number of currently buffered lines.
    #[must_use]
    #[allow(dead_code)] // used by tests and by future UI counters
    pub fn len(&self) -> usize {
        self.lock().lines.len()
    }

    /// Returns `true` when the buffer is empty.
    #[must_use]
    #[allow(dead_code)] // used by tests
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Returns the newest buffered line, if any.
    #[must_use]
    #[allow(dead_code)] // used by tests and by future UI counters
    pub fn last(&self) -> Option<LogLine> {
        self.lock().lines.back().cloned()
    }
}

/// Marker-based severity classification for raw server/SteamCMD lines.
#[must_use]
pub fn classify_line(line: &str) -> LogLevel {
    let lower = line.to_lowercase();

    if ERROR_MARKERS.iter().any(|marker| lower.contains(marker)) {
        return LogLevel::Error;
    }
    if WARN_MARKERS.iter().any(|marker| lower.contains(marker)) {
        return LogLevel::Warn;
    }
    if DEBUG_MARKERS.iter().any(|marker| lower.contains(marker)) {
        // SteamCMD's `Update state (0x…)` lines are informational, not debug.
        if lower.contains("update state (0x") {
            return LogLevel::Info;
        }
        return LogLevel::Debug;
    }

    LogLevel::Info
}

const ERROR_MARKERS: [&str; 8] = [
    "error",
    "exception",
    "fatal",
    "crash",
    "failed",
    "failure",
    "unhandled",
    "denied",
];
const WARN_MARKERS: [&str; 12] = [
    "warning",
    " warn",
    "timeout",
    "timed out",
    "incompatible",
    "retry",
    "missing",
    "not found",
    "unable to",
    "deprecated",
    "could not",
    "bad password",
];
const DEBUG_MARKERS: [&str; 8] = [
    "zrpc",
    "network version",
    "player history",
    "localization",
    "platform",
    "steamappid",
    "debug",
    "update state (0x",
];

/// Parses a single Valheim server log line into semantic events.
///
/// Returns every event recognized in the line; most lines produce an empty
/// vector.
#[must_use]
pub fn parse_server_line(line: &str) -> Vec<LogEvent> {
    let mut events = Vec::new();

    if let Some(captures) = VERSION_RE.captures(line) {
        if let Some(version) = captures.get(1) {
            events.push(LogEvent::Version(version.as_str().trim().to_string()));
        }
    }

    if line.contains("Game server connected") {
        events.push(LogEvent::GameServerConnected);
    }

    if is_ready_line(line) {
        events.push(LogEvent::Ready);
    }

    if let Some(world) = parse_world_loaded(line) {
        events.push(LogEvent::WorldLoaded {
            world: world.0,
            save_number: world.1,
        });
    }

    if line.contains("Loading: Generating locations") {
        events.push(LogEvent::WorldGenerating);
    }

    if let Some(captures) = CREATE_WORLD_RE.captures(line) {
        if let Some(world) = captures.get(1) {
            events.push(LogEvent::WorldCreating(world.as_str().to_string()));
        }
    }

    if let Some(event) = parse_world_save(line) {
        events.push(event);
    }

    if let Some(captures) = CONNECTION_RE.captures(line) {
        if let Some(id) = captures.get(1) {
            events.push(LogEvent::PlayerConnected {
                id: id.as_str().trim().to_string(),
            });
        }
    }

    if let Some(captures) = JOINED_RE.captures(line) {
        if let Some(name) = captures.get(1) {
            events.push(LogEvent::PlayerJoined {
                name: name.as_str().trim().to_string(),
            });
        }
    }

    if let Some(captures) = SOCKET_CLOSED_RE.captures(line) {
        if let Some(id) = captures.get(1) {
            events.push(LogEvent::PlayerLeft {
                id: id.as_str().trim().to_string(),
            });
        }
    }

    let join_code = JOIN_CODE_RE
        .captures(line)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
        .filter(|value| value.len() == JOIN_CODE_DIGITS);
    let players_online = ACTIVE_PLAYERS_RE
        .captures(line)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<u32>().ok());

    match (join_code, players_online) {
        (Some(join_code), Some(players_online)) => {
            events.push(LogEvent::Session {
                join_code,
                players_online,
            });
        }
        (Some(join_code), None) => events.push(LogEvent::JoinCode(join_code)),
        _ => {}
    }

    if let Some(captures) = PRESET_RE.captures(line) {
        if let Some(preset) = captures.get(1) {
            events.push(LogEvent::PresetApplied(preset.as_str().trim().to_string()));
        }
    }

    if let Some(captures) = MODIFIER_RE.captures(line) {
        if let (Some(key), Some(value)) = (captures.get(1), captures.get(2)) {
            events.push(LogEvent::ModifierApplied {
                key: key.as_str().to_string(),
                value: value.as_str().to_string(),
            });
        }
    }

    if line.contains("Error bad password") {
        events.push(LogEvent::BadPassword);
    }
    if line.contains("World load failed") {
        events.push(LogEvent::WorldLoadFailed);
    }
    if line.contains("Game - OnApplicationQuit")
        || line.contains("Shutting down")
        || line.contains("ZNet Shutdown")
    {
        events.push(LogEvent::ShutdownStarted);
    }

    events
}

/// Returns `true` when the line proves the server can accept players.
///
/// Empirically verified on Valheim 1.0.21: for a **new** world
/// `Game server connected` appears ~20 seconds before `Opened Steam server`
/// (world generation is still running), so it cannot be the readiness marker.
/// `Registering lobby` is the last step before publishing the server; it is
/// accepted as an additional marker in case a build omits `Opened Steam server`.
fn is_ready_line(line: &str) -> bool {
    // `Opened PlayFab server` is the crossplay equivalent of
    // `Opened Steam server` (verified on Valheim 1.0.21).
    line.contains("Opened Steam server")
        || line.contains("Opened PlayFab server")
        || line.contains("Loading: Done. Total seconds")
        || line.contains("Registering lobby")
}

/// Parses both save completion formats.
///
/// * pre-1.0: `World saved ( 412.5ms )`;
/// * 1.0: `World save (5/5) done. Total time [35ms]` — only the final `N/N`
///   stage counts, earlier stages (`1/5`, `2/5`, …) are progress lines.
fn parse_world_save(line: &str) -> Option<LogEvent> {
    if line.contains("World saved") {
        let duration_ms = SAVE_DURATION_RE
            .captures(line)
            .and_then(|captures| captures.get(1))
            .and_then(|value| value.as_str().parse::<f64>().ok())
            .map(|value| {
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let rounded = value.round().max(0.0) as u32;
                rounded
            });
        return Some(LogEvent::WorldSaved { duration_ms });
    }

    let captures = SAVE_STEP_RE.captures(line)?;
    let current = captures.get(1)?.as_str().parse::<u32>().ok()?;
    let total = captures.get(2)?.as_str().parse::<u32>().ok()?;
    if current != total || total == 0 {
        return None;
    }

    let duration_ms = SAVE_TOTAL_MS_RE
        .captures(line)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<u32>().ok());

    Some(LogEvent::WorldSaved { duration_ms })
}

/// Extracts `(world, save_number)` from `Load world:` / `ZNet.LoadWorld:` lines.
fn parse_world_loaded(line: &str) -> Option<(String, Option<u32>)> {
    let rest = line
        .find("ZNet.LoadWorld:")
        .map(|index| &line[index + "ZNet.LoadWorld:".len()..])
        .or_else(|| {
            line.find("Load world:")
                .map(|index| &line[index + "Load world:".len()..])
        })?;

    let rest = rest.trim();
    if rest.is_empty() {
        return None;
    }

    // `MyWorld (MyWorld), save number 7` / `Dedicated (Dedicated)`.
    let name = rest
        .split('(')
        .next()
        .unwrap_or(rest)
        .trim()
        .trim_end_matches(',')
        .trim();
    if name.is_empty() {
        return None;
    }

    let save_number = SAVE_NUMBER_RE
        .captures(rest)
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse::<u32>().ok());

    Some((name.to_string(), save_number))
}

/// Parses the percentage out of a SteamCMD progress line.
///
/// SteamCMD prints lines like
/// `Update state (0x61) downloading, progress: 12.34 (1234 / 10000)`.
#[must_use]
pub fn parse_steamcmd_progress(line: &str) -> Option<f32> {
    let captures = STEAMCMD_PROGRESS_RE.captures(line)?;
    let value = captures.get(1)?.as_str().parse::<f32>().ok()?;
    Some(value.clamp(0.0, 100.0))
}

/// Phase reported by a SteamCMD line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SteamcmdPhase {
    /// Downloading files.
    Downloading,
    /// Verifying existing files (`validate`).
    Verifying,
    /// Preallocating disk space.
    Preallocating,
    /// Finished successfully.
    Done,
    /// Failed.
    Failed,
}

/// Recognizes the phase of a SteamCMD update line.
#[must_use]
pub fn parse_steamcmd_phase(line: &str) -> Option<SteamcmdPhase> {
    let lower = line.to_lowercase();

    if lower.starts_with("success!") && lower.contains("fully installed") {
        return Some(SteamcmdPhase::Done);
    }
    if lower.starts_with("error!") || lower.contains("state is 0x") {
        return Some(SteamcmdPhase::Failed);
    }
    if lower.contains("downloading") {
        return Some(SteamcmdPhase::Downloading);
    }
    if lower.contains("verifying") {
        return Some(SteamcmdPhase::Verifying);
    }
    if lower.contains("preallocating") {
        return Some(SteamcmdPhase::Preallocating);
    }

    None
}

/// Returns `true` for SteamCMD lines that report a fatal update error.
#[must_use]
pub fn is_steamcmd_failure(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.starts_with("error!")
        || lower.contains("failed to install")
        || lower.contains("state is 0x")
}

static VERSION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Valheim version:\s*(\S+)").expect("valid version regex"));
static SAVE_DURATION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"World saved\s*\(\s*([0-9]+(?:\.[0-9]+)?)").expect("valid save regex")
});
static CONNECTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Got connection SteamID\s+(\S+)").expect("valid connection regex")
});
static JOINED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Got character ZDOID from\s+(.+?)\s*:\s*[0-9]+:[0-9]+").expect("valid joined regex")
});
static SOCKET_CLOSED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Closing socket\s+(\S+)").expect("valid socket regex"));
// Join codes are exactly six digits. The line
// `New session server "…" that has join code , now 0 player(s)` has an empty
// code and must not produce an event (the real code appears a few seconds
// later in `Session "…" with join code 863039 …`). The regex captures any
// digit run and the length is validated in code, because the `regex` crate has
// no lookahead to reject longer numbers.
static JOIN_CODE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"join code\s+(\d+)").expect("valid join code regex"));
// Valheim 1.0 prints `is active with 0 player(s)`, older builds print
// `is active with 3 players`.
static ACTIVE_PLAYERS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"is active with\s+(\d+)\s+player(?:\(s\)|s)").expect("valid players regex")
});
static PRESET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Setting world modifier preset:\s*(\S+)").expect("valid preset regex")
});
static MODIFIER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Setting world modifier:\s*(\w+)\s*->\s*(\w+)").expect("valid modifier regex")
});
static CREATE_WORLD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Get create world\s+(\S+)").expect("valid create world regex"));
static SAVE_NUMBER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"save number\s+(\d+)").expect("valid save number regex"));
static SAVE_STEP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"World save \((\d+)\s*/\s*(\d+)\)").expect("valid save step regex")
});
static SAVE_TOTAL_MS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[(\d+)\s*ms\]").expect("valid save total regex"));
static STEAMCMD_PROGRESS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"progress:\s*([0-9]+(?:\.[0-9]+)?)").expect("valid progress regex")
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_is_bounded_and_sequence_is_monotonic() {
        let buffer = LogBuffer::new(3);
        for index in 0..5 {
            buffer.push(
                1_700_000_000_000 + index,
                LogSource::Server,
                LogLevel::Info,
                format!("line {index}"),
            );
        }

        assert_eq!(buffer.len(), 3);
        let lines = buffer.get(10, None, None);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].seq, 3);
        assert_eq!(lines[2].seq, 5);
        assert_eq!(lines[2].line, "line 4");
    }

    #[test]
    fn get_respects_limit_source_and_since_seq() {
        let buffer = LogBuffer::default_capacity();
        buffer.push(1, LogSource::Server, LogLevel::Info, "s1");
        buffer.push(2, LogSource::App, LogLevel::Warn, "a1");
        buffer.push(3, LogSource::Server, LogLevel::Error, "s2");

        let all = buffer.get(100, None, None);
        assert_eq!(all.len(), 3);

        let servers = buffer.get(100, Some(LogSource::Server), None);
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].line, "s1");

        let newer = buffer.get(100, None, Some(1));
        assert_eq!(newer.len(), 2);
        assert_eq!(newer[0].seq, 2);

        let limited = buffer.get(1, None, None);
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].seq, 3);
    }

    #[test]
    fn get_clamps_the_limit() {
        let buffer = LogBuffer::new(10);
        buffer.push(1, LogSource::App, LogLevel::Info, "x");
        assert_eq!(buffer.get(0, None, None).len(), 1);
        assert_eq!(buffer.get(usize::MAX, None, None).len(), 1);
    }

    #[test]
    fn clear_keeps_the_last_seq_growing() {
        let buffer = LogBuffer::default_capacity();
        buffer.push(1, LogSource::App, LogLevel::Info, "first");
        buffer.clear();
        assert!(buffer.is_empty());

        let second = buffer.push(2, LogSource::App, LogLevel::Info, "second");
        assert_eq!(second.seq, 2);
    }

    #[test]
    fn dedupe_collapses_repeated_lines_within_the_window() {
        let buffer = LogBuffer::default_capacity();
        assert!(
            buffer
                .push_dedup(1000, LogSource::Server, LogLevel::Info, "same")
                .is_some()
        );
        assert!(
            buffer
                .push_dedup(1500, LogSource::Server, LogLevel::Info, "same")
                .is_none()
        );
        assert!(
            buffer
                .push_dedup(5000, LogSource::Server, LogLevel::Info, "same")
                .is_some()
        );
        assert_eq!(buffer.len(), 2);
    }

    #[test]
    fn dedupe_ignores_other_sources() {
        let buffer = LogBuffer::default_capacity();
        buffer.push_dedup(1000, LogSource::Server, LogLevel::Info, "same");
        assert!(
            buffer
                .push_dedup(1000, LogSource::Steamcmd, LogLevel::Info, "same")
                .is_some()
        );
    }

    #[test]
    fn classifies_error_warn_debug_and_info_lines() {
        assert_eq!(
            classify_line("Error! App '896660' state is 0x6 after update job."),
            LogLevel::Error
        );
        assert_eq!(
            classify_line("[Error  : Unity Log] Exception: boom"),
            LogLevel::Error
        );
        assert_eq!(
            classify_line("Warning: could not create a window"),
            LogLevel::Warn
        );
        assert_eq!(
            classify_line("Loading: Generating locations"),
            LogLevel::Info
        );
        assert_eq!(
            classify_line("Network version check, their:40, mine:41"),
            LogLevel::Debug
        );
        assert_eq!(
            classify_line("Update state (0x61) downloading, progress: 12.34"),
            LogLevel::Info
        );
        assert_eq!(classify_line("Game server connected"), LogLevel::Info);
    }

    #[test]
    fn parses_version_line() {
        // Real line from Valheim 1.0.21 (the timestamp prefix is part of the file).
        let events =
            parse_server_line("11/08/2026 20:17:10: Valheim version: 1.0.21 (network version 41)");
        assert_eq!(events, vec![LogEvent::Version("1.0.21".to_string())]);

        let events = parse_server_line("Valheim version: l-1.0.20 (network version 41)");
        assert_eq!(events, vec![LogEvent::Version("l-1.0.20".to_string())]);
    }

    #[test]
    fn parses_readiness_and_world_loading() {
        // `Game server connected` is an intermediate marker, not readiness: for a
        // new world it appears before the world generation finishes.
        assert_eq!(
            parse_server_line("11/08/2026 20:15:48: Game server connected"),
            vec![LogEvent::GameServerConnected]
        );
        assert!(
            parse_server_line("11/08/2026 20:15:48: Game server connected")
                .iter()
                .all(|event| *event != LogEvent::Ready)
        );

        assert_eq!(
            parse_server_line("11/08/2026 20:16:07: Opened Steam server"),
            vec![LogEvent::Ready]
        );
        assert_eq!(
            parse_server_line("11/08/2026 20:16:07: Registering lobby"),
            vec![LogEvent::Ready]
        );
        assert_eq!(
            parse_server_line(
                "11/08/2026 20:16:07: Loading: Done. Total seconds sinze ZNet start: 22,3779577, Genloc duration: 18569,4475 ms"
            ),
            vec![LogEvent::Ready]
        );
        // An early unrelated "Loading: Done" line must not be treated as ready.
        assert!(
            !parse_server_line("11/08/2026 20:15:41: Loading: Done, Total time: -4,2953069")
                .contains(&LogEvent::Ready)
        );

        let events = parse_server_line(
            "11/08/2026 20:17:13: ZNet.LoadWorld: TestWorld (TestWorld), save number 1",
        );
        assert_eq!(
            events,
            vec![LogEvent::WorldLoaded {
                world: "TestWorld".to_string(),
                save_number: Some(1),
            }]
        );

        let events = parse_server_line("Load world: Dedicated (Dedicated)");
        assert_eq!(
            events,
            vec![LogEvent::WorldLoaded {
                world: "Dedicated".to_string(),
                save_number: None,
            }]
        );
    }

    #[test]
    fn parses_world_generation_and_saves() {
        assert_eq!(
            parse_server_line("11/08/2026 20:15:48: Loading: Generating locations"),
            vec![LogEvent::WorldGenerating]
        );
        // Printed before generation starts; a fresh world has no ZNet.LoadWorld.
        assert_eq!(
            parse_server_line("11/08/2026 20:35:38: Get create world OpsCrossplayNew"),
            vec![LogEvent::WorldCreating("OpsCrossplayNew".to_string())]
        );
        assert_eq!(
            parse_server_line("World saved ( 412.5ms )"),
            vec![LogEvent::WorldSaved {
                duration_ms: Some(413),
            }]
        );
        assert_eq!(
            parse_server_line("World saved"),
            vec![LogEvent::WorldSaved { duration_ms: None }]
        );

        // Valheim 1.0 save sequence: only the final `5/5` line is a completed save.
        for stage in [
            "World save (1/5) Cloud & Backup checks done [0ms] => Save number 1",
            "World save (2/5) Chunks writing done [11ms]",
            "World save (4/5) FWL writing done [2ms]",
        ] {
            assert!(
                !parse_server_line(stage)
                    .iter()
                    .any(|event| matches!(event, LogEvent::WorldSaved { .. })),
                "stage must not complete the save: {stage}"
            );
        }
        assert_eq!(
            parse_server_line("World save (5/5) done. Total time [35ms]"),
            vec![LogEvent::WorldSaved {
                duration_ms: Some(35),
            }]
        );
    }

    #[test]
    fn parses_player_connections_and_disconnections() {
        assert_eq!(
            parse_server_line("Got connection SteamID 76561198012345678"),
            vec![LogEvent::PlayerConnected {
                id: "76561198012345678".to_string(),
            }]
        );
        assert_eq!(
            parse_server_line("Got character ZDOID from Sigrid : 1234567890:1"),
            vec![LogEvent::PlayerJoined {
                name: "Sigrid".to_string(),
            }]
        );
        assert_eq!(
            parse_server_line("Closing socket 76561198012345678"),
            vec![LogEvent::PlayerLeft {
                id: "76561198012345678".to_string(),
            }]
        );
    }

    #[test]
    fn parses_join_code_and_session_lines() {
        let session = r#"Session "Ravenhold" with join code 483920 and IP 203.0.113.10:2456 is active with 3 players"#;
        assert_eq!(
            parse_server_line(session),
            vec![LogEvent::Session {
                join_code: "483920".to_string(),
                players_online: 3,
            }]
        );

        assert_eq!(
            parse_server_line("registered with join code 604510"),
            vec![LogEvent::JoinCode("604510".to_string())]
        );
    }

    #[test]
    fn parses_real_crossplay_join_code_lines() {
        // Trap line: the join code is empty here, it is not a real code yet.
        let trap = r#"New session server "OpsCrossplayTest" that has join code , now 0 player(s)"#;
        assert_eq!(parse_server_line(trap), Vec::<LogEvent>::new());

        assert_eq!(
            parse_server_line(r#"Session "OpsCrossplayTest" registered with join code 863039"#),
            vec![LogEvent::JoinCode("863039".to_string())]
        );

        // Real 1.0.21 session line: `player(s)` (not `players`) plus the public IP.
        let active = r#"Session "OpsCrossplayTest" with join code 863039 and IP 203.0.113.10:2466 is active with 0 player(s)"#;
        assert_eq!(
            parse_server_line(active),
            vec![LogEvent::Session {
                join_code: "863039".to_string(),
                players_online: 0,
            }]
        );

        // `Opened PlayFab server` is the crossplay readiness marker.
        assert_eq!(
            parse_server_line("11/08/2026 20:37:14: Opened PlayFab server"),
            vec![LogEvent::Ready]
        );
        // PlayFab login requests are not readiness.
        assert!(
            !parse_server_line("11/08/2026 20:37:14: Sending PlayFab login request (attempt 2)")
                .contains(&LogEvent::Ready)
        );
        // Codes shorter/longer than six digits are not accepted.
        assert_eq!(parse_server_line("join code 12345"), Vec::<LogEvent>::new());
        assert_eq!(
            parse_server_line("join code 1234567"),
            Vec::<LogEvent>::new()
        );
    }

    #[test]
    fn parses_preset_errors_and_world_failures() {
        assert_eq!(
            parse_server_line("Setting world modifier preset: hard"),
            vec![LogEvent::PresetApplied("hard".to_string())]
        );
        assert_eq!(
            parse_server_line("Setting world modifier: combat->hard"),
            vec![LogEvent::ModifierApplied {
                key: "combat".to_string(),
                value: "hard".to_string(),
            }]
        );
        assert_eq!(
            parse_server_line("Error bad password:"),
            vec![LogEvent::BadPassword]
        );
        assert_eq!(
            parse_server_line("World load failed mid-file"),
            vec![LogEvent::WorldLoadFailed]
        );
        // Graceful shutdown markers verified on Valheim 1.0.21.
        assert_eq!(
            parse_server_line("11/08/2026 20:16:27: Game - OnApplicationQuit"),
            vec![LogEvent::ShutdownStarted]
        );
        assert_eq!(
            parse_server_line("11/08/2026 20:16:27: ZNet Shutdown"),
            vec![LogEvent::ShutdownStarted]
        );
    }

    #[test]
    fn parses_steamcmd_progress_and_phases() {
        let line = "Update state (0x61) downloading, progress: 12.34 (1234 / 10000)";
        assert_eq!(parse_steamcmd_progress(line), Some(12.34));
        assert_eq!(parse_steamcmd_phase(line), Some(SteamcmdPhase::Downloading));

        assert_eq!(
            parse_steamcmd_phase("Update state (0x81) verifying update..."),
            Some(SteamcmdPhase::Verifying)
        );
        assert_eq!(
            parse_steamcmd_phase("Success! App '896660' fully installed."),
            Some(SteamcmdPhase::Done)
        );
        assert!(is_steamcmd_failure(
            "Error! App '896660' state is 0x6 after update job."
        ));
        assert!(!is_steamcmd_failure("Logging in user 'anonymous'"));
        assert_eq!(parse_steamcmd_progress("no progress here"), None);
    }
}
