/**
 * Typed wrappers for every Tauri command and event of the Valheim core.
 *
 * This is the only place in the frontend that talks to Rust. All commands follow
 * `docs/ARCHITECTURE.md` §5.2 (snake_case command names, camelCase arguments,
 * camelCase result fields, `{ code, message }` errors) and all events follow §5.3.
 *
 * In the browser preview (`pnpm dev` without Tauri) the same wrappers route to
 * `lib/preview.ts` instead of `invoke`, so the UI is fully usable without Rust.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { isPreviewMode, previewInvoke, previewListen } from '@/lib/preview';
import type {
  AppConfig,
  AppInfo,
  BackupInfo,
  InstallProgress,
  InstallStatus,
  IpcErrorPayload,
  LogLine,
  LogSource,
  ModStatus,
  NetworkDiagnosis,
  OpenTarget,
  KnownPlayer,
  PlayerListKind,
  PlayerLists,
  ResolvedPaths,
  ServerState,
  WorldInfo,
} from '@/lib/types';

export type { AppInfo, IpcErrorPayload };

/**
 * A normalized error for every rejected `invoke` call.
 *
 * Errors crossing the IPC boundary are plain serialized values, not `Error`
 * instances, so they must be converted before they reach the UI.
 */
export class IpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
  }
}

/** Returns `true` for non-null plain objects, narrowing the type safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Narrows an unknown rejection value to the serialized Rust error payload. */
function isIpcErrorPayload(value: unknown): value is IpcErrorPayload {
  return isRecord(value) && typeof value['message'] === 'string';
}

/** Converts any IPC rejection into an {@link IpcError}. */
export function toIpcError(error: unknown): IpcError {
  if (error instanceof IpcError) {
    return error;
  }

  if (typeof error === 'string') {
    return new IpcError('UNKNOWN', error);
  }

  if (isIpcErrorPayload(error)) {
    const code = typeof error.code === 'string' ? error.code : 'UNKNOWN';

    return new IpcError(code, error.message);
  }

  return new IpcError('UNKNOWN', 'An unexpected error occurred');
}

/** Runs a command through the preview backend or the real Rust core. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isPreviewMode()) {
    return previewInvoke<T>(command, args);
  }

  return args === undefined ? invoke<T>(command) : invoke<T>(command, args);
}

/** Subscribes to a Rust event or to the equivalent preview event. */
function subscribe<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isPreviewMode()) {
    return Promise.resolve(
      previewListen(event, (payload) => {
        handler(payload as T);
      }),
    );
  }

  return listen<T>(event, (eventPayload) => {
    handler(eventPayload.payload);
  });
}

// --- System ---------------------------------------------------------------

/** Metadata about the running application. */
export function getAppInfo(): Promise<AppInfo> {
  return call('app_info');
}

/** Resolved absolute paths of the current configuration. */
export function getPaths(): Promise<ResolvedPaths> {
  return call('get_paths');
}

/** Opens a directory or file in the system file manager. */
export function openPath(target: OpenTarget): Promise<void> {
  return call('open_path', { target });
}

// --- Configuration --------------------------------------------------------

export function getConfig(): Promise<AppConfig> {
  return call('get_config');
}

export function saveConfig(config: AppConfig): Promise<AppConfig> {
  return call('save_config', { config });
}

export function resetConfig(): Promise<AppConfig> {
  return call('reset_config');
}

// --- Install and process --------------------------------------------------

export function getInstallStatus(): Promise<InstallStatus> {
  return call('get_install_status');
}

export function installSteamcmd(): Promise<InstallProgress> {
  return call('install_steamcmd');
}

export function updateServer(validate: boolean): Promise<InstallProgress> {
  return call('update_server', { validate });
}

export function getServerState(): Promise<ServerState> {
  return call('get_server_state');
}

export function startServer(): Promise<ServerState> {
  return call('start_server');
}

export function stopServer(force: boolean): Promise<ServerState> {
  return call('stop_server', { force });
}

// --- Logs -----------------------------------------------------------------

export interface GetLogsOptions {
  limit?: number;
  source?: LogSource | null;
  sinceSeq?: number | null;
}

/** Last lines of the ring buffer, used for the first paint. */
export function getLogs(options: GetLogsOptions = {}): Promise<LogLine[]> {
  const { limit = 500, source = null, sinceSeq = null } = options;

  return call('get_logs', { limit, source, sinceSeq });
}

/** Clears the in-memory ring buffer (the log file is untouched). */
export function clearLogs(): Promise<void> {
  return call('clear_logs');
}

// --- Worlds ---------------------------------------------------------------

export function listWorlds(): Promise<WorldInfo[]> {
  return call('list_worlds');
}

// --- Player lists ---------------------------------------------------------

export function getPlayerLists(): Promise<PlayerLists> {
  return call('get_player_lists');
}

/**
 * Players the manager knows about: seen in the log buffer/history plus entries
 * from `adminlist.txt` (used by the «Админ» page).
 */
export function getKnownPlayers(): Promise<KnownPlayer[]> {
  return call('get_known_players');
}

export function addPlayer(
  list: PlayerListKind,
  id: string,
  name: string | null,
): Promise<PlayerLists> {
  return call('add_player', { list, id, name });
}

export function removePlayer(list: PlayerListKind, id: string): Promise<PlayerLists> {
  return call('remove_player', { list, id });
}

// --- Backups --------------------------------------------------------------

export function listBackups(): Promise<BackupInfo[]> {
  return call('list_backups');
}

export function createBackup(label: string | null): Promise<BackupInfo> {
  return call('create_backup', { label });
}

export function restoreBackup(name: string, createSafetyBackup: boolean): Promise<void> {
  return call('restore_backup', { name, createSafetyBackup });
}

export function deleteBackup(name: string): Promise<void> {
  return call('delete_backup', { name });
}

// --- Network --------------------------------------------------------------

export function diagnoseNetwork(): Promise<NetworkDiagnosis> {
  return call('diagnose_network');
}

export function openFirewallPorts(): Promise<NetworkDiagnosis> {
  return call('open_firewall_ports');
}

export function isPortAvailable(port: number): Promise<boolean> {
  return call('is_port_available', { port });
}

// --- Mods (BepInEx) -------------------------------------------------------

/** Installed BepInEx/Server_devcommands state for the «Админ» page. */
export function getModStatus(): Promise<ModStatus> {
  return call('get_mod_status');
}

/** Downloads BepInExPack_Valheim + Server_devcommands into the server dir. */
export function installServerMods(): Promise<ModStatus> {
  return call('install_server_mods');
}

// --- Events (§5.3) --------------------------------------------------------

/** A new line of the server, SteamCMD or application log. */
export function onServerLog(handler: (line: LogLine) => void): Promise<UnlistenFn> {
  return subscribe('server-log', handler);
}

/** The process phase, PID, version, players or join code changed. */
export function onServerState(handler: (state: ServerState) => void): Promise<UnlistenFn> {
  return subscribe('server-state', handler);
}

/** Download/update progress emitted by SteamCMD operations. */
export function onInstallProgress(
  handler: (progress: InstallProgress) => void,
): Promise<UnlistenFn> {
  return subscribe('server-install-progress', handler);
}

/** Player lists were changed outside of the app (files on disk). */
export function onPlayerListsChanged(handler: (lists: PlayerLists) => void): Promise<UnlistenFn> {
  return subscribe('server-lists-changed', handler);
}
