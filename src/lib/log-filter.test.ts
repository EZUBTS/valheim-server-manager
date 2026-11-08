import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOG_FILTERS,
  appendLogLine,
  countLogLevels,
  countLogSources,
  filterLogs,
  hasLogProblems,
  sortLogLines,
} from '@/lib/log-filter';
import type { LogLine } from '@/lib/types';

function line(seq: number, overrides: Partial<LogLine> = {}): LogLine {
  return {
    seq,
    ts: 1_700_000_000_000 + seq,
    source: 'server',
    level: 'info',
    line: `line ${seq}`,
    ...overrides,
  };
}

const LINES: LogLine[] = [
  line(1, { source: 'app', line: 'Приложение запущено' }),
  line(2, { source: 'steamcmd', line: "Success! App '896660' fully installed." }),
  line(3, { source: 'server', level: 'warn', line: 'Network version check, their:40' }),
  line(4, { source: 'server', line: 'Game server connected' }),
  line(5, { source: 'server', level: 'error', line: 'Error bad password:' }),
  line(6, { source: 'server', level: 'debug', line: 'Player history entry with index 0' }),
];

describe('filterLogs', () => {
  it('returns everything with default filters', () => {
    expect(filterLogs(LINES, DEFAULT_LOG_FILTERS)).toHaveLength(LINES.length);
  });

  it('filters by source', () => {
    const filtered = filterLogs(LINES, { source: 'server', level: 'all', query: '' });

    expect(filtered).toHaveLength(4);
    expect(filtered.every((entry) => entry.source === 'server')).toBe(true);
  });

  it('filters by level', () => {
    const filtered = filterLogs(LINES, { source: 'all', level: 'warn', query: '' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.line).toContain('Network version');
  });

  it('searches case-insensitively and trims the query', () => {
    expect(filterLogs(LINES, { source: 'all', level: 'all', query: '  CONNECTED ' })).toHaveLength(
      1,
    );
    expect(filterLogs(LINES, { source: 'all', level: 'all', query: 'app' })).toHaveLength(1);
  });

  it('combines all filters', () => {
    expect(filterLogs(LINES, { source: 'server', level: 'error', query: 'password' })).toHaveLength(
      1,
    );
    expect(filterLogs(LINES, { source: 'steamcmd', level: 'error', query: '' })).toHaveLength(0);
  });
});

describe('log counters', () => {
  it('counts levels and sources', () => {
    const levels = countLogLevels(LINES);
    const sources = countLogSources(LINES);

    expect(levels).toEqual({ debug: 1, info: 3, warn: 1, error: 1 });
    expect(sources).toEqual({ server: 4, steamcmd: 1, app: 1 });
  });

  it('detects problem lines', () => {
    expect(hasLogProblems(LINES)).toBe(true);
    expect(hasLogProblems([line(1)])).toBe(false);
  });
});

describe('ring buffer helpers', () => {
  it('appends lines and ignores duplicates', () => {
    const buffer = [line(1)];

    expect(appendLogLine(buffer, line(2))).toHaveLength(2);
    expect(appendLogLine(buffer, line(1))).toHaveLength(1);
  });

  it('caps the buffer from the end', () => {
    const buffer = [line(1), line(2), line(3)];
    const next = appendLogLine(buffer, line(4), 3);

    expect(next.map((entry) => entry.seq)).toEqual([2, 3, 4]);
  });

  it('sorts by sequence', () => {
    expect(sortLogLines([line(3), line(1), line(2)]).map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });
});
