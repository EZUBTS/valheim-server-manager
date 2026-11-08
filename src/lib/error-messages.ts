/**
 * Turns typed IPC failures into friendly Russian titles and actionable hints.
 *
 * Rust serializes `{ code, message }`; the raw message is often English and
 * technical, so the UI shows a localized title, the original message as detail
 * and a hint that tells the user what to do next (§5.4 of the contract).
 */

import { toIpcError } from '@/lib/ipc';

export interface ErrorHint {
  title: string;
  hint: string | null;
}

const ERROR_HINTS: Record<string, ErrorHint> = {
  VALIDATION: {
    title: 'Проверьте введённые данные',
    hint: 'Исправьте выделенные поля и попробуйте снова.',
  },
  UNEXPECTED: {
    title: 'Неожиданная ошибка ядра',
    hint: 'Подробности записаны в лог приложения — откройте страницу «Логи».',
  },
  IO: {
    title: 'Ошибка доступа к файлам',
    hint: 'Проверьте путь, права доступа и что файл не занят другой программой.',
  },
  NOT_FOUND: {
    title: 'Файл или запись не найдены',
    hint: 'Обновите список и повторите действие.',
  },
  CONFIG: {
    title: 'Ошибка конфигурации',
    hint: 'Проверьте настройки или сбросьте конфигурацию на странице «Настройки».',
  },
  ALREADY_RUNNING: {
    title: 'Сервер уже запущен',
    hint: 'Остановите его, прежде чем выполнить действие.',
  },
  NOT_RUNNING: {
    title: 'Сервер не запущен',
    hint: 'Запустите сервер на странице «Обзор» или «Сервер».',
  },
  SERVER_NOT_INSTALLED: {
    title: 'Файлы сервера не установлены',
    hint: 'Откройте страницу «Сервер» и установите Valheim Dedicated Server.',
  },
  STEAMCMD_NOT_INSTALLED: {
    title: 'SteamCMD не установлен',
    hint: 'Откройте страницу «Сервер» и сначала установите SteamCMD.',
  },
  PORT_IN_USE: {
    title: 'Порт занят',
    hint: 'Выберите другой порт на странице «Мир» или закройте программу, которая его занимает.',
  },
  PROCESS: {
    title: 'Ошибка процесса сервера',
    hint: 'Проверьте лог сервера и запустите его заново.',
  },
  BACKUP_FAILED: {
    title: 'Не удалось создать резервную копию',
    hint: 'Проверьте свободное место и права на каталог бэкапов.',
  },
  ELEVATION_REQUIRED: {
    title: 'Нужны права администратора',
    hint: 'Запустите приложение от имени администратора или добавьте правило брандмауэра вручную.',
  },
  NETWORK: {
    title: 'Ошибка сетевой диагностики',
    hint: 'Повторите проверку и убедитесь, что сетевые службы Windows доступны.',
  },
  UNSUPPORTED: {
    title: 'Операция не поддерживается',
    hint: 'Эта возможность недоступна на текущей системе или в режиме предпросмотра.',
  },
  UNAVAILABLE: {
    title: 'Ядро недоступно',
    hint: 'Приложение открыто в браузере без Rust-ядра — запустите десктопное окно через pnpm desktop:dev.',
  },
  UNKNOWN: {
    title: 'Неизвестная ошибка',
    hint: 'Повторите действие; если ошибка останется — откройте страницу «Логи».',
  },
};

export interface DescribedError {
  /** Stable error code from the Rust core (`UNKNOWN` when absent). */
  code: string;
  /** Localized short title. */
  title: string;
  /** Original technical message from the core. */
  message: string;
  /** Localized actionable hint, if one is known. */
  hint: string | null;
}

/** Normalizes any rejection and attaches a localized title/hint. */
export function describeIpcError(error: unknown): DescribedError {
  const ipcError = toIpcError(error);
  const known = ERROR_HINTS[ipcError.code] ?? ERROR_HINTS['UNKNOWN'];

  return {
    code: ipcError.code,
    title: known?.title ?? 'Неизвестная ошибка',
    message: ipcError.message,
    hint: known?.hint ?? null,
  };
}

/** One-line human message for a toast or banner. */
export function formatErrorForUser(error: unknown): { title: string; description: string } {
  const described = describeIpcError(error);
  const description = described.hint
    ? `${described.message} — ${described.hint}`
    : described.message;

  return { title: described.title, description };
}
