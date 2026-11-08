import {
  CheckCircle2,
  Globe2,
  Loader2,
  RefreshCw,
  Router,
  ShieldAlert,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageContent, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { Metric } from '@/components/ui/metric';
import { Notice } from '@/components/ui/notice';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import { formatPortRange, formatRelativeTime } from '@/lib/format';
import { PAGE_META } from '@/lib/pages';
import type { FirewallRuleInfo, PortCheck } from '@/lib/types';

const PORT_STATE: Record<
  PortCheck['state'],
  { label: string; variant: 'success' | 'warning' | 'outline' }
> = {
  listening: { label: 'Прослушивается', variant: 'success' },
  closed: { label: 'Закрыт', variant: 'warning' },
  unknown: { label: 'Неизвестно', variant: 'outline' },
};

function directionLabel(direction: FirewallRuleInfo['direction']): string {
  if (direction === 'in') {
    return 'Входящее';
  }

  if (direction === 'out') {
    return 'Исходящее';
  }

  return 'Неизвестно';
}

/** Ports, firewall, local IPs, join code and connection instructions. */
export function NetworkPage() {
  const store = useServer();
  const { data, pending } = store;
  const [firewallDialogOpen, setFirewallDialogOpen] = useState(false);

  const network = data.network;
  const config = data.config;
  const crossplay = config?.server.crossplay ?? false;
  const joinCode = data.serverState?.joinCode ?? null;
  const mainPort = network?.mainPort ?? config?.server.port ?? 2456;
  const { diagnoseNetwork } = store;

  useEffect(() => {
    if (!network && store.status === 'ready') {
      void diagnoseNetwork();
    }
  }, [diagnoseNetwork, network, store.status]);

  return (
    <PageContent>
      <PageHeader
        title={PAGE_META.network.label}
        description={PAGE_META.network.description}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void store.diagnoseNetwork();
              }}
              disabled={pending.network}
            >
              {pending.network ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              Проверить сеть
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setFirewallDialogOpen(true);
              }}
              disabled={pending.firewall || network?.firewallOk}
            >
              {pending.firewall ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              {network?.firewallOk ? 'Брандмауэр настроен' : 'Разрешить в брандмауэре'}
            </Button>
          </>
        }
      />

      {!network ? (
        <Notice tone="info" title="Сетевая диагностика">
          Проверяем UDP-порты, правила брандмауэра и локальные адреса…
        </Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Metric
              label="UDP-диапазон"
              value={
                <span className="font-mono text-base">{formatPortRange(network.portRange)}</span>
              }
              hint={`основной порт ${network.mainPort}`}
            />
            <Metric
              label="Брандмауэр"
              value={network.firewallOk ? 'Разрешён' : 'Не настроен'}
              hint={crossplay ? 'при crossplay не обязателен' : 'входящий UDP для exe/портов'}
              tone={network.firewallOk ? 'success' : 'warning'}
              icon={
                network.firewallOk ? (
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="size-3.5" aria-hidden="true" />
                )
              }
            />
            <Metric
              label="Crossplay"
              value={crossplay ? 'Включён' : 'Выключен'}
              hint={crossplay ? 'подключение по коду приглашения' : 'подключение по IP:порт'}
              tone={crossplay ? 'primary' : 'default'}
              icon={<Globe2 className="size-3.5" aria-hidden="true" />}
            />
            <Metric
              label="Локальные IP"
              value={network.localIps.length > 0 ? network.localIps[0] : '—'}
              hint={`проверено ${formatRelativeTime(network.generatedAt)}`}
              icon={<Wifi className="size-3.5" aria-hidden="true" />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wifi className="size-3.5 text-primary" aria-hidden="true" />
                  UDP-порты
                </CardTitle>
                <CardDescription>
                  Valheim занимает основной порт и два следующих. Игровой трафик и Steam query —
                  только UDP.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <TR>
                      <TH>Порт</TH>
                      <TH>Протокол</TH>
                      <TH>Назначение</TH>
                      <TH>Состояние</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {network.ports.map((port, index) => {
                      const state = PORT_STATE[port.state];
                      const purposes = [
                        'игровой трафик',
                        'Steam query (port + 1)',
                        'третичный порт (port + 2)',
                      ];

                      return (
                        <TR key={port.port}>
                          <TD className="font-mono text-xs font-medium">{port.port}</TD>
                          <TD className="text-xs uppercase">{port.protocol}</TD>
                          <TD className="text-[11px] text-muted-foreground">
                            {purposes[index] ?? '—'}
                          </TD>
                          <TD>
                            <Badge variant={state.variant}>{state.label}</Badge>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
                {!data.installStatus?.serverInstalled && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Сервер не установлен: порты откроются только после установки и запуска.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
                    Правила брандмауэра
                  </CardTitle>
                  <CardDescription>
                    Входящие правила UDP для сервера в брандмауэре Windows.
                  </CardDescription>
                </div>
                <Badge variant={network.firewallOk ? 'success' : 'warning'}>
                  {network.firewallOk ? 'настроен' : 'требует внимания'}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {network.firewallRules.length === 0 ? (
                  <Notice tone="warning">
                    Правила для Valheim не найдены. Нажмите «Разрешить в брандмауэре», чтобы создать
                    входящее правило UDP {formatPortRange(network.portRange)}.
                  </Notice>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Правило</TH>
                        <TH>Порты</TH>
                        <TH>Направление</TH>
                        <TH>Статус</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {network.firewallRules.map((rule) => (
                        <TR key={rule.name}>
                          <TD className="text-xs">{rule.name}</TD>
                          <TD className="font-mono text-[11px]">{rule.ports}</TD>
                          <TD className="text-[11px] text-muted-foreground">
                            {directionLabel(rule.direction)}
                          </TD>
                          <TD>
                            <Badge variant={rule.enabled ? 'success' : 'danger'}>
                              {rule.enabled ? 'включено' : 'выключено'}
                            </Badge>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFirewallDialogOpen(true);
                    }}
                    disabled={pending.firewall || network.firewallOk}
                  >
                    <ShieldCheck className="size-3.5" aria-hidden="true" />
                    Добавить правило
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Требуются права администратора (netsh advfirewall).
                  </p>
                </div>

                {crossplay && (
                  <Notice tone="info">
                    Crossplay идёт через relay PlayFab: правило брандмауэра не обязательно, но не
                    помешает локальным подключениям.
                  </Notice>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe2 className="size-3.5 text-primary" aria-hidden="true" />
                  Как подключиться
                </CardTitle>
                <CardDescription>{config?.server.name}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {crossplay ? (
                  <div className="rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5">
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      Код приглашения
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-2xl font-semibold tracking-[0.3em] text-primary">
                        {joinCode ?? '—'}
                      </p>
                      {joinCode && (
                        <CopyButton value={joinCode} label="Копировать код приглашения" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      Игроки вводят код в меню Valheim. Код меняется после каждого перезапуска
                      сервера.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      Адрес в локальной сети
                    </p>
                    <p className="font-mono text-lg font-semibold">
                      {network.localIps[0] ?? '—'}:{network.mainPort}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Для подключения из интернета нужен проброс портов и внешний IP.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-foreground">Локальные адреса</p>
                  <div className="flex flex-wrap gap-1.5">
                    {network.localIps.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">Не найдены</span>
                    )}
                    {network.localIps.map((ip) => (
                      <span
                        key={ip}
                        className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/30 px-2 py-1 font-mono text-[11px]"
                      >
                        {ip}
                        <CopyButton
                          value={`${ip}:${network.mainPort}`}
                          label={`Копировать ${ip}`}
                        />
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                  Лимит игроков — 10 человек. Для join code нужен запущенный сервер с включённым
                  crossplay.
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Router className="size-3.5 text-primary" aria-hidden="true" />
                      Проброс портов на роутере
                    </CardTitle>
                    <CardDescription>
                      {crossplay
                        ? 'При crossplay проброс не требуется.'
                        : 'Нужен для подключения из интернета.'}
                    </CardDescription>
                  </div>
                  {crossplay && <Badge variant="outline">не требуется</Badge>}
                </CardHeader>
                <CardContent>
                  <ol
                    className={cn(
                      'space-y-2 text-[11px] leading-5 text-muted-foreground',
                      crossplay && 'opacity-60',
                    )}
                  >
                    <li className="flex gap-2">
                      <span className="font-mono text-primary">1.</span>
                      Задайте серверу статический локальный IP (например, 192.168.1.42).
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-primary">2.</span>
                      Пробросьте входящий UDP {formatPortRange(network.portRange)} на этот IP в
                      настройках роутера.
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-primary">3.</span>
                      Разрешите приложение в брандмауэре Windows.
                    </li>
                    <li className="flex gap-2">
                      <span className="font-mono text-primary">4.</span>
                      Проверьте подключение извне по внешнему IP и порту {network.mainPort}.
                    </li>
                  </ol>
                  {crossplay && (
                    <Notice tone="info" className="mt-3">
                      Crossplay-трафик идёт через PlayFab relay — проброс портов не нужен. Зато
                      подключение по локальному IP в этом режиме не работает.
                    </Notice>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Подсказки диагностики</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {network.hints.map((hint) => (
                    <p
                      key={hint}
                      className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground"
                    >
                      <CheckCircle2
                        className="mt-0.5 size-3.5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      {hint}
                    </p>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={firewallDialogOpen}
        title="Добавить правило брандмауэра?"
        description={`Входящее UDP-правило для портов ${formatPortRange(network?.portRange ?? [mainPort, mainPort + 2])}.`}
        confirmLabel="Добавить правило"
        pending={pending.firewall}
        onConfirm={() => {
          void (async () => {
            const added = await store.allowFirewall();
            setFirewallDialogOpen(false);

            if (!added) {
              store.notify({
                tone: 'warning',
                title: 'Правило не добавлено',
                description:
                  'Windows может запросить права администратора. Запустите приложение от имени администратора или добавьте правило вручную.',
              });
            }
          })();
        }}
        onCancel={() => {
          setFirewallDialogOpen(false);
        }}
      >
        <div className="space-y-2.5 text-xs leading-5 text-muted-foreground">
          <p>
            Команда <span className="font-mono">netsh advfirewall</span> добавит входящие правила
            UDP для приложения сервера. Для этого нужны права администратора.
          </p>
          <p>
            Если Windows откажет — запустите менеджер от имени администратора или добавьте правило
            брандмауэра вручную.
          </p>
        </div>
      </ConfirmDialog>
    </PageContent>
  );
}
