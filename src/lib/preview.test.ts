import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emitPreviewEvent,
  isPreviewMode,
  previewInvoke,
  previewListen,
  resetPreviewBackend,
} from '@/lib/preview';
import type { InstallStatus, LogLine, PlayerLists, ServerState } from '@/lib/types';

describe('preview backend', () => {
  beforeEach(() => {
    resetPreviewBackend();
  });

  it('runs in the browser test environment', () => {
    expect(isPreviewMode()).toBe(true);
  });

  it('serves configuration, install status and state fixtures', async () => {
    const config = await previewInvoke<{ server: { world: string } }>('get_config');
    const install = await previewInvoke<InstallStatus>('get_install_status');
    const state = await previewInvoke<ServerState>('get_server_state');

    expect(config.server.world).toBe('Midgard');
    expect(install.steamcmdInstalled).toBe(true);
    expect(install.serverInstalled).toBe(true);
    expect(state.phase).toBe('running');
    expect(state.joinCode).toBe('483920');
  });

  it('returns recent log lines filtered by source and limit', async () => {
    const all = await previewInvoke<LogLine[]>('get_logs', {
      limit: 500,
      source: null,
      sinceSeq: null,
    });
    const serverOnly = await previewInvoke<LogLine[]>('get_logs', {
      limit: 5,
      source: 'server',
      sinceSeq: null,
    });

    expect(all.length).toBeGreaterThan(30);
    expect(serverOnly.length).toBe(5);
    expect(serverOnly.every((line) => line.source === 'server')).toBe(true);
  });

  it('validates configurations like the Rust core', async () => {
    const config = await previewInvoke<Record<string, unknown>>('get_config');
    const server = config['server'] as Record<string, unknown>;

    await expect(
      previewInvoke('save_config', {
        config: { ...config, server: { ...server, port: 80 } },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('creates, restores and deletes backups', async () => {
    await previewInvoke('stop_server', { force: false });

    const before = await previewInvoke<unknown[]>('list_backups');

    const created = await previewInvoke<{ name: string }>('create_backup', { label: null });
    expect(created.name).toMatch(/\.zip$/);

    const after = await previewInvoke<unknown[]>('list_backups');
    expect(after.length).toBe(before.length + 1);

    await previewInvoke('restore_backup', {
      name: created.name,
      createSafetyBackup: false,
    });
    await previewInvoke('delete_backup', { name: created.name });
    const final = await previewInvoke<unknown[]>('list_backups');
    expect(final.length).toBe(before.length);
  });

  it('refuses to restore while the server is running', async () => {
    const backups = await previewInvoke<Array<{ name: string }>>('list_backups');
    const name = backups[0]?.name ?? 'missing.zip';

    await expect(
      previewInvoke('restore_backup', { name, createSafetyBackup: false }),
    ).rejects.toMatchObject({ code: 'PROCESS' });
  });

  it('adds and removes players and emits lists-changed', async () => {
    const handler = vi.fn<(lists: PlayerLists) => void>();
    const unlisten = previewListen('server-lists-changed', handler);

    const updated = await previewInvoke<PlayerLists>('add_player', {
      list: 'admins',
      id: 'V_76561198000000077',
      name: 'Инвар',
    });

    expect(updated.admins).toHaveLength(3);
    expect(handler).toHaveBeenCalledTimes(1);

    const removed = await previewInvoke<PlayerLists>('remove_player', {
      list: 'admins',
      id: 'V_76561198000000077',
    });
    expect(removed.admins).toHaveLength(2);

    unlisten();
  });

  it('stops the server with a simulated graceful shutdown', async () => {
    const state = await previewInvoke<ServerState>('stop_server', { force: false });

    expect(state.phase).toBe('stopped');
    expect(state.pid).toBeNull();
    expect(state.joinCode).toBeNull();
  });

  it('emits server-state when starting the process', async () => {
    await previewInvoke('stop_server', { force: false });

    const handler = vi.fn<(state: ServerState) => void>();
    const unlisten = previewListen('server-state', handler);

    const starting = await previewInvoke<ServerState>('start_server');
    expect(starting.phase).toBe('starting');
    expect(handler).toHaveBeenCalled();
    expect((handler.mock.calls.at(-1)?.[0] as ServerState | undefined)?.phase).toBe('starting');

    unlisten();
  });

  it('marks firewall ports as allowed after the action', async () => {
    const before = await previewInvoke<{ firewallOk: boolean }>('diagnose_network');
    expect(before.firewallOk).toBe(false);

    const after = await previewInvoke<{ firewallOk: boolean }>('open_firewall_ports');
    expect(after.firewallOk).toBe(true);
  });

  it('installs server mods only while the server is stopped', async () => {
    const initial = await previewInvoke<{
      bepinexInstalled: boolean;
      serverDevcommandsInstalled: boolean;
    }>('get_mod_status');

    expect(initial.bepinexInstalled).toBe(false);
    expect(initial.serverDevcommandsInstalled).toBe(false);

    await expect(previewInvoke('install_server_mods')).rejects.toMatchObject({
      code: 'PROCESS',
    });

    await previewInvoke('stop_server', { force: false });

    const installed = await previewInvoke<{
      bepinexInstalled: boolean;
      bepinexVersion: string | null;
      serverDevcommandsInstalled: boolean;
      serverDevcommandsVersion: string | null;
      plugins: string[];
      installDir: string;
    }>('install_server_mods');

    expect(installed.bepinexInstalled).toBe(true);
    expect(installed.bepinexVersion).toBeTruthy();
    expect(installed.serverDevcommandsInstalled).toBe(true);
    expect(installed.serverDevcommandsVersion).toBeTruthy();
    expect(installed.plugins.length).toBeGreaterThan(0);
    expect(installed.installDir.length).toBeGreaterThan(0);
  });

  it('returns known players sorted by last activity', async () => {
    const players =
      await previewInvoke<Array<{ name: string | null; isAdmin: boolean }>>('get_known_players');

    expect(players.length).toBeGreaterThanOrEqual(3);
    expect(players.some((player) => player.isAdmin)).toBe(true);
  });

  it('clears the log buffer and emits a fresh app line', async () => {
    await previewInvoke('clear_logs');

    const lines = await previewInvoke<LogLine[]>('get_logs', {
      limit: 10,
      source: null,
      sinceSeq: null,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.source).toBe('app');
  });

  it('emits events through the preview bus', () => {
    const handler = vi.fn<(line: LogLine) => void>();
    const unlisten = previewListen('server-log', handler);
    const line: LogLine = { seq: 1, ts: 1, source: 'app', level: 'info', line: 'test' };

    emitPreviewEvent('server-log', line);

    expect(handler).toHaveBeenCalledWith(line);
    unlisten();
  });

  it('rejects unknown commands as unsupported', async () => {
    await expect(previewInvoke('not_a_command')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});
