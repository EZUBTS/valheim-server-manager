/**
 * Shared store types and the React context for the Valheim server manager.
 *
 * The provider owns the single source of truth for the whole UI; components read
 * it through `useServer()` (see `hooks/use-server.ts`).
 */

import { createContext } from 'react';

import type {
  AppConfig,
  AppInfo,
  BackupInfo,
  InstallProgress,
  InstallStatus,
  KnownPlayer,
  LogLine,
  ModStatus,
  NetworkDiagnosis,
  OpenTarget,
  PlayerListKind,
  PlayerLists,
  ResolvedPaths,
  ServerState,
  WorldInfo,
} from '@/lib/types';

/** Everything the Rust core reports plus the client-side world list. */
export interface ServerData {
  config: AppConfig | null;
  paths: ResolvedPaths | null;
  appInfo: AppInfo | null;
  installStatus: InstallStatus | null;
  serverState: ServerState | null;
  logs: LogLine[];
  worlds: WorldInfo[];
  backups: BackupInfo[];
  players: PlayerLists | null;
  /** Игроки, замеченные в логах/списках, для страницы «Админ». */
  knownPlayers: KnownPlayer[] | null;
  /** Состояние серверных модов (BepInEx + Server_devcommands). */
  modStatus: ModStatus | null;
  network: NetworkDiagnosis | null;
  installProgress: InstallProgress | null;
}

export type LoadStatus = 'loading' | 'ready' | 'error';

/** Keys of long-running actions with their own spinner/disabled state. */
export type PendingAction =
  | 'initial'
  | 'save-config'
  | 'reset-config'
  | 'install'
  | 'update'
  | 'start'
  | 'stop'
  | 'backup-create'
  | 'backup-restore'
  | 'backup-delete'
  | 'players'
  | 'known-players'
  | 'mods-install'
  | 'mods-refresh'
  | 'network'
  | 'firewall'
  | 'open-path'
  | 'port-check'
  | 'clear-logs';

export type PendingState = Record<PendingAction, boolean>;

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  description: string | null;
}

/** A toast without the generated id. */
export type NewToast = Omit<ToastMessage, 'id'>;

/** The full store contract exposed to pages. */
export interface ServerStore {
  data: ServerData;
  status: LoadStatus;
  loadError: string | null;
  pending: PendingState;
  toasts: ToastMessage[];
  /** `true` in the browser preview (`pnpm dev` without the Tauri webview). */
  isPreview: boolean;

  refreshAll: () => Promise<void>;
  refreshServerState: () => Promise<void>;
  refreshInstallStatus: () => Promise<void>;
  refreshWorlds: () => Promise<void>;
  refreshBackups: () => Promise<void>;
  refreshLists: () => Promise<void>;
  refreshKnownPlayers: () => Promise<void>;
  refreshMods: () => Promise<void>;
  refreshNetwork: () => Promise<void>;

  saveConfig: (config: AppConfig) => Promise<boolean>;
  resetConfig: () => Promise<boolean>;

  installSteamcmd: () => Promise<void>;
  updateServer: (validate: boolean) => Promise<void>;
  installMods: () => Promise<boolean>;
  startServer: () => Promise<boolean>;
  stopServer: (force: boolean) => Promise<boolean>;

  createBackup: (label: string | null) => Promise<boolean>;
  restoreBackup: (name: string, createSafetyBackup: boolean) => Promise<boolean>;
  deleteBackup: (name: string) => Promise<boolean>;

  addPlayer: (list: PlayerListKind, id: string, name: string | null) => Promise<boolean>;
  removePlayer: (list: PlayerListKind, id: string) => Promise<boolean>;

  diagnoseNetwork: () => Promise<void>;
  allowFirewall: () => Promise<boolean>;
  openPath: (target: OpenTarget) => Promise<void>;
  checkPortAvailable: (port: number) => Promise<boolean | null>;

  clearLogs: () => Promise<void>;
  notify: (toast: NewToast) => void;
  dismissToast: (id: number) => void;
}

export const ServerContext = createContext<ServerStore | null>(null);
