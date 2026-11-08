import { Loader2, Play, Square } from 'lucide-react';
import { useState } from 'react';

import { CopyButton } from '@/components/ui/copy-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Metric } from '@/components/ui/metric';
import { Notice } from '@/components/ui/notice';
import { ServerPhaseBadge } from '@/components/features/server-phase-badge';
import { useNow } from '@/hooks/use-clock';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import { formatDuration, formatPort, formatVersion } from '@/lib/format';
import { SERVER_PHASE_HINTS, canStartServer, canStopServer } from '@/lib/status';

/** Default `-saveinterval` used when the configuration does not define one. */
const DEFAULT_SAVE_INTERVAL_SEC = 300;

/** Dashboard hero: phase, uptime, version, join code and start/stop controls. */
export function ServerStatusCard() {
  const store = useServer();
  const { data, pending } = store;
  const now = useNow(1000);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);

  const state = data.serverState;
  const phase = state?.phase ?? null;
  const serverInstalled = data.installStatus?.serverInstalled ?? false;
  const isRunning = phase === 'running';
  const canStart = canStartServer(phase) && serverInstalled;
  const canStop = canStopServer(phase);
  const uptime =
    state?.phase === 'running' && state.startedAt !== null
      ? Math.floor((now - state.startedAt) / 1000)
      : null;
  const players = isRunning || phase === 'starting' ? (state?.playersOnline ?? null) : null;
  const saveIntervalLabel = formatDuration(
    data.config?.server.saveIntervalSec ?? DEFAULT_SAVE_INTERVAL_SEC,
    'short',
  );

  return (
    <>
      <Card
        className={cn(
          'relative overflow-hidden bg-card/70',
          isRunning && 'border-success/25 shadow-[0_0_40px_-24px_var(--success)]',
        )}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        <CardContent className="relative space-y-4 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <ServerPhaseBadge phase={phase} />
                <span className="text-[11px] text-muted-foreground">
                  {phase ? SERVER_PHASE_HINTS[phase] : 'Состояние неизвестно'}
                </span>
              </div>
              <p className="truncate font-display text-2xl leading-8 font-semibold tracking-tight">
                {data.config?.server.name ?? 'Сервер не настроен'}
              </p>
              <p className="text-xs text-muted-foreground">
                Мир «{data.config?.server.world ?? '—'}» · порт{' '}
                {formatPort(state?.port ?? data.config?.server.port)} UDP ·{' '}
                {formatVersion(state?.version)}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="rounded-lg border border-border/60 bg-muted/25 px-4 py-2 text-right">
                <p className="text-[10px] tracking-wider text-muted-foreground uppercase">Аптайм</p>
                <p className="font-mono text-lg leading-6 font-semibold tabular-nums">
                  {uptime !== null ? formatDuration(uptime, 'clock') : '—'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canStart && (
                  <Button
                    onClick={() => {
                      void store.startServer();
                    }}
                    disabled={pending.start || !serverInstalled}
                    title={
                      serverInstalled
                        ? undefined
                        : 'Сначала установите файлы сервера на странице «Сервер»'
                    }
                  >
                    {pending.start ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="size-4" aria-hidden="true" />
                    )}
                    Запустить
                  </Button>
                )}
                {canStop && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setStopDialogOpen(true);
                    }}
                    disabled={pending.stop}
                  >
                    {pending.stop ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Square className="size-4" aria-hidden="true" />
                    )}
                    Остановить
                  </Button>
                )}
                {phase === 'stopping' && !canStop && (
                  <Button variant="outline" disabled>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Останавливается…
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric
              label="Игроки"
              value={players === null ? '—' : `${players} / 10`}
              hint="лимит Valheim — 10"
              tone={players !== null && players > 0 ? 'success' : 'default'}
            />
            <Metric
              label="PID"
              value={<span className="font-mono text-base">{state?.pid ?? '—'}</span>}
              hint={state?.pid ? 'процесс сервера' : 'процесс не запущен'}
            />
            <Metric
              label="Версия"
              value={
                <span className="font-mono text-[13px] leading-5 break-all">
                  {formatVersion(state?.version)}
                </span>
              }
              hint="из строки лога"
            />
            <Metric
              label="Порт"
              value={
                <span className="font-mono text-base">
                  {formatPort(state?.port ?? data.config?.server.port)}
                </span>
              }
              hint="UDP, +2 следующих"
            />
          </div>

          {(data.config?.server.crossplay || state?.joinCode) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  Код приглашения crossplay
                </p>
                <p className="font-mono text-xl leading-7 font-semibold tracking-[0.3em] text-primary">
                  {state?.joinCode ?? '—'}
                </p>
              </div>
              <div className="flex max-w-64 items-center gap-2">
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {state?.joinCode
                    ? 'Код меняется после каждого перезапуска сервера.'
                    : 'Код появится после запуска сервера с включённым crossplay.'}
                </p>
                {state?.joinCode && (
                  <CopyButton value={state.joinCode} label="Копировать код приглашения" />
                )}
              </div>
            </div>
          )}

          {state?.phase === 'error' && (
            <Notice tone="danger" title="Сервер завершился с ошибкой">
              {state.lastError ?? 'Проверьте лог сервера, чтобы найти причину.'}
            </Notice>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={stopDialogOpen}
        title="Остановить сервер?"
        description="Процесс получит сигнал корректного завершения. Если он не ответит, ядро завершит его принудительно."
        confirmLabel="Остановить"
        tone="danger"
        pending={pending.stop}
        onConfirm={() => {
          void (async () => {
            const stopped = await store.stopServer(false);
            setStopDialogOpen(false);

            if (stopped) {
              store.notify({
                tone: 'info',
                title: 'Остановка выполнена',
                description: 'Проверьте лог, чтобы убедиться в сохранении мира.',
              });
            }
          })();
        }}
        onCancel={() => {
          setStopDialogOpen(false);
        }}
      >
        <div className="space-y-2.5">
          <Notice tone="warning" title="Несохранённый прогресс">
            Прогресс с последнего автосохранения (интервал {saveIntervalLabel}) может потеряться.
          </Notice>
          <p className="text-xs leading-5 text-muted-foreground">
            {data.config?.autoBackupBeforeStop
              ? 'Перед остановкой будет автоматически создана резервная копия мира.'
              : 'Автобэкап перед остановкой выключен — при необходимости создайте копию во вкладке «Бэкапы».'}
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}
