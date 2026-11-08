import { describe, expect, it } from 'vitest';

import {
  buildServerArgs,
  buildServerLogFilePath,
  formatCommandLine,
  maskServerArgs,
  quoteArgument,
} from '@/lib/args';
import type { AppConfig } from '@/lib/types';

function createConfig(overrides: Partial<AppConfig['server']> = {}): AppConfig {
  return {
    schemaVersion: 1,
    installDir: 'D:\\Servers\\Valheim\\server',
    steamcmdDir: 'D:\\Servers\\Valheim\\steamcmd',
    backupsDir: 'D:\\Servers\\Valheim\\backups',
    keepBackups: 10,
    autoBackupBeforeUpdate: true,
    autoBackupBeforeStop: true,
    server: {
      name: 'Вальгалла · Дружина Одина',
      world: 'Midgard',
      port: 2456,
      password: 'OdinRaven42',
      isPublic: true,
      crossplay: false,
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
    },
  };
}

const SAVE_DIR = 'D:\\Servers\\Valheim\\server\\savedir';

describe('buildServerArgs', () => {
  it('builds the contract order', () => {
    const args = buildServerArgs(createConfig(), { saveDir: SAVE_DIR });

    expect(args).toEqual([
      '-nographics',
      '-batchmode',
      '-name',
      'Вальгалла · Дружина Одина',
      '-port',
      '2456',
      '-world',
      'Midgard',
      '-password',
      'OdinRaven42',
      '-public',
      '1',
      '-savedir',
      SAVE_DIR,
      '-preset',
      'normal',
      '-saveinterval',
      '300',
    ]);
  });

  it('adds crossplay, log file and extra arguments', () => {
    const args = buildServerArgs(
      createConfig({ crossplay: true, extraArgs: ['-setkey', 'nobuildcost'] }),
      { saveDir: SAVE_DIR },
      'D:\\logs\\server.log',
    );

    expect(args).toContain('-crossplay');
    expect(args).toContain('-logfile');
    expect(args).toContain('D:\\logs\\server.log');
    expect(args.slice(-2)).toEqual(['-setkey', 'nobuildcost']);
  });

  it('sends -public 0 for a hidden server', () => {
    const args = buildServerArgs(createConfig({ isPublic: false }), { saveDir: SAVE_DIR });

    expect(args[args.indexOf('-public') + 1]).toBe('0');
  });

  it('adds -setkey flags in the stable contract order', () => {
    const args = buildServerArgs(
      createConfig({ setKeys: ['playerevents', 'nobuildcost', 'nomap'] }),
      {
        saveDir: SAVE_DIR,
      },
    );
    const firstSetKey = args.indexOf('-setkey');
    const saveInterval = args.indexOf('-saveinterval');

    expect(args.slice(firstSetKey, saveInterval)).toEqual([
      '-setkey',
      'nobuildcost',
      '-setkey',
      'playerevents',
      '-setkey',
      'nomap',
    ]);
  });

  it('replaces the preset with modifier pairs for custom worlds', () => {
    const args = buildServerArgs(
      createConfig({
        preset: 'custom',
        modifiers: {
          combat: 'hard',
          deathPenalty: 'casual',
          resources: 'more',
          raids: 'less',
          portals: 'hard',
        },
        saveIntervalSec: null,
      }),
      { saveDir: SAVE_DIR },
    );

    expect(args).not.toContain('-preset');
    expect(args).not.toContain('-saveinterval');
    expect(args.slice(-15)).toEqual([
      '-modifier',
      'combat',
      'hard',
      '-modifier',
      'deathpenalty',
      'casual',
      '-modifier',
      'resources',
      'more',
      '-modifier',
      'raids',
      'less',
      '-modifier',
      'portals',
      'hard',
    ]);
  });
});

describe('command line formatting', () => {
  it('quotes arguments with spaces and quotes', () => {
    expect(quoteArgument('simple')).toBe('simple');
    expect(quoteArgument('two words')).toBe('"two words"');
    expect(quoteArgument('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteArgument('')).toBe('""');
  });

  it('joins executable and arguments', () => {
    const line = formatCommandLine('D:\\Server Folder\\valheim_server.exe', ['-name', 'My server']);

    expect(line).toBe('"D:\\Server Folder\\valheim_server.exe" -name "My server"');
  });
});

describe('preview helpers', () => {
  it('builds a concrete log file path without placeholders', () => {
    const path = buildServerLogFilePath(
      'C:\\Users\\admin\\AppData\\Local\\ValheimManager\\logs\\',
      new Date(2026, 10, 8, 23, 15, 42),
    );

    expect(path).toBe(
      'C:\\Users\\admin\\AppData\\Local\\ValheimManager\\logs\\server\\server-20261108-231542.log',
    );
    expect(path).not.toMatch(/[{}]/);
  });

  it('masks the -password value for previews without mutating the source', () => {
    const args = ['-name', 'Simple server', '-password', 'TestPassword1', '-port', '2456'];
    const masked = maskServerArgs(args, 'TestPassword1');

    expect(masked).toEqual(['-name', 'Simple server', '-password', '••••••', '-port', '2456']);
    expect(masked).not.toContain('TestPassword1');
    // Исходные аргументы не меняются — это только витрина.
    expect(args[3]).toBe('TestPassword1');
  });

  it('does not add a mask when the password is empty', () => {
    expect(maskServerArgs(['-password', '', '-port', '2456'], '')).toEqual([
      '-password',
      '',
      '-port',
      '2456',
    ]);
  });
});
