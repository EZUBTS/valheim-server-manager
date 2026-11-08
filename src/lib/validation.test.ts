import { describe, expect, it } from 'vitest';

import type { AppConfig, ServerSettings } from '@/lib/types';
import {
  getServerWarnings,
  hasErrors,
  validateAppConfig,
  validateDirectory,
  validateExtraArgs,
  validateKeepBackups,
  validatePassword,
  validatePort,
  validateSaveInterval,
  validateServerName,
  validateServerSettings,
  validateWorldName,
} from '@/lib/validation';

function createSettings(overrides: Partial<ServerSettings> = {}): ServerSettings {
  return {
    name: 'Вальгалла · Дружина Одина',
    world: 'Midgard',
    port: 2456,
    password: 'OdinRaven42',
    isPublic: true,
    crossplay: true,
    preset: 'normal',
    modifiers: {
      combat: 'normal',
      deathPenalty: 'normal',
      resources: 'normal',
      raids: 'normal',
      portals: 'normal',
    },
    setKeys: [],
    saveIntervalSec: 300,
    extraArgs: [],
    ...overrides,
  };
}

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    schemaVersion: 1,
    installDir: 'D:\\Servers\\Valheim\\server',
    steamcmdDir: 'D:\\Servers\\Valheim\\steamcmd',
    backupsDir: 'D:\\Servers\\Valheim\\backups',
    keepBackups: 10,
    autoBackupBeforeUpdate: true,
    autoBackupBeforeStop: true,
    server: createSettings(),
    ...overrides,
  };
}

describe('name and world validation', () => {
  it('requires a server name up to 53 characters', () => {
    expect(validateServerName('')).toMatch(/Укажите имя/);
    expect(validateServerName('Вальгалла')).toBeNull();
    expect(validateServerName('а'.repeat(54))).toMatch(/53/);
    expect(validateServerName('Имя\nс переводом')).toMatch(/переводы строк/);
  });

  it('enforces the world name pattern and 20-char limit', () => {
    expect(validateWorldName('')).toMatch(/Укажите имя мира/);
    expect(validateWorldName('Midgard')).toBeNull();
    expect(validateWorldName('Мидгард')).toMatch(/латиница/i);
    expect(validateWorldName('a'.repeat(21))).toMatch(/20/);
    expect(validateWorldName('my_world-2')).toBeNull();
  });
});

describe('password validation', () => {
  it('requires 5–20 characters', () => {
    expect(validatePassword('abcd', createSettings())).toMatch(/5/);
    expect(validatePassword('a'.repeat(21), createSettings())).toMatch(/20/);
    expect(validatePassword('OdinRaven42', createSettings())).toBeNull();
  });

  it('rejects a password contained in the server name', () => {
    expect(validatePassword('Raven', createSettings({ name: 'Вальгалла Raven' }))).toMatch(
      /входить в имя сервера/,
    );
  });
});

describe('numeric validation', () => {
  it('checks the port range', () => {
    expect(validatePort('abc')).toMatch(/целым числом/);
    expect(validatePort(80)).toMatch(/1024/);
    expect(validatePort(70_000)).toMatch(/65535/);
    expect(validatePort(2456)).toBeNull();
    expect(validatePort('2456')).toBeNull();
  });

  it('checks save interval and backup rotation', () => {
    expect(validateSaveInterval(null)).toBeNull();
    expect(validateSaveInterval(59)).toMatch(/60/);
    expect(validateSaveInterval(300)).toBeNull();
    expect(validateKeepBackups(0)).toMatch(/от 1/);
    expect(validateKeepBackups(101)).toMatch(/100/);
    expect(validateKeepBackups(10)).toBeNull();
  });
});

describe('paths and extra arguments', () => {
  it('requires absolute directories', () => {
    expect(validateDirectory('')).toMatch(/Укажите путь/);
    expect(validateDirectory('relative\\path')).toMatch(/абсолютный/);
    expect(validateDirectory('D:\\Servers\\Valheim')).toBeNull();
    expect(validateDirectory('\\\\server\\share')).toBeNull();
  });

  it('rejects empty extra arguments', () => {
    expect(validateExtraArgs([])).toBeNull();
    expect(validateExtraArgs(['-setkey nobuildcost'])).toBeNull();
    expect(validateExtraArgs([''])).toMatch(/пустыми/);
  });
});

describe('aggregate validation', () => {
  it('collects field errors for server settings', () => {
    const errors = validateServerSettings(
      createSettings({ name: '', world: 'немир', port: 1, password: '123' }),
    );

    expect(errors.name).toBeDefined();
    expect(errors.world).toBeDefined();
    expect(errors.port).toBeDefined();
    expect(errors.password).toBeDefined();
    expect(hasErrors(errors)).toBe(true);
  });

  it('validates the whole config', () => {
    expect(hasErrors(validateAppConfig(createConfig()))).toBe(false);

    const errors = validateAppConfig(
      createConfig({
        backupsDir: 'C:\\backups',
        installDir: 'bad',
        server: createSettings({ saveIntervalSec: 10 }),
      }),
    );

    expect(errors.installDir).toBeDefined();
    expect(errors.saveIntervalSec).toBeDefined();
  });

  it('returns non-blocking warnings', () => {
    const warnings = getServerWarnings(createSettings({ crossplay: true }));

    expect(warnings.some((warning) => warning.includes('crossplay'))).toBe(true);
  });
});
