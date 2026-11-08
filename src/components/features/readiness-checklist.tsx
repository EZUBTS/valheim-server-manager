import {
  CheckCircle2,
  ChevronRight,
  CircleX,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import { formatPort } from '@/lib/format';
import type { PageId } from '@/lib/pages';
import { firstError, hasErrors, validateAppConfig } from '@/lib/validation';

type CheckState = 'ok' | 'warning' | 'error' | 'pending';

interface ReadinessItem {
  key: string;
  label: string;
  detail: string;
  state: CheckState;
  page: PageId;
  action: string;
}

const STATE_ICONS: Record<CheckState, LucideIcon> = {
  ok: CheckCircle2,
  warning: TriangleAlert,
  error: CircleX,
  pending: Loader2,
};

const STATE_STYLES: Record<CheckState, string> = {
  ok: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive',
  pending: 'animate-spin text-muted-foreground',
};

interface ReadinessChecklistProps {
  onNavigate: (page: PageId) => void;
}

/** "Server is ready to play" checklist with links to the relevant pages. */
export function ReadinessChecklist({ onNavigate }: ReadinessChecklistProps) {
  const store = useServer();
  const { data } = store;
  const { checkPortAvailable } = store;
  const [portCheck, setPortCheck] = useState<{ port: number; available: boolean | null } | null>(
    null,
  );

  const phase = data.serverState?.phase ?? null;
  const port = data.config?.server.port ?? null;
  const running = phase === 'running';

  useEffect(() => {
    if (port === null) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      const available = await checkPortAvailable(port);

      if (!cancelled) {
        setPortCheck({ port, available });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkPortAvailable, port]);

  const checkedPort = portCheck && portCheck.port === port ? portCheck : null;
  const portState =
    running || checkedPort === null || checkedPort.available === null
      ? running
        ? 'free'
        : checkedPort === null
          ? 'checking'
          : 'unknown'
      : checkedPort.available
        ? 'free'
        : 'busy';

  const config = data.config;
  const configErrors = config ? validateAppConfig(config) : {};
  const configValid = config !== null && !hasErrors(configErrors);
  const worldExists = data.worlds.some((world) => world.isActive);
  const crossplay = config?.server.crossplay ?? false;
  const firewallOk = data.network?.firewallOk ?? false;

  const items: ReadinessItem[] = [
    {
      key: 'steamcmd',
      label: 'SteamCMD установлен',
      detail: data.installStatus?.steamcmdInstalled
        ? 'Инструмент обновления найден.'
        : 'Нужен для установки и обновления сервера.',
      state: data.installStatus?.steamcmdInstalled ? 'ok' : 'error',
      page: 'server',
      action: 'Установить',
    },
    {
      key: 'server',
      label: 'Файлы сервера установлены',
      detail: data.installStatus?.serverInstalled
        ? 'Valheim Dedicated Server на месте.'
        : 'Сервер ещё не установлен через SteamCMD.',
      state: data.installStatus?.serverInstalled ? 'ok' : 'error',
      page: 'server',
      action: 'Установить',
    },
    {
      key: 'config',
      label: 'Конфигурация корректна',
      detail: configValid
        ? 'Имя, мир, пароль и порт проходят проверку.'
        : (firstError(configErrors) ?? 'Проверьте параметры сервера.'),
      state: configValid ? 'ok' : 'error',
      page: 'world',
      action: 'Проверить',
    },
    {
      key: 'port',
      label: 'Порт доступен',
      detail:
        running && port !== null
          ? `Сервер слушает UDP ${formatPort(port)}–${formatPort(port + 2)}.`
          : portState === 'checking'
            ? 'Проверяем занятость порта…'
            : portState === 'busy'
              ? 'Порт занят другой программой.'
              : `UDP ${formatPort(port)} свободен.`,
      state:
        running || portState === 'free'
          ? 'ok'
          : portState === 'checking'
            ? 'pending'
            : portState === 'busy'
              ? 'error'
              : 'warning',
      page: 'world',
      action: 'Изменить',
    },
    {
      key: 'firewall',
      label: crossplay ? 'Брандмауэр не требуется' : 'Правило брандмауэра',
      detail: crossplay
        ? 'При crossplay трафик идёт через PlayFab — проброс не нужен.'
        : firewallOk
          ? 'Входящий UDP разрешён.'
          : 'Разрешите UDP в брандмауэре Windows.',
      state: crossplay || firewallOk ? 'ok' : 'warning',
      page: 'network',
      action: 'Настроить',
    },
    {
      key: 'world',
      label: 'Мир существует',
      detail: worldExists
        ? 'Выбранный мир найден в worlds_local.'
        : 'При первом запуске мир будет создан с нуля.',
      state: worldExists ? 'ok' : 'warning',
      page: 'world',
      action: 'Выбрать',
    },
  ];

  const doneCount = items.filter((item) => item.state === 'ok').length;
  const percent = Math.round((doneCount / items.length) * 100);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Готовность к игре</CardTitle>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {doneCount} / {items.length}
          </span>
        </div>
        <CardDescription>Проверка установки, конфигурации и сети.</CardDescription>
        <Progress
          value={percent}
          tone={percent === 100 ? 'success' : 'primary'}
          label="Готовность сервера"
          className="mt-1 h-1.5"
        />
      </CardHeader>

      <CardContent className="flex-1 space-y-1">
        {items.map((item) => {
          const Icon = STATE_ICONS[item.state];

          return (
            <div
              key={item.key}
              className="flex items-start gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/30"
            >
              <Icon
                className={cn('mt-0.5 size-4 shrink-0', STATE_STYLES[item.state])}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{item.label}</p>
                <p className="text-[11px] leading-4 text-muted-foreground">{item.detail}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground"
                onClick={() => {
                  onNavigate(item.page);
                }}
              >
                {item.action}
                <ChevronRight className="size-3" aria-hidden="true" />
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
