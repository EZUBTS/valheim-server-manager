import {
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useState } from 'react';

import { InstallProgressCard } from '@/components/features/install-progress-card';
import { LaunchArgumentsCard } from '@/components/features/launch-arguments-card';
import { PageContent, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoList, InfoRow } from '@/components/ui/info-row';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { useServer } from '@/hooks/use-server';
import { formatBytes, formatVersion } from '@/lib/format';
import { PAGE_META } from '@/lib/pages';
import { isServerActive } from '@/lib/status';

/** Installation, updates, paths and the launch-argument preview. */
export function ServerPage() {
  const store = useServer();
  const { data, pending } = store;
  const [validateFiles, setValidateFiles] = useState(true);

  const installStatus = data.installStatus;
  const paths = data.paths;
  const phase = data.serverState?.phase ?? null;
  const serverRunning = isServerActive(phase);
  const steamcmdInstalled = installStatus?.steamcmdInstalled ?? false;
  const serverInstalled = installStatus?.serverInstalled ?? false;

  return (
    <PageContent>
      <PageHeader
        title={PAGE_META.server.label}
        description={PAGE_META.server.description}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void Promise.all([store.refreshInstallStatus(), store.refreshServerState()]);
            }}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Обновить статус
          </Button>
        }
      />

      <InstallProgressCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-3.5 text-primary" aria-hidden="true" />
                SteamCMD
              </CardTitle>
              <CardDescription>
                Инструмент Valve для установки и обновления выделенного сервера.
              </CardDescription>
            </div>
            <Badge variant={steamcmdInstalled ? 'success' : 'warning'}>
              {steamcmdInstalled ? 'Установлен' : 'Не найден'}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <InfoList>
              <InfoRow label="Путь" mono title={installStatus?.steamcmdPath}>
                {installStatus?.steamcmdPath ?? '—'}
              </InfoRow>
              <InfoRow label="Каталог" mono title={installStatus?.steamcmdPath}>
                {data.config?.steamcmdDir ?? '—'}
              </InfoRow>
            </InfoList>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void store.installSteamcmd();
                }}
                disabled={pending.install || pending.update}
              >
                {pending.install ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                {steamcmdInstalled ? 'Переустановить' : 'Установить SteamCMD'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void store.openPath('steamcmdDir');
                }}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                Открыть каталог
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
                Valheim Dedicated Server
              </CardTitle>
              <CardDescription>AppID 896660, анонимный вход SteamCMD.</CardDescription>
            </div>
            <Badge variant={serverInstalled ? 'success' : 'warning'}>
              {serverInstalled ? 'Установлен' : 'Не установлен'}
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <InfoList>
              <InfoRow label="Размер установки">
                {serverInstalled ? formatBytes(installStatus?.installSizeBytes) : '—'}
              </InfoRow>
              <InfoRow label="Версия сервера">
                <span className="font-mono text-[11px]">
                  {formatVersion(data.serverState?.version)}
                </span>
              </InfoRow>
              <InfoRow label="Исполняемый файл" mono title={installStatus?.serverExePath}>
                {installStatus?.serverExePath ?? '—'}
              </InfoRow>
            </InfoList>

            <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
              <span className="space-y-0.5">
                <span className="block text-xs font-medium text-foreground">
                  Проверять целостность файлов
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  Флаг <span className="font-mono">validate</span> в app_update — дольше, но
                  надёжнее.
                </span>
              </span>
              <Switch
                checked={validateFiles}
                onCheckedChange={setValidateFiles}
                aria-label="Проверять целостность файлов при обновлении"
                disabled={serverRunning}
                className="mt-0.5"
              />
            </div>

            {serverRunning && (
              <Notice tone="warning">
                Сервер запущен. Остановите его перед обновлением, чтобы не повредить файлы мира.
              </Notice>
            )}

            <div className="mt-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void store.updateServer(validateFiles);
                }}
                disabled={!steamcmdInstalled || pending.update || pending.install || serverRunning}
              >
                {pending.update ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                Обновить сервер
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void store.openPath('installDir');
                }}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                Открыть каталог
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-3.5 text-primary" aria-hidden="true" />
              Пути и файлы
            </CardTitle>
            <CardDescription>Каталоги можно изменить на странице «Настройки».</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoList>
              <InfoRow label="Каталог сервера" mono title={paths?.installDir}>
                {paths?.installDir ?? '—'}
              </InfoRow>
              <InfoRow label="Сохранения" mono title={paths?.saveDir}>
                {paths?.saveDir ?? '—'}
              </InfoRow>
              <InfoRow label="Миры" mono title={paths?.worldsDir}>
                {paths?.worldsDir ?? '—'}
              </InfoRow>
              <InfoRow label="Логи" mono title={paths?.logsDir}>
                {paths?.logsDir ?? '—'}
              </InfoRow>
            </InfoList>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void store.openPath('saveDir');
                }}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                Сохранения
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void store.openPath('logsDir');
                }}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                Логи
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void store.openPath('installDir');
                }}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                Каталог сервера
              </Button>
            </div>
          </CardContent>
        </Card>

        <LaunchArgumentsCard />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Notice tone="info" title="steam_appid.txt">
          В каталоге сервера должен находиться <span className="font-mono">steam_appid.txt</span> с
          содержимым <span className="font-mono">892970</span> (ID клиентской игры). Ядро проверяет
          и при необходимости создаёт этот файл.
        </Notice>
        <Notice tone="info" title="Как работает обновление">
          SteamCMD скачивает свежие файлы сервера в каталог установки; каталог миров{' '}
          <span className="font-mono">savedir</span> при этом не затрагивается. Если в настройках
          включён автобэкап, перед обновлением создаётся резервная копия миров.
        </Notice>
      </div>
    </PageContent>
  );
}
