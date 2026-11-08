import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addPlayer,
  clearLogs,
  createBackup,
  deleteBackup,
  getAppInfo,
  getConfig,
  getKnownPlayers,
  getLogs,
  getModStatus,
  IpcError,
  installServerMods,
  isPortAvailable,
  onInstallProgress,
  onPlayerListsChanged,
  onServerLog,
  onServerState,
  openPath,
  removePlayer,
  restoreBackup,
  saveConfig,
  startServer,
  stopServer,
  toIpcError,
  updateServer,
} from '@/lib/ipc';
import type { AppConfig, LogLine, ServerState } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  isTauri: vi.fn<() => boolean>(() => true),
  listen:
    vi.fn<(event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

const CONFIG: AppConfig = {
  schemaVersion: 1,
  installDir: 'D:\\Servers\\Valheim\\server',
  steamcmdDir: 'D:\\Servers\\Valheim\\steamcmd',
  backupsDir: 'D:\\Servers\\Valheim\\backups',
  keepBackups: 10,
  autoBackupBeforeUpdate: true,
  autoBackupBeforeStop: true,
  server: {
    name: 'Вальгалла',
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
    setKeys: ['nobuildcost'],
    saveIntervalSec: 300,
    extraArgs: [],
  },
};

const SERVER_STATE: ServerState = {
  phase: 'running',
  pid: 42,
  startedAt: 1_700_000_000_000,
  uptimeSec: 120,
  world: 'Midgard',
  port: 2456,
  version: 'l-1.0.20 (network version 41)',
  joinCode: null,
  playersOnline: 2,
  lastExitCode: null,
  lastError: null,
};

describe('IPC command wrappers', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
    mocks.listen.mockReset();
    mocks.listen.mockResolvedValue(() => undefined);
    mocks.isTauri.mockReturnValue(true);
  });

  it('calls app_info without arguments', async () => {
    const info = {
      name: 'Valheim Server Manager',
      version: '0.1.0',
      tauriVersion: '2.12.5',
      os: 'windows',
      arch: 'x86_64',
      debug: true,
    };
    mocks.invoke.mockResolvedValue(info);

    await expect(getAppInfo()).resolves.toEqual(info);
    expect(mocks.invoke).toHaveBeenCalledWith('app_info');
  });

  it('passes the full config to save_config', async () => {
    mocks.invoke.mockResolvedValue(CONFIG);

    await expect(saveConfig(CONFIG)).resolves.toEqual(CONFIG);
    expect(mocks.invoke).toHaveBeenCalledWith('save_config', { config: CONFIG });
  });

  it('uses camelCase arguments for get_logs and fills defaults', async () => {
    mocks.invoke.mockResolvedValue([]);

    await getLogs();
    expect(mocks.invoke).toHaveBeenCalledWith('get_logs', {
      limit: 500,
      source: null,
      sinceSeq: null,
    });

    await getLogs({ limit: 10, source: 'server', sinceSeq: 7 });
    expect(mocks.invoke).toHaveBeenLastCalledWith('get_logs', {
      limit: 10,
      source: 'server',
      sinceSeq: 7,
    });
  });

  it('wraps process and install commands', async () => {
    mocks.invoke.mockResolvedValue(SERVER_STATE);

    await startServer();
    expect(mocks.invoke).toHaveBeenLastCalledWith('start_server');

    await stopServer(false);
    expect(mocks.invoke).toHaveBeenLastCalledWith('stop_server', { force: false });

    await updateServer(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('update_server', { validate: true });

    mocks.invoke.mockResolvedValue(undefined);
    await clearLogs();
    expect(mocks.invoke).toHaveBeenLastCalledWith('clear_logs');
  });

  it('wraps player list commands', async () => {
    mocks.invoke.mockResolvedValue({ admins: [], banned: [], permitted: [] });

    await addPlayer('admins', 'V_76561198000000001', 'Рагнар');
    expect(mocks.invoke).toHaveBeenLastCalledWith('add_player', {
      list: 'admins',
      id: 'V_76561198000000001',
      name: 'Рагнар',
    });

    await removePlayer('banned', 'V_76561198000000001');
    expect(mocks.invoke).toHaveBeenLastCalledWith('remove_player', {
      list: 'banned',
      id: 'V_76561198000000001',
    });
  });

  it('loads known players for the admin page', async () => {
    const players = [
      {
        name: 'Рагнар',
        steamId64: '76561198000000001',
        platformId: 'V_76561198000000001',
        isAdmin: true,
        lastSeenAt: 1_700_000_000_000,
        source: 'history' as const,
      },
    ];
    mocks.invoke.mockResolvedValue(players);

    await expect(getKnownPlayers()).resolves.toEqual(players);
    expect(mocks.invoke).toHaveBeenLastCalledWith('get_known_players');
  });

  it('wraps backup commands', async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await createBackup(null);
    expect(mocks.invoke).toHaveBeenLastCalledWith('create_backup', { label: null });

    await restoreBackup('backup.zip', true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('restore_backup', {
      name: 'backup.zip',
      createSafetyBackup: true,
    });

    await deleteBackup('backup.zip');
    expect(mocks.invoke).toHaveBeenLastCalledWith('delete_backup', { name: 'backup.zip' });
  });

  it('wraps system commands', async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await openPath('installDir');
    expect(mocks.invoke).toHaveBeenLastCalledWith('open_path', { target: 'installDir' });

    mocks.invoke.mockResolvedValue(true);
    await expect(isPortAvailable(2456)).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('is_port_available', { port: 2456 });
  });

  it('wraps mod status and installation commands', async () => {
    const modStatus = {
      bepinexInstalled: false,
      bepinexVersion: null,
      serverDevcommandsInstalled: false,
      serverDevcommandsVersion: null,
      plugins: [],
      installDir: 'D:\\Servers\\Valheim\\server',
    };
    mocks.invoke.mockResolvedValue(modStatus);

    await expect(getModStatus()).resolves.toEqual(modStatus);
    expect(mocks.invoke).toHaveBeenLastCalledWith('get_mod_status');

    await expect(installServerMods()).resolves.toEqual(modStatus);
    expect(mocks.invoke).toHaveBeenLastCalledWith('install_server_mods');

    await openPath('bepinexDir');
    expect(mocks.invoke).toHaveBeenLastCalledWith('open_path', { target: 'bepinexDir' });
  });
});

describe('IPC event wrappers', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.listen.mockResolvedValue(() => undefined);
    mocks.isTauri.mockReturnValue(true);
  });

  it('subscribes to server-log and forwards the payload', async () => {
    const handler = vi.fn<(line: LogLine) => void>();

    await onServerLog(handler);

    expect(mocks.listen).toHaveBeenCalledWith('server-log', expect.any(Function));

    const listener = mocks.listen.mock.calls[0]?.[1];
    const line: LogLine = { seq: 1, ts: 1, source: 'server', level: 'info', line: 'hello' };
    listener?.({ payload: line });

    expect(handler).toHaveBeenCalledWith(line);
  });

  it('subscribes to all documented events', async () => {
    await onServerState(vi.fn());
    await onInstallProgress(vi.fn());
    await onPlayerListsChanged(vi.fn());

    const events = mocks.listen.mock.calls.map(([event]) => event);

    expect(events).toEqual(['server-state', 'server-install-progress', 'server-lists-changed']);
  });
});

describe('browser preview routing', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.isTauri.mockReturnValue(false);
  });

  it('serves preview fixtures instead of invoking Rust', async () => {
    const config = await getConfig();

    expect(config.server.world).toBe('Midgard');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe('toIpcError', () => {
  it('returns existing IpcError instances unchanged', () => {
    const original = new IpcError('VALIDATION', 'nope');

    expect(toIpcError(original)).toBe(original);
  });

  it('normalizes the serialized Rust error payload', () => {
    const error = toIpcError({ code: 'VALIDATION', message: 'Message cannot be empty' });

    expect(error).toBeInstanceOf(IpcError);
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toBe('Message cannot be empty');
  });

  it('falls back to the UNKNOWN code when the payload has no code', () => {
    expect(toIpcError({ message: 'boom' }).code).toBe('UNKNOWN');
  });

  it('normalizes string and unknown rejections', () => {
    expect(toIpcError('plain failure').message).toBe('plain failure');
    expect(toIpcError(undefined).message).toBe('An unexpected error occurred');
  });
});
