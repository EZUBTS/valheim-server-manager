import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { describeIpcError } from '@/lib/error-messages';
import * as ipc from '@/lib/ipc';
import { appendLogLine, sortLogLines } from '@/lib/log-filter';
import { isPreviewMode } from '@/lib/preview';
import {
  ServerContext,
  type LoadStatus,
  type NewToast,
  type PendingAction,
  type PendingState,
  type ServerData,
  type ServerStore,
  type ToastMessage,
} from '@/providers/server-context';
import type { AppConfig, LogLine, OpenTarget, PlayerListKind } from '@/lib/types';

/** Ring buffer size mirrored from the Rust side. */
const MAX_LOG_LINES = 2000;

const EMPTY_DATA: ServerData = {
  config: null,
  paths: null,
  appInfo: null,
  installStatus: null,
  serverState: null,
  logs: [],
  worlds: [],
  backups: [],
  players: null,
  knownPlayers: null,
  modStatus: null,
  network: null,
  installProgress: null,
};

const EMPTY_PENDING: PendingState = {
  initial: false,
  'save-config': false,
  'reset-config': false,
  install: false,
  update: false,
  start: false,
  stop: false,
  'backup-create': false,
  'backup-restore': false,
  'backup-delete': false,
  players: false,
  'known-players': false,
  'mods-install': false,
  'mods-refresh': false,
  network: false,
  firewall: false,
  'open-path': false,
  'port-check': false,
  'clear-logs': false,
};

/** Resolves to `null` instead of rejecting — useful for optional refreshes. */
async function optional<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

/** Merges log groups by `seq`, keeping the newest 2000 lines. */
function mergeLogs(...groups: ReadonlyArray<readonly LogLine[]>): LogLine[] {
  const bySeq = new Map<number, LogLine>();

  for (const group of groups) {
    for (const line of group) {
      bySeq.set(line.seq, line);
    }
  }

  return [...bySeq.values()].toSorted((left, right) => left.seq - right.seq).slice(-MAX_LOG_LINES);
}

interface ServerProviderProps {
  children: ReactNode;
}

/**
 * Single application store: loads every slice of state, subscribes to Tauri
 * events, exposes typed actions and surfaces failures as Russian toasts.
 */
export function ServerProvider({ children }: ServerProviderProps) {
  const [data, setData] = useState<ServerData>(EMPTY_DATA);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingState>(EMPTY_PENDING);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);
  const isPreview = isPreviewMode();

  const notify = useCallback((toast: NewToast) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;
    setToasts((current) => [...current.slice(-4), { id, ...toast }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notifyError = useCallback(
    (error: unknown) => {
      const described = describeIpcError(error);
      const description = described.hint
        ? `${described.message}. ${described.hint}`
        : described.message;

      notify({ tone: 'error', title: described.title, description });
    },
    [notify],
  );

  const runAction = useCallback(async function runActionInternal<T>(
    key: PendingAction,
    action: () => Promise<T>,
  ): Promise<T> {
    setPending((current) => ({ ...current, [key]: true }));

    try {
      return await action();
    } finally {
      setPending((current) => ({ ...current, [key]: false }));
    }
  }, []);
  const appendLog = useCallback((line: LogLine) => {
    setData((current) => {
      if (current.logs.some((entry) => entry.seq === line.seq)) {
        return current;
      }

      return { ...current, logs: appendLogLine(current.logs, line, MAX_LOG_LINES) };
    });
  }, []);

  // --- Refreshes -----------------------------------------------------------

  const refreshServerState = useCallback(async () => {
    const state = await optional(ipc.getServerState());

    if (state) {
      setData((current) => ({ ...current, serverState: state }));
    }
  }, []);

  const refreshInstallStatus = useCallback(async () => {
    const installStatus = await optional(ipc.getInstallStatus());

    if (installStatus) {
      setData((current) => ({ ...current, installStatus }));
    }
  }, []);

  const refreshWorlds = useCallback(async () => {
    const worlds = await optional(ipc.listWorlds());

    if (worlds) {
      setData((current) => ({ ...current, worlds }));
    }
  }, []);

  const refreshBackups = useCallback(async () => {
    const backups = await optional(ipc.listBackups());

    if (backups) {
      setData((current) => ({ ...current, backups }));
    }
  }, []);

  const refreshLists = useCallback(async () => {
    const players = await optional(ipc.getPlayerLists());

    if (players) {
      setData((current) => ({ ...current, players }));
    }
  }, []);

  const refreshKnownPlayers = useCallback(async () => {
    await runAction('known-players', async () => {
      const knownPlayers = await optional(ipc.getKnownPlayers());

      if (knownPlayers) {
        setData((current) => ({ ...current, knownPlayers }));
      }
    });
  }, [runAction]);

  const refreshMods = useCallback(async () => {
    await runAction('mods-refresh', async () => {
      const modStatus = await optional(ipc.getModStatus());

      if (modStatus) {
        setData((current) => ({ ...current, modStatus }));
      }
    });
  }, [runAction]);

  const refreshNetwork = useCallback(async () => {
    const network = await optional(ipc.diagnoseNetwork());

    if (network) {
      setData((current) => ({ ...current, network }));
    }
  }, []);

  /**
   * Загружает состояние приложения в два независимых этапа.
   *
   * 1. Быстрое ядро (config/paths/appInfo/installStatus/serverState) — как только
   *    оно получено, статус становится `ready`, и страницы могут рисовать контент.
   * 2. Независимые «срезы» (логи/миры/бэкапы/списки/известные игроки/моды)
   *    догружаются в фоне и не блокируют `ready`; каждый применяется по мере
   *    готовности.
   *
   * `diagnose_network` намеренно НЕ вызывается при старте: на больших машинах он
   * может занимать десятки секунд. Диагностика грузится лениво со страницы «Сеть»
   * или по действию пользователя.
   */
  const refreshAll = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);

    const coreResults = await Promise.allSettled([
      ipc.getConfig(),
      ipc.getPaths(),
      ipc.getAppInfo(),
      ipc.getInstallStatus(),
      ipc.getServerState(),
    ]);
    const [configResult, pathsResult, appInfoResult, installResult, serverStateResult] =
      coreResults;
    const corePatch: Partial<ServerData> = {};

    if (configResult?.status === 'fulfilled') {
      corePatch.config = configResult.value;
    }
    if (pathsResult?.status === 'fulfilled') {
      corePatch.paths = pathsResult.value;
    }
    if (appInfoResult?.status === 'fulfilled') {
      corePatch.appInfo = appInfoResult.value;
    }
    if (installResult?.status === 'fulfilled') {
      corePatch.installStatus = installResult.value;
    }
    if (serverStateResult?.status === 'fulfilled') {
      corePatch.serverState = serverStateResult.value;
    }

    setData((current) => ({ ...current, ...corePatch }));

    // Без конфигурации/путей приложение работать не может — это фатальная ошибка.
    const coreFailure =
      configResult?.status === 'rejected'
        ? configResult.reason
        : pathsResult?.status === 'rejected'
          ? pathsResult.reason
          : null;

    if (coreFailure !== null) {
      const described = describeIpcError(coreFailure);
      setLoadError(
        described.hint
          ? `${described.title}. ${described.hint}`
          : `${described.title}: ${described.message}`,
      );
      setStatus('error');
    } else {
      setStatus('ready');
    }

    // Фоновые быстрые вызовы: не влияют на готовность интерфейса.
    void Promise.allSettled([
      ipc.getLogs({ limit: MAX_LOG_LINES }),
      ipc.listWorlds(),
      ipc.listBackups(),
      ipc.getPlayerLists(),
      ipc.getKnownPlayers(),
      ipc.getModStatus(),
    ]).then((results) => {
      const [logsResult, worldsResult, backupsResult, playersResult, knownResult, modsResult] =
        results;

      setData((current) => ({
        ...current,
        logs:
          logsResult?.status === 'fulfilled'
            ? mergeLogs(current.logs, sortLogLines(logsResult.value))
            : current.logs,
        worlds: worldsResult?.status === 'fulfilled' ? worldsResult.value : current.worlds,
        backups: backupsResult?.status === 'fulfilled' ? backupsResult.value : current.backups,
        players: playersResult?.status === 'fulfilled' ? playersResult.value : current.players,
        knownPlayers:
          knownResult?.status === 'fulfilled' ? knownResult.value : current.knownPlayers,
        modStatus: modsResult?.status === 'fulfilled' ? modsResult.value : current.modStatus,
      }));
    });
  }, []);

  // --- Configuration -------------------------------------------------------

  const saveConfig = useCallback(
    async (config: AppConfig): Promise<boolean> =>
      runAction('save-config', async () => {
        try {
          const saved = await ipc.saveConfig(config);
          const [paths, installStatus, worlds] = await Promise.all([
            optional(ipc.getPaths()),
            optional(ipc.getInstallStatus()),
            optional(ipc.listWorlds()),
          ]);

          setData((current) => ({
            ...current,
            config: saved,
            paths: paths ?? current.paths,
            installStatus: installStatus ?? current.installStatus,
            worlds: worlds ?? current.worlds,
          }));
          notify({
            tone: 'success',
            title: 'Конфигурация сохранена',
            description:
              'Если сервер работает, изменения мира и порта применятся после перезапуска.',
          });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, runAction],
  );

  const resetConfig = useCallback(
    async (): Promise<boolean> =>
      runAction('reset-config', async () => {
        try {
          const config = await ipc.resetConfig();
          const [paths, installStatus, worlds] = await Promise.all([
            optional(ipc.getPaths()),
            optional(ipc.getInstallStatus()),
            optional(ipc.listWorlds()),
          ]);

          setData((current) => ({
            ...current,
            config,
            paths: paths ?? current.paths,
            installStatus: installStatus ?? current.installStatus,
            worlds: worlds ?? current.worlds,
          }));
          notify({
            tone: 'success',
            title: 'Конфигурация сброшена',
            description: 'Восстановлены значения по умолчанию.',
          });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, runAction],
  );

  // --- Install and process -------------------------------------------------

  const installSteamcmd = useCallback(async (): Promise<void> => {
    await runAction('install', async () => {
      try {
        const progress = await ipc.installSteamcmd();
        setData((current) => ({ ...current, installProgress: progress }));
      } catch (error) {
        setData((current) => ({ ...current, installProgress: null }));
        notifyError(error);
      }
    });
  }, [notifyError, runAction]);

  const updateServer = useCallback(
    async (validate: boolean): Promise<void> => {
      await runAction('update', async () => {
        try {
          const progress = await ipc.updateServer(validate);
          setData((current) => ({ ...current, installProgress: progress }));
        } catch (error) {
          setData((current) => ({ ...current, installProgress: null }));
          notifyError(error);
        }
      });
    },
    [notifyError, runAction],
  );

  const installMods = useCallback(
    async (): Promise<boolean> =>
      runAction('mods-install', async () => {
        try {
          const modStatus = await ipc.installServerMods();
          setData((current) => ({ ...current, modStatus }));
          notify({
            tone: 'success',
            title: modStatus.bepinexInstalled ? 'Моды установлены' : 'Установка модов завершена',
            description: 'Перезапустите сервер, чтобы BepInEx и Server_devcommands загрузились.',
          });

          return modStatus.bepinexInstalled;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, runAction],
  );

  const startServer = useCallback(
    async (): Promise<boolean> =>
      runAction('start', async () => {
        try {
          const state = await ipc.startServer();
          setData((current) => ({ ...current, serverState: state }));
          notify({
            tone: 'success',
            title: 'Сервер запускается',
            description: 'Готовность появится, когда сервер напишет «Game server connected».',
          });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, runAction],
  );

  const stopServer = useCallback(
    async (force: boolean): Promise<boolean> =>
      runAction('stop', async () => {
        try {
          const state = await ipc.stopServer(force);
          setData((current) => ({ ...current, serverState: state }));
          notify({
            tone: 'success',
            title: 'Сервер остановлен',
            description: 'Мир сохранён, процесс завершён.',
          });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, runAction],
  );

  // --- Backups -------------------------------------------------------------

  const createBackup = useCallback(
    async (label: string | null): Promise<boolean> =>
      runAction('backup-create', async () => {
        try {
          const backup = await ipc.createBackup(label);
          await refreshBackups();
          notify({
            tone: 'success',
            title: 'Резервная копия создана',
            description: backup.name,
          });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, refreshBackups, runAction],
  );

  const restoreBackup = useCallback(
    async (name: string, createSafetyBackup: boolean): Promise<boolean> =>
      runAction('backup-restore', async () => {
        try {
          await ipc.restoreBackup(name, createSafetyBackup);
          await Promise.all([refreshBackups(), refreshWorlds()]);
          notify({
            tone: 'success',
            title: 'Мир восстановлен',
            description: name,
          });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, refreshBackups, refreshWorlds, runAction],
  );

  const deleteBackup = useCallback(
    async (name: string): Promise<boolean> =>
      runAction('backup-delete', async () => {
        try {
          await ipc.deleteBackup(name);
          await refreshBackups();
          notify({ tone: 'success', title: 'Резервная копия удалена', description: name });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, refreshBackups, runAction],
  );

  // --- Player lists --------------------------------------------------------

  const addPlayer = useCallback(
    async (list: PlayerListKind, id: string, name: string | null): Promise<boolean> =>
      runAction('players', async () => {
        try {
          const players = await ipc.addPlayer(list, id, name);
          setData((current) => ({ ...current, players }));
          await refreshKnownPlayers();
          notify({ tone: 'success', title: 'Игрок добавлен в список', description: id });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, refreshKnownPlayers, runAction],
  );

  const removePlayer = useCallback(
    async (list: PlayerListKind, id: string): Promise<boolean> =>
      runAction('players', async () => {
        try {
          const players = await ipc.removePlayer(list, id);
          setData((current) => ({ ...current, players }));
          await refreshKnownPlayers();
          notify({ tone: 'success', title: 'Игрок удалён из списка', description: id });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, refreshKnownPlayers, runAction],
  );

  // --- Network, files, logs ------------------------------------------------

  const diagnoseNetwork = useCallback(async (): Promise<void> => {
    await runAction('network', async () => {
      try {
        const network = await ipc.diagnoseNetwork();
        setData((current) => ({ ...current, network }));
      } catch (error) {
        notifyError(error);
      }
    });
  }, [notifyError, runAction]);

  const allowFirewall = useCallback(
    async (): Promise<boolean> =>
      runAction('firewall', async () => {
        try {
          const network = await ipc.openFirewallPorts();
          setData((current) => ({ ...current, network }));
          notify({
            tone: 'success',
            title: 'Правило брандмауэра добавлено',
            description: `Входящий UDP ${network.portRange[0]}–${network.portRange[1]}.`,
          });

          return true;
        } catch (error) {
          notifyError(error);
          return false;
        }
      }),
    [notify, notifyError, runAction],
  );

  const openPath = useCallback(
    async (target: OpenTarget): Promise<void> => {
      await runAction('open-path', async () => {
        try {
          await ipc.openPath(target);

          if (isPreview) {
            notify({
              tone: 'info',
              title: 'Режим предпросмотра',
              description: 'Проводник открывается только в десктопном приложении.',
            });
          }
        } catch (error) {
          notifyError(error);
        }
      });
    },
    [isPreview, notify, notifyError, runAction],
  );

  const checkPortAvailable = useCallback(
    async (port: number): Promise<boolean | null> => {
      try {
        return await ipc.isPortAvailable(port);
      } catch (error) {
        notifyError(error);
        return null;
      }
    },
    [notifyError],
  );

  const clearLogs = useCallback(async (): Promise<void> => {
    await runAction('clear-logs', async () => {
      try {
        await ipc.clearLogs();
        setData((current) => ({ ...current, logs: [] }));
        notify({ tone: 'success', title: 'Лог очищен', description: 'Файл лога не тронут.' });
      } catch (error) {
        notifyError(error);
      }
    });
  }, [notify, notifyError, runAction]);

  // --- Effects -------------------------------------------------------------

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const boot = async () => {
      const subscriptions = await Promise.allSettled([
        ipc.onServerLog((line) => {
          if (!disposed) {
            appendLog(line);
          }
        }),
        ipc.onServerState((state) => {
          if (!disposed) {
            setData((current) => ({ ...current, serverState: state }));
          }
        }),
        ipc.onInstallProgress((progress) => {
          if (!disposed) {
            setData((current) => ({ ...current, installProgress: progress }));
          }
        }),
        ipc.onPlayerListsChanged((players) => {
          if (!disposed) {
            setData((current) => ({ ...current, players }));
          }
        }),
      ]);

      for (const result of subscriptions) {
        if (result.status === 'fulfilled') {
          unlisteners.push(result.value);
        }
      }

      if (disposed) {
        for (const unlisten of unlisteners) {
          unlisten();
        }

        return;
      }

      await refreshAll();
    };

    void boot();

    return () => {
      disposed = true;

      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [appendLog, refreshAll]);

  // Announce the result of a finished download/update once.
  useEffect(() => {
    const progress = data.installProgress;

    if (!progress || (progress.phase !== 'done' && progress.phase !== 'error')) {
      return undefined;
    }

    const timer = setTimeout(() => {
      if (progress.phase === 'done') {
        void refreshInstallStatus();
        notify({ tone: 'success', title: progress.message, description: null });
      } else {
        notify({ tone: 'error', title: 'Операция не завершена', description: progress.message });
      }
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [data.installProgress, notify, refreshInstallStatus]);

  // Hide the finished progress bar after a few seconds.
  useEffect(() => {
    const progress = data.installProgress;

    if (!progress || (progress.phase !== 'done' && progress.phase !== 'error')) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setData((current) => ({ ...current, installProgress: null }));
    }, 6000);

    return () => {
      clearTimeout(timer);
    };
  }, [data.installProgress]);

  const value = useMemo<ServerStore>(
    () => ({
      data,
      status,
      loadError,
      pending,
      toasts,
      isPreview,
      refreshAll,
      refreshServerState,
      refreshInstallStatus,
      refreshWorlds,
      refreshBackups,
      refreshLists,
      refreshKnownPlayers,
      refreshMods,
      refreshNetwork,
      saveConfig,
      resetConfig,
      installSteamcmd,
      updateServer,
      installMods,
      startServer,
      stopServer,
      createBackup,
      restoreBackup,
      deleteBackup,
      addPlayer,
      removePlayer,
      diagnoseNetwork,
      allowFirewall,
      openPath,
      checkPortAvailable,
      clearLogs,
      notify,
      dismissToast,
    }),
    [
      data,
      status,
      loadError,
      pending,
      toasts,
      isPreview,
      refreshAll,
      refreshServerState,
      refreshInstallStatus,
      refreshWorlds,
      refreshBackups,
      refreshLists,
      refreshKnownPlayers,
      refreshMods,
      refreshNetwork,
      saveConfig,
      resetConfig,
      installSteamcmd,
      updateServer,
      installMods,
      startServer,
      stopServer,
      createBackup,
      restoreBackup,
      deleteBackup,
      addPlayer,
      removePlayer,
      diagnoseNetwork,
      allowFirewall,
      openPath,
      checkPortAvailable,
      clearLogs,
      notify,
      dismissToast,
    ],
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}
