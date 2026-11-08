/** Human labels and tone helpers for the server lifecycle phase. */

import type { InstallProgress, ServerPhase } from '@/lib/types';

export const SERVER_PHASE_LABELS: Record<ServerPhase, string> = {
  stopped: 'Остановлен',
  starting: 'Запускается',
  running: 'Работает',
  stopping: 'Останавливается',
  error: 'Ошибка',
};

export const INSTALL_PHASE_LABELS: Record<InstallProgress['phase'], string> = {
  idle: 'Ожидание',
  downloading: 'Скачивание',
  extracting: 'Распаковка',
  updating: 'Обновление',
  verifying: 'Проверка файлов',
  done: 'Готово',
  error: 'Ошибка',
};

export const SERVER_PHASE_HINTS: Record<ServerPhase, string> = {
  stopped: 'Процесс сервера не запущен',
  starting: 'Процесс запущен, сервер загружает мир',
  running: 'Сервер принимает игроков',
  stopping: 'Сервер сохраняет мир и завершает работу',
  error: 'Процесс завершился с ошибкой — проверьте лог',
};

export type PhaseTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger';

export function getPhaseTone(phase: ServerPhase | null): PhaseTone {
  if (phase === 'running') {
    return 'success';
  }

  if (phase === 'starting' || phase === 'stopping') {
    return 'active';
  }

  if (phase === 'error') {
    return 'danger';
  }

  return 'neutral';
}

/** The process is busy (starting/running/stopping) and cannot be spawned again. */
export function isServerActive(phase: ServerPhase | null): boolean {
  return phase === 'starting' || phase === 'running' || phase === 'stopping';
}

/** Start is allowed only when the process is stopped or failed. */
export function canStartServer(phase: ServerPhase | null): boolean {
  return phase === 'stopped' || phase === 'error' || phase === null;
}

/** Stop is meaningful while the process is starting or running. */
export function canStopServer(phase: ServerPhase | null): boolean {
  return phase === 'starting' || phase === 'running';
}

/** The server finished loading and accepts players (reminder for the dashboard). */
export function isServerReady(phase: ServerPhase | null): boolean {
  return phase === 'running';
}
