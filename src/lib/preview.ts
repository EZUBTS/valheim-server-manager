/**
 * Browser preview backend.
 *
 * `pnpm dev` runs the React UI in a plain browser where no Rust core exists.
 * Instead of failing, every IPC command is routed to this in-memory backend that
 * behaves like a running Valheim server: it keeps mutable state, emits the same
 * Tauri events and simulates installation/update progress, so every page is
 * alive during frontend development.
 *
 * The real desktop build never enters this module (`isPreviewMode()` is false
 * inside the Tauri webview), so it cannot mask a missing Rust command in
 * production.
 */

import { isTauri } from '@tauri-apps/api/core';

import { isValidSteamId } from '@/lib/format';
import { appendLogLine } from '@/lib/log-filter';
import {
  buildPreviewNetworkHints,
  createPreviewAppInfo,
  createPreviewBackups,
  createPreviewConfig,
  createPreviewInstallStatus,
  createPreviewKnownPlayers,
  createPreviewLogs,
  createPreviewModStatus,
  createPreviewNetwork,
  createPreviewPaths,
  createPreviewPlayers,
  createPreviewServerState,
  createPreviewWorlds,
  PREVIEW_INSTALL_SIZE,
  PREVIEW_JOIN_CODE,
  PREVIEW_LOCAL_IPS,
  PREVIEW_PUBLIC_IP,
} from '@/lib/preview-data';
import type {
  AppConfig,
  BackupInfo,
  InstallProgress,
  KnownPlayer,
  LogLevel,
  LogLine,
  LogSource,
  ModStatus,
  NetworkDiagnosis,
  PlayerListEntry,
  PlayerListKind,
  PlayerLists,
  PortCheck,
  ServerState,
} from '@/lib/types';
import { firstError, hasErrors, validateAppConfig } from '@/lib/validation';

/** `true` when the UI runs in a plain browser without the Tauri webview. */
export function isPreviewMode(): boolean {
  return !isTauri();
}

/** Events simulated by the preview backend; mirrors §5.3 of the contract. */
export interface PreviewEventMap {
  'server-log': LogLine;
  'server-state': ServerState;
  'server-install-progress': InstallProgress;
  'server-lists-changed': PlayerLists;
}

export type PreviewEventName = keyof PreviewEventMap;

const PREVIEW_EVENT_NAMES = new Set<PreviewEventName>([
  'server-log',
  'server-state',
  'server-install-progress',
  'server-lists-changed',
]);

type PreviewListener = (payload: unknown) => void;

interface PreviewBackend {
  config: AppConfig;
  paths: ReturnType<typeof createPreviewPaths>;
  appInfo: ReturnType<typeof createPreviewAppInfo>;
  installStatus: ReturnType<typeof createPreviewInstallStatus>;
  serverState: ServerState;
  logs: LogLine[];
  nextSeq: number;
  worlds: ReturnType<typeof createPreviewWorlds>;
  backups: BackupInfo[];
  players: PlayerLists;
  knownPlayers: KnownPlayer[];
  modStatus: ModStatus;
  network: NetworkDiagnosis;
  installProgress: InstallProgress | null;
  installedSteamcmdDir: string;
  installedServerDir: string;
}

const listeners = new Map<PreviewEventName, Set<PreviewListener>>();

let backend: PreviewBackend = createBackend();
let activityTimer: ReturnType<typeof setInterval> | null = null;
let activityStep = 0;
let installToken = 0;
let serverToken = 0;

const ACTIVITY_INTERVAL_MS = 7000;
const PREVIEW_COMMAND_DELAY_MS = 70;

const PLAYER_LIST_LABELS: Record<PlayerListKind, string> = {
  admins: 'Администраторы',
  banned: 'Забаненные',
  permitted: 'Допущенные',
};

interface InstallStep {
  progress: InstallProgress;
  delayMs: number;
  log: { source: LogSource; level: LogLevel; line: string } | null;
}

const STEAMCMD_STEPS: readonly InstallStep[] = [
  {
    progress: { phase: 'downloading', message: 'Скачивание steamcmd.zip…', percent: 0 },
    delayMs: 120,
    log: { source: 'steamcmd', level: 'info', line: 'Downloading steamcmd.zip...' },
  },
  {
    progress: { phase: 'downloading', message: 'Скачивание steamcmd.zip…', percent: 45 },
    delayMs: 480,
    log: null,
  },
  {
    progress: { phase: 'downloading', message: 'Скачивание steamcmd.zip…', percent: 100 },
    delayMs: 420,
    log: {
      source: 'steamcmd',
      level: 'info',
      line: 'Update state (0x61) downloading, progress: 100.00 (2543210000 / 2543210000)',
    },
  },
  {
    progress: { phase: 'extracting', message: 'Распаковка steamcmd.zip…', percent: null },
    delayMs: 380,
    log: { source: 'app', level: 'info', line: 'Распаковка steamcmd.zip в каталог SteamCMD' },
  },
  {
    progress: { phase: 'done', message: 'SteamCMD установлен', percent: 100 },
    delayMs: 260,
    log: { source: 'app', level: 'info', line: 'SteamCMD установлен' },
  },
];

const UPDATE_STEPS: readonly InstallStep[] = [
  {
    progress: { phase: 'updating', message: 'Запуск SteamCMD: app_update 896660…', percent: null },
    delayMs: 120,
    log: {
      source: 'steamcmd',
      level: 'info',
      line: "Redirecting stderr to 'steamcmd\\logs\\stderr.txt'",
    },
  },
  {
    progress: { phase: 'verifying', message: 'Проверка файлов сервера…', percent: 35 },
    delayMs: 650,
    log: {
      source: 'steamcmd',
      level: 'info',
      line: '[ 35%] Checking for available updates...',
    },
  },
  {
    progress: { phase: 'updating', message: 'Загрузка обновления…', percent: 78 },
    delayMs: 760,
    log: {
      source: 'steamcmd',
      level: 'info',
      line: 'Update state (0x61) downloading, progress: 78.00 (1980000000 / 2543210000)',
    },
  },
  {
    progress: { phase: 'done', message: 'Сервер обновлён', percent: 100 },
    delayMs: 420,
    log: { source: 'steamcmd', level: 'info', line: "Success! App '896660' fully installed." },
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Throws a payload shaped like the Rust `AppError` (normalized by ipc.ts). */
function previewError(code: string, message: string): never {
  const error = new Error(message);
  Object.assign(error, { code });

  throw error;
}

function createBackend(): PreviewBackend {
  const now = Date.now();
  const config = createPreviewConfig();
  const logs = createPreviewLogs(now);

  return {
    config,
    paths: createPreviewPaths(config),
    appInfo: createPreviewAppInfo(),
    installStatus: createPreviewInstallStatus(config),
    serverState: createPreviewServerState(now),
    logs,
    nextSeq: (logs.at(-1)?.seq ?? 0) + 1,
    worlds: createPreviewWorlds(config, now),
    backups: createPreviewBackups(now),
    players: createPreviewPlayers(),
    knownPlayers: createPreviewKnownPlayers(now),
    modStatus: createPreviewModStatus(config),
    network: createPreviewNetwork(config, now),
    installProgress: null,
    installedSteamcmdDir: config.steamcmdDir,
    installedServerDir: config.installDir,
  };
}

function normalizeDir(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

function joinPath(directory: string, name: string): string {
  return `${directory.trim().replace(/[\\/]+$/, '')}\\${name}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatBackupStamp(timestamp: number): string {
  const date = new Date(timestamp);

  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'manual'
  );
}

function isPreviewEventName(value: string): value is PreviewEventName {
  return PREVIEW_EVENT_NAMES.has(value as PreviewEventName);
}

function sessionLine(joinCode: string, players: number): string {
  return `Session "${backend.config.server.name}" with join code ${joinCode} and IP ${PREVIEW_PUBLIC_IP}:${backend.config.server.port} is active with ${players} players`;
}

// --- Event bus -------------------------------------------------------------

/** Emits an event to every preview subscriber (used by tests as well). */
export function emitPreviewEvent<K extends PreviewEventName>(
  event: K,
  payload: PreviewEventMap[K],
): void {
  const handlers = listeners.get(event);

  if (!handlers || handlers.size === 0) {
    return;
  }

  for (const handler of handlers) {
    handler(clone(payload));
  }
}

/** Subscribes to a preview event; returns an unsubscribe function. */
export function previewListen<K extends PreviewEventName>(
  event: K,
  handler: (payload: PreviewEventMap[K]) => void,
): () => void;
export function previewListen(event: string, handler: PreviewListener): () => void;
export function previewListen(event: string, handler: PreviewListener): () => void {
  if (!isPreviewEventName(event)) {
    return () => undefined;
  }

  const handlers = listeners.get(event) ?? new Set<PreviewListener>();
  handlers.add(handler);
  listeners.set(event, handlers);
  syncActivityTimer();

  return () => {
    const current = listeners.get(event);

    if (!current) {
      return;
    }

    current.delete(handler);

    if (current.size === 0) {
      listeners.delete(event);
    }

    syncActivityTimer();
  };
}

function syncActivityTimer(): void {
  const shouldRun = listeners.size > 0;

  if (shouldRun && activityTimer === null) {
    activityTimer = setInterval(emitActivityLine, ACTIVITY_INTERVAL_MS);
  } else if (!shouldRun && activityTimer !== null) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
}

function emitActivityLine(): void {
  const state = backend.serverState;

  if (state.phase !== 'running') {
    return;
  }

  const actions: Array<() => void> = [
    () => {
      pushLog('server', 'info', `World saved ( ${(380 + (activityStep % 7) * 4.3).toFixed(1)}ms )`);
    },
    () => {
      if (state.joinCode) {
        pushLog('server', 'info', sessionLine(state.joinCode, state.playersOnline ?? 0));
      } else {
        pushLog('server', 'info', 'World saved ( 388.1ms )');
      }
    },
    () => {
      pushLog(
        'server',
        'debug',
        'Player history entry with index 0: Рагнар (V_76561198000000001, 1EC168833352B6CF)',
      );
    },
  ];

  actions[activityStep % actions.length]?.();
  activityStep += 1;
}

function pushLog(source: LogSource, level: LogLevel, line: string): LogLine {
  const entry: LogLine = { seq: backend.nextSeq, ts: Date.now(), source, level, line };
  backend.nextSeq += 1;
  backend.logs = appendLogLine(backend.logs, entry, 2000);
  emitPreviewEvent('server-log', entry);

  return entry;
}

function setServerState(patch: Partial<ServerState>): ServerState {
  backend.serverState = { ...backend.serverState, ...patch };
  emitPreviewEvent('server-state', backend.serverState);

  return clone(backend.serverState);
}

function setInstallProgress(progress: InstallProgress): void {
  backend.installProgress = progress;
  emitPreviewEvent('server-install-progress', progress);
}

// --- Mutable state operations ---------------------------------------------

function refreshInstallStatus(): ReturnType<typeof createPreviewInstallStatus> {
  const config = backend.config;
  const steamcmdInstalled =
    normalizeDir(backend.installedSteamcmdDir) === normalizeDir(config.steamcmdDir);
  const serverInstalled =
    normalizeDir(backend.installedServerDir) === normalizeDir(config.installDir);

  backend.installStatus = {
    steamcmdInstalled,
    serverInstalled,
    steamcmdPath: joinPath(config.steamcmdDir, 'steamcmd.exe'),
    serverExePath: joinPath(config.installDir, 'valheim_server.exe'),
    installDir: config.installDir,
    installSizeBytes: serverInstalled ? PREVIEW_INSTALL_SIZE : 0,
  };

  return clone(backend.installStatus);
}

function setPlayerList(kind: PlayerListKind, entries: PlayerListEntry[]): void {
  const next: PlayerLists = { ...backend.players };

  if (kind === 'admins') {
    next.admins = entries;
  } else if (kind === 'banned') {
    next.banned = entries;
  } else {
    next.permitted = entries;
  }

  backend.players = next;
  emitPreviewEvent('server-lists-changed', next);
}

/** SteamID64 from a bare id, `V_<id>` or a legacy value, if present. */
function deriveSteamId64(id: string): string | null {
  const match = /^(?:v_)?(7656\d{13})$/i.exec(id.trim());

  return match?.[1] ?? null;
}

/** `true` when a known player corresponds to a `PlayerListEntry.id`. */
function knownPlayerMatchesId(player: KnownPlayer, id: string): boolean {
  const target = id.trim().toLowerCase();

  if (player.platformId && player.platformId.toLowerCase() === target) {
    return true;
  }

  if (player.steamId64) {
    const bare = player.steamId64.toLowerCase();

    if (target === bare || target === `v_${bare}`) {
      return true;
    }
  }

  return false;
}

/**
 * Re-derives the `isAdmin` flag of known players from `adminlist.txt` and adds
 * admins that were entered manually but never seen in the log.
 */
function syncKnownPlayersWithAdmins(): void {
  const admins = backend.players.admins;
  const now = Date.now();

  backend.knownPlayers = backend.knownPlayers.map((player) => ({
    ...player,
    isAdmin: admins.some((entry) => knownPlayerMatchesId(player, entry.id)),
  }));

  for (const entry of admins) {
    if (!backend.knownPlayers.some((player) => knownPlayerMatchesId(player, entry.id))) {
      backend.knownPlayers = [
        ...backend.knownPlayers,
        {
          name: entry.name,
          steamId64: deriveSteamId64(entry.id),
          platformId: entry.id,
          isAdmin: true,
          lastSeenAt: now,
          source: 'list',
        },
      ];
    }
  }
}

function createBackupInternal(label: string | null): BackupInfo {
  const now = Date.now();
  const suffix = label ? `-${slugify(label)}` : '';
  const backup: BackupInfo = {
    name: `valheim${suffix}-${formatBackupStamp(now)}.zip`,
    sizeBytes: 44_000_000 + backend.backups.length * 1_250_000,
    createdAt: now,
    worlds: [backend.config.server.world],
  };

  backend.backups = [backup, ...backend.backups];

  const keepBackups = Math.max(1, backend.config.keepBackups);

  if (backend.backups.length > keepBackups) {
    backend.backups = backend.backups.slice(0, keepBackups);
  }

  return backup;
}

function buildNetworkDiagnosis(): NetworkDiagnosis {
  const config = backend.config;
  const mainPort = config.server.port;
  const running = backend.serverState.phase === 'running';
  const portsRange = `${mainPort}-${mainPort + 2}`;
  const firewallRules = backend.network.firewallRules.map((rule) => ({
    ...rule,
    ports: portsRange,
  }));
  const firewallOk = firewallRules.some(
    (rule) => rule.enabled && rule.direction === 'in' && rule.ports === portsRange,
  );
  const ports: PortCheck[] = [0, 1, 2].map((offset) => ({
    port: mainPort + offset,
    protocol: 'udp',
    state: running && offset < 2 ? 'listening' : 'closed',
  }));

  backend.network = {
    mainPort,
    portRange: [mainPort, mainPort + 2],
    ports,
    firewallRules,
    firewallOk,
    localIps: [...PREVIEW_LOCAL_IPS],
    generatedAt: Date.now(),
    hints: buildPreviewNetworkHints(config, running, firewallOk),
  };

  return clone(backend.network);
}

function scheduleStartFinish(): void {
  const token = ++serverToken;

  void (async () => {
    await delay(1800);

    if (token !== serverToken || backend.serverState.phase !== 'starting') {
      return;
    }

    pushLog('server', 'info', 'Valheim version: l-1.0.20 (network version 41)');
    pushLog(
      'server',
      'info',
      `Load world: ${backend.config.server.world} (${backend.config.server.world})`,
    );
    pushLog('server', 'info', `Setting world modifier preset: ${backend.config.server.preset}`);
    pushLog('server', 'info', 'Opened Steam server');
    pushLog('server', 'info', 'Game server connected');

    const joinCode = backend.config.server.crossplay ? PREVIEW_JOIN_CODE : null;

    setServerState({
      phase: 'running',
      pid: 8420 + (Date.now() % 100),
      startedAt: Date.now(),
      uptimeSec: 0,
      world: backend.config.server.world,
      port: backend.config.server.port,
      version: 'l-1.0.20 (network version 41)',
      joinCode,
      playersOnline: 0,
      lastExitCode: null,
      lastError: null,
    });

    if (joinCode) {
      pushLog('server', 'info', sessionLine(joinCode, 0));
    }

    pushLog('app', 'info', 'Сервер запущен и готов принимать игроков');
  })();
}

function startInstall(kind: 'steamcmd' | 'update'): InstallProgress {
  const token = ++installToken;
  const steps = kind === 'steamcmd' ? STEAMCMD_STEPS : UPDATE_STEPS;

  if (steps[0]) {
    setInstallProgress(clone(steps[0].progress));
  }

  void (async () => {
    for (const step of steps) {
      await delay(step.delayMs);

      if (token !== installToken) {
        return;
      }

      setInstallProgress(clone(step.progress));

      if (step.log) {
        pushLog(step.log.source, step.log.level, step.log.line);
      }
    }

    if (token !== installToken) {
      return;
    }

    if (kind === 'steamcmd') {
      backend.installedSteamcmdDir = backend.config.steamcmdDir;
      refreshInstallStatus();
      pushLog('app', 'info', 'SteamCMD установлен и готов к работе');
    } else {
      backend.installedServerDir = backend.config.installDir;
      refreshInstallStatus();
      pushLog('app', 'info', 'Valheim Dedicated Server обновлён до последней версии');
    }

    setInstallProgress({
      phase: 'done',
      message: kind === 'steamcmd' ? 'SteamCMD установлен' : 'Сервер обновлён',
      percent: 100,
    });
  })();

  return clone(backend.installProgress ?? { phase: 'idle', message: 'Подготовка…', percent: null });
}

// --- Command helpers -------------------------------------------------------

/** Шаги симуляции установки серверных модов (BepInEx + Server_devcommands). */
const MODS_INSTALL_STEPS: readonly {
  progress: InstallProgress;
  delayMs: number;
  log: string | null;
}[] = [
  {
    progress: {
      phase: 'downloading',
      message: 'Скачивание BepInExPack_Valheim с Thunderstore…',
      percent: 20,
    },
    delayMs: 320,
    log: 'Скачивание BepInExPack_Valheim (Thunderstore)',
  },
  {
    progress: {
      phase: 'downloading',
      message: 'Скачивание Server_devcommands с Thunderstore…',
      percent: 65,
    },
    delayMs: 380,
    log: 'Скачивание Server_devcommands (Thunderstore)',
  },
  {
    progress: {
      phase: 'extracting',
      message: 'Распаковка модов в каталог сервера…',
      percent: null,
    },
    delayMs: 340,
    log: 'Распаковка BepInEx и Server_devcommands в каталог сервера',
  },
  {
    progress: {
      phase: 'verifying',
      message: 'Проверка BepInEx/plugins…',
      percent: 90,
    },
    delayMs: 280,
    log: null,
  },
];

/**
 * Симулирует установку BepInEx + Server_devcommands: прогресс идёт через
 * общий канал `server-install-progress`, как и у Rust-команды.
 */
async function runModsInstall(): Promise<ModStatus> {
  const token = ++installToken;

  for (const step of MODS_INSTALL_STEPS) {
    await delay(step.delayMs);

    if (token !== installToken) {
      break;
    }

    setInstallProgress(clone(step.progress));

    if (step.log) {
      pushLog('app', 'info', step.log);
    }
  }

  if (token !== installToken) {
    previewError('UNEXPECTED', 'Установка модов была прервана другой операцией');
  }

  backend.modStatus = {
    bepinexInstalled: true,
    bepinexVersion: '5.4.2360',
    serverDevcommandsInstalled: true,
    serverDevcommandsVersion: '1.116.0',
    plugins: ['ServerDevcommands.dll'],
    installDir: backend.config.installDir,
  };
  setInstallProgress({ phase: 'done', message: 'Моды установлены', percent: 100 });
  pushLog(
    'app',
    'info',
    'BepInEx и Server_devcommands установлены; перезапустите сервер для загрузки модов',
  );

  return clone(backend.modStatus);
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];

  return typeof value === 'string' ? value : null;
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function playerKindArg(value: unknown): PlayerListKind {
  if (value === 'admins' || value === 'banned' || value === 'permitted') {
    return value;
  }

  return previewError('VALIDATION', 'Неизвестный список игроков');
}

// --- Commands --------------------------------------------------------------

async function runCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case 'app_info':
      return clone(backend.appInfo);

    case 'get_config':
      return clone(backend.config);

    case 'save_config': {
      const candidate = args['config'];

      if (typeof candidate !== 'object' || candidate === null) {
        previewError('VALIDATION', 'Конфигурация не передана');
      }

      const config = candidate as AppConfig;
      const errors = validateAppConfig(config);

      if (hasErrors(errors)) {
        previewError('VALIDATION', firstError(errors) ?? 'Некорректная конфигурация');
      }

      backend.config = clone(config);
      backend.paths = createPreviewPaths(config);
      backend.worlds = createPreviewWorlds(config);
      refreshInstallStatus();

      if (!config.server.crossplay && backend.serverState.phase === 'running') {
        setServerState({ joinCode: null });
      }

      pushLog('app', 'info', 'Конфигурация сохранена');

      if (
        backend.serverState.phase === 'running' &&
        (backend.serverState.world !== config.server.world ||
          backend.serverState.port !== config.server.port)
      ) {
        pushLog('app', 'warn', 'Новый мир и порт вступят в силу после перезапуска сервера');
      }

      return clone(backend.config);
    }

    case 'reset_config': {
      backend.config = createPreviewConfig();
      backend.paths = createPreviewPaths(backend.config);
      backend.worlds = createPreviewWorlds(backend.config);
      refreshInstallStatus();
      pushLog('app', 'info', 'Конфигурация сброшена к значениям по умолчанию');

      return clone(backend.config);
    }

    case 'get_paths':
      backend.paths = createPreviewPaths(backend.config);

      return clone(backend.paths);

    case 'get_install_status':
      return refreshInstallStatus();

    case 'install_steamcmd':
      return startInstall('steamcmd');

    case 'update_server': {
      if (!refreshInstallStatus().steamcmdInstalled) {
        previewError('STEAMCMD_NOT_INSTALLED', 'Сначала установите SteamCMD');
      }

      return startInstall('update');
    }

    case 'get_server_state':
      return clone(backend.serverState);

    case 'start_server': {
      const phase = backend.serverState.phase;

      if (phase === 'running' || phase === 'starting') {
        previewError('ALREADY_RUNNING', 'Сервер уже запущен');
      }

      if (!refreshInstallStatus().serverInstalled) {
        previewError('SERVER_NOT_INSTALLED', 'Файлы Valheim Dedicated Server не установлены');
      }

      setServerState({
        phase: 'starting',
        pid: null,
        startedAt: null,
        uptimeSec: 0,
        world: backend.config.server.world,
        port: backend.config.server.port,
        version: null,
        joinCode: null,
        playersOnline: 0,
        lastExitCode: null,
        lastError: null,
      });
      pushLog(
        'app',
        'info',
        `Запуск сервера: мир «${backend.config.server.world}», порт ${backend.config.server.port}`,
      );
      scheduleStartFinish();

      return clone(backend.serverState);
    }

    case 'stop_server': {
      const phase = backend.serverState.phase;

      if (phase === 'stopped' || phase === 'error') {
        previewError('NOT_RUNNING', 'Сервер не запущен');
      }

      const force = args['force'] === true;

      serverToken += 1;
      setServerState({ phase: 'stopping' });
      pushLog('app', 'info', force ? 'Принудительная остановка сервера…' : 'Остановка сервера…');

      if (backend.config.autoBackupBeforeStop) {
        const backup = createBackupInternal('before-stop');
        pushLog('app', 'info', `Автобэкап перед остановкой: ${backup.name}`);
      }

      await delay(900);

      pushLog('server', 'info', 'World saved ( 512.3ms )');
      pushLog('server', 'info', 'Closing socket 76561198000000001');
      pushLog('app', 'info', 'Сервер остановлен');

      setServerState({
        phase: 'stopped',
        pid: null,
        startedAt: null,
        uptimeSec: null,
        version: null,
        joinCode: null,
        playersOnline: 0,
        lastExitCode: 0,
        lastError: null,
      });

      return clone(backend.serverState);
    }

    case 'get_logs': {
      const limit = Math.min(Math.max(numberArg(args, 'limit') ?? 500, 1), 2000);
      const source = stringArg(args, 'source');
      const sinceSeq = numberArg(args, 'sinceSeq');
      let lines = backend.logs;

      if (source === 'server' || source === 'steamcmd' || source === 'app') {
        lines = lines.filter((line) => line.source === source);
      }

      if (sinceSeq !== null) {
        lines = lines.filter((line) => line.seq > sinceSeq);
      }

      return clone(lines.slice(-limit));
    }

    case 'clear_logs':
      backend.logs = [];
      pushLog('app', 'info', 'Буфер логов очищен');

      return undefined;

    case 'list_worlds':
      return clone(backend.worlds);

    case 'get_player_lists':
      return clone(backend.players);

    case 'get_known_players':
      return clone(backend.knownPlayers).toSorted(
        (left, right) => right.lastSeenAt - left.lastSeenAt,
      );

    case 'add_player': {
      const kind = playerKindArg(args['list']);
      const rawId = (stringArg(args, 'id') ?? '').trim();

      if (!isValidSteamId(rawId)) {
        previewError(
          'VALIDATION',
          'Укажите SteamID64 или ID с префиксом V_/X_ (например, V_76561198000000001)',
        );
      }

      const name = (stringArg(args, 'name') ?? '').trim();
      const current = backend.players[kind];

      if (current.some((entry) => entry.id.toLowerCase() === rawId.toLowerCase())) {
        previewError('VALIDATION', 'Игрок уже есть в этом списке');
      }

      setPlayerList(kind, [...current, { id: rawId, name: name.length > 0 ? name : null }]);

      if (kind === 'admins') {
        syncKnownPlayersWithAdmins();
      }

      pushLog('app', 'info', `Игрок ${rawId} добавлен: ${PLAYER_LIST_LABELS[kind]}`);

      return clone(backend.players);
    }

    case 'remove_player': {
      const kind = playerKindArg(args['list']);
      const id = (stringArg(args, 'id') ?? '').trim();
      const current = backend.players[kind];
      const next = current.filter((entry) => entry.id.toLowerCase() !== id.toLowerCase());

      if (next.length === current.length) {
        previewError('NOT_FOUND', 'Игрок не найден в списке');
      }

      setPlayerList(kind, next);

      if (kind === 'admins') {
        syncKnownPlayersWithAdmins();
      }

      pushLog('app', 'info', `Игрок ${id} удалён: ${PLAYER_LIST_LABELS[kind]}`);

      return clone(backend.players);
    }

    case 'list_backups':
      return clone(backend.backups);

    case 'create_backup': {
      const label = stringArg(args, 'label');
      const backup = createBackupInternal(label);
      pushLog('app', 'info', `Создана резервная копия: ${backup.name}`);

      return clone(backup);
    }

    case 'restore_backup': {
      const name = stringArg(args, 'name') ?? '';
      const createSafetyBackup = args['createSafetyBackup'] === true;
      const phase = backend.serverState.phase;

      if (phase !== 'stopped' && phase !== 'error') {
        previewError('PROCESS', 'Восстановление доступно только при остановленном сервере');
      }

      const backup = backend.backups.find((entry) => entry.name === name);

      if (!backup) {
        previewError('NOT_FOUND', 'Резервная копия не найдена');
      }

      if (createSafetyBackup) {
        createBackupInternal('before-restore');
      }

      await delay(850);
      pushLog('app', 'info', `Мир восстановлен из архива ${name}`);
      backend.worlds = createPreviewWorlds(backend.config);

      return undefined;
    }

    case 'delete_backup': {
      const name = stringArg(args, 'name') ?? '';
      const next = backend.backups.filter((entry) => entry.name !== name);

      if (next.length === backend.backups.length) {
        previewError('NOT_FOUND', 'Резервная копия не найдена');
      }

      backend.backups = next;
      pushLog('app', 'info', `Удалена резервная копия: ${name}`);

      return undefined;
    }

    case 'diagnose_network':
      return buildNetworkDiagnosis();

    case 'open_firewall_ports': {
      await delay(850);
      const diagnosis = buildNetworkDiagnosis();

      diagnosis.firewallRules = diagnosis.firewallRules.map((rule) => ({
        ...rule,
        enabled: true,
      }));
      diagnosis.firewallOk = true;
      diagnosis.hints = buildPreviewNetworkHints(
        backend.config,
        backend.serverState.phase === 'running',
        true,
      );
      backend.network = diagnosis;
      pushLog(
        'app',
        'info',
        `Добавлено входящее правило брандмауэра UDP ${diagnosis.portRange[0]}–${diagnosis.portRange[1]}`,
      );

      return clone(backend.network);
    }

    case 'open_path': {
      const target = stringArg(args, 'target') ?? 'installDir';
      pushLog('app', 'info', `Открытие каталога: ${target}`);

      return undefined;
    }

    case 'is_port_available': {
      const port = numberArg(args, 'port');

      if (port === null) {
        return false;
      }

      const phase = backend.serverState.phase;
      const mainPort = backend.config.server.port;

      if (phase !== 'stopped' && port >= mainPort && port <= mainPort + 2) {
        return false;
      }

      return true;
    }

    case 'get_mod_status':
      return clone(backend.modStatus);

    case 'install_server_mods': {
      const phase = backend.serverState.phase;

      if (phase === 'running' || phase === 'starting' || phase === 'stopping') {
        previewError('PROCESS', 'Остановите сервер перед установкой модов');
      }

      return runModsInstall();
    }

    default:
      return previewError('UNSUPPORTED', `Команда недоступна в режиме предпросмотра: ${command}`);
  }
}

/**
 * Executes a command against the in-memory preview backend.
 *
 * Every command has a small artificial delay so loading states and disabled
 * buttons behave like in the desktop build.
 */
export async function previewInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  await delay(PREVIEW_COMMAND_DELAY_MS);

  const result = await runCommand(command, args ?? {});

  return result as T;
}

/** Restores the preview backend and clears listeners (test helper). */
export function resetPreviewBackend(): void {
  installToken += 1;
  serverToken += 1;
  backend = createBackend();
  listeners.clear();
  activityStep = 0;

  if (activityTimer !== null) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
}
