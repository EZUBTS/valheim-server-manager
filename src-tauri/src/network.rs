//! Network diagnostics: UDP port usage, Windows Firewall rules, local IPs.
//!
//! Valheim uses three UDP ports: `-port` (game traffic), `-port + 1` (Steam
//! query, needed for the server browser) and `-port + 2` (recommended by the
//! official guide). TCP is not needed. See `docs/valheim-server-reference.md` §4.
//!
//! Diagnostics are deliberately fast (`< 2 s`): PowerShell's
//! `Get-NetFirewallRule | Get-NetFirewallPortFilter` takes **tens of seconds**
//! on machines with hundreds of rules (measured: ~35 s for 428 inbound rules,
//! 82 s in the packaged app), so Windows is queried through localised `netsh`
//! output instead:
//! - targeted `netsh advfirewall firewall show rule name="<known name>"` for the
//!   rules the manager and Valheim create;
//! - one `netsh … show rule name=all dir=in` enumeration as a bounded fallback
//!   (hard timeout: if it takes too long, known-name results are used);
//! - `ipconfig` for local IPv4 addresses plus a socket trick as a fallback;
//! - `netstat -ano -p UDP` for UDP port usage.
//!
//! Every external process runs through
//! [`crate::process::run_command_with_timeout`], so a hung tool is killed by a
//! deadline instead of freezing the UI. Results are cached for
//! [`DIAGNOSIS_CACHE_TTL`] and substep durations are logged.

use std::collections::BTreeSet;
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::config::AppConfig;
use crate::error::AppError;
use crate::process::{hidden_command, run_command_with_timeout};
use crate::state::now_ms;

/// Number of UDP ports a Valheim server occupies: `port`, `port + 1`, `port + 2`.
pub const PORT_SPAN: u16 = 3;

/// How long a computed [`NetworkDiagnosis`] is reused.
pub const DIAGNOSIS_CACHE_TTL: Duration = Duration::from_secs(12);

/// Hard timeout for `netstat`.
const NETSTAT_TIMEOUT: Duration = Duration::from_millis(1_000);
/// Hard timeout for one targeted `netsh … show rule name="<name>"` query.
const NETSH_KNOWN_RULE_TIMEOUT: Duration = Duration::from_millis(500);
/// Hard timeout for the full `netsh … show rule name=all dir=in` enumeration.
const NETSH_ALL_RULES_TIMEOUT: Duration = Duration::from_millis(1_500);
/// Hard timeout for `ipconfig`.
const IPCONFIG_TIMEOUT: Duration = Duration::from_millis(1_000);
/// Hard timeout for `netsh` when adding/removing a firewall rule.
const NETSH_ACTION_TIMEOUT: Duration = Duration::from_secs(3);

/// Transport protocol of a port check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PortProtocol {
    Udp,
    /// Kept for the contract: Valheim needs no TCP ports, but the UI type has it.
    #[allow(dead_code)]
    Tcp,
}

/// State of one port.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PortState {
    Listening,
    Closed,
    /// Reported when the platform lets us neither confirm nor deny the port.
    #[allow(dead_code)]
    Unknown,
}

/// One port check result.
///
/// Matches `PortCheck` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortCheck {
    pub port: u16,
    pub protocol: PortProtocol,
    pub state: PortState,
}

/// Direction of a firewall rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum RuleDirection {
    In,
    Out,
    #[default]
    Unknown,
}

/// A Windows Firewall rule relevant to the server.
///
/// Matches `FirewallRuleInfo` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallRuleInfo {
    pub name: String,
    pub enabled: bool,
    pub ports: String,
    pub direction: RuleDirection,
}

/// Result of the network diagnostics.
///
/// Matches `NetworkDiagnosis` in `src/lib/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkDiagnosis {
    pub main_port: u16,
    pub port_range: (u16, u16),
    pub ports: Vec<PortCheck>,
    pub firewall_rules: Vec<FirewallRuleInfo>,
    pub firewall_ok: bool,
    pub local_ips: Vec<String>,
    pub generated_at: i64,
    pub hints: Vec<String>,
}

/// Builds the human-readable hints for the network page.
#[must_use]
pub fn build_hints(
    config: &AppConfig,
    ports: &[PortCheck],
    firewall_ok: bool,
    local_ips: &[String],
) -> Vec<String> {
    let main_port = config.server.port;
    let last_port = main_port.saturating_add(PORT_SPAN - 1);
    let range = format!("{main_port}–{last_port}");
    let mut hints = Vec::new();

    if config.server.crossplay {
        hints.push(
            "Crossplay включён: проброс портов на роутере не нужен, игроки подключаются по коду приглашения (6 цифр)."
                .to_string(),
        );
        hints.push(
            "При crossplay подключение по локальному IP не работает — используйте код приглашения."
                .to_string(),
        );
    } else {
        hints.push(format!(
            "Пробросьте на роутере UDP-порты {range} на локальный IP этого компьютера."
        ));
        hints.push(format!(
            "Подключение по IP: добавьте сервер в Steam через «Join IP» {main_port} или найдите его по порту запроса {last_port}."
        ));
        hints.push(format!(
            "Valheim 1.0 реально занимает только UDP {main_port} и {} (Steam query); порт {last_port} обычно не слушается — держите его в правилах брандмауэра/роутера на всякий случай, вреда нет.",
            main_port.saturating_add(1)
        ));
    }

    if firewall_ok {
        hints.push(format!(
            "В брандмауэре Windows найдено включённое входящее правило для UDP {range}."
        ));
    } else {
        hints.push(format!(
            "Нет включённого входящего правила брандмауэра для UDP {range}: нажмите «Разрешить в брандмауэре»."
        ));
    }

    let listening: Vec<u16> = ports
        .iter()
        .filter(|check| check.state == PortState::Listening)
        .map(|check| check.port)
        .collect();
    if listening.is_empty() {
        hints.push(
            "Сейчас ни один из портов сервера не слушается — вероятно, сервер остановлен."
                .to_string(),
        );
    } else {
        hints.push(format!(
            "Слушаются UDP-порты: {}.",
            listening
                .iter()
                .map(u16::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    if !local_ips.is_empty() {
        hints.push(format!(
            "Локальные IPv4-адреса: {}. Для игры в локальной сети используйте <IP>:{main_port}.",
            local_ips.join(", ")
        ));
    }

    hints
}

// --- TTL cache -------------------------------------------------------------

#[derive(Debug)]
struct CachedDiagnosis {
    port: u16,
    created: Instant,
    diagnosis: NetworkDiagnosis,
}

/// Small cache for [`diagnose_network`] results, keyed by the server port.
#[derive(Debug)]
struct DiagnosisCache {
    ttl: Duration,
    inner: Mutex<Option<CachedDiagnosis>>,
}

impl DiagnosisCache {
    fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            inner: Mutex::new(None),
        }
    }

    fn get(&self, port: u16, now: Instant) -> Option<NetworkDiagnosis> {
        let guard = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let cached = guard.as_ref()?;
        if cached.port != port || now.saturating_duration_since(cached.created) >= self.ttl {
            return None;
        }
        Some(cached.diagnosis.clone())
    }

    fn put(&self, port: u16, now: Instant, diagnosis: NetworkDiagnosis) {
        let mut guard = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        *guard = Some(CachedDiagnosis {
            port,
            created: now,
            diagnosis,
        });
    }

    fn invalidate(&self) {
        let mut guard = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        *guard = None;
    }
}

static DIAGNOSIS_CACHE: LazyLock<DiagnosisCache> =
    LazyLock::new(|| DiagnosisCache::new(DIAGNOSIS_CACHE_TTL));
static DIAGNOSIS_COMPUTE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Drops the cached diagnosis (called after firewall rules are changed).
pub fn invalidate_diagnosis_cache() {
    DIAGNOSIS_CACHE.invalidate();
}

/// Returns the network diagnostics, reusing a result computed less than
/// [`DIAGNOSIS_CACHE_TTL`] ago for the same port.
///
/// Concurrent calls are serialised: the second caller waits for the first one
/// and then gets its cached result instead of running all the process queries
/// again.
pub fn diagnose_network(config: &AppConfig) -> NetworkDiagnosis {
    let port = config.server.port;
    if let Some(cached) = DIAGNOSIS_CACHE.get(port, Instant::now()) {
        log::debug!(
            target: "valheim-server",
            "diagnose_network: cache hit for port {port}"
        );
        return cached;
    }

    let _guard = DIAGNOSIS_COMPUTE_LOCK
        .lock()
        .unwrap_or_else(PoisonError::into_inner);

    // Another thread may have computed the result while we were waiting.
    if let Some(cached) = DIAGNOSIS_CACHE.get(port, Instant::now()) {
        return cached;
    }

    let diagnosis = diagnose_network_uncached(config);
    DIAGNOSIS_CACHE.put(port, Instant::now(), diagnosis.clone());
    diagnosis
}

/// Runs all diagnostics without consulting the cache.
pub fn diagnose_network_uncached(config: &AppConfig) -> NetworkDiagnosis {
    let total_started = Instant::now();
    let main_port = config.server.port;
    let last_port = main_port.saturating_add(PORT_SPAN - 1);

    // 1. UDP ports currently bound on the machine.
    let netstat_started = Instant::now();
    let bound_ports = udp_bound_ports();
    let netstat_ms = netstat_started.elapsed().as_millis();

    let mut ports = Vec::with_capacity(usize::from(PORT_SPAN));
    for offset in 0..PORT_SPAN {
        let port = main_port.saturating_add(offset);
        let state = match &bound_ports {
            Ok(bound) => {
                if bound.contains(&port) {
                    PortState::Listening
                } else {
                    PortState::Closed
                }
            }
            Err(error) => {
                log::debug!(target: "valheim-server", "netstat недоступен: {error}");
                if is_udp_port_free(port) {
                    PortState::Closed
                } else {
                    PortState::Listening
                }
            }
        };
        ports.push(PortCheck {
            port,
            protocol: PortProtocol::Udp,
            state,
        });
    }

    // 2. Firewall rules (targeted netsh queries + one bounded enumeration).
    let firewall_started = Instant::now();
    let mut firewall_rules = query_firewall_rules(main_port, last_port);
    let firewall_ms = firewall_started.elapsed().as_millis();
    firewall_rules.truncate(50);
    let firewall_rule_count = firewall_rules.len();

    // 3. Local IPv4 addresses (ipconfig + socket fallback).
    let ips_started = Instant::now();
    let local_ips = local_ipv4_addresses();
    let ips_ms = ips_started.elapsed().as_millis();

    let firewall_ok = firewall_rules.iter().any(|rule| {
        rule.enabled
            && rule.direction == RuleDirection::In
            && ports_cover(&rule.ports, main_port, last_port)
    });

    let hints = build_hints(config, &ports, firewall_ok, &local_ips);
    let total_ms = total_started.elapsed().as_millis();

    log::info!(
        target: "valheim-server",
        "diagnose_network: netstat {netstat_ms} ms, firewall {firewall_ms} ms ({firewall_rule_count} rules), local_ips {ips_ms} ms, total {total_ms} ms"
    );

    NetworkDiagnosis {
        main_port,
        port_range: (main_port, last_port),
        ports,
        firewall_rules,
        firewall_ok,
        local_ips,
        generated_at: now_ms(),
        hints,
    }
}

// --- Firewall rules --------------------------------------------------------

/// Name of the firewall rule created by the manager.
#[must_use]
pub fn firewall_rule_name(first_port: u16, last_port: u16) -> String {
    format!("Valheim Server Manager (UDP {first_port}-{last_port})")
}

/// Rule names that are queried directly (fast path).
///
/// Includes the rule the manager creates, the name used by the ops scripts /
/// manual rules on the user's machine, and the default 2456–2458 variants when
/// the configured port range is different.
#[must_use]
pub fn known_firewall_rule_names(first_port: u16, last_port: u16) -> Vec<String> {
    let mut names = vec![
        firewall_rule_name(first_port, last_port),
        format!("Valheim Server (UDP {first_port}-{last_port})"),
        "Valheim Server Manager (UDP 2456-2458)".to_string(),
        "Valheim Server (UDP 2456-2458)".to_string(),
    ];
    names.sort();
    names.dedup();
    names
}

/// A firewall rule block parsed from `netsh` output.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct ParsedRule {
    name: String,
    enabled: bool,
    direction: RuleDirection,
    ports: String,
    protocol: String,
    action: String,
}

impl ParsedRule {
    /// `true` for an inbound, UDP, allow rule (the only kind that opens the game
    /// ports; `netsh` output is localised, values are matched case-insensitively).
    fn is_udp_allow(&self) -> bool {
        let protocol = self.protocol.trim().to_lowercase();
        let protocol_ok = protocol.is_empty()
            || protocol == "udp"
            || protocol == "any"
            || protocol == "любой"
            || protocol == "17";
        let action = self.action.trim().to_lowercase();
        let action_ok = action.is_empty()
            || action == "allow"
            || action == "разрешить"
            || action == "разрешение";
        let direction_ok = !matches!(self.direction, RuleDirection::Out);
        protocol_ok && action_ok && direction_ok
    }

    fn into_info(self) -> FirewallRuleInfo {
        FirewallRuleInfo {
            name: self.name,
            enabled: self.enabled,
            ports: self.ports,
            direction: self.direction,
        }
    }
}

/// Fields of a `netsh advfirewall firewall show rule` block we care about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NetshField {
    Name,
    Enabled,
    Direction,
    Ports,
    Protocol,
    Action,
}

/// Maps a localised `netsh` label to a known field (RU/EN).
fn netsh_field(key: &str) -> Option<NetshField> {
    match key.trim().to_lowercase().as_str() {
        "rule name" | "name" | "правило" | "имя правила" | "название правила" => {
            Some(NetshField::Name)
        }
        "enabled" | "включено" | "включен" | "включён" => {
            Some(NetshField::Enabled)
        }
        "direction" | "направление" => Some(NetshField::Direction),
        "local port" | "localport" | "локальный порт" | "локальные порты" | "порт" => {
            Some(NetshField::Ports)
        }
        "protocol" | "протокол" => Some(NetshField::Protocol),
        "action" | "действие" => Some(NetshField::Action),
        _ => None,
    }
}

/// Parses `netsh` rule blocks (works for RU and EN output, one or many rules).
#[must_use]
fn parse_netsh_rules(output: &str) -> Vec<ParsedRule> {
    let mut rules: Vec<ParsedRule> = Vec::new();
    let mut current: Option<ParsedRule> = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("---")
            || trimmed.starts_with("===")
            || trimmed.starts_with('─')
        {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim().to_string();

        match netsh_field(key) {
            Some(NetshField::Name) => {
                if let Some(rule) = current.take() {
                    if !rule.name.is_empty() {
                        rules.push(rule);
                    }
                }
                current = Some(ParsedRule {
                    name: value,
                    ..ParsedRule::default()
                });
            }
            Some(NetshField::Enabled) => {
                if let Some(rule) = current.as_mut() {
                    rule.enabled = parse_netsh_bool(&value);
                }
            }
            Some(NetshField::Direction) => {
                if let Some(rule) = current.as_mut() {
                    rule.direction = parse_netsh_direction(&value);
                }
            }
            Some(NetshField::Ports) => {
                if let Some(rule) = current.as_mut() {
                    rule.ports = value;
                }
            }
            Some(NetshField::Protocol) => {
                if let Some(rule) = current.as_mut() {
                    rule.protocol = value;
                }
            }
            Some(NetshField::Action) => {
                if let Some(rule) = current.as_mut() {
                    rule.action = value;
                }
            }
            None => {}
        }
    }

    if let Some(rule) = current {
        if !rule.name.is_empty() {
            rules.push(rule);
        }
    }

    rules
}

/// Parses `Yes/No`, `True/False` or Russian `Да/Нет`.
fn parse_netsh_bool(value: &str) -> bool {
    let lower = value.trim().to_lowercase();
    lower.starts_with("yes") || lower.starts_with("true") || lower.starts_with("да")
}

/// Parses `In/Out` or Russian `Входящее/Исходящее`.
fn parse_netsh_direction(value: &str) -> RuleDirection {
    let lower = value.trim().to_lowercase();
    if lower.starts_with("in") || lower.starts_with("вход") {
        RuleDirection::In
    } else if lower.starts_with("out") || lower.starts_with("исход") || lower.starts_with("выход")
    {
        RuleDirection::Out
    } else {
        RuleDirection::Unknown
    }
}

/// Queries firewall rules: fast targeted known names first, then one bounded
/// full inbound enumeration for manual/legacy Valheim-named rules.
fn query_firewall_rules(first_port: u16, last_port: u16) -> Vec<FirewallRuleInfo> {
    let mut parsed_rules: Vec<ParsedRule> = Vec::new();

    // 1. Targeted queries for the known names (~40 ms each on this machine).
    for name in known_firewall_rule_names(first_port, last_port) {
        let mut command = hidden_command("netsh");
        command.args([
            "advfirewall",
            "firewall",
            "show",
            "rule",
            &format!("name={name}"),
        ]);
        match run_command_with_timeout(command, NETSH_KNOWN_RULE_TIMEOUT) {
            Ok(output) if output.timed_out => {
                log::warn!(
                    target: "valheim-server",
                    "netsh show rule name={name}: таймаут {} мс",
                    NETSH_KNOWN_RULE_TIMEOUT.as_millis()
                );
            }
            Ok(output) if output.success() => {
                for rule in parse_netsh_rules(&output.stdout) {
                    if rule.name.eq_ignore_ascii_case(&name) {
                        parsed_rules.push(rule);
                    }
                }
            }
            // A missing rule makes netsh exit non-zero: this is expected.
            Ok(_) => {}
            Err(error) => {
                log::debug!(target: "valheim-server", "netsh недоступен: {error}");
            }
        }
    }

    // 2. Complete inbound list, but never block longer than the hard timeout.
    let enumeration_started = Instant::now();
    let mut command = hidden_command("netsh");
    command.args([
        "advfirewall",
        "firewall",
        "show",
        "rule",
        "name=all",
        "dir=in",
    ]);
    match run_command_with_timeout(command, NETSH_ALL_RULES_TIMEOUT) {
        Ok(output) if output.timed_out => {
            log::warn!(
                target: "valheim-server",
                "перебор правил брандмауэра превысил {} мс — показываю только известные правила",
                NETSH_ALL_RULES_TIMEOUT.as_millis()
            );
        }
        Ok(output) if output.success() => {
            for rule in parse_netsh_rules(&output.stdout) {
                // Only Valheim-related rules are interesting here: broad
                // "allow UDP for any program" rules belong to other software and
                // must not make `firewallOk` true. Rules are found by name (the
                // manager and ops scripts use names containing "Valheim").
                if rule.name.to_lowercase().contains("valheim") {
                    parsed_rules.push(rule);
                }
            }
            log::debug!(
                target: "valheim-server",
                "netsh show rule name=all: {} мс",
                enumeration_started.elapsed().as_millis()
            );
        }
        Ok(_) => {
            log::debug!(target: "valheim-server", "netsh show rule name=all завершился с ошибкой");
        }
        Err(error) => {
            log::debug!(target: "valheim-server", "netsh недоступен: {error}");
        }
    }

    // 3. Keep inbound UDP allow rules, deduplicate, sort for a stable payload.
    let mut rules: Vec<FirewallRuleInfo> = Vec::new();
    for parsed in parsed_rules {
        if !parsed.is_udp_allow() {
            continue;
        }
        let info = parsed.into_info();
        let duplicate = rules
            .iter()
            .any(|existing| existing.name == info.name && existing.ports == info.ports);
        if !duplicate {
            rules.push(info);
        }
    }
    rules.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.ports.cmp(&right.ports))
    });
    rules
}

// --- Ports -----------------------------------------------------------------

/// Checks whether a UDP port can be used.
///
/// A plain `bind(0.0.0.0:port)` is not enough: Valheim listens on
/// `[::]:<port>` (dual-stack), and on Windows binding the IPv4 wildcard can
/// still succeed while the IPv6 wildcard is taken. Therefore the port is also
/// checked through `netstat`, which reports IPv6 endpoints too.
#[must_use]
pub fn is_udp_port_free(port: u16) -> bool {
    if let Ok(bound_ports) = udp_bound_ports() {
        if bound_ports.contains(&port) {
            return false;
        }
    }

    UdpSocket::bind(("0.0.0.0", port)).is_ok()
}

/// Parses UDP local ports from `netstat -ano -p UDP` output.
#[must_use]
pub fn parse_netstat_udp_ports(output: &str) -> BTreeSet<u16> {
    let mut ports = BTreeSet::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.to_ascii_uppercase().starts_with("UDP") {
            continue;
        }

        let mut tokens = trimmed.split_whitespace();
        let _protocol = tokens.next();
        let Some(local_address) = tokens.next() else {
            continue;
        };
        let Some((_, port)) = local_address.rsplit_once(':') else {
            continue;
        };
        if let Ok(port) = port.parse::<u16>() {
            ports.insert(port);
        }
    }

    ports
}

/// Runs `netstat` and returns the set of bound UDP ports.
pub fn udp_bound_ports() -> Result<BTreeSet<u16>, AppError> {
    let mut command = hidden_command("netstat");
    command.args(["-ano", "-p", "UDP"]);
    let output = run_command_with_timeout(command, NETSTAT_TIMEOUT)?;

    if output.timed_out {
        return Err(AppError::Network(format!(
            "netstat не ответил за {} мс",
            NETSTAT_TIMEOUT.as_millis()
        )));
    }
    if !output.success() {
        return Err(AppError::Network(
            "netstat завершился с ошибкой".to_string(),
        ));
    }

    Ok(parse_netstat_udp_ports(&output.stdout))
}

// --- Local IPs -------------------------------------------------------------

/// Returns local IPv4 addresses: parsed from `ipconfig` (fast, ~10 ms) plus the
/// primary route address from a UDP socket as a fallback.
#[must_use]
pub fn local_ipv4_addresses() -> Vec<String> {
    let mut addresses: Vec<String> = Vec::new();

    let command = hidden_command("ipconfig");
    match run_command_with_timeout(command, IPCONFIG_TIMEOUT) {
        Ok(output) if !output.timed_out => {
            addresses.extend(parse_ipconfig_ipv4(&output.stdout));
        }
        Ok(output) if output.timed_out => {
            log::debug!(target: "valheim-server", "ipconfig: таймаут, используем socket fallback");
        }
        Ok(_) => {
            log::debug!(target: "valheim-server", "ipconfig завершился с ошибкой");
        }
        Err(error) => {
            log::debug!(target: "valheim-server", "ipconfig недоступен: {error}");
        }
    }

    if let Some(primary) = primary_local_ip() {
        if !addresses.iter().any(|address| address == &primary) {
            addresses.insert(0, primary);
        }
    }

    addresses.retain(|address| is_usable_ipv4(address));
    addresses.sort();
    addresses.dedup();
    addresses
}

/// Parses IPv4 addresses from `ipconfig` output (RU/EN).
///
/// Only lines that mention `IPv4` are used, so subnet masks, gateways and IPv6
/// addresses are ignored.
#[must_use]
pub fn parse_ipconfig_ipv4(output: &str) -> Vec<String> {
    let mut addresses: Vec<String> = Vec::new();

    for line in output.lines() {
        if !line.to_ascii_lowercase().contains("ipv4") {
            continue;
        }
        let Some((_, value)) = line.split_once(':') else {
            continue;
        };
        for token in value.split_whitespace() {
            // Addresses may be suffixed with `(Preferred)` / `(Основной)`.
            let candidate = token
                .trim_matches(|character: char| !character.is_ascii_digit() && character != '.');
            if is_usable_ipv4(candidate) {
                addresses.push(candidate.to_string());
                break;
            }
        }
    }

    addresses.sort();
    addresses.dedup();
    addresses
}

/// Returns the primary non-loopback IPv4 address of the machine.
#[must_use]
pub fn primary_local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        None
    } else {
        Some(ip.to_string())
    }
}

/// Returns `true` for usable local IPv4 addresses (no loopback/link-local).
#[must_use]
pub fn is_usable_ipv4(value: &str) -> bool {
    value
        .parse::<Ipv4Addr>()
        .is_ok_and(|ip| !ip.is_loopback() && !ip.is_unspecified() && !ip.is_link_local())
}

/// Checks whether `ports` (firewall rule local ports) cover the inclusive range.
#[must_use]
pub fn ports_cover(ports: &str, first: u16, last: u16) -> bool {
    let normalized = ports.trim();
    if normalized.is_empty() {
        // An empty `LocalPort` means the filter does not apply to ports at all;
        // such a rule cannot be counted as covering the server ports.
        return false;
    }
    let lower = normalized.to_lowercase();
    if lower == "any" || lower == "любой" || lower == "любые" || normalized == "*" {
        return true;
    }

    let mut covered = BTreeSet::new();
    for part in normalized.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((start, end)) = part.split_once('-') {
            let (Ok(start), Ok(end)) = (start.trim().parse::<u16>(), end.trim().parse::<u16>())
            else {
                continue;
            };
            for port in start..=end {
                covered.insert(port);
            }
        } else if let Ok(port) = part.parse::<u16>() {
            covered.insert(port);
        }
    }

    (first..=last).all(|port| covered.contains(&port))
}

// --- Firewall modification -------------------------------------------------

/// Adds an inbound UDP firewall rule for the server ports.
///
/// Requires administrator rights; a refusal is reported as
/// [`AppError::ElevationRequired`].
pub fn open_firewall_ports(config: &AppConfig) -> Result<NetworkDiagnosis, AppError> {
    let main_port = config.server.port;
    let last_port = main_port.saturating_add(PORT_SPAN - 1);
    let rule_name = firewall_rule_name(main_port, last_port);
    let ports_argument = format!("localport={main_port}-{last_port}");

    // Replace an existing rule with the same name to keep the list clean.
    let mut delete_command = hidden_command("netsh");
    delete_command.args([
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        &format!("name={rule_name}"),
    ]);
    let _ = run_command_with_timeout(delete_command, NETSH_ACTION_TIMEOUT);

    let mut add_command = hidden_command("netsh");
    add_command.args([
        "advfirewall",
        "firewall",
        "add",
        "rule",
        &format!("name={rule_name}"),
        "dir=in",
        "action=allow",
        "protocol=UDP",
        &ports_argument,
    ]);
    let output = run_command_with_timeout(add_command, NETSH_ACTION_TIMEOUT)?;

    if output.timed_out || !output.success() {
        let text = output.combined_output();
        let lower = text.to_lowercase();
        if lower.contains("elevat")
            || lower.contains("access is denied")
            || text.contains("отказано")
            || text.contains("администратор")
        {
            return Err(AppError::ElevationRequired(format!(
                "netsh не смог добавить правило UDP {main_port}–{last_port}: нужны права администратора. Запустите приложение от имени администратора или добавьте правило вручную."
            )));
        }
        return Err(AppError::Network(format!(
            "netsh не смог добавить правило: {}",
            text.trim()
        )));
    }

    invalidate_diagnosis_cache();
    Ok(diagnose_network_uncached(config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ServerSettings;

    fn sample_diagnosis(main_port: u16) -> NetworkDiagnosis {
        NetworkDiagnosis {
            main_port,
            port_range: (main_port, main_port.saturating_add(2)),
            ports: Vec::new(),
            firewall_rules: Vec::new(),
            firewall_ok: false,
            local_ips: Vec::new(),
            generated_at: 0,
            hints: Vec::new(),
        }
    }

    #[test]
    fn parses_udp_ports_from_netstat_output() {
        let output = "\r\nАктивные подключения\r\n\r\n  Proto  Локальный адрес        Внешний адрес          PID\r\n  UDP    0.0.0.0:2456           *:*                    1234\r\n  UDP    0.0.0.0:2457           *:*                    1234\r\n  UDP    [::]:2458              *:*                    1234\r\n  UDP    127.0.0.1:50000        *:*                    999\r\n  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING\r\n";

        let ports = parse_netstat_udp_ports(output);
        assert!(ports.contains(&2456));
        assert!(ports.contains(&2457));
        assert!(ports.contains(&2458));
        assert!(ports.contains(&50000));
        assert!(!ports.contains(&80));
        assert_eq!(ports.len(), 4);
    }

    #[test]
    fn parses_empty_netstat_output() {
        assert_eq!(parse_netstat_udp_ports("").len(), 0);
        assert_eq!(parse_netstat_udp_ports("garbage\n").len(), 0);
    }

    #[test]
    fn ports_cover_handles_ranges_lists_and_any() {
        assert!(ports_cover("2456-2458", 2456, 2458));
        assert!(ports_cover("2455-2460", 2456, 2458));
        assert!(ports_cover("2456,2457,2458", 2456, 2458));
        assert!(ports_cover("Any", 2456, 2458));
        assert!(ports_cover("Любой", 2456, 2458));
        assert!(ports_cover("*", 2456, 2458));

        assert!(!ports_cover("2456-2457", 2456, 2458));
        assert!(!ports_cover("2456", 2456, 2458));
        assert!(!ports_cover("", 2456, 2458));
        assert!(!ports_cover("2457-2458", 2456, 2458));
    }

    #[test]
    fn firewall_rule_name_is_stable() {
        assert_eq!(
            firewall_rule_name(2456, 2458),
            "Valheim Server Manager (UDP 2456-2458)"
        );
    }

    #[test]
    fn known_rule_names_include_manager_and_ops_variants() {
        let names = known_firewall_rule_names(2456, 2458);
        assert!(
            names
                .iter()
                .any(|name| name == "Valheim Server Manager (UDP 2456-2458)")
        );
        assert!(
            names
                .iter()
                .any(|name| name == "Valheim Server (UDP 2456-2458)")
        );

        let custom = known_firewall_rule_names(2466, 2468);
        assert!(custom.iter().any(|name| name.contains("2466-2468")));
        assert!(custom.iter().any(|name| name.contains("2456-2458")));
    }

    #[test]
    fn parses_english_netsh_rule() {
        let output = "Rule Name:                            Valheim Server (UDP 2456-2458)\r\n----------------------------------------------------------------------\r\nEnabled:                              Yes\r\nDirection:                            In\r\nProfiles:                             Domain,Private,Public\r\nProtocol:                             UDP\r\nLocalPort:                            2456-2458\r\nAction:                               Allow\r\n";

        let rules = parse_netsh_rules(output);
        assert_eq!(rules.len(), 1);
        let rule = &rules[0];
        assert_eq!(rule.name, "Valheim Server (UDP 2456-2458)");
        assert!(rule.enabled);
        assert_eq!(rule.direction, RuleDirection::In);
        assert_eq!(rule.ports, "2456-2458");
        assert!(rule.is_udp_allow());
    }

    #[test]
    fn parses_real_russian_netsh_rule_from_this_machine() {
        // Real `netsh advfirewall firewall show rule name="Valheim Server (UDP 2456-2458)"`
        // output captured from the app process on this Windows machine (RU MUI):
        // note the masculine «Включен» label and «Вход» direction value, which
        // differ from older translations.
        let output = "\r\nИмя правила:                          Valheim Server (UDP 2456-2458)\r\n----------------------------------------------------------------------\r\nВключен:                              Да\r\nНаправление:                          Вход\r\nProfiles:                             Домен,Частный,Публичный\r\nГруппировка:                          \r\nLocalIP:                              Любой\r\nУдаленный IP:                         Любой\r\nПротокол:                             UDP\r\nЛокальный порт:                       2456-2458\r\nУдаленный порт:                       Любой\r\nДействие:                             Разрешить\r\n";

        let rules = parse_netsh_rules(output);
        assert_eq!(rules.len(), 1);
        let rule = &rules[0];
        assert_eq!(rule.name, "Valheim Server (UDP 2456-2458)");
        assert!(rule.enabled);
        assert_eq!(rule.direction, RuleDirection::In);
        assert_eq!(rule.ports, "2456-2458");
        assert!(rule.is_udp_allow());
        assert!(ports_cover(&rule.ports, 2456, 2458));
    }

    #[test]
    fn parses_russian_netsh_rule() {
        let output = "Правило:                              Valheim Server (UDP 2456-2458)\r\n----------------------------------------------------------------------\r\nВключено:                             Да\r\nНаправление:                          Входящее\r\nПрофили:                              Частный\r\nПротокол:                             UDP\r\nЛокальный порт:                       2456-2458\r\nДействие:                             Разрешить\r\n";

        let rules = parse_netsh_rules(output);
        assert_eq!(rules.len(), 1);
        let rule = &rules[0];
        assert_eq!(rule.name, "Valheim Server (UDP 2456-2458)");
        assert!(rule.enabled);
        assert_eq!(rule.direction, RuleDirection::In);
        assert_eq!(rule.ports, "2456-2458");
        assert!(rule.is_udp_allow());
        assert_eq!(
            rule.clone().into_info(),
            FirewallRuleInfo {
                name: "Valheim Server (UDP 2456-2458)".to_string(),
                enabled: true,
                ports: "2456-2458".to_string(),
                direction: RuleDirection::In,
            }
        );
    }

    #[test]
    fn parses_multiple_netsh_rules_and_skips_irrelevant_ones() {
        let output = "Rule Name:                            Valheim Server (UDP 2456-2458)\r\n----------------------------------------------------------------------\r\nEnabled:                              Yes\r\nDirection:                            In\r\nProtocol:                             UDP\r\nLocalPort:                            2456-2458\r\nAction:                               Allow\r\nRule Name:                            Valheim TCP\r\n----------------------------------------------------------------------\r\nEnabled:                              Yes\r\nDirection:                            In\r\nProtocol:                             TCP\r\nLocalPort:                            2456-2458\r\nAction:                               Allow\r\nRule Name:                            Valheim blocked\r\n----------------------------------------------------------------------\r\nEnabled:                              Yes\r\nDirection:                            In\r\nProtocol:                             UDP\r\nLocalPort:                            2456-2458\r\nAction:                               Block\r\nRule Name:                            Disabled rule\r\n----------------------------------------------------------------------\r\nEnabled:                              No\r\nDirection:                            In\r\nProtocol:                             UDP\r\nLocalPort:                            7000\r\nAction:                               Allow\r\n";

        let rules = parse_netsh_rules(output);
        assert_eq!(rules.len(), 4);
        assert_eq!(rules[0].name, "Valheim Server (UDP 2456-2458)");
        assert_eq!(rules[1].name, "Valheim TCP");
        assert!(!rules[1].is_udp_allow());
        assert!(!rules[2].is_udp_allow());
        assert!(!rules[3].enabled);
        assert!(rules[3].is_udp_allow());
    }

    #[test]
    fn netsh_output_without_rules_is_empty() {
        assert_eq!(
            parse_netsh_rules("No rules match the specified criteria.\r\n").len(),
            0
        );
        assert_eq!(
            parse_netsh_rules("Правил, соответствующих указанным условиям, не найдено.\r\n").len(),
            0
        );
    }

    #[test]
    fn parses_ipv4_from_english_ipconfig() {
        let output = "Windows IP Configuration\r\n\r\nEthernet adapter Ethernet:\r\n\r\n   Connection-specific DNS Suffix  . : lan\r\n   Link-local IPv6 Address . . . . . : fe80::1%12\r\n   IPv4 Address. . . . . . . . . . . : 192.168.1.10\r\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\r\n   IPv4 Address. . . . . . . . . . . : 169.254.5.6\r\n   Default Gateway . . . . . . . . . : 192.168.1.1\r\n";
        assert_eq!(parse_ipconfig_ipv4(output), vec!["192.168.1.10"]);
    }

    #[test]
    fn parses_ipv4_from_russian_ipconfig() {
        let output = "Настройка протокола IP для Windows\r\n\r\nАдаптер Ethernet Ethernet:\r\n\r\n   IPv4-адрес. . . . . . . . . . . . : 10.0.0.5(Основной)\r\n   Маска подсети . . . . . . . . . . : 255.255.255.0\r\n";
        assert_eq!(parse_ipconfig_ipv4(output), vec!["10.0.0.5"]);
    }

    #[test]
    fn usable_ipv4_filters_loopback_and_link_local() {
        assert!(is_usable_ipv4("192.168.1.10"));
        assert!(!is_usable_ipv4("127.0.0.1"));
        assert!(!is_usable_ipv4("169.254.5.6"));
        assert!(!is_usable_ipv4("0.0.0.0"));
        assert!(!is_usable_ipv4("not-an-ip"));
    }

    #[test]
    fn diagnosis_cache_reuses_results_and_expires() {
        let cache = DiagnosisCache::new(Duration::from_secs(5));
        let now = Instant::now();
        let diagnosis = sample_diagnosis(2456);

        assert_eq!(cache.get(2456, now), None);
        cache.put(2456, now, diagnosis.clone());

        assert_eq!(
            cache.get(2456, now + Duration::from_millis(1000)),
            Some(diagnosis.clone())
        );
        // Another port must not hit the cache entry.
        assert_eq!(cache.get(2466, now), None);
        // Exactly at the TTL the entry is stale.
        assert_eq!(cache.get(2456, now + Duration::from_secs(5)), None);

        cache.put(2456, now, diagnosis);
        cache.invalidate();
        assert_eq!(cache.get(2456, now), None);
    }

    #[test]
    fn hints_mention_the_ports_and_crossplay_rules() {
        let config = AppConfig {
            server: ServerSettings {
                port: 2456,
                crossplay: false,
                ..ServerSettings::default()
            },
            ..AppConfig::default()
        };
        let ports = vec![
            PortCheck {
                port: 2456,
                protocol: PortProtocol::Udp,
                state: PortState::Closed,
            },
            PortCheck {
                port: 2457,
                protocol: PortProtocol::Udp,
                state: PortState::Closed,
            },
            PortCheck {
                port: 2458,
                protocol: PortProtocol::Udp,
                state: PortState::Closed,
            },
        ];

        let hints = build_hints(&config, &ports, false, &["192.168.1.10".to_string()]);
        let joined = hints.join(" ");
        assert!(joined.contains("2456–2458"));
        assert!(joined.contains("брандмауэр"));
        assert!(joined.contains("192.168.1.10"));

        let crossplay_config = AppConfig {
            server: ServerSettings {
                crossplay: true,
                ..ServerSettings::default()
            },
            ..AppConfig::default()
        };
        let hints = build_hints(&crossplay_config, &ports, true, &[]);
        let joined = hints.join(" ");
        assert!(joined.contains("код приглашения"));
        assert!(joined.contains("не нужен"));
    }

    #[test]
    fn diagnosis_serializes_in_camel_case() {
        let diagnosis = NetworkDiagnosis {
            main_port: 2456,
            port_range: (2456, 2458),
            ports: vec![PortCheck {
                port: 2456,
                protocol: PortProtocol::Udp,
                state: PortState::Listening,
            }],
            firewall_rules: vec![FirewallRuleInfo {
                name: "rule".to_string(),
                enabled: true,
                ports: "2456-2458".to_string(),
                direction: RuleDirection::In,
            }],
            firewall_ok: true,
            local_ips: vec!["192.168.1.10".to_string()],
            generated_at: 1,
            hints: vec!["hint".to_string()],
        };
        let payload = serde_json::to_value(&diagnosis).expect("serializes");

        assert_eq!(payload["mainPort"], 2456);
        assert_eq!(payload["portRange"][0], 2456);
        assert_eq!(payload["portRange"][1], 2458);
        assert_eq!(payload["ports"][0]["protocol"], "udp");
        assert_eq!(payload["ports"][0]["state"], "listening");
        assert_eq!(payload["firewallRules"][0]["direction"], "in");
        assert_eq!(payload["firewallOk"], true);
        assert_eq!(payload["localIps"][0], "192.168.1.10");
        assert_eq!(payload["generatedAt"], 1);
        assert!(payload.get("main_port").is_none());
    }

    /// Measures the real diagnostics on this machine. Ignored by default:
    /// run with `cargo test -- --ignored --nocapture measure_diagnose_network`.
    #[test]
    #[ignore = "runs real netsh/netstat/ipconfig calls; use --ignored --nocapture"]
    fn measure_diagnose_network_on_this_machine() {
        let temp = tempfile::tempdir().expect("temp dir");
        let base = crate::paths::BasePaths::new(
            temp.path().join("config"),
            temp.path().join("data"),
            temp.path().join("data").join("logs"),
            temp.path().join("root"),
        );
        let config = AppConfig::defaults(&base);
        let main_port = config.server.port;
        let last_port = main_port.saturating_add(PORT_SPAN - 1);

        let started = Instant::now();
        let bound = udp_bound_ports();
        println!(
            "netstat: {} ms (ok={})",
            started.elapsed().as_millis(),
            bound.is_ok()
        );

        let started = Instant::now();
        let rules = query_firewall_rules(main_port, last_port);
        println!(
            "firewall (targeted + bounded enumeration): {} ms, {} rules: {:?}",
            started.elapsed().as_millis(),
            rules.len(),
            rules
                .iter()
                .map(|rule| format!("{} [{}]", rule.name, rule.ports))
                .collect::<Vec<_>>()
        );

        let started = Instant::now();
        let ips = local_ipv4_addresses();
        println!("local ips: {} ms, {:?}", started.elapsed().as_millis(), ips);

        invalidate_diagnosis_cache();
        let started = Instant::now();
        let first = diagnose_network(&config);
        let first_ms = started.elapsed().as_millis();
        let started = Instant::now();
        let cached = diagnose_network(&config);
        let cached_ms = started.elapsed().as_millis();
        println!(
            "diagnose_network: first {first_ms} ms, cache hit {cached_ms} ms, total rules {}, ports {}",
            first.firewall_rules.len(),
            cached.ports.len()
        );

        assert!(
            first_ms < 3000,
            "diagnose_network must not exceed 3 s, got {first_ms} ms"
        );
        assert!(
            cached_ms < 100,
            "cache hit must be fast, got {cached_ms} ms"
        );
    }
}
