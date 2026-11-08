import { Download, FolderOpen, Loader2, Puzzle, RefreshCw } from 'lucide-react';

import { CopyAction, AdminLoadError } from '@/components/pages/admin/admin-shared';
import { useAdminDataTimeout } from '@/components/pages/admin/use-admin-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoList, InfoRow } from '@/components/ui/info-row';
import { Notice } from '@/components/ui/notice';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useServer } from '@/hooks/use-server';
import { formatPercent } from '@/lib/format';
import { INSTALL_PHASE_LABELS } from '@/lib/status';

/** Ссылки на моды (Thunderstore). Открываются игроком вручную. */
const BEPINEX_PACK_URL = 'https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/';
const SERVER_DEVCOMMANDS_URL =
  'https://thunderstore.io/c/valheim/p/JereKuusela/Server_devcommands/';

/** Ссылки на клиентские моды — копируются, но не открываются автоматически. */
const MOD_LINKS: ReadonlyArray<{ label: string; url: string }> = [
  { label: 'BepInExPack_Valheim (Thunderstore)', url: BEPINEX_PACK_URL },
  { label: 'Server_devcommands (Thunderstore)', url: SERVER_DEVCOMMANDS_URL },
];

export function AdminModsTab() {
  const store = useServer();
  const { data, pending, status } = store;
  const phase = data.serverState?.phase ?? null;
  const running = phase === 'running' || phase === 'starting' || phase === 'stopping';
  const modStatus = data.modStatus;
  const bepinexInstalled = modStatus?.bepinexInstalled === true;
  const devcommandsInstalled = modStatus?.serverDevcommandsInstalled === true;
  const modsReady = bepinexInstalled && devcommandsInstalled;
  const progress = data.installProgress;
  const installing = pending['mods-install'];
  const showProgress =
    installing || (progress !== null && /мод|BepInEx|devcommands/i.test(progress.message));
  const { loading, failed, retry } = useAdminDataTimeout(modStatus !== null, store.refreshMods);

  // Статус модов ещё не пришёл от ядра — показываем skeleton вместо ложного «нет».
  if (modStatus === null) {
    if (status === 'error' || failed) {
      return (
        <AdminLoadError
          title="Статус модов не загрузился"
          onRetry={() => {
            retry();
            void store.refreshMods();
          }}
          retrying={pending['mods-refresh']}
        />
      );
    }

    if (loading) {
      return (
        <div data-testid="admin-mods-loading" className="h-full space-y-3 overflow-y-auto p-5">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      );
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Puzzle className="size-3.5 text-primary" aria-hidden="true" />
                Читы на сервере: поддержка модов
              </CardTitle>
              <CardDescription>
                Ванильный выделенный сервер отключает devcommands — для god/fly/spawn/itemset нужны
                BepInEx и Server Devcommands. Менеджер ставит серверную часть автоматически.
              </CardDescription>
            </div>
            <Badge variant={modsReady ? 'success' : bepinexInstalled ? 'warning' : 'danger'}>
              {modsReady
                ? 'моды установлены'
                : bepinexInstalled
                  ? 'BepInEx есть, Server_devcommands нет'
                  : 'vanilla — читы отключены'}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {modsReady ? (
              <Notice tone="success" title="Моды установлены">
                Перезапустите сервер, чтобы BepInEx и Server Devcommands загрузились. После рестарта
                введите в игре F5 → <span className="font-mono">devcommands</span> → нужную команду.
              </Notice>
            ) : (
              <Notice tone="warning" title="Почему читы не работают">
                На обычном (vanilla) выделенном сервере команды{' '}
                <span className="font-mono">devcommands</span>,{' '}
                <span className="font-mono">god</span>, <span className="font-mono">fly</span>,{' '}
                <span className="font-mono">spawn</span>, <span className="font-mono">itemset</span>{' '}
                отклоняются даже для админа — это ограничение Iron Gate. Их включают только моды
                BepInEx + Server Devcommands.
              </Notice>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                <InfoList>
                  <InfoRow label="BepInEx">
                    {bepinexInstalled
                      ? `установлен${modStatus?.bepinexVersion ? ` · v${modStatus.bepinexVersion}` : ''}`
                      : 'не установлен'}
                  </InfoRow>
                  <InfoRow label="Server_devcommands">
                    {devcommandsInstalled
                      ? `установлен${modStatus?.serverDevcommandsVersion ? ` · v${modStatus.serverDevcommandsVersion}` : ''}`
                      : 'не установлен'}
                  </InfoRow>
                  <InfoRow label="Плагины" mono={Boolean(modStatus?.plugins.length)}>
                    {modStatus && modStatus.plugins.length > 0 ? modStatus.plugins.join(', ') : '—'}
                  </InfoRow>
                  <InfoRow label="Каталог сервера" mono title={modStatus?.installDir}>
                    {modStatus?.installDir ?? data.config?.installDir ?? '—'}
                  </InfoRow>
                </InfoList>
              </div>

              <div className="space-y-3">
                {showProgress && progress && (
                  <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium text-foreground">
                        {INSTALL_PHASE_LABELS[progress.phase]}
                      </span>
                      <span className="font-mono text-muted-foreground tabular-nums">
                        {formatPercent(progress.percent)}
                      </span>
                    </div>
                    <Progress
                      value={progress.phase === 'done' ? 100 : progress.percent}
                      label="Установка серверных модов"
                      className="mt-1.5 h-1.5"
                    />
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      {progress.message}
                    </p>
                  </div>
                )}

                {running && (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] leading-4 text-warning-foreground">
                    Сервер запущен — остановите его, чтобы установить моды (кнопка «Остановить» на
                    странице «Обзор»).
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={running || installing}
                    title={
                      running
                        ? 'Остановите сервер перед установкой модов'
                        : modsReady
                          ? 'Переустановить/обновить серверные моды'
                          : 'Скачать BepInExPack_Valheim и Server_devcommands с Thunderstore'
                    }
                    onClick={() => {
                      void store.installMods();
                    }}
                  >
                    {installing ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="size-4" aria-hidden="true" />
                    )}
                    {modsReady ? 'Переустановить моды' : 'Установить моды'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending['mods-refresh']}
                    onClick={() => {
                      void store.refreshMods();
                    }}
                  >
                    {pending['mods-refresh'] ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                    )}
                    Обновить статус
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!bepinexInstalled}
                    title={
                      bepinexInstalled
                        ? 'Открыть каталог BepInEx в проводнике'
                        : 'BepInEx ещё не установлен'
                    }
                    onClick={() => {
                      void store.openPath('bepinexDir');
                    }}
                  >
                    <FolderOpen className="size-3.5" aria-hidden="true" />
                    Открыть папку BepInEx
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 rounded-lg border border-border/70 bg-muted/15 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Puzzle className="size-3.5 text-primary" aria-hidden="true" />
                Клиентская часть (для админа-игрока)
              </p>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Менеджер ставит <span className="font-medium text-foreground">серверную часть</span>{' '}
                (BepInEx + Server_devcommands в BepInEx/plugins). Чтобы вводить читы, админ ставит
                моды и себе на клиент: Server devcommands снимает запрет devcommands для админа и
                добавляет расширенные команды. Игроки без модов обычно могут играть, но части
                функционала не увидят.
              </p>
              <ol className="space-y-1 text-[11px] leading-4 text-muted-foreground">
                <li>
                  1. Установите <span className="font-medium text-foreground">r2modman</span> /
                  Thunderstore Mod Manager на PC.
                </li>
                <li>
                  2. В профиле Valheim установите{' '}
                  <span className="font-mono">BepInExPack_Valheim</span> и{' '}
                  <span className="font-mono">Server_devcommands</span>.
                </li>
                <li>
                  3. Запустите игру и включите консоль: в 1.0 она доступна в настройках геймплея или
                  через launch option <span className="font-mono">-console</span>, затем F5.
                </li>
                <li>
                  4. Подключитесь к серверу и введите <span className="font-mono">devcommands</span>{' '}
                  → нужная команда из каталога выше.
                </li>
              </ol>
              <div className="space-y-1.5">
                {MOD_LINKS.map((link) => (
                  <div
                    key={link.url}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/50 px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-foreground">{link.label}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {link.url}
                      </p>
                    </div>
                    <CopyAction
                      value={link.url}
                      title="Ссылка скопирована"
                      label={`Копировать ссылку ${link.label}`}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">
                Моды только для PC: Xbox/PlayStation не могут устанавливать BepInEx. Включение читов
                помечает персонажа/мир как «читерский» и блокирует достижения Iron Gate — вернуть их
                можно командой{' '}
                <span className="font-mono">yesiuseddevcommandsbutiwantmyachievementsanyway 1</span>{' '}
                (хотфикс 1.0.12). Моды — на свой риск и могут ломаться при обновлениях игры; перед
                экспериментами сделайте бэкап мира во вкладке «Бэкапы».
              </p>
            </div>
            <Notice tone="info" title="RCON и удалённое выполнение команд">
              Server Devcommands не делает консоль сервера интерактивной и не добавляет RCON. Для
              удалённых команд нужны сторонние RCON-моды (RCON-Next + мост команд, ValheimRcon,
              ConsoleStdinHeeler) и отдельная интеграция — в v1 не поддерживается.
            </Notice>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
