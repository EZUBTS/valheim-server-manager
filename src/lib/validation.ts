/**
 * Client-side validation of the Valheim server configuration.
 *
 * These rules mirror the contract in `docs/ARCHITECTURE.md` (§5.2 and §12) and
 * the practical limits from `docs/valheim-server-reference.md` (§3.4). The Rust
 * core validates again — the UI validation exists to show friendly, inline
 * Russian messages without a round-trip.
 */

import type { AppConfig, ServerSettings } from '@/lib/types';

export const SERVER_NAME_MAX_LENGTH = 53;
/** `-world`: latin letters, digits, `_` and `-`, 1–20 characters. */
export const WORLD_NAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
export const WORLD_NAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 5;
export const PASSWORD_MAX_LENGTH = 20;
export const SAVE_INTERVAL_MIN_SEC = 60;
/** The manager's default when no save interval is configured. */
export const SAVE_INTERVAL_DEFAULT_SEC = 300;
export const PORT_MIN = 1024;
export const PORT_MAX = 65535;
export const KEEP_BACKUPS_MIN = 1;
export const KEEP_BACKUPS_MAX = 100;

export type ServerField =
  'name' | 'world' | 'port' | 'password' | 'saveIntervalSec' | 'extraArgs' | 'modifiers';

export type ServerSettingsErrors = Partial<Record<ServerField, string>>;

export type ConfigField = ServerField | 'installDir' | 'steamcmdDir' | 'backupsDir' | 'keepBackups';

export type AppConfigErrors = Partial<Record<ConfigField, string>>;

function normalizeNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value.trim());
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

export function validateServerName(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Укажите имя сервера';
  }

  if (trimmed.length > SERVER_NAME_MAX_LENGTH) {
    return `Имя сервера — не длиннее ${SERVER_NAME_MAX_LENGTH} символов`;
  }

  if (/[\r\n]/.test(value)) {
    return 'Имя не должно содержать переводы строк';
  }

  return null;
}

export function validateWorldName(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Укажите имя мира';
  }

  if (!WORLD_NAME_PATTERN.test(trimmed)) {
    return `Только латиница, цифры, «_» и «-», не длиннее ${WORLD_NAME_MAX_LENGTH} символов`;
  }

  return null;
}

export function validatePort(value: number | string): string | null {
  const numeric = normalizeNumber(value);

  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    return 'Порт должен быть целым числом';
  }

  if (numeric < PORT_MIN || numeric > PORT_MAX) {
    return `Порт должен быть в диапазоне ${PORT_MIN}–${PORT_MAX}`;
  }

  return null;
}

/**
 * Mirrors the Rust check: 5–20 characters and the password must not be part of
 * the server name (the official server script fails with `Error bad password`).
 */
export function validatePassword(
  password: string,
  settings: Pick<ServerSettings, 'name'>,
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Пароль — не короче ${PASSWORD_MIN_LENGTH} символов`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Пароль — не длиннее ${PASSWORD_MAX_LENGTH} символов`;
  }

  const lowerPassword = password.toLowerCase();
  const serverName = settings.name.trim().toLowerCase();

  if (serverName.length > 0 && serverName.includes(lowerPassword)) {
    return 'Пароль не должен входить в имя сервера';
  }

  return null;
}

export function validateSaveInterval(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return 'Интервал сохранения должен быть целым числом';
  }

  if (value < SAVE_INTERVAL_MIN_SEC) {
    return `Минимум ${SAVE_INTERVAL_MIN_SEC} секунд`;
  }

  return null;
}

export function validateKeepBackups(value: number): string | null {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return 'Укажите целое число';
  }

  if (value < KEEP_BACKUPS_MIN || value > KEEP_BACKUPS_MAX) {
    return `Храните от ${KEEP_BACKUPS_MIN} до ${KEEP_BACKUPS_MAX} копий`;
  }

  return null;
}

export function validateDirectory(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Укажите путь к каталогу';
  }

  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    return 'Путь не должен содержать переводы строк';
  }

  if (!isAbsolutePath(trimmed)) {
    return 'Нужен абсолютный путь, например D:\\Servers\\Valheim\\server';
  }

  return null;
}

export function validateExtraArgs(args: string[]): string | null {
  for (const arg of args) {
    if (!arg.trim()) {
      return 'Дополнительные аргументы не должны быть пустыми';
    }

    if (/[\r\n]/.test(arg)) {
      return 'Каждый аргумент — отдельной строкой';
    }
  }

  return null;
}

/** Validates every server setting and returns field-keyed Russian messages. */
export function validateServerSettings(settings: ServerSettings): ServerSettingsErrors {
  const errors: ServerSettingsErrors = {};

  const nameError = validateServerName(settings.name);
  if (nameError) {
    errors.name = nameError;
  }

  const worldError = validateWorldName(settings.world);
  if (worldError) {
    errors.world = worldError;
  }

  const portError = validatePort(settings.port);
  if (portError) {
    errors.port = portError;
  }

  const passwordError = validatePassword(settings.password, settings);
  if (passwordError) {
    errors.password = passwordError;
  }

  const saveIntervalError = validateSaveInterval(settings.saveIntervalSec);
  if (saveIntervalError) {
    errors.saveIntervalSec = saveIntervalError;
  }

  const extraArgsError = validateExtraArgs(settings.extraArgs);
  if (extraArgsError) {
    errors.extraArgs = extraArgsError;
  }

  return errors;
}

/** Validates paths plus the server settings of a full application config. */
export function validateAppConfig(config: AppConfig): AppConfigErrors {
  const errors: AppConfigErrors = { ...validateServerSettings(config.server) };

  const installDirError = validateDirectory(config.installDir);
  if (installDirError) {
    errors.installDir = installDirError;
  }

  const steamcmdDirError = validateDirectory(config.steamcmdDir);
  if (steamcmdDirError) {
    errors.steamcmdDir = steamcmdDirError;
  }

  const backupsDirError = validateDirectory(config.backupsDir);
  if (backupsDirError) {
    errors.backupsDir = backupsDirError;
  }

  const keepBackupsError = validateKeepBackups(config.keepBackups);
  if (keepBackupsError) {
    errors.keepBackups = keepBackupsError;
  }

  return errors;
}

/** Non-blocking warnings for the world/password form. */
export function getServerWarnings(settings: ServerSettings): string[] {
  const warnings: string[] = [];

  if (!settings.password) {
    warnings.push('Без пароля опубликовать сервер в общем списке Steam не получится.');
  }

  if (settings.crossplay) {
    warnings.push(
      'В режиме crossplay проброс портов не нужен, но подключение по локальному IP не работает — игроки заходят по коду приглашения.',
    );
  }

  return warnings;
}

/** `true` when at least one field carries a message. */
export function hasErrors(errors: Readonly<object>): boolean {
  return Object.values(errors).some((message) => Boolean(message));
}

/** The first message in field order (useful for a summary banner). */
export function firstError(errors: Readonly<object>): string | null {
  for (const message of Object.values(errors)) {
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return null;
}
