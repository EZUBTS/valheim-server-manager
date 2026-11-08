import {
  Archive,
  Globe2,
  Loader2,
  Network,
  RefreshCw,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { AutoBackupSettings } from '@/components/features/auto-backup-settings';
import { InstallProgressCard } from '@/components/features/install-progress-card';
import { ReadinessChecklist } from '@/components/features/readiness-checklist';
import { RecentLogs } from '@/components/features/recent-logs';
import { ServerStatusCard } from '@/components/features/server-status-card';
import { PageContent, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate } from '@/hooks/use-navigate';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import {
  formatBackupCount,
  formatBytes,
  formatPort,
  formatRelativeTime,
  formatVersion,
} from '@/lib/format';
import { PAGE_META } from '@/lib/pages';
import { isServerActive } from '@/lib/status';

interface QuickActionProps {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
}

function QuickAction({ icon, title, description, onClick, disabled, pending }: QuickActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className={cn(
        'group flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5 text-left transition-colors outline-none',
        'hover:border-primary/40 hover:bg-accent/40',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/70 disabled:hover:bg-card/60',
      )}
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{icon}</span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Landing page: live status, readiness, quick actions and recent activity. */
export function DashboardPage() {
  const store = useServer();
  const navigate = useNavigate();
  const { data, status, loadError, pending } = store;
  const phase = data.serverState?.phase ?? null;
  const active = isServerActive(phase);
  const activeWorld = data.worlds.find((world) => world.isActive) ?? null;
  const latestBackup = data.backups[0] ?? null;
  const network = data.network;
  const needsSteamcmd = data.installStatus !== null && !data.installStatus.steamcmdInstalled;
  const needsServer = data.installStatus !== null && !data.installStatus.serverInstalled;

  const primaryInstallAction = needsSteamcmd
    ? {
        title: 'Установить SteamCMD',
        description: 'Скачать и распаковать steamcmd.zip',
        pending: pending.install,
        disabled: false,
        run: () => {
          void store.installSteamcmd();
        },
      }
    : needsServer
      ? {
          title: 'Установить сервер',
          description: 'SteamCMD app_update 896660',
          pending: pending.update,
          disabled: active,
          run: () => {
            void store.updateServer(true);
          },
        }
      : {
          title: 'Обновить сервер',
          description: 'SteamCMD app_update 896660',
          pending: pending.update,
          disabled: active,
          run: () => {
            void store.updateServer(true);
          },
        };

  return (
    <PageContent>
      <PageHeader
        title={PAGE_META.dashboard.label}
        description={PAGE_META.dashboard.description}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void store.refreshAll();
            }}
            disabled={status === 'loading'}
          >
            <RefreshCw
              className={cn('size-3.5', status === 'loading' && 'animate-spin')}
              aria-hidden="true"
            />
            Обновить
          </Button>
        }
      />

      {status === 'loading' && <DashboardSkeleton />}

      {status === 'error' && (
        <Notice tone="danger" title="Не удалось загрузить состояние сервера">
          {loadError ?? 'Проверьте, что десктопное приложение запущено, и повторите попытку.'}
        </Notice>
      )}

      {status === 'ready' && (
        <>
          <InstallProgressCard />

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <ServerStatusCard />

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <QuickAction
                  icon={<RefreshCw className="size-4" />}
                  title={primaryInstallAction.title}
                  description={primaryInstallAction.description}
                  pending={primaryInstallAction.pending}
                  disabled={primaryInstallAction.disabled}
                  onClick={primaryInstallAction.run}
                />
                <QuickAction
                  icon={<Archive className="size-4" />}
                  title="Создать бэкап"
                  description="ZIP-архив миров Valheim"
                  pending={pending['backup-create']}
                  onClick={() => {
                    void store.createBackup(null);
                  }}
                />
                <QuickAction
                  icon={<ScrollText className="size-4" />}
                  title="Открыть логи"
                  description="Живой вывод и фильтры"
                  onClick={() => {
                    navigate('logs');
                  }}
                />
                <QuickAction
                  icon={<Network className="size-4" />}
                  title="Проверить сеть"
                  description="Порты, брандмауэр, IP"
                  onClick={() => {
                    navigate('network');
                  }}
                />
              </div>

              <RecentLogs
                onOpenLogs={() => {
                  navigate('logs');
                }}
              />
            </div>

            <div className="space-y-4">
              <ReadinessChecklist onNavigate={navigate} />
              <AutoBackupSettings />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Globe2 className="size-3.5 text-primary" aria-hidden="true" />
                  Миры
                </CardTitle>
                <CardDescription>
                  {data.worlds.length > 0
                    ? `${data.worlds.length} в каталоге worlds_local`
                    : 'Миры пока не найдены'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-2">
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <p className="truncate font-display text-base font-semibold">
                    {activeWorld?.name ?? data.config?.server.world ?? '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    активный мир ·{' '}
                    {activeWorld ? formatBytes(activeWorld.sizeBytes) : 'ещё не создан'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => {
                    navigate('world');
                  }}
                >
                  Управлять мирами
                </Button>
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Archive className="size-3.5 text-primary" aria-hidden="true" />
                  Бэкапы
                </CardTitle>
                <CardDescription>
                  {formatBackupCount(data.backups.length)} в каталоге
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-2">
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <p className="truncate font-mono text-[11px] font-medium">
                    {latestBackup?.name ?? 'Резервных копий пока нет'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {latestBackup
                      ? `${formatRelativeTime(latestBackup.createdAt)} · ${formatBytes(latestBackup.sizeBytes)}`
                      : 'Создайте первую копию мира'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => {
                    navigate('backups');
                  }}
                >
                  Все резервные копии
                </Button>
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
                  Сеть
                </CardTitle>
                <CardDescription>
                  UDP {formatPort(network?.portRange[0] ?? data.config?.server.port)}–
                  {formatPort(network?.portRange[1] ?? null)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-2">
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">Брандмауэр</span>
                    {data.config?.server.crossplay ? (
                      <Badge variant="outline">не требуется</Badge>
                    ) : network?.firewallOk ? (
                      <Badge variant="success">разрешён</Badge>
                    ) : (
                      <Badge variant="warning">настроить</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Версия сервера: {formatVersion(data.serverState?.version)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => {
                    navigate('network');
                  }}
                >
                  К сетевой диагностике
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageContent>
  );
}
