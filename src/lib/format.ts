/**
 * Locale-aware formatting helpers for the UI.
 *
 * Everything the user sees is formatted for `ru-RU`: byte sizes use binary
 * units (КБ/МБ/ГБ), durations and dates are Russian, numbers use a comma as the
 * decimal separator. `null`/`undefined`/non-finite values render as an em dash
 * so empty states stay visually calm.
 */

/** Shown whenever a value is missing or not applicable. */
export const EMPTY_VALUE = '—';

const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'] as const;

const fractionFormatters = new Map<number, Intl.NumberFormat>();

function getFractionFormatter(fractionDigits: number): Intl.NumberFormat {
  const cached = fractionFormatters.get(fractionDigits);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });

  fractionFormatters.set(fractionDigits, formatter);

  return formatter;
}

const integerFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats an integer with Russian thousands separators. */
export function formatNumber(value: number): string {
  return Number.isFinite(value) ? integerFormatter.format(value) : EMPTY_VALUE;
}

/** Formats a byte count using binary units: `1536` → `1,5 КБ`. */
export function formatBytes(bytes: number | null | undefined, fractionDigits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return EMPTY_VALUE;
  }

  const absolute = Math.max(0, bytes);

  if (absolute < 1024) {
    return `${Math.round(absolute)} Б`;
  }

  let value = absolute;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${getFractionFormatter(fractionDigits).format(value)} ${BYTE_UNITS[unitIndex] ?? 'Б'}`;
}

/**
 * Formats a duration in seconds.
 *
 * - `short`: human summary without seconds once minutes are known («2 ч 13 мин»);
 * - `clock`: `ЧЧ:ММ:СС` with a day prefix for long uptimes («2 д 03:12:44»).
 */
export function formatDuration(
  seconds: number | null | undefined,
  style: 'short' | 'clock' = 'short',
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return EMPTY_VALUE;
  }

  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (style === 'clock') {
    const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;

    return days > 0 ? `${days} д ${clock}` : clock;
  }

  if (days > 0) {
    return `${days} д ${hours} ч`;
  }

  if (hours > 0) {
    return `${hours} ч ${minutes} мин`;
  }

  if (minutes > 0) {
    return `${minutes} мин ${secs} с`;
  }

  return `${secs} с`;
}

/** Short uptime label: «2 ч 13 мин». */
export function formatUptime(seconds: number | null | undefined): string {
  return formatDuration(seconds, 'short');
}

/** Full Russian date and time: «08.11.2026, 20:15:32». */
export function formatDateTime(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }

  return dateTimeFormatter.format(new Date(value));
}

/** Time of day: «20:15:32». */
export function formatTime(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }

  return timeFormatter.format(new Date(value));
}

/** Date without time: «08.11.2026». */
export function formatDate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }

  return dateFormatter.format(new Date(value));
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Human relative time: «только что», «5 мин назад», «вчера», «08.11.2026». */
export function formatRelativeTime(
  value: number | null | undefined,
  now: number = Date.now(),
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EMPTY_VALUE;
  }

  const diff = now - value;
  const future = diff < 0;
  const absolute = Math.abs(diff);

  if (absolute < 45_000) {
    return 'только что';
  }

  if (absolute < MINUTE * 60) {
    const minutes = Math.max(1, Math.round(absolute / MINUTE));

    return future ? `через ${minutes} мин` : `${minutes} мин назад`;
  }

  if (absolute < HOUR * 24) {
    const hours = Math.round(absolute / HOUR);

    return future ? `через ${hours} ч` : `${hours} ч назад`;
  }

  if (absolute < HOUR * 48) {
    return future ? 'завтра' : 'вчера';
  }

  if (absolute < DAY * 7) {
    const days = Math.round(absolute / DAY);

    return future ? `через ${days} дн` : `${days} дн назад`;
  }

  return formatDate(value);
}

/** Port number as a string, or an em dash. */
export function formatPort(port: number | null | undefined): string {
  return port === null || port === undefined || !Number.isFinite(port) ? EMPTY_VALUE : String(port);
}

/** Inclusive port range: «2456–2458». */
export function formatPortRange(range: [number, number] | null | undefined): string {
  if (!range) {
    return EMPTY_VALUE;
  }

  return `${range[0]}–${range[1]}`;
}

/** Percentage: `42.4` → «42 %». */
export function formatPercent(percent: number | null | undefined, fractionDigits = 0): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return EMPTY_VALUE;
  }

  return `${getFractionFormatter(fractionDigits).format(percent)} %`;
}

/** Russian plural form for a count: `pluralRu(2, ['игрок','игрока','игроков'])` → «2 игрока». */
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const absolute = Math.abs(Math.trunc(count));
  const mod10 = absolute % 10;
  const mod100 = absolute % 100;

  let form = forms[2];

  if (mod10 === 1 && mod100 !== 11) {
    form = forms[0];
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    form = forms[1];
  }

  return `${count} ${form}`;
}

/** «3 игрока», «1 игрок», «—». */
export function formatPlayerCount(count: number | null | undefined): string {
  return count === null || count === undefined || !Number.isFinite(count)
    ? EMPTY_VALUE
    : pluralRu(count, ['игрок', 'игрока', 'игроков']);
}

/** «4 бэкапа», «1 бэкап». */
export function formatBackupCount(count: number | null | undefined): string {
  return count === null || count === undefined
    ? EMPTY_VALUE
    : pluralRu(count, ['бэкап', 'бэкапа', 'бэкапов']);
}

const STEAM_ID64_PATTERN = /^7656\d{13}$/;
const PREFIXED_VALUE_PATTERN = /^([vx])_(.+)$/i;
const XBOX_ID_PATTERN = /^\d{1,20}$/;

/**
 * Normalizes a player identifier pasted into a player list.
 *
 * Valheim 1.0 writes `V_<SteamID64>` entries (Xbox uses `X_<id>`) while older
 * documentation and servers still accept bare 17-digit SteamID64 values. We
 * accept all three forms and keep the user's chosen prefix.
 */
export function normalizeSteamId(input: string): string | null {
  const value = input.trim();

  if (!value) {
    return null;
  }

  if (STEAM_ID64_PATTERN.test(value)) {
    return value;
  }

  const match = PREFIXED_VALUE_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const prefix = (match[1] ?? '').toUpperCase();
  const id = match[2] ?? '';

  if (prefix === 'V') {
    return STEAM_ID64_PATTERN.test(id) ? `V_${id}` : null;
  }

  return XBOX_ID_PATTERN.test(id) ? `X_${id}` : null;
}

/** `true` if the value is a bare SteamID64 or a `V_`/`X_` prefixed player id. */
export function isValidSteamId(input: string): boolean {
  return normalizeSteamId(input) !== null;
}

/** Short hint for SteamID inputs. */
export const STEAM_ID_HINT =
  'Формат Valheim 1.0 — V_<SteamID64> для Steam и X_<ID> для Xbox/Game Pass; «голый» SteamID64 тоже принимается. ID можно скопировать из F2-панели игрока или из строки подключения в логе.';

/** Server version from a log line, or a friendly fallback. */
export function formatVersion(version: string | null | undefined): string {
  return version ? version : 'неизвестна';
}

/** Clamps a value to the 0–100 range (progress bars). */
export function clampPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}
