import { describe, expect, it } from 'vitest';

import {
  EMPTY_VALUE,
  clampPercent,
  formatBackupCount,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPlayerCount,
  formatPort,
  formatPortRange,
  formatRelativeTime,
  formatTime,
  formatUptime,
  formatVersion,
  isValidSteamId,
  normalizeSteamId,
  pluralRu,
} from '@/lib/format';

describe('formatBytes', () => {
  it('formats binary units with Russian decimals', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1024)).toBe('1 КБ');
    expect(formatBytes(1536)).toBe('1,5 КБ');
    expect(formatBytes(1024 * 1024 * 3.25)).toBe('3,3 МБ');
  });

  it('renders an em dash for empty values', () => {
    expect(formatBytes(null)).toBe(EMPTY_VALUE);
    expect(formatBytes(undefined)).toBe(EMPTY_VALUE);
    expect(formatBytes(Number.NaN)).toBe(EMPTY_VALUE);
  });
});

describe('formatDuration', () => {
  it('formats human uptime', () => {
    expect(formatUptime(0)).toBe('0 с');
    expect(formatUptime(45)).toBe('45 с');
    expect(formatUptime(125)).toBe('2 мин 5 с');
    expect(formatUptime(3750)).toBe('1 ч 2 мин');
    expect(formatUptime(90_000)).toBe('1 д 1 ч');
  });

  it('formats clock uptime', () => {
    expect(formatDuration(45, 'clock')).toBe('00:00:45');
    expect(formatDuration(3750, 'clock')).toBe('01:02:30');
    expect(formatDuration(90_061, 'clock')).toBe('1 д 01:01:01');
  });

  it('rejects invalid input', () => {
    expect(formatDuration(null)).toBe(EMPTY_VALUE);
    expect(formatDuration(-5)).toBe(EMPTY_VALUE);
  });
});

describe('dates and numbers', () => {
  it('formats Russian dates and times', () => {
    const timestamp = new Date('2026-11-08T12:34:56').getTime();

    expect(formatDateTime(timestamp)).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}/);
    expect(formatTime(timestamp)).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(formatNumber(12_345)).toMatch(/12\s?345/);
  });

  it('formats relative times', () => {
    const now = Date.now();

    expect(formatRelativeTime(now - 10_000, now)).toBe('только что');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 мин назад');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 ч назад');
    expect(formatRelativeTime(now - 30 * 3_600_000, now)).toBe('вчера');
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe('3 дн назад');
    expect(formatRelativeTime(null, now)).toBe(EMPTY_VALUE);
  });

  it('formats ports, percentages and versions', () => {
    expect(formatPort(2456)).toBe('2456');
    expect(formatPort(null)).toBe(EMPTY_VALUE);
    expect(formatPortRange([2456, 2458])).toBe('2456–2458');
    expect(formatPortRange(null)).toBe(EMPTY_VALUE);
    expect(formatPercent(42.4)).toBe('42 %');
    expect(formatPercent(null)).toBe(EMPTY_VALUE);
    expect(formatVersion('l-1.0.20 (network version 41)')).toBe('l-1.0.20 (network version 41)');
    expect(formatVersion(null)).toBe('неизвестна');
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(null)).toBe(0);
  });
});

describe('Russian plurals', () => {
  it('picks the correct form', () => {
    expect(formatPlayerCount(1)).toBe('1 игрок');
    expect(formatPlayerCount(3)).toBe('3 игрока');
    expect(formatPlayerCount(5)).toBe('5 игроков');
    expect(formatPlayerCount(11)).toBe('11 игроков');
    expect(formatPlayerCount(21)).toBe('21 игрок');
    expect(formatPlayerCount(null)).toBe(EMPTY_VALUE);
    expect(formatBackupCount(2)).toBe('2 бэкапа');
    expect(pluralRu(1, ['руна', 'руны', 'рун'])).toBe('1 руна');
  });
});

describe('player identifiers', () => {
  it('accepts bare SteamID64', () => {
    expect(normalizeSteamId('76561198000000001')).toBe('76561198000000001');
    expect(isValidSteamId(' 76561198000000001 ')).toBe(true);
  });

  it('accepts Valheim 1.0 platform prefixes', () => {
    expect(normalizeSteamId('V_76561198000000001')).toBe('V_76561198000000001');
    expect(normalizeSteamId('v_76561198000000001')).toBe('V_76561198000000001');
    expect(normalizeSteamId('X_2535400000000001')).toBe('X_2535400000000001');
  });

  it('rejects malformed identifiers', () => {
    expect(normalizeSteamId('')).toBeNull();
    expect(normalizeSteamId('12345')).toBeNull();
    expect(normalizeSteamId('V_12345')).toBeNull();
    expect(normalizeSteamId('X_')).toBeNull();
    expect(normalizeSteamId('Steam_76561198000000001')).toBeNull();
  });
});
