//! Player access lists: `adminlist.txt`, `bannedlist.txt`, `permittedlist.txt`.
//!
//! Facts from `docs/valheim-server-reference.md` §6:
//! - the files live in the save directory (the `-savedir` base), next to
//!   `worlds_local`;
//! - one entry per line, lines starting with `//` are comments;
//! - Valheim 1.0 ids look like `[Platform]_[UserID]` (`V_<SteamID64>`,
//!   `X_<id>`), legacy files contain bare SteamID64 values;
//! - the lists are read only at server startup, so changes need a restart.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::UNIX_EPOCH;

use chrono::{Local, NaiveDate, TimeZone};
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::config::AppConfig;
use crate::error::AppError;
use crate::logs::{LogLevel, LogLine, LogSource};

/// Name of the admin list file.
pub const ADMIN_FILE: &str = "adminlist.txt";
/// Name of the ban list file.
pub const BANNED_FILE: &str = "bannedlist.txt";
/// Name of the whitelist file.
pub const PERMITTED_FILE: &str = "permittedlist.txt";
/// File with user-provided display names for list entries.
pub const NAMES_FILE: &str = "player-names.json";

/// Kind of an access list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayerListKind {
    /// Admins (`adminlist.txt`).
    Admins,
    /// Banned players (`bannedlist.txt`).
    Banned,
    /// Whitelist (`permittedlist.txt`).
    Permitted,
}

impl PlayerListKind {
    /// File name of the list.
    #[must_use]
    pub const fn file_name(self) -> &'static str {
        match self {
            Self::Admins => ADMIN_FILE,
            Self::Banned => BANNED_FILE,
            Self::Permitted => PERMITTED_FILE,
        }
    }
}

/// One entry of an access list.
///
/// Matches `PlayerListEntry` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerListEntry {
    /// Player id exactly as stored in the file (`V_…`, `X_…` or bare SteamID64).
    pub id: String,
    /// Optional display name, stored by the manager in a sidecar file.
    pub name: Option<String>,
}

/// Contents of all three access lists.
///
/// Matches `PlayerLists` in `src/lib/types.ts`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerLists {
    pub admins: Vec<PlayerListEntry>,
    pub banned: Vec<PlayerListEntry>,
    pub permitted: Vec<PlayerListEntry>,
}

impl PlayerLists {
    /// Returns the list of the requested kind.
    #[must_use]
    #[allow(dead_code)] // used by tests and by future callers
    pub fn kind(&self, kind: PlayerListKind) -> &Vec<PlayerListEntry> {
        match kind {
            PlayerListKind::Admins => &self.admins,
            PlayerListKind::Banned => &self.banned,
            PlayerListKind::Permitted => &self.permitted,
        }
    }
}

/// Path of one list file inside the save directory.
#[must_use]
pub fn list_file(save_dir: &Path, kind: PlayerListKind) -> PathBuf {
    save_dir.join(kind.file_name())
}

/// Sidecar path for player display names.
#[must_use]
pub fn names_file(data_dir: &Path) -> PathBuf {
    data_dir.join(NAMES_FILE)
}

/// Parsed contents of one access list file.
///
/// Valheim creates the files with a header comment (for example
/// `// List admin players ID  ONE per line`), so comments are kept and written
/// back when the manager modifies the list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ListFile {
    /// Comment lines (starting with `//`), in their original order.
    pub comments: Vec<String>,
    /// Player entries in file order.
    pub entries: Vec<PlayerListEntry>,
}

/// Parses the contents of a list file, separating comments from entries.
///
/// Accepts comments (`//…`), blank lines, bare SteamID64 values and
/// `V_…`/`X_…` ids. An inline `id name` form is tolerated too, although the
/// server itself only reads the id.
#[must_use]
pub fn parse_list_file(content: &str) -> ListFile {
    let mut comments = Vec::new();
    let mut entries = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("//") {
            comments.push(line.to_string());
            continue;
        }

        let mut parts = line.split_whitespace();
        let Some(id) = parts.next() else {
            continue;
        };
        let rest = parts.collect::<Vec<_>>().join(" ");
        let name = if rest.is_empty() { None } else { Some(rest) };

        entries.push(PlayerListEntry {
            id: id.to_string(),
            name,
        });
    }

    ListFile { comments, entries }
}

/// Parses only the entries of a list file.
#[must_use]
#[allow(dead_code)] // convenience API used by tests and future import/export
pub fn parse_list(content: &str) -> Vec<PlayerListEntry> {
    parse_list_file(content).entries
}

/// Serializes a list file: comments first, then one id per line (CRLF).
#[must_use]
pub fn serialize_list_file(list: &ListFile) -> String {
    let mut output = String::new();
    for comment in &list.comments {
        output.push_str(comment);
        output.push_str("\r\n");
    }
    for entry in &list.entries {
        // Only the id is written: the server does not understand names in
        // these files, names live in the manager sidecar.
        output.push_str(&entry.id);
        output.push_str("\r\n");
    }
    output
}

/// Serializes entries into the file format (one id per line, CRLF).
#[must_use]
#[allow(dead_code)] // convenience API used by tests and future import/export
pub fn serialize_list(entries: &[PlayerListEntry]) -> String {
    serialize_list_file(&ListFile {
        comments: Vec::new(),
        entries: entries.to_vec(),
    })
}

fn read_list_file(path: &Path) -> Result<ListFile, AppError> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(parse_list_file(&content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ListFile::default()),
        Err(error) => Err(AppError::io(
            format!("чтение списка {}", path.display()),
            &error,
        )),
    }
}

fn write_list_file(path: &Path, list: &ListFile) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| AppError::io("создание каталога списков игроков", &error))?;
    }
    std::fs::write(path, serialize_list_file(list))
        .map_err(|error| AppError::io(format!("запись списка {}", path.display()), &error))
}

/// Loads the sidecar map `id -> display name`.
#[must_use]
pub fn load_names(data_dir: &Path) -> BTreeMap<String, String> {
    let path = names_file(data_dir);
    let Ok(content) = std::fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_names(data_dir: &Path, names: &BTreeMap<String, String>) -> Result<(), AppError> {
    let path = names_file(data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| AppError::io("создание каталога данных", &error))?;
    }
    let json = serde_json::to_string_pretty(names).map_err(|error| {
        AppError::Config(format!("не удалось сохранить имена игроков: {error}"))
    })?;
    std::fs::write(&path, format!("{json}\n"))
        .map_err(|error| AppError::io("запись файла имён игроков", &error))
}

/// Reads all three lists from the save directory and merges display names.
pub fn read_lists(config: &AppConfig, data_dir: &Path) -> Result<PlayerLists, AppError> {
    let save_dir = config.save_dir_path();
    let names = load_names(data_dir);

    let mut lists = PlayerLists {
        admins: read_list_file(&list_file(&save_dir, PlayerListKind::Admins))?.entries,
        banned: read_list_file(&list_file(&save_dir, PlayerListKind::Banned))?.entries,
        permitted: read_list_file(&list_file(&save_dir, PlayerListKind::Permitted))?.entries,
    };

    for entries in [&mut lists.admins, &mut lists.banned, &mut lists.permitted] {
        for entry in entries.iter_mut() {
            if entry.name.is_none() {
                entry.name = names.get(&entry.id).cloned();
            }
        }
    }

    Ok(lists)
}

/// Adds (or updates) an entry in a list, then returns all lists.
pub fn add_entry(
    config: &AppConfig,
    data_dir: &Path,
    kind: PlayerListKind,
    id: &str,
    name: Option<&str>,
) -> Result<PlayerLists, AppError> {
    let id = validate_player_id(kind, id)?;
    let save_dir = config.save_dir_path();
    let path = list_file(&save_dir, kind);
    let mut list = read_list_file(&path)?;

    if let Some(existing) = list.entries.iter_mut().find(|entry| entry.id == id) {
        existing.id.clone_from(&id);
    } else {
        list.entries.push(PlayerListEntry {
            id: id.clone(),
            name: None,
        });
    }
    write_list_file(&path, &list)?;

    let mut names = load_names(data_dir);
    match name.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => {
            names.insert(id, name.to_string());
        }
        None => {
            names.remove(&id);
        }
    }
    save_names(data_dir, &names)?;

    read_lists(config, data_dir)
}

/// Removes an entry from a list, then returns all lists.
pub fn remove_entry(
    config: &AppConfig,
    data_dir: &Path,
    kind: PlayerListKind,
    id: &str,
) -> Result<PlayerLists, AppError> {
    let id = id.trim();
    let save_dir = config.save_dir_path();
    let path = list_file(&save_dir, kind);
    let mut list = read_list_file(&path)?;
    list.entries.retain(|entry| entry.id != id);
    write_list_file(&path, &list)?;

    let mut names = load_names(data_dir);
    names.remove(id);
    save_names(data_dir, &names)?;

    read_lists(config, data_dir)
}

/// Maximum number of players returned by [`parse_known_players`].
pub const MAX_KNOWN_PLAYERS: usize = 50;

/// Where the manager learned about a player.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KnownPlayerSource {
    /// Loaded from the server's "Player history" lines.
    History,
    /// Seen in live log lines (connections, characters, PlayFab sockets).
    Live,
    /// Added from the manager access lists (adminlist/permittedlist).
    List,
}

impl KnownPlayerSource {
    /// Higher priority wins when the same player is found in several sources.
    const fn rank(self) -> u8 {
        match self {
            Self::List => 0,
            Self::History => 1,
            Self::Live => 2,
        }
    }
}

/// A player known to the manager.
///
/// Matches `KnownPlayer` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownPlayer {
    /// Character name, when known.
    pub name: Option<String>,
    /// SteamID64, when the log line or an access list contained one.
    pub steam_id64: Option<String>,
    /// Platform id exactly as it appeared in the log (`Steam_…`, `playfab/…`).
    pub platform_id: Option<String>,
    /// `true` when the SteamID64 is in `adminlist.txt`.
    pub is_admin: bool,
    /// Last activity time, epoch milliseconds (`0` for list-only entries).
    pub last_seen_at: i64,
    /// Where the manager learned about the player.
    pub source: KnownPlayerSource,
}

/// Accumulator used while merging log lines into players.
#[derive(Debug)]
struct PlayerBuilder {
    name: Option<String>,
    steam_id64: Option<String>,
    platform_id: Option<String>,
    last_seen_at: i64,
    source: KnownPlayerSource,
}

impl PlayerBuilder {
    fn new(source: KnownPlayerSource, last_seen_at: i64) -> Self {
        Self {
            name: None,
            steam_id64: None,
            platform_id: None,
            last_seen_at,
            source,
        }
    }
}

/// Builds the list of known players from the log buffer and the admin list.
///
/// Only `server` lines are considered. Lines are processed in chronological
/// order, so the newest sighting of a player wins `last_seen_at` and a live
/// sighting upgrades a player that was first discovered in the history.
#[must_use]
#[allow(clippy::too_many_lines)] // one linear pass over the log buffer
pub fn parse_known_players(
    lines: &[LogLine],
    admin_entries: &[PlayerListEntry],
) -> Vec<KnownPlayer> {
    let mut players: Vec<PlayerBuilder> = Vec::new();

    for line in lines.iter().filter(|line| line.source == LogSource::Server) {
        let text = &line.line;
        let ts = line.ts;

        if let Some(captures) = HISTORY_RE.captures(text) {
            let name = captures
                .get(1)
                .map(|match_| match_.as_str().trim().to_string())
                .filter(|name| !name.is_empty());
            let steam_id64 = captures.get(2).map(|match_| match_.as_str().to_string());
            let platform_id = steam_id64
                .as_ref()
                .map(|steam_id| format!("Steam_{steam_id}"));
            upsert_player(
                &mut players,
                steam_id64,
                platform_id,
                name,
                KnownPlayerSource::History,
                ts,
            );
            continue;
        }

        if let Some(captures) = ZDOID_RE.captures(text) {
            let name = captures
                .get(1)
                .map(|match_| match_.as_str().trim().to_string())
                .filter(|name| !name.is_empty());
            if let Some(name) = name {
                upsert_player(
                    &mut players,
                    None,
                    None,
                    Some(name),
                    KnownPlayerSource::Live,
                    ts,
                );
            }
            continue;
        }

        if let Some(captures) = PLAYFAB_SOCKET_RE.captures(text) {
            let platform_id = captures.get(2).map(|match_| match_.as_str().to_string());
            let steam_id64 = platform_id.as_deref().and_then(steam_id_from_platform_id);
            upsert_player(
                &mut players,
                steam_id64,
                platform_id,
                None,
                KnownPlayerSource::Live,
                ts,
            );
            continue;
        }

        if let Some(captures) = CONNECTION_RE.captures(text) {
            let raw_id = captures
                .get(1)
                .map(|match_| match_.as_str().trim().to_string());
            let steam_id64 = raw_id
                .as_deref()
                .filter(|value| is_steam_id64(value))
                .map(str::to_string);
            let platform_id = steam_id64
                .as_ref()
                .map(|steam_id| format!("Steam_{steam_id}"))
                .or_else(|| raw_id.clone());
            upsert_player(
                &mut players,
                steam_id64,
                platform_id,
                None,
                KnownPlayerSource::Live,
                ts,
            );
            continue;
        }

        if let Some(captures) = SOCKET_CLOSED_RE.captures(text) {
            if let Some(id) = captures.get(1).map(|match_| match_.as_str()) {
                if let Some(index) = players
                    .iter()
                    .position(|player| player.steam_id64.as_deref() == Some(id))
                {
                    players[index].last_seen_at = ts;
                    players[index].source = KnownPlayerSource::Live;
                }
            }
        }
    }

    // Access lists: mark known admins and add admins that never appeared in the log.
    let mut admin_steam_ids: BTreeSet<String> = BTreeSet::new();
    let mut admin_platform_ids: BTreeSet<String> = BTreeSet::new();
    for entry in admin_entries {
        let (steam_id64, platform_id) = split_access_list_id(&entry.id);
        if let Some(platform_id) = &platform_id {
            admin_platform_ids.insert(platform_id.clone());
        }

        let Some(steam_id64) = steam_id64 else {
            // Platform-only list entry (for example `X_<id>` for Xbox): it has
            // no SteamID64, so deduplicate it by the platform id only.
            let known = platform_id.as_deref().is_some_and(|platform| {
                players
                    .iter()
                    .any(|player| player.platform_id.as_deref() == Some(platform))
            });
            if !known {
                let mut builder = PlayerBuilder::new(KnownPlayerSource::List, 0);
                builder.name.clone_from(&entry.name);
                builder.platform_id = platform_id;
                players.push(builder);
            }
            continue;
        };

        admin_steam_ids.insert(steam_id64.clone());

        let existing = players
            .iter()
            .position(|player| player.steam_id64.as_deref() == Some(steam_id64.as_str()));
        if let Some(index) = existing {
            if players[index].platform_id.is_none() {
                players[index].platform_id = platform_id;
            }
        } else {
            let mut builder = PlayerBuilder::new(KnownPlayerSource::List, 0);
            builder.name.clone_from(&entry.name);
            builder.steam_id64 = Some(steam_id64);
            builder.platform_id = platform_id;
            players.push(builder);
        }
    }

    let mut result: Vec<KnownPlayer> = players
        .into_iter()
        .map(|player| {
            let is_admin = player
                .steam_id64
                .as_deref()
                .is_some_and(|steam_id| admin_steam_ids.contains(steam_id))
                || player
                    .platform_id
                    .as_deref()
                    .is_some_and(|platform_id| admin_platform_ids.contains(platform_id));
            KnownPlayer {
                is_admin,
                name: player.name,
                steam_id64: player.steam_id64,
                platform_id: player.platform_id,
                last_seen_at: player.last_seen_at,
                source: player.source,
            }
        })
        .collect();

    result.sort_by(|left, right| {
        right
            .last_seen_at
            .cmp(&left.last_seen_at)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.steam_id64.cmp(&right.steam_id64))
    });
    result.truncate(MAX_KNOWN_PLAYERS);
    result
}

/// Finds an existing player and merges the new information into it.
fn upsert_player(
    players: &mut Vec<PlayerBuilder>,
    steam_id64: Option<String>,
    platform_id: Option<String>,
    name: Option<String>,
    source: KnownPlayerSource,
    timestamp: i64,
) {
    let index = find_player(
        players,
        steam_id64.as_deref(),
        platform_id.as_deref(),
        name.as_deref(),
    );

    if let Some(index) = index {
        let player = &mut players[index];
        if steam_id64.is_some() {
            player.steam_id64 = steam_id64;
        }
        if platform_id.is_some() {
            player.platform_id = platform_id;
        }
        if name.is_some() {
            player.name = name;
        }
        player.last_seen_at = timestamp.max(player.last_seen_at);
        if source.rank() > player.source.rank() {
            player.source = source;
        }
    } else {
        let mut player = PlayerBuilder::new(source, timestamp);
        player.steam_id64 = steam_id64;
        player.platform_id = platform_id;
        player.name = name;
        players.push(player);
    }
}

/// Locates a player by SteamID64, then by platform id, then by character name.
fn find_player(
    players: &[PlayerBuilder],
    steam_id64: Option<&str>,
    platform_id: Option<&str>,
    name: Option<&str>,
) -> Option<usize> {
    if let Some(steam_id64) = steam_id64 {
        if let Some(index) = players
            .iter()
            .position(|player| player.steam_id64.as_deref() == Some(steam_id64))
        {
            return Some(index);
        }
    }
    if let Some(platform_id) = platform_id {
        if let Some(index) = players
            .iter()
            .position(|player| player.platform_id.as_deref() == Some(platform_id))
        {
            return Some(index);
        }
    }
    if let Some(name) = name {
        if let Some(index) = players.iter().position(|player| {
            player
                .name
                .as_deref()
                .is_some_and(|existing| existing.eq_ignore_ascii_case(name))
        }) {
            return Some(index);
        }
    }

    None
}

/// Extracts the SteamID64 from a platform id such as `Steam_7656…`.
fn steam_id_from_platform_id(platform_id: &str) -> Option<String> {
    let steam_id = platform_id.strip_prefix("Steam_")?;
    is_steam_id64(steam_id).then(|| steam_id.to_string())
}

/// Splits an access-list entry into `(steam_id64, platform_id)`.
///
/// Accepted forms: `V_<SteamID64>` (Steam, 1.0), `X_<id>` (Xbox/Game Pass),
/// bare SteamID64 (legacy). Other platform prefixes are kept as platform ids.
fn split_access_list_id(raw_id: &str) -> (Option<String>, Option<String>) {
    let value = raw_id.trim();

    if let Some(rest) = value
        .strip_prefix("V_")
        .or_else(|| value.strip_prefix("v_"))
    {
        if is_steam_id64(rest) {
            return (Some(rest.to_string()), Some(value.to_string()));
        }
        return (None, Some(value.to_string()));
    }
    if value.starts_with("X_") || value.starts_with("x_") {
        return (None, Some(value.to_string()));
    }
    if is_steam_id64(value) {
        return (Some(value.to_string()), None);
    }

    (None, Some(value.to_string()))
}

/// Returns `true` for a 17-digit SteamID64 value.
fn is_steam_id64(value: &str) -> bool {
    value.len() == 17 && value.chars().all(|character| character.is_ascii_digit())
}

// --- Fallback to the recent server log files -------------------------------

/// Maximum number of lines parsed from one server log file.
///
/// The ring buffer only covers the current application session; after a restart
/// the `server-*.log` files on disk are the only source of player history, so
/// they are parsed too (see [`load_server_log_lines`]).
pub const MAX_SERVER_LOG_LINES: usize = 20_000;

/// How many newest server logs are merged.
///
/// The very newest log may be a short startup/test run without players (for
/// example a BepInEx smoke test), while the previous one contains the real
/// "Player history" lines — so up to three recent files are merged.
pub const MAX_SERVER_LOG_FILES: usize = 3;

/// Hard limit of bytes read from the tail of a big server log.
const MAX_SERVER_LOG_READ_BYTES: u64 = 5 * 1024 * 1024;

/// How many first lines are read from a big server log: Valheim prints the
/// `Player history entry` lines near the beginning, right after loading the
/// world, so the head must be kept even when the tail is truncated.
const SERVER_LOG_HEAD_LINES: usize = 2_000;

/// Returns up to `max_files` newest server log files in `<logsDir>/server`.
///
/// The manager writes one file per server start (`server-YYYYMMDD-HHMMSS.log`,
/// see [`crate::paths::server_log_file`]); the newest file comes first. Returns
/// an empty vector when no logs exist or the directory cannot be read (the
/// caller then simply has no history).
#[must_use]
pub fn recent_server_log_files(logs_dir: &Path, max_files: usize) -> Vec<PathBuf> {
    if max_files == 0 {
        return Vec::new();
    }

    let server_log_dir = logs_dir.join("server");
    let entries = match std::fs::read_dir(&server_log_dir) {
        Ok(entries) => entries,
        Err(error) => {
            log::debug!(
                target: "valheim-server",
                "Каталог серверных логов {} недоступен: {error}",
                server_log_dir.display()
            );
            return Vec::new();
        }
    };

    let mut files: Vec<(i64, String, PathBuf)> = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let lower_name = file_name.to_ascii_lowercase();
        let is_server_log = lower_name.starts_with("server-")
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("log"));
        if !is_server_log || !path.is_file() {
            continue;
        }

        files.push((file_modified_ms(&path), file_name, path));
    }

    files.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    files.truncate(max_files);
    files.into_iter().map(|(_, _, path)| path).collect()
}

/// Reads the recent server logs into [`LogLine`]s usable by
/// [`parse_known_players`].
///
/// Up to [`MAX_SERVER_LOG_FILES`] newest logs are merged, oldest first and the
/// newest last, so later sightings win during parsing. Lines are limited to
/// [`MAX_SERVER_LOG_LINES`] per file (head with player history plus the newest
/// tail) and 5 MiB of file data; any I/O error is logged at debug level and
/// yields an empty vector, never an error to the UI.
#[must_use]
pub fn load_server_log_lines(logs_dir: &Path, max_lines: usize) -> Vec<LogLine> {
    let files = recent_server_log_files(logs_dir, MAX_SERVER_LOG_FILES);
    if files.is_empty() {
        return Vec::new();
    }

    let mut lines: Vec<LogLine> = Vec::new();
    for path in files.iter().rev() {
        let raw_lines = read_log_lines(path, max_lines);
        // Some Unity lines have no timestamp prefix; they inherit the previous
        // one (or the file modification time for the very first lines).
        let mut timestamp = file_modified_ms(path);
        for line in raw_lines {
            if let Some(parsed) = parse_log_timestamp(&line) {
                timestamp = parsed;
            }
            lines.push(LogLine {
                seq: 0,
                ts: timestamp,
                source: LogSource::Server,
                level: LogLevel::Info,
                line,
            });
        }
    }

    lines
}

/// Parses the `MM/DD/YYYY HH:MM:SS:` prefix Valheim writes to its log file.
///
/// The server writes local time in US format (verified: `11/08/2026 21:00:22:`).
#[must_use]
pub fn parse_log_timestamp(line: &str) -> Option<i64> {
    let captures = LOG_TIMESTAMP_RE.captures(line)?;
    let month: u32 = captures.get(1)?.as_str().parse().ok()?;
    let day: u32 = captures.get(2)?.as_str().parse().ok()?;
    let year: i32 = captures.get(3)?.as_str().parse().ok()?;
    let hour: u32 = captures.get(4)?.as_str().parse().ok()?;
    let minute: u32 = captures.get(5)?.as_str().parse().ok()?;
    let second: u32 = captures.get(6)?.as_str().parse().ok()?;

    let naive = NaiveDate::from_ymd_opt(year, month, day)?.and_hms_opt(hour, minute, second)?;
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|datetime| datetime.timestamp_millis())
}

/// Reads at most `max_lines` lines from a log file.
fn read_log_lines(path: &Path, max_lines: usize) -> Vec<String> {
    if max_lines == 0 {
        return Vec::new();
    }
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return Vec::new(),
        Err(error) => {
            log::debug!(
                target: "valheim-server",
                "Не удалось прочитать серверный лог {}: {error}",
                path.display()
            );
            return Vec::new();
        }
    };
    if metadata.len() == 0 {
        return Vec::new();
    }

    let mut lines: Vec<String> = if metadata.len() <= MAX_SERVER_LOG_READ_BYTES {
        match std::fs::read(path) {
            Ok(bytes) => split_log_bytes(&bytes),
            Err(error) => {
                log::debug!(
                    target: "valheim-server",
                    "Не удалось прочитать серверный лог {}: {error}",
                    path.display()
                );
                return Vec::new();
            }
        }
    } else {
        // Large log: keep the beginning (player history after world load) and
        // the newest tail, skip the middle.
        let head = read_head_lines(path, SERVER_LOG_HEAD_LINES.min(max_lines));
        let tail_count = max_lines.saturating_sub(head.len()).max(1);
        let tail = read_tail_lines(path, tail_count);
        head.into_iter().chain(tail).collect()
    };

    trim_to_line_limit(&mut lines, max_lines);
    lines
}

/// Splits raw bytes into lines, dropping an incomplete trailing line.
fn split_log_bytes(bytes: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(bytes);
    let mut lines: Vec<String> = text
        .lines()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();
    if !bytes.is_empty() && !bytes.ends_with(b"\n") && !lines.is_empty() {
        // The server is writing this line right now; parse it next time.
        lines.pop();
    }
    lines
}

/// Reads the first `max_lines` lines of a file.
fn read_head_lines(path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .take(max_lines)
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect()
}

/// Reads the last `max_lines` lines of a file (up to 5 MiB of data).
fn read_tail_lines(path: &Path, max_lines: usize) -> Vec<String> {
    if max_lines == 0 {
        return Vec::new();
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(length) = file.seek(SeekFrom::End(0)) else {
        return Vec::new();
    };
    if length == 0 {
        return Vec::new();
    }

    let read_length = length.min(MAX_SERVER_LOG_READ_BYTES);
    if file.seek(SeekFrom::Start(length - read_length)).is_err() {
        return Vec::new();
    }
    let mut buffer = Vec::new();
    if file.read_to_end(&mut buffer).is_err() {
        return Vec::new();
    }

    let mut lines = split_log_bytes(&buffer);
    if read_length < length && !lines.is_empty() {
        // We started in the middle of a line.
        lines.remove(0);
    }
    let skip = lines.len().saturating_sub(max_lines);
    lines.split_off(skip)
}

/// Keeps the first `SERVER_LOG_HEAD_LINES` lines and the newest tail.
fn trim_to_line_limit(lines: &mut Vec<String>, max_lines: usize) {
    if lines.len() <= max_lines {
        return;
    }

    let head_count = SERVER_LOG_HEAD_LINES.min(max_lines);
    let tail_count = max_lines - head_count;
    let tail_start = lines.len() - tail_count;
    let tail: Vec<String> = lines.split_off(tail_start);
    lines.truncate(head_count);
    lines.extend(tail);
}

/// File modification time in epoch milliseconds (`0` when unavailable).
fn file_modified_ms(path: &Path) -> i64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| {
            i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
        })
}

static LOG_TIMESTAMP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{1,2})/(\d{1,2})/(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2}):")
        .expect("valid log timestamp regex")
});

static HISTORY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Player history entry with index \d+:\s*(.*?)\s*\(Steam_(\d{17}),")
        .expect("valid player history regex")
});
static ZDOID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Got character ZDOID from (.+?) : (-?\d+):(\d+)").expect("valid ZDOID regex")
});
static PLAYFAB_SOCKET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"PlayFab socket with remote ID (\S+) received local Platform ID (\S+)")
        .expect("valid PlayFab socket regex")
});
static CONNECTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Got connection SteamID\s+(\S+)").expect("valid connection regex")
});
static SOCKET_CLOSED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Closing socket\s+(\S+)").expect("valid socket closed regex"));

/// Validates a player id entered in the UI.
///
/// Accepted forms:
/// - bare SteamID64 (17 digits, legacy format);
/// - `V_<SteamID64>` (Steam, Valheim 1.0);
/// - `X_<id>` (Xbox / Game Pass, Valheim 1.0) and other `ABC_<id>` platforms;
/// - IPv4 address for the ban list only (in-game `ban` by IP).
pub fn validate_player_id(kind: PlayerListKind, id: &str) -> Result<String, AppError> {
    let id = id.trim();

    if id.is_empty() {
        return Err(AppError::validation("ID игрока не может быть пустым"));
    }
    if id.chars().count() > 64 {
        return Err(AppError::validation("ID игрока слишком длинное"));
    }
    if id.chars().any(char::is_control) || id.chars().any(char::is_whitespace) {
        return Err(AppError::validation(
            "ID игрока не должно содержать пробелов и управляющих символов",
        ));
    }

    if STEAM_ID64_RE.is_match(id) || PLATFORM_ID_RE.is_match(id) {
        return Ok(id.to_string());
    }
    if kind == PlayerListKind::Banned && IPV4_RE.is_match(id) {
        return Ok(id.to_string());
    }

    Err(AppError::validation(
        "Неверный формат ID: ожидается SteamID64 (17 цифр), V_<SteamID64> или X_<ID>",
    ))
}

static STEAM_ID64_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{17}$").expect("valid SteamID64 regex"));
static PLATFORM_ID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Za-z]{1,3}_[A-Za-z0-9]{1,40}$").expect("valid platform id regex")
});
static IPV4_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:\d{1,3}\.){3}\d{1,3}$").expect("valid IPv4 regex"));

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::BasePaths;

    fn config() -> (tempfile::TempDir, AppConfig) {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = BasePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
            temp.path().join("data").join("logs"),
            temp.path().join("root"),
        );
        (temp, AppConfig::defaults(&base))
    }

    #[test]
    fn parses_lists_with_comments_and_blank_lines() {
        let content =
            "// Admins\r\nV_76561198000000001\r\n\r\nX_2535400000000001\r\n76561198000000002\r\n";
        let entries = parse_list(content);

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].id, "V_76561198000000001");
        assert_eq!(entries[1].id, "X_2535400000000001");
        assert_eq!(entries[2].id, "76561198000000002");
        assert!(entries.iter().all(|entry| entry.name.is_none()));

        let list = parse_list_file(content);
        assert_eq!(list.comments, vec!["// Admins".to_string()]);
        assert_eq!(list.entries.len(), 3);
    }

    #[test]
    fn preserves_server_created_header_comments() {
        let (temp, config) = config();
        let data_dir = temp.path().join("data");
        let path = list_file(&config.save_dir_path(), PlayerListKind::Admins);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        // This is exactly what a fresh Valheim dedicated server writes.
        std::fs::write(
            &path,
            "// List admin players ID  ONE per line\r\nV_76561198000000009\r\n",
        )
        .expect("write header file");

        let lists = add_entry(
            &config,
            &data_dir,
            PlayerListKind::Admins,
            "V_76561198000000001",
            None,
        )
        .expect("add");
        assert_eq!(lists.admins.len(), 2);
        let raw = std::fs::read_to_string(&path).expect("read back");
        assert!(
            raw.starts_with("// List admin players ID  ONE per line"),
            "header must be preserved, got: {raw:?}"
        );

        remove_entry(
            &config,
            &data_dir,
            PlayerListKind::Admins,
            "V_76561198000000009",
        )
        .expect("remove");
        let raw = std::fs::read_to_string(&path).expect("read back");
        assert!(raw.starts_with("// List admin players ID  ONE per line"));
        assert!(raw.contains("V_76561198000000001"));
        assert!(!raw.contains("V_76561198000000009"));
    }

    #[test]
    fn parses_legacy_and_platform_ids() {
        assert_eq!(parse_list("76561198012345678\n").len(), 1);
        assert_eq!(parse_list("V_76561198012345678\n").len(), 1);
        assert_eq!(parse_list("X_2535400000000001\n").len(), 1);
        assert_eq!(parse_list("// only a comment\n").len(), 0);
    }

    #[test]
    fn serializes_one_id_per_line_with_crlf() {
        let entries = vec![
            PlayerListEntry {
                id: "V_1".to_string(),
                name: Some("Alice".to_string()),
            },
            PlayerListEntry {
                id: "V_2".to_string(),
                name: None,
            },
        ];
        assert_eq!(serialize_list(&entries), "V_1\r\nV_2\r\n");
    }

    #[test]
    fn validation_accepts_documented_formats() {
        for (kind, id) in [
            (PlayerListKind::Admins, "76561198012345678"),
            (PlayerListKind::Admins, "V_76561198012345678"),
            (PlayerListKind::Admins, "X_2535400000000001"),
            (PlayerListKind::Admins, "  V_76561198012345678  "),
            (PlayerListKind::Banned, "203.0.113.10"),
        ] {
            let validated = validate_player_id(kind, id).expect("valid id");
            assert_eq!(validated, id.trim());
        }
    }

    #[test]
    fn validation_rejects_bad_ids() {
        for (kind, id) in [
            (PlayerListKind::Admins, ""),
            (PlayerListKind::Admins, "not-an-id"),
            (PlayerListKind::Admins, "12345"),
            (PlayerListKind::Admins, "V_"),
            (PlayerListKind::Admins, "V_12 34"),
            (PlayerListKind::Admins, "203.0.113.10"),
            (PlayerListKind::Banned, "203.0.113"),
        ] {
            let error = validate_player_id(kind, id).expect_err("invalid id is rejected");
            assert_eq!(error.code(), "VALIDATION");
        }
    }

    #[test]
    fn add_and_remove_round_trip_through_files() {
        let (temp, config) = config();
        let data_dir = temp.path().join("data");

        let lists = add_entry(
            &config,
            &data_dir,
            PlayerListKind::Admins,
            "V_76561198000000001",
            Some("Alice"),
        )
        .expect("add admin");
        assert_eq!(lists.admins.len(), 1);
        assert_eq!(lists.admins[0].name.as_deref(), Some("Alice"));

        // Adding the same id is idempotent and updates the name.
        let lists = add_entry(
            &config,
            &data_dir,
            PlayerListKind::Admins,
            "V_76561198000000001",
            Some("Alice 2"),
        )
        .expect("add admin again");
        assert_eq!(lists.admins.len(), 1);
        assert_eq!(lists.admins[0].name.as_deref(), Some("Alice 2"));

        let lists = add_entry(
            &config,
            &data_dir,
            PlayerListKind::Banned,
            "76561198000000009",
            None,
        )
        .expect("add banned");
        assert_eq!(lists.banned.len(), 1);

        let lists = remove_entry(
            &config,
            &data_dir,
            PlayerListKind::Admins,
            "V_76561198000000001",
        )
        .expect("remove admin");
        assert_eq!(lists.admins.len(), 0);
        assert_eq!(lists.banned.len(), 1);
    }

    #[test]
    fn written_files_contain_only_ids() {
        let (temp, config) = config();
        let data_dir = temp.path().join("data");
        add_entry(
            &config,
            &data_dir,
            PlayerListKind::Permitted,
            "V_76561198000000003",
            Some("Bob"),
        )
        .expect("add");

        let content = std::fs::read_to_string(list_file(
            &config.save_dir_path(),
            PlayerListKind::Permitted,
        ))
        .expect("read list");
        assert_eq!(content, "V_76561198000000003\r\n");
    }

    #[test]
    fn missing_files_yield_empty_lists() {
        let (temp, config) = config();
        let data_dir = temp.path().join("data");
        let lists = read_lists(&config, &data_dir).expect("reads");
        assert_eq!(lists, PlayerLists::default());
    }

    #[test]
    fn names_sidecar_survives_reload() {
        let (temp, config) = config();
        let data_dir = temp.path().join("data");
        add_entry(
            &config,
            &data_dir,
            PlayerListKind::Admins,
            "V_76561198000000001",
            Some("Alice"),
        )
        .expect("add");

        let reloaded = read_lists(&config, &data_dir).expect("reads");
        assert_eq!(reloaded.admins[0].name.as_deref(), Some("Alice"));
    }

    #[test]
    fn invalid_json_in_names_file_is_ignored() {
        let (temp, config) = config();
        let data_dir = temp.path().join("data");
        std::fs::create_dir_all(&data_dir).expect("mkdir");
        std::fs::write(names_file(&data_dir), "{ broken").expect("write");

        add_entry(
            &config,
            &data_dir,
            PlayerListKind::Admins,
            "V_76561198000000001",
            Some("Alice"),
        )
        .expect("add works despite broken names file");
        assert_eq!(
            read_lists(&config, &data_dir).expect("reads").admins[0]
                .name
                .as_deref(),
            Some("Alice")
        );
    }

    // --- Known players ------------------------------------------------------

    use crate::logs::{LogLevel, LogLine};

    fn server_line(ts: i64, text: &str) -> LogLine {
        LogLine {
            seq: 0,
            ts,
            source: LogSource::Server,
            level: LogLevel::Info,
            line: text.to_string(),
        }
    }

    fn admin_entry(id: &str) -> PlayerListEntry {
        PlayerListEntry {
            id: id.to_string(),
            name: None,
        }
    }

    #[test]
    fn builds_known_players_from_real_1_0_21_log_lines() {
        // Lines below are copied from a real Valheim 1.0.21 crossplay server log.
        let lines = vec![
            server_line(
                1_000,
                "11/08/2026 21:00:22: Player history entry with index 0:  PlayerOne (Steam_76561198000000001, 1F9F5D73C109A8FB)",
            ),
            server_line(
                1_100,
                "11/08/2026 21:00:22: Player history entry with index 1:   (Steam_76561198000000004, F4BE1B423894222A)",
            ),
            server_line(
                1_200,
                r#"11/08/2026 21:01:02: Player joined server "Valheim Tankograd" that has join code 513053, now 1 player(s)"#,
            ),
            server_line(
                1_300,
                "11/08/2026 21:01:02: PlayFab socket with remote ID playfab/7A3C9EB4D392A113 received local Platform ID Steam_76561198000000004",
            ),
            server_line(
                1_400,
                "11/08/2026 21:01:18: Got character ZDOID from BaBuN : -41079580:1",
            ),
            server_line(
                1_500,
                "11/08/2026 21:01:49: PlayFab socket with remote ID playfab/6131FE270CFDF254 received local Platform ID Steam_76561198000000002",
            ),
            server_line(
                1_600,
                "11/08/2026 21:02:47: Got character ZDOID from PlayerFive : 688412153:1",
            ),
            // PlayerOne and PlayerOne are the same player: the live line merges into the
            // history entry and keeps the SteamID64.
            server_line(
                1_700,
                "11/08/2026 21:02:59: Got character ZDOID from PlayerOne : 3114238855:1",
            ),
        ];
        let admins = vec![admin_entry("V_76561198000000001")];

        let players = parse_known_players(&lines, &admins);

        assert_eq!(players.len(), 5);
        assert_eq!(players[0].name.as_deref(), Some("PlayerOne"));
        assert_eq!(players[0].steam_id64.as_deref(), Some("76561198000000001"));
        assert_eq!(
            players[0].platform_id.as_deref(),
            Some("Steam_76561198000000001")
        );
        assert!(players[0].is_admin);
        assert_eq!(players[0].source, KnownPlayerSource::Live);

        // The empty history name stays `None`, the SteamID64 is known.
        let unnamed = players
            .iter()
            .find(|player| player.steam_id64.as_deref() == Some("76561198000000004"))
            .expect("history entry with empty name");
        assert!(unnamed.name.is_none());
        assert!(!unnamed.is_admin);

        // Live-only names have no SteamID64 until the game prints a matching id.
        let babun = players
            .iter()
            .find(|player| player.name.as_deref() == Some("BaBuN"))
            .expect("live name");
        assert!(babun.steam_id64.is_none());
        assert_eq!(babun.source, KnownPlayerSource::Live);

        // Sorted by last_seen_at descending.
        for window in players.windows(2) {
            assert!(window[0].last_seen_at >= window[1].last_seen_at);
        }
    }

    #[test]
    fn adds_admin_entries_that_never_appeared_in_the_log() {
        let players = parse_known_players(
            &[],
            &[
                admin_entry("V_76561198000000001"),
                admin_entry("X_2535400000000001"),
                admin_entry("76561198000000002"),
            ],
        );

        assert_eq!(players.len(), 3);
        assert!(
            players
                .iter()
                .all(|player| player.is_admin && player.source == KnownPlayerSource::List)
        );
        assert!(players.iter().all(|player| player.last_seen_at == 0));

        let steam = players
            .iter()
            .find(|player| player.steam_id64.as_deref() == Some("76561198000000001"))
            .expect("V_ admin");
        assert_eq!(steam.platform_id.as_deref(), Some("V_76561198000000001"));

        let xbox = players
            .iter()
            .find(|player| player.platform_id.as_deref() == Some("X_2535400000000001"))
            .expect("X_ admin");
        assert!(xbox.steam_id64.is_none());

        let legacy = players
            .iter()
            .find(|player| player.steam_id64.as_deref() == Some("76561198000000002"))
            .expect("legacy admin");
        assert!(legacy.platform_id.is_none());
    }

    #[test]
    fn deduplicates_repeated_live_lines() {
        let lines = vec![
            server_line(
                100,
                "PlayFab socket with remote ID playfab/AAAAAAAAAAAAAAAA received local Platform ID Steam_76561198000000003",
            ),
            server_line(
                200,
                "PlayFab socket with remote ID playfab/AAAAAAAAAAAAAAAA received local Platform ID Steam_76561198000000003",
            ),
            server_line(300, "Got connection SteamID 76561198000000004"),
            server_line(400, "Got connection SteamID 76561198000000004"),
        ];

        let players = parse_known_players(&lines, &[]);
        assert_eq!(players.len(), 2);

        let socket = players
            .iter()
            .find(|player| player.steam_id64.as_deref() == Some("76561198000000003"))
            .expect("playfab player");
        assert_eq!(socket.last_seen_at, 200);

        let steam = players
            .iter()
            .find(|player| player.steam_id64.as_deref() == Some("76561198000000004"))
            .expect("steam player");
        assert_eq!(
            steam.platform_id.as_deref(),
            Some("Steam_76561198000000004")
        );
        assert_eq!(steam.last_seen_at, 400);
    }

    #[test]
    fn empty_buffer_returns_no_players() {
        assert_eq!(parse_known_players(&[], &[]).len(), 0);
    }

    #[test]
    fn ignores_non_server_lines() {
        let mut line = server_line(
            100,
            "Player history entry with index 0: Alice (Steam_76561198000000005, HASH)",
        );
        line.source = LogSource::App;

        assert_eq!(parse_known_players(&[line], &[]).len(), 0);
    }

    #[test]
    fn limits_the_result_and_keeps_the_newest_players() {
        let lines: Vec<LogLine> = (0..60)
            .map(|index| {
                server_line(
                    i64::from(index),
                    &format!("Got character ZDOID from Player{index} : {index}:1"),
                )
            })
            .collect();

        let players = parse_known_players(&lines, &[]);
        assert_eq!(players.len(), MAX_KNOWN_PLAYERS);
        assert_eq!(players[0].name.as_deref(), Some("Player59"));
    }

    #[test]
    fn known_player_serializes_like_the_contract() {
        let player = KnownPlayer {
            name: Some("Alice".to_string()),
            steam_id64: Some("76561198000000001".to_string()),
            platform_id: Some("Steam_76561198000000001".to_string()),
            is_admin: true,
            last_seen_at: 42,
            source: KnownPlayerSource::History,
        };
        let payload = serde_json::to_value(&player).expect("serializes");

        assert_eq!(payload["name"], "Alice");
        assert_eq!(payload["steamId64"], "76561198000000001");
        assert_eq!(payload["platformId"], "Steam_76561198000000001");
        assert_eq!(payload["isAdmin"], true);
        assert_eq!(payload["lastSeenAt"], 42);
        assert_eq!(payload["source"], "history");
        assert!(payload.get("steam_id64").is_none());
    }

    // --- Fallback to the last server log ------------------------------------

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, contents).expect("write file");
    }

    fn local_epoch_ms(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> i64 {
        Local
            .from_local_datetime(
                &NaiveDate::from_ymd_opt(year, month, day)
                    .expect("valid date")
                    .and_hms_opt(hour, minute, second)
                    .expect("valid time"),
            )
            .earliest()
            .expect("local time")
            .timestamp_millis()
    }

    #[test]
    fn recent_server_logs_are_sorted_by_modification_time() {
        let temp = tempfile::tempdir().expect("temp dir");
        let logs_dir = temp.path().join("logs");
        let server_dir = logs_dir.join("server");
        std::fs::create_dir_all(&server_dir).expect("mkdir");
        write_file(&server_dir.join("server-20260101-000000.log"), "old\n");
        write_file(&server_dir.join("manager-20260102-000000.log"), "manager\n");
        write_file(&server_dir.join("server-notes.txt"), "notes\n");
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_file(&server_dir.join("server-20260102-000000.log"), "new\n");

        let newest = recent_server_log_files(&logs_dir, 1);
        assert_eq!(newest, vec![server_dir.join("server-20260102-000000.log")]);

        let both = recent_server_log_files(&logs_dir, 2);
        assert_eq!(both.len(), 2);
        assert_eq!(both[1], server_dir.join("server-20260101-000000.log"));

        // No logs directory / empty logs directory: no fallback data, no panic.
        assert_eq!(
            recent_server_log_files(&temp.path().join("missing"), 1).len(),
            0
        );
        let empty = temp.path().join("logs-empty");
        std::fs::create_dir_all(empty.join("server")).expect("mkdir");
        assert_eq!(recent_server_log_files(&empty, 1).len(), 0);
    }

    #[test]
    fn loads_timestamps_and_lines_from_the_last_server_log() {
        let temp = tempfile::tempdir().expect("temp dir");
        let logs_dir = temp.path().join("logs");
        let content = concat!(
            "11/08/2026 21:00:22: Player history entry with index 0:  PlayerOne (Steam_76561198000000001, 1F9F5D73C109A8FB)\r\n",
            "11/08/2026 21:01:18: Got character ZDOID from PlayerOne : 3114238855:1\n",
            "raw unity line without timestamp\n",
            "partial-line-without-newline"
        );
        write_file(
            &logs_dir.join("server").join("server-20260101-000000.log"),
            content,
        );

        let lines = load_server_log_lines(&logs_dir, MAX_SERVER_LOG_LINES);

        // The incomplete trailing line is ignored (the server may be writing it).
        assert_eq!(lines.len(), 3);
        assert!(lines[0].line.contains("Player history entry"));
        assert_eq!(lines[0].ts, local_epoch_ms(2026, 11, 8, 21, 0, 22));
        assert_eq!(lines[1].ts, local_epoch_ms(2026, 11, 8, 21, 1, 18));
        assert_eq!(lines[2].line, "raw unity line without timestamp");
        // Lines without a timestamp prefix inherit the previous one.
        assert_eq!(lines[2].ts, lines[1].ts);
        assert!(lines.iter().all(|line| line.source == LogSource::Server));
    }

    #[test]
    fn known_players_are_restored_from_the_last_log_after_an_app_restart() {
        // This is the exact scenario: the application restarted, the ring buffer
        // is empty, but the last server log still contains the player history.
        let temp = tempfile::tempdir().expect("temp dir");
        let logs_dir = temp.path().join("logs");
        let content = concat!(
            "11/08/2026 21:00:22: Player history entry with index 0:  PlayerOne (Steam_76561198000000001, 1F9F5D73C109A8FB)\n",
            "11/08/2026 21:00:22: Player history entry with index 1:   (Steam_76561198000000004, F4BE1B423894222A)\n",
            "11/08/2026 21:01:02: PlayFab socket with remote ID playfab/7A3C9EB4D392A113 received local Platform ID Steam_76561198000000004\n",
            "11/08/2026 21:02:59: Got character ZDOID from PlayerOne : 3114238855:1\n",
            "11/08/2026 21:02:47: Got character ZDOID from BaBuN : -41079580:1\n"
        );
        write_file(
            &logs_dir.join("server").join("server-20260101-000000.log"),
            content,
        );

        let lines = load_server_log_lines(&logs_dir, MAX_SERVER_LOG_LINES);
        let admins = vec![admin_entry("V_76561198000000001")];
        let players = parse_known_players(&lines, &admins);

        assert_ne!(players.len(), 0);
        let zuba = players
            .iter()
            .find(|player| player.steam_id64.as_deref() == Some("76561198000000001"))
            .expect("PlayerOne restored from the history line");
        assert_eq!(zuba.name.as_deref(), Some("PlayerOne"));
        assert!(zuba.is_admin);
        assert_eq!(zuba.source, KnownPlayerSource::Live);
        assert_eq!(zuba.last_seen_at, local_epoch_ms(2026, 11, 8, 21, 2, 59));

        let unnamed = players
            .iter()
            .find(|player| player.steam_id64.as_deref() == Some("76561198000000004"))
            .expect("PlayFab socket player");
        assert!(unnamed.name.is_none());
        assert!(!unnamed.is_admin);
    }

    #[test]
    fn merges_recent_logs_when_the_newest_one_has_no_player_lines() {
        // Real-world case: the newest file by mtime is a short test run without
        // players, while the previous log contains the actual player history.
        let temp = tempfile::tempdir().expect("temp dir");
        let logs_dir = temp.path().join("logs");
        let server_dir = logs_dir.join("server");
        write_file(
            &server_dir.join("server-20260101-000000.log"),
            concat!(
                "11/08/2026 21:00:22: Player history entry with index 0:  PlayerOne (Steam_76561198000000001, 1F9F5D73C109A8FB)\n",
                "11/08/2026 21:02:59: Got character ZDOID from PlayerOne : 3114238855:1\n"
            ),
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_file(
            &server_dir.join("server-20260102-000000.log"),
            "11/08/2026 22:00:00: BepInEx smoke test, no players\n",
        );

        let lines = load_server_log_lines(&logs_dir, MAX_SERVER_LOG_LINES);
        let players = parse_known_players(&lines, &[]);

        let zuba = players
            .iter()
            .find(|player| player.steam_id64.as_deref() == Some("76561198000000001"))
            .expect("player restored from the previous log");
        assert_eq!(zuba.name.as_deref(), Some("PlayerOne"));
        // The older log is merged first, the newer one last.
        assert!(lines[0].line.contains("Player history entry"));
        assert!(
            lines
                .last()
                .is_some_and(|line| line.line.contains("BepInEx smoke test"))
        );
    }

    #[test]
    fn missing_server_logs_yield_no_players() {
        let temp = tempfile::tempdir().expect("temp dir");

        let lines = load_server_log_lines(&temp.path().join("logs"), MAX_SERVER_LOG_LINES);

        assert_eq!(lines.len(), 0);
        assert_eq!(parse_known_players(&lines, &[]).len(), 0);
    }

    #[test]
    fn server_log_lines_are_limited_keeping_head_and_tail() {
        let temp = tempfile::tempdir().expect("temp dir");
        let logs_dir = temp.path().join("logs");
        let mut content = String::new();
        {
            use std::fmt::Write as _;
            for index in 0..3000 {
                writeln!(content, "line-{index}").expect("write line");
            }
        }
        write_file(
            &logs_dir.join("server").join("server-20260101-000000.log"),
            &content,
        );

        let lines = load_server_log_lines(&logs_dir, 2500);

        assert_eq!(lines.len(), 2500);
        // The head keeps the player-history area, the tail keeps the newest lines.
        assert_eq!(lines[0].line, "line-0");
        assert_eq!(lines[1999].line, "line-1999");
        assert_eq!(lines[2000].line, "line-2500");
        assert_eq!(lines[2499].line, "line-2999");
    }

    #[test]
    fn parses_log_timestamp_prefixes() {
        assert_eq!(
            parse_log_timestamp("11/08/2026 21:00:22: Player history entry"),
            Some(local_epoch_ms(2026, 11, 8, 21, 0, 22))
        );
        assert_eq!(
            parse_log_timestamp("11/8/2026 9:00:22: short date"),
            Some(local_epoch_ms(2026, 11, 8, 9, 0, 22))
        );
        assert_eq!(parse_log_timestamp("no timestamp here"), None);
        assert_eq!(parse_log_timestamp("99/99/9999 99:99:99: bad"), None);
    }
}
