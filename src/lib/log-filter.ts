/** Pure filtering helpers for the live server log page. */

import type { LogLevel, LogLine, LogSource } from '@/lib/types';

export type LogSourceFilter = LogSource | 'all';
export type LogLevelFilter = LogLevel | 'all';

export interface LogFilters {
  source: LogSourceFilter;
  level: LogLevelFilter;
  query: string;
}

export const DEFAULT_LOG_FILTERS: LogFilters = {
  source: 'all',
  level: 'all',
  query: '',
};

export const LOG_SOURCE_LABELS: Record<LogSource, string> = {
  server: 'Сервер',
  steamcmd: 'SteamCMD',
  app: 'Приложение',
};

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'Отладка',
  info: 'Инфо',
  warn: 'Предупреждения',
  error: 'Ошибки',
};

/** Filters log lines by source, level and a case-insensitive text query. */
export function filterLogs(lines: readonly LogLine[], filters: LogFilters): LogLine[] {
  const query = filters.query.trim().toLowerCase();

  return lines.filter((line) => {
    if (filters.source !== 'all' && line.source !== filters.source) {
      return false;
    }

    if (filters.level !== 'all' && line.level !== filters.level) {
      return false;
    }

    if (query.length > 0 && !line.line.toLowerCase().includes(query)) {
      return false;
    }

    return true;
  });
}

/** Number of lines per level. */
export function countLogLevels(lines: readonly LogLine[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };

  for (const line of lines) {
    counts[line.level] += 1;
  }

  return counts;
}

/** Number of lines per source. */
export function countLogSources(lines: readonly LogLine[]): Record<LogSource, number> {
  const counts: Record<LogSource, number> = { server: 0, steamcmd: 0, app: 0 };

  for (const line of lines) {
    counts[line.source] += 1;
  }

  return counts;
}

/** `true` when the buffer contains at least one warning or error line. */
export function hasLogProblems(lines: readonly LogLine[]): boolean {
  return lines.some((line) => line.level === 'warn' || line.level === 'error');
}

/** Appends a line to a ring buffer, ignoring duplicate `seq` values. */
export function appendLogLine(lines: readonly LogLine[], line: LogLine, limit = 2000): LogLine[] {
  if (lines.some((existing) => existing.seq === line.seq)) {
    return [...lines];
  }

  return [...lines, line].slice(-Math.max(1, limit));
}

/** Sorts log lines by their monotonically increasing sequence number. */
export function sortLogLines(lines: readonly LogLine[]): LogLine[] {
  return [...lines].toSorted((left, right) => left.seq - right.seq);
}
