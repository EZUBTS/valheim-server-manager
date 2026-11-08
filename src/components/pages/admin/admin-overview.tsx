import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Crown,
  Gamepad2,
  Info,
  Loader2,
  Network,
  Play,
  Puzzle,
  Server,
  Square,
  Terminal,
  TriangleAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';

import { ComboCard } from '@/components/pages/admin/admin-command-card';
import { AdminPanelTitle } from '@/components/pages/admin/admin-item-card';
import {
  AdminLoadError,
  StatusChip,
  getDisplayId,
  getPlayerDisplayName,
  type AdminTabId,
} from '@/components/pages/admin/admin-shared';
import { useAdminDataTimeout } from '@/components/pages/admin/use-admin-data';
import { LogLineRow } from '@/components/features/log-line-row';
import { ServerPhaseBadge } from '@/components/features/server-phase-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate } from '@/hooks/use-navigate';
import { useNow } from '@/hooks/use-clock';
import { useServer } from '@/hooks/use-server';
import { ADMIN_COMBOS } from '@/lib/admin-commands';
import { cn } from '@/lib/cn';
import {
  formatDuration,
  formatPlayerCount,
  formatPort,
  formatRelativeTime,
  formatVersion,
} from '@/lib/format';
import { SERVER_PHASE_LABELS, canStartServer, canStopServer } from '@/lib/status';

/** Комбо, показываемые на обзоре. */
const OVERVIEW_COMBO_IDS = [
  'admin-kit',
  'immortal-stamina',
  'free-build',
  'flight',
  'items',
  'ghost',
] as const;

type ChecklistState = 'ok' | 'warning' | 'error' | 'info';

interface ChecklistItem {
  key: string;
  label: string;
  detail: string;
  state: ChecklistState;
  tab: AdminTabId;
  action: string;
}

const CHECKLIST_ICONS: Record<ChecklistState, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warning: TriangleAlert,
  error: XCircle,
  info: Info,
};

const CHECKLIST_STYLES: Record<ChecklistState, string> = {
  ok: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive',
  info: 'text-primary',
};

interface AdminOverviewTabProps {
  onOpenTab: (tab: AdminTabId) => void;
}

/** Обзорный раздел: статусы, чек-лист, комбо, последние игроки и лог. */
export function AdminOverviewTab({ onOpenTab }: AdminOverviewTabProps) {
  const store = useServer();
  const navigate = useNavigate();
  const { data, pending } = store;
  const now = useNow(30_000);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const configLoaded = data.config !== null;
  const { loading, failed, retry } = useAdminDataTimeout(configLoaded, store.refreshAll);

  const state = data.serverState;
  const phase = state?.phase ?? null;
  const running = phase === 'running';
  const adminsCount = data.players?.admins.length ?? 0;
  const knownPlayers = data.knownPlayers;
  const knownPlayerCount = knownPlayers?.length ?? null;
  const modsReady =
    data.modStatus?.bepinexInstalled === true && data.modStatus.serverDevcommandsInstalled === true;
  const lastLogs = data.logs.slice(-5);
  const lastPlayers = (knownPlayers ?? []).slice(0, 5);
  const combos = ADMIN_COMBOS.filter((combo) =>
    (OVERVIEW_COMBO_IDS as readonly string[]).includes(combo.id),
  );
  const serverInstalled = data.installStatus?.serverInstalled ?? false;

  const checklist: ChecklistItem[] = [
    {
      key: 'server',
      label: 'Файлы сервера установлены',
      detail: serverInstalled
        ? 'Valheim Dedicated Server на месте.'
        : 'Установите сервер на странице «Сервер».',
      state: serverInstalled ? 'ok' : 'error',
      tab: 'overview',
      action: 'Сервер',
    },
    {
      key: 'admins',
      label: 'В adminlist есть администратор',
      detail:
        adminsCount > 0
          ? `Записей в adminlist: ${adminsCount}. Изменения — после рестарта.`
          : 'Добавьте свой SteamID64 в adminlist — иначе команд в игре не будет.',
      state: adminsCount > 0 ? 'ok' : 'warning',
      tab: 'players',
      action: 'Игроки',
    },
    {
      key: 'known',
      label: 'Менеджер видит игроков',
      detail:
        knownPlayerCount === null
          ? 'Список игроков ещё загружается.'
          : knownPlayerCount > 0
            ? `Известно игроков: ${knownPlayerCount}.`
            : 'Запустите сервер и подключитесь — игроки появятся из логов.',
      state: knownPlayerCount !== null && knownPlayerCount > 0 ? 'ok' : 'warning',
      tab: 'players',
      action: 'Игроки',
    },
    {
      key: 'mods',
      label: 'Серверные моды установлены',
      detail: modsReady
        ? 'BepInEx + Server Devcommands — читы доступны после рестарта.'
        : 'Vanilla-сервер отклоняет читы; поставьте моды в разделе «Моды».',
      state: modsReady ? 'ok' : 'warning',
      tab: 'mods',
      action: 'Моды',
    },
    {
      key: 'client',
      label: 'Клиентские моды (проверьте у себя)',
      detail:
        'Проверьте на своём ПК: BepInExPack_Valheim и Server_devcommands. Xbox/консоли не могут.',
      state: 'info',
      tab: 'mods',
      action: 'Инструкция',
    },
  ];

  // Клиентские моды нельзя проверить автоматически — они не входят в счёт.
  const automaticItems = checklist.filter((item) => item.state !== 'info');
  const automaticOk = automaticItems.filter((item) => item.state === 'ok').length;

  if (!configLoaded) {
    if (store.status === 'error' || failed) {
      return (
        <AdminLoadError
          title="Не удалось загрузить данные админки"
          description={store.loadError ?? 'Ядро не ответило вовремя.'}
          onRetry={() => {
            retry();
            void store.refreshAll();
          }}
          retrying={store.status === 'loading'}
        />
      );
    }

    if (loading) {
      return (
        <div data-testid="admin-overview-loading" className="h-full space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      );
    }

    return (
      <AdminLoadError
        title="Данные ещё не пришли"
        description="Повторите загрузку данных админки."
        onRetry={() => {
          retry();
          void store.refreshAll();
        }}
      />
    );
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
            <div className="flex items-start justify-between gap-2">
              <AdminPanelTitle
                icon={<Server className="size-4" aria-hidden="true" />}
                title="Сервер"
              />
              <ServerPhaseBadge phase={phase} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
                <p className="text-muted-foreground">Аптайм</p>
                <p className="font-mono text-xs text-foreground">
                  {state?.phase === 'running' && state.startedAt !== null
                    ? formatDuration(Math.floor((now - state.startedAt) / 1000), 'clock')
                    : '—'}
                </p>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
                <p className="text-muted-foreground">Игроки</p>
                <p className="font-mono text-xs text-foreground">
                  {running ? formatPlayerCount(state?.playersOnline ?? 0) : '—'}
                </p>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
                <p className="text-muted-foreground">Порт</p>
                <p className="font-mono text-xs text-foreground">
                  {formatPort(state?.port ?? data.config?.server.port)} UDP
                </p>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
                <p className="text-muted-foreground">Версия</p>
                <p
                  className="truncate font-mono text-[10px] text-foreground"
                  title={formatVersion(state?.version)}
                >
                  {formatVersion(state?.version)}
                </p>
              </div>
            </div>
            {phase === 'error' && state?.lastError && (
              <p className="text-[10px] leading-4 text-destructive">{state.lastError}</p>
            )}
            <div className="mt-auto flex flex-wrap gap-2">
              {canStartServer(phase) && (
                <Button
                  size="sm"
                  disabled={pending.start || !serverInstalled}
                  onClick={() => {
                    void store.startServer();
                  }}
                >
                  {pending.start ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="size-3.5" aria-hidden="true" />
                  )}
                  Запустить
                </Button>
              )}
              {canStopServer(phase) && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending.stop}
                  onClick={() => {
                    setStopDialogOpen(true);
                  }}
                >
                  {pending.stop ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Square className="size-3.5" aria-hidden="true" />
                  )}
                  Остановить
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigate('logs');
                }}
              >
                Логи
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigate('network');
                }}
              >
                <Network className="size-3.5" aria-hidden="true" />
                Проверить сеть
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
            <AdminPanelTitle
              icon={<Crown className="size-4" aria-hidden="true" />}
              title="Администрирование"
              description="adminlist.txt применяется только после перезапуска сервера."
            />
            <div className="flex flex-wrap gap-1.5">
              <StatusChip tone={adminsCount > 0 ? 'success' : 'warning'}>
                админов: {adminsCount}
              </StatusChip>
              <StatusChip tone="neutral">
                известно: {knownPlayerCount === null ? '—' : knownPlayerCount}
              </StatusChip>
              <StatusChip tone={running ? 'success' : 'neutral'}>
                сервер: {phase ? SERVER_PHASE_LABELS[phase].toLowerCase() : '—'}
              </StatusChip>
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">
              Свой SteamID64 можно скопировать из F2-панели игрока или строки подключения в логе.
              Добавьте ID в adminlist и перезапустите сервер.
            </p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  onOpenTab('players');
                }}
              >
                <Users className="size-3.5" aria-hidden="true" />
                Игроки и adminlist
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenTab('help');
                }}
              >
                Как стать админом
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
            <div className="flex items-start justify-between gap-2">
              <AdminPanelTitle
                icon={<Puzzle className="size-4" aria-hidden="true" />}
                title="Моды для читов"
              />
              <Badge variant={modsReady ? 'success' : 'warning'}>
                {modsReady ? 'установлены' : 'нет'}
              </Badge>
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">
              {modsReady
                ? 'BepInEx + Server Devcommands установлены. Перезапустите сервер и введите devcommands в игре.'
                : 'Vanilla-сервер не даёт devcommands даже админу. Установите серверные моды.'}
            </p>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={running || pending['mods-install']}
                title={running ? 'Остановите сервер перед установкой модов' : undefined}
                onClick={() => {
                  void store.installMods();
                }}
              >
                {pending['mods-install'] ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Puzzle className="size-3.5" aria-hidden="true" />
                )}
                {modsReady ? 'Обновить моды' : 'Установить моды'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenTab('mods');
                }}
              >
                Подробнее
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-center justify-between gap-2">
              <AdminPanelTitle
                icon={<ClipboardList className="size-4" aria-hidden="true" />}
                title="Готов к админке"
                description="Быстрая проверка перед раздачей команд."
              />
              <StatusChip
                tone={automaticOk === automaticItems.length ? 'success' : 'warning'}
                title="Автоматические проверки (клиентские моды проверяются вручную)"
              >
                {automaticOk}/{automaticItems.length} автоматических пунктов
              </StatusChip>
            </div>
            <div className="space-y-1">
              {checklist.map((item) => {
                const Icon = CHECKLIST_ICONS[item.state];

                return (
                  <div
                    key={item.key}
                    className="flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/30"
                  >
                    <Icon
                      className={cn('mt-0.5 size-3.5 shrink-0', CHECKLIST_STYLES[item.state])}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-foreground">{item.label}</p>
                      <p className="text-[10px] leading-4 text-muted-foreground">{item.detail}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-1.5 text-[10px]"
                      onClick={() => {
                        onOpenTab(item.tab);
                      }}
                    >
                      {item.action}
                      <ArrowRight className="size-3" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] leading-4 text-muted-foreground">
              Клиентские моды не входят в автоматический счёт — проверьте их на своём ПК (PC).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-center justify-between gap-2">
              <AdminPanelTitle
                icon={<Terminal className="size-4" aria-hidden="true" />}
                title="Быстрые комбо"
                description="Скопируйте набор и вставьте в F5-консоль игры."
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => {
                  onOpenTab('commands');
                }}
              >
                Все команды
                <ArrowRight className="size-3" aria-hidden="true" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {combos.map((combo) => (
                <ComboCard key={combo.id} combo={combo} compact />
              ))}
            </div>
            <Notice tone="warning">
              Комбо с читами работают только с модом Server Devcommands; модерация (kick/ban/save) —
              в игре от админа.
            </Notice>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-center justify-between gap-2">
              <AdminPanelTitle
                icon={<Users className="size-4" aria-hidden="true" />}
                title="Последние игроки"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => {
                  onOpenTab('players');
                }}
              >
                Все игроки
                <ArrowRight className="size-3" aria-hidden="true" />
              </Button>
            </div>
            {lastPlayers.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
                {knownPlayers === null
                  ? 'Загружаем список игроков…'
                  : 'Пока никого не видели. Запустите сервер и подключитесь.'}
              </p>
            ) : (
              <ul className="space-y-1">
                {lastPlayers.map((player) => (
                  <li
                    key={`${player.platformId ?? ''}-${player.steamId64 ?? ''}-${player.lastSeenAt}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-accent/30"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-foreground">
                        {getPlayerDisplayName(player)}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {getDisplayId(player)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {player.isAdmin && (
                        <Badge variant="success" className="h-4 px-1.5 text-[9px]">
                          админ
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(player.lastSeenAt, now)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-center justify-between gap-2">
              <AdminPanelTitle
                icon={<Gamepad2 className="size-4" aria-hidden="true" />}
                title="Последние события лога"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => {
                  navigate('logs');
                }}
              >
                Все логи
                <ArrowRight className="size-3" aria-hidden="true" />
              </Button>
            </div>
            {lastLogs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
                Лог пуст. Строки появятся после запуска сервера.
              </p>
            ) : (
              <div className="space-y-0.5">
                {lastLogs.map((line) => (
                  <LogLineRow key={line.seq} line={line} hideSource />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
        {(
          [
            ['commands', 'Читы и команды'],
            ['items', 'Предметы и существа'],
            ['world', 'Читы мира'],
            ['mods', 'Моды'],
            ['help', 'Справка'],
          ] as ReadonlyArray<[AdminTabId, string]>
        ).map(([tab, label]) => (
          <Button
            key={tab}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              onOpenTab(tab);
            }}
          >
            {label}
            <ArrowRight className="size-3" aria-hidden="true" />
          </Button>
        ))}
      </div>

      <ConfirmDialog
        open={stopDialogOpen}
        title="Остановить сервер?"
        description="Сервер сохранит мир и завершит работу; несохранённый прогресс с последнего автосейва может потеряться."
        confirmLabel="Остановить"
        tone="danger"
        pending={pending.stop}
        onConfirm={() => {
          void (async () => {
            await store.stopServer(false);
            setStopDialogOpen(false);
          })();
        }}
        onCancel={() => {
          setStopDialogOpen(false);
        }}
      >
        <p className="text-xs leading-5 text-muted-foreground">
          {data.config?.autoBackupBeforeStop
            ? 'Перед остановкой будет создана резервная копия мира (автобэкап включён).'
            : 'Автобэкап перед остановкой выключен — при необходимости создайте копию во вкладке «Бэкапы».'}
        </p>
      </ConfirmDialog>
    </div>
  );
}
