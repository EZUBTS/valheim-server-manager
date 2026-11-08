/**
 * Realistic fixtures for the browser preview (`pnpm dev` without Rust).
 *
 * The data intentionally looks like a long-running Valheim 1.0 server: an
 * installed SteamCMD, an installed dedicated server, three players online, a
 * crossplay join code, backups with history and a network diagnosis that still
 * needs a firewall rule. Every creator returns a fresh mutable structure so the
 * preview backend can be reset.
 */

import type {
  AppConfig,
  AppInfo,
  BackupInfo,
  InstallStatus,
  KnownPlayer,
  LogLevel,
  LogLine,
  LogSource,
  ModStatus,
  NetworkDiagnosis,
  PlayerLists,
  ResolvedPaths,
  ServerState,
  WorldInfo,
} from '@/lib/types';

const MINUTE = 60_000;
const HOUR = 3_600_000;

const PREVIEW_INSTALL_DIR = 'D:\\Servers\\Valheim\\server';
const PREVIEW_STEAMCMD_DIR = 'D:\\Servers\\Valheim\\steamcmd';
const PREVIEW_BACKUPS_DIR = 'D:\\Servers\\Valheim\\backups';
const PREVIEW_DATA_DIR = 'C:\\Users\\Viking\\AppData\\Local\\com.valheim.servermanager';
const PREVIEW_CONFIG_FILE =
  'C:\\Users\\Viking\\AppData\\Roaming\\com.valheim.servermanager\\config.json';

/** Size of the dedicated server installation in the preview (≈2.6 ГБ). */
export const PREVIEW_INSTALL_SIZE = 2_743_218_176;

const PREVIEW_JOIN_CODE = '483920';
/** Public IP shown in the connection instructions (documentation range). */
export const PREVIEW_PUBLIC_IP = '203.0.113.10';
const PREVIEW_PLAYER_NAMES = ['Рагнар', 'Лагерта', 'Бьорн'];

/** Crossplay join code the preview server registers after a restart. */
export { PREVIEW_JOIN_CODE };

/** Builds the default application configuration used by the preview. */
export function createPreviewConfig(): AppConfig {
  return {
    schemaVersion: 1,
    installDir: PREVIEW_INSTALL_DIR,
    steamcmdDir: PREVIEW_STEAMCMD_DIR,
    backupsDir: PREVIEW_BACKUPS_DIR,
    keepBackups: 10,
    autoBackupBeforeUpdate: true,
    autoBackupBeforeStop: true,
    server: {
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
      // World cheats visible on the «Админ» page as enabled toggles.
      setKeys: ['nobuildcost', 'passivemobs'],
      saveIntervalSec: 300,
      extraArgs: [],
    },
  };
}

/** Metadata returned by `app_info` in the preview. */
export function createPreviewAppInfo(): AppInfo {
  return {
    name: 'Valheim Server Manager',
    version: '0.1.0',
    tauriVersion: '2.12.5',
    os: 'windows',
    arch: 'x86_64',
    debug: true,
  };
}

/** Paths derived from a configuration, mirroring the Rust `ResolvedPaths`. */
export function createPreviewPaths(config: AppConfig = createPreviewConfig()): ResolvedPaths {
  const saveDir = `${config.installDir}\\savedir`;

  return {
    configFile: PREVIEW_CONFIG_FILE,
    logsDir: `${PREVIEW_DATA_DIR}\\logs`,
    dataDir: PREVIEW_DATA_DIR,
    installDir: config.installDir,
    steamcmdDir: config.steamcmdDir,
    backupsDir: config.backupsDir,
    saveDir,
    worldsDir: `${saveDir}\\worlds_local`,
  };
}

/** Install status of the preview machine: everything is installed. */
export function createPreviewInstallStatus(
  config: AppConfig = createPreviewConfig(),
): InstallStatus {
  return {
    steamcmdInstalled: true,
    serverInstalled: true,
    steamcmdPath: `${config.steamcmdDir}\\steamcmd.exe`,
    serverExePath: `${config.installDir}\\valheim_server.exe`,
    installDir: config.installDir,
    installSizeBytes: PREVIEW_INSTALL_SIZE,
  };
}

/** A running server with a crossplay join code and three players online. */
export function createPreviewServerState(now: number = Date.now()): ServerState {
  const startedAt = now - 2 * HOUR - 13 * MINUTE - 45_000;

  return {
    phase: 'running',
    pid: 8420,
    startedAt,
    uptimeSec: Math.floor((now - startedAt) / 1000),
    world: 'Midgard',
    port: 2456,
    version: 'l-1.0.20 (network version 41)',
    joinCode: PREVIEW_JOIN_CODE,
    playersOnline: PREVIEW_PLAYER_NAMES.length,
    lastExitCode: null,
    lastError: null,
  };
}

interface LogSeed {
  source: LogSource;
  level: LogLevel;
  line: string;
  minutesAgo: number;
}

const LOG_SEEDS: readonly LogSeed[] = [
  // Application boot
  {
    source: 'app',
    level: 'info',
    line: 'Valheim Server Manager 0.1.0 запущен',
    minutesAgo: 163,
  },
  {
    source: 'app',
    level: 'info',
    line: `Конфигурация загружена: ${PREVIEW_CONFIG_FILE}`,
    minutesAgo: 162.8,
  },
  {
    source: 'app',
    level: 'info',
    line: 'Базовый каталог: D:\\Servers\\Valheim',
    minutesAgo: 162.7,
  },
  {
    source: 'app',
    level: 'info',
    line: `SteamCMD найден: ${PREVIEW_STEAMCMD_DIR}\\steamcmd.exe`,
    minutesAgo: 162.6,
  },

  // SteamCMD update session
  {
    source: 'steamcmd',
    level: 'info',
    line: "Redirecting stderr to 'D:\\Servers\\Valheim\\steamcmd\\logs\\stderr.txt'",
    minutesAgo: 160,
  },
  {
    source: 'steamcmd',
    level: 'info',
    line: 'Logging directory: D:\\Servers\\Valheim\\steamcmd\\logs',
    minutesAgo: 159.8,
  },
  {
    source: 'steamcmd',
    level: 'info',
    line: '[  0%] Checking for available updates...',
    minutesAgo: 159.6,
  },
  {
    source: 'steamcmd',
    level: 'info',
    line: '[ 50%] Downloading update (1215 of 2431 KB)...',
    minutesAgo: 159.3,
  },
  {
    source: 'steamcmd',
    level: 'info',
    line: '[100%] Downloading update (2431 of 2431 KB)...',
    minutesAgo: 159,
  },
  {
    source: 'steamcmd',
    level: 'info',
    line: 'Update state (0x61) downloading, progress: 100.00 (2543210000 / 2543210000)',
    minutesAgo: 158.8,
  },
  {
    source: 'steamcmd',
    level: 'info',
    line: "Success! App '896660' fully installed.",
    minutesAgo: 158.5,
  },
  {
    source: 'app',
    level: 'info',
    line: 'Перед обновлением создан автобэкап: valheim-before-update-20261108-181200.zip',
    minutesAgo: 158,
  },
  {
    source: 'app',
    level: 'info',
    line: `Valheim Dedicated Server обновлён: ${PREVIEW_INSTALL_DIR}`,
    minutesAgo: 157.8,
  },

  // Server start
  {
    source: 'server',
    level: 'info',
    line: 'Valheim version: l-1.0.20 (network version 41)',
    minutesAgo: 157.5,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Load world: Midgard (Midgard)',
    minutesAgo: 157.4,
  },
  {
    source: 'server',
    level: 'info',
    line: 'ZNet.LoadWorld: Midgard (Midgard), save number 42',
    minutesAgo: 157.3,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Setting world modifier preset: normal',
    minutesAgo: 157.2,
  },
  {
    source: 'server',
    level: 'info',
    line: 'ZRpc timeout set to 30s',
    minutesAgo: 157.1,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Opened Steam server',
    minutesAgo: 157,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Game server connected',
    minutesAgo: 156.9,
  },
  {
    source: 'server',
    level: 'warn',
    line: 'Network version check, their:40, mine:41',
    minutesAgo: 156.7,
  },

  // Crossplay session registration
  {
    source: 'server',
    level: 'info',
    line: `Session "Вальгалла · Дружина Одина" with join code ${PREVIEW_JOIN_CODE} and IP ${PREVIEW_PUBLIC_IP}:2456 is active with 0 players`,
    minutesAgo: 156.5,
  },

  // Players joining
  {
    source: 'server',
    level: 'info',
    line: 'Got connection SteamID 76561198000000001',
    minutesAgo: 150,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Got handshake from client 76561198000000001',
    minutesAgo: 149.9,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Got character ZDOID from Рагнар : 1234567890:1',
    minutesAgo: 149.5,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Server: New peer connected,sending global keys',
    minutesAgo: 149.4,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Got connection SteamID 76561198000000002',
    minutesAgo: 132,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Got character ZDOID from Лагерта : 1234567891:1',
    minutesAgo: 131.4,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Got connection SteamID 76561198000000004',
    minutesAgo: 96,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Got character ZDOID from Бьорн : 1234567892:1',
    minutesAgo: 95.5,
  },
  {
    source: 'server',
    level: 'info',
    line: 'World saved ( 412.5ms )',
    minutesAgo: 90,
  },
  {
    source: 'server',
    level: 'info',
    line: 'World saved ( 388.1ms )',
    minutesAgo: 85,
  },
  {
    source: 'server',
    level: 'info',
    line: 'Closing socket 76561198000000099',
    minutesAgo: 80,
  },
  {
    source: 'server',
    level: 'info',
    line: `Session "Вальгалла · Дружина Одина" with join code ${PREVIEW_JOIN_CODE} and IP ${PREVIEW_PUBLIC_IP}:2456 is active with 3 players`,
    minutesAgo: 72,
  },
  {
    source: 'server',
    level: 'info',
    line: 'World saved ( 401.7ms )',
    minutesAgo: 67,
  },

  // A firewall problem worth acting on
  {
    source: 'app',
    level: 'error',
    line: 'Не удалось добавить правило брандмауэра: требуются права администратора (ELEVATION_REQUIRED)',
    minutesAgo: 60,
  },
  {
    source: 'app',
    level: 'warn',
    line: 'Порт UDP 2458 не прослушивается — это нормально, но правило брандмауэра должно покрывать 2456–2458',
    minutesAgo: 59.5,
  },
  {
    source: 'server',
    level: 'info',
    line: 'World saved ( 395.3ms )',
    minutesAgo: 45,
  },
  {
    source: 'server',
    level: 'info',
    line: `Session "Вальгалла · Дружина Одина" with join code ${PREVIEW_JOIN_CODE} and IP ${PREVIEW_PUBLIC_IP}:2456 is active with 3 players`,
    minutesAgo: 32,
  },
  {
    source: 'server',
    level: 'info',
    line: 'World saved ( 408.9ms )',
    minutesAgo: 17,
  },
  {
    source: 'server',
    level: 'debug',
    line: 'Player history entry with index 0: Рагнар (V_76561198000000001, 1EC168833352B6CF)',
    minutesAgo: 10,
  },
  {
    source: 'server',
    level: 'info',
    line: `Session "Вальгалла · Дружина Одина" with join code ${PREVIEW_JOIN_CODE} and IP ${PREVIEW_PUBLIC_IP}:2456 is active with 3 players`,
    minutesAgo: 2,
  },
  {
    source: 'server',
    level: 'info',
    line: 'World saved ( 396.2ms )',
    minutesAgo: 0.4,
  },
];

/** Ring-buffer seed for the logs page (ascending `seq`). */
export function createPreviewLogs(now: number = Date.now()): LogLine[] {
  return LOG_SEEDS.map((seed, index) => ({
    seq: index + 1,
    ts: now - seed.minutesAgo * MINUTE,
    source: seed.source,
    level: seed.level,
    line: seed.line,
  }));
}

/** Worlds found in `worlds_local`, with the configured world marked active. */
export function createPreviewWorlds(
  config: AppConfig = createPreviewConfig(),
  now: number = Date.now(),
): WorldInfo[] {
  const worlds: Array<Omit<WorldInfo, 'isActive'>> = [
    { name: 'Midgard', sizeBytes: 148_231_552, modifiedAt: now - 3 * MINUTE },
    { name: 'Yggdrasil', sizeBytes: 2_112_455_000, modifiedAt: now - 26 * HOUR },
    { name: 'Asgard', sizeBytes: 87_112_456, modifiedAt: now - 12 * 24 * HOUR },
  ];

  return worlds.map((world) => ({
    ...world,
    isActive: world.name === config.server.world,
  }));
}

/** Backup archive history. */
export function createPreviewBackups(now: number = Date.now()): BackupInfo[] {
  return [
    {
      name: 'valheim-before-update-20261108-181200.zip',
      sizeBytes: 46_220_151,
      createdAt: now - 2 * HOUR - 40 * MINUTE,
      worlds: ['Midgard', 'Yggdrasil'],
    },
    {
      name: 'valheim-Midgard-20261107-221540.zip',
      sizeBytes: 44_910_733,
      createdAt: now - 21 * HOUR,
      worlds: ['Midgard'],
    },
    {
      name: 'valheim-Midgard-20261106-120000.zip',
      sizeBytes: 41_203_004,
      createdAt: now - 2 * 24 * HOUR - 5 * HOUR,
      worlds: ['Midgard'],
    },
    {
      name: 'valheim-Asgard-20261026-090000.zip',
      sizeBytes: 33_781_220,
      createdAt: now - 13 * 24 * HOUR,
      worlds: ['Asgard'],
    },
  ];
}

/** Player lists: two admins, one ban and a whitelist that is already active. */
export function createPreviewPlayers(): PlayerLists {
  return {
    admins: [
      { id: 'V_76561198000000001', name: 'Рагнар' },
      { id: 'V_76561198000000002', name: 'Лагерта' },
    ],
    banned: [{ id: 'V_76561198000000003', name: 'Грим' }],
    permitted: [
      { id: 'V_76561198000000001', name: 'Рагнар' },
      { id: 'V_76561198000000004', name: 'Бьорн' },
      { id: 'X_2535400000000001', name: 'Астрид (Xbox)' },
    ],
  };
}

/**
 * Players the manager has seen in logs/lists — the «Админ» page fixture.
 *
 * Steam IDs match the connection lines in `createPreviewLogs`, so the page shows
 * the same names the user sees in the log; Астрид has only a platform id (Xbox)
 * to exercise the non-Steam path.
 */
export function createPreviewKnownPlayers(now: number = Date.now()): KnownPlayer[] {
  return [
    {
      name: 'Рагнар',
      steamId64: '76561198000000001',
      platformId: 'V_76561198000000001',
      isAdmin: true,
      lastSeenAt: now - 30_000,
      source: 'live',
    },
    {
      name: 'Лагерта',
      steamId64: '76561198000000002',
      platformId: 'V_76561198000000002',
      isAdmin: true,
      lastSeenAt: now - 5 * MINUTE,
      source: 'live',
    },
    {
      name: 'Бьорн',
      steamId64: '76561198000000004',
      platformId: 'V_76561198000000004',
      isAdmin: false,
      lastSeenAt: now - 12 * MINUTE,
      source: 'history',
    },
    {
      name: 'Астрид',
      steamId64: null,
      platformId: 'X_2535400000000001',
      isAdmin: false,
      lastSeenAt: now - 47 * MINUTE,
      source: 'history',
    },
    {
      name: 'Грим',
      steamId64: '76561198000000003',
      platformId: 'V_76561198000000003',
      isAdmin: false,
      lastSeenAt: now - 2 * HOUR,
      source: 'list',
    },
  ];
}

/** Local IPv4 addresses shown on the network page. */
export const PREVIEW_LOCAL_IPS = ['192.168.1.42', '10.8.0.5'] as const;

/**
 * Mod state fixture: the preview server is vanilla, so cheats are disabled and
 * the «Админ» page offers installing BepInEx + Server_devcommands.
 */
export function createPreviewModStatus(config: AppConfig = createPreviewConfig()): ModStatus {
  return {
    bepinexInstalled: false,
    bepinexVersion: null,
    serverDevcommandsInstalled: false,
    serverDevcommandsVersion: null,
    plugins: [],
    installDir: config.installDir,
  };
}

/** Builds the user-facing hints for the network page. */
export function buildPreviewNetworkHints(
  config: AppConfig,
  serverRunning: boolean,
  firewallOk: boolean,
): string[] {
  const mainPort = config.server.port;
  const portRange = `${mainPort}–${mainPort + 2}`;
  const hints: string[] = [];

  if (config.server.crossplay) {
    hints.push(
      'Crossplay включён: проброс портов на роутере не нужен, игроки заходят по коду приглашения. Подключение по локальному IP в этом режиме не работает.',
    );
  } else {
    hints.push(
      `Пробросьте UDP ${portRange} на роутере на локальный IP сервера (например, 192.168.1.42).`,
    );
  }

  if (!serverRunning) {
    hints.push('Сервер остановлен: UDP-порты открываются только после запуска процесса.');
  }

  if (firewallOk) {
    hints.push(`Правило брандмауэра для UDP ${portRange} создано и включено.`);
  } else {
    hints.push(
      `Добавьте входящее правило брандмауэра Windows для UDP ${portRange} или нажмите «Разрешить в брандмауэре».`,
    );
  }

  return hints;
}

/** Network diagnosis with a disabled firewall rule — a realistic first run. */
export function createPreviewNetwork(
  config: AppConfig = createPreviewConfig(),
  now: number = Date.now(),
): NetworkDiagnosis {
  const mainPort = config.server.port;

  return {
    mainPort,
    portRange: [mainPort, mainPort + 2],
    ports: [
      { port: mainPort, protocol: 'udp', state: 'listening' },
      { port: mainPort + 1, protocol: 'udp', state: 'listening' },
      { port: mainPort + 2, protocol: 'udp', state: 'closed' },
    ],
    firewallRules: [
      {
        name: 'Valheim Dedicated Server',
        enabled: false,
        ports: `${mainPort}-${mainPort + 2}`,
        direction: 'in',
      },
    ],
    firewallOk: false,
    localIps: [...PREVIEW_LOCAL_IPS],
    generatedAt: now - 40_000,
    hints: buildPreviewNetworkHints(config, true, false),
  };
}
