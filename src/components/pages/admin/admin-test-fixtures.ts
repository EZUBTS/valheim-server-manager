/**
 * Общие фикстуры для тестов страницы «Админ».
 *
 * Используются тестами с mocked `invoke` (desktop-путь), чтобы не дублировать
 * конфигурацию/статусы в каждом файле.
 */

import type {
  AppConfig,
  AppInfo,
  InstallStatus,
  KnownPlayer,
  ModStatus,
  NetworkDiagnosis,
  PlayerListEntry,
  PlayerListKind,
  PlayerLists,
  ResolvedPaths,
  ServerState,
} from '@/lib/types';

export const TEST_CONFIG: AppConfig = {
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
    crossplay: true,
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

export const TEST_PATHS: ResolvedPaths = {
  configFile: 'C:\\config.json',
  logsDir: 'C:\\logs',
  dataDir: 'C:\\data',
  installDir: TEST_CONFIG.installDir,
  steamcmdDir: TEST_CONFIG.steamcmdDir,
  backupsDir: TEST_CONFIG.backupsDir,
  saveDir: 'D:\\Servers\\Valheim\\server\\savedir',
  worldsDir: 'D:\\Servers\\Valheim\\server\\savedir\\worlds_local',
};

export const TEST_APP_INFO: AppInfo = {
  name: 'Valheim Server Manager',
  version: '0.2.0',
  tauriVersion: '2.12.5',
  os: 'windows',
  arch: 'x86_64',
  debug: true,
};

export const TEST_INSTALL_STATUS: InstallStatus = {
  steamcmdInstalled: true,
  serverInstalled: true,
  steamcmdPath: 'D:\\Servers\\Valheim\\steamcmd\\steamcmd.exe',
  serverExePath: 'D:\\Servers\\Valheim\\server\\valheim_server.exe',
  installDir: TEST_CONFIG.installDir,
  installSizeBytes: 2_743_218_176,
};

export const TEST_PLAYER_LISTS: PlayerLists = {
  admins: [],
  banned: [],
  permitted: [],
};

/** Игроки, которых «увидел» менеджер (для mocked-тестов adminlist). */
export const TEST_KNOWN_PLAYERS: readonly KnownPlayer[] = [
  {
    name: 'Рагнар',
    steamId64: '76561198000000001',
    platformId: 'V_76561198000000001',
    isAdmin: false,
    lastSeenAt: 1_700_000_100_000,
    source: 'live',
  },
  {
    name: 'Бьорн',
    steamId64: '76561198000000002',
    platformId: 'V_76561198000000002',
    isAdmin: false,
    lastSeenAt: 1_700_000_000_000,
    source: 'history',
  },
];

export const TEST_NETWORK: NetworkDiagnosis = {
  mainPort: 2456,
  portRange: [2456, 2458],
  ports: [],
  firewallRules: [],
  firewallOk: true,
  localIps: ['192.168.1.42'],
  generatedAt: 0,
  hints: [],
};

export const TEST_MODS_NOT_INSTALLED: ModStatus = {
  bepinexInstalled: false,
  bepinexVersion: null,
  serverDevcommandsInstalled: false,
  serverDevcommandsVersion: null,
  plugins: [],
  installDir: TEST_CONFIG.installDir,
};

export const TEST_MODS_INSTALLED: ModStatus = {
  bepinexInstalled: true,
  bepinexVersion: '5.4.2360',
  serverDevcommandsInstalled: true,
  serverDevcommandsVersion: '1.116.0',
  plugins: ['ServerDevcommands.dll'],
  installDir: TEST_CONFIG.installDir,
};

export function createTestServerState(running: boolean): ServerState {
  return {
    phase: running ? 'running' : 'stopped',
    pid: running ? 4242 : null,
    startedAt: running ? Date.now() - 60_000 : null,
    uptimeSec: running ? 60 : null,
    world: 'Midgard',
    port: 2456,
    version: running ? 'l-1.0.21' : null,
    joinCode: running ? '123456' : null,
    playersOnline: running ? 2 : null,
    lastExitCode: null,
    lastError: null,
  };
}

export interface AdminInvokeOptions {
  running: boolean;
  modsInstalled?: boolean;
  /** Отклонять `get_config` — проверка error-state вкладок. */
  failConfig?: boolean;
  /** Никогда не отвечать на `get_known_players` — проверка skeleton/timeout. */
  knownPlayersPending?: boolean;
}

/**
 * Обработчик `invoke` для desktop-тестов админки.
 *
 * Возвращает функцию `(command, args) => Promise<unknown>`; состояние модов
 * мутируется командой `install_server_mods`, как в реальном ядре.
 */
function readStringArg(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];

  return typeof value === 'string' ? value : '';
}

export function createAdminInvokeHandler(options: AdminInvokeOptions) {
  let modStatus = options.modsInstalled ? TEST_MODS_INSTALLED : TEST_MODS_NOT_INSTALLED;
  let playerLists: PlayerLists = {
    admins: [],
    banned: [],
    permitted: [],
  };
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  const knownPlayers = (): KnownPlayer[] => {
    const adminIds = new Set(playerLists.admins.map((entry) => entry.id.toLowerCase()));

    return TEST_KNOWN_PLAYERS.map((player) => ({
      ...player,
      isAdmin: player.steamId64 !== null && adminIds.has(`v_${player.steamId64.toLowerCase()}`),
    }));
  };

  const handler = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    calls.push({ command, args });

    switch (command) {
      case 'app_info':
        return TEST_APP_INFO;
      case 'get_config':
        if (options.failConfig) {
          throw new Error('backend unavailable (test)');
        }

        return TEST_CONFIG;
      case 'get_paths':
        return TEST_PATHS;
      case 'get_install_status':
        return TEST_INSTALL_STATUS;
      case 'get_server_state':
        return createTestServerState(options.running);
      case 'get_logs':
        return [];
      case 'list_worlds':
        return [];
      case 'list_backups':
        return [];
      case 'get_player_lists':
        return clone(playerLists);
      case 'get_known_players':
        if (options.knownPlayersPending) {
          return new Promise<never>(() => undefined);
        }

        return knownPlayers();
      case 'add_player': {
        const kind = args?.['list'] as PlayerListKind;
        const id = readStringArg(args, 'id');
        const name = typeof args?.['name'] === 'string' ? args['name'] : null;
        const entry: PlayerListEntry = { id, name };

        playerLists = {
          ...playerLists,
          [kind]: [...playerLists[kind], entry],
        };

        return clone(playerLists);
      }
      case 'remove_player': {
        const kind = args?.['list'] as PlayerListKind;
        const id = readStringArg(args, 'id').toLowerCase();

        playerLists = {
          ...playerLists,
          [kind]: playerLists[kind].filter((entry) => entry.id.toLowerCase() !== id),
        };

        return clone(playerLists);
      }
      case 'get_mod_status':
        return modStatus;
      case 'diagnose_network':
        return TEST_NETWORK;
      case 'install_server_mods':
        modStatus = TEST_MODS_INSTALLED;
        return modStatus;
      case 'save_config':
        return args?.['config'] ?? TEST_CONFIG;
      case 'stop_server':
        return createTestServerState(false);
      case 'start_server':
        return createTestServerState(true);
      case 'open_path':
        return undefined;
      default:
        return undefined;
    }
  };

  return { handler, calls };
}
