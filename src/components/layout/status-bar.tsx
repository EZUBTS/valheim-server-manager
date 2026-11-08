import { useNow } from '@/hooks/use-clock';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import { formatDuration, formatPort, formatVersion } from '@/lib/format';
import { SERVER_PHASE_LABELS, isServerActive } from '@/lib/status';

function Separator() {
  return (
    <span aria-hidden="true" className="h-3 w-px bg-border/80">
      {' '}
    </span>
  );
}

/** Slim desktop-style status bar at the bottom of the window. */
export function StatusBar() {
  const { data, status, isPreview } = useServer();
  const now = useNow(1000);
  const state = data.serverState;
  const phase = state?.phase ?? null;
  const uptime =
    state?.phase === 'running' && state.startedAt !== null
      ? Math.floor((now - state.startedAt) / 1000)
      : (state?.uptimeSec ?? null);
  const players = isServerActive(phase) ? state?.playersOnline : null;

  const connection = isPreview
    ? { label: 'Режим предпросмотра', dot: 'bg-warning' }
    : status === 'ready'
      ? { label: 'Ядро подключено', dot: 'bg-success' }
      : status === 'error'
        ? { label: 'Нет связи с ядром', dot: 'bg-destructive' }
        : { label: 'Подключение…', dot: 'animate-pulse bg-warning' };

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 border-t border-border/70 bg-muted/30 px-3 text-[11px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('size-1.5 shrink-0 rounded-full', connection.dot)}
          />
          <span className="truncate">{connection.label}</span>
        </span>
        <Separator />
        <span className="truncate">
          Сервер: {phase ? SERVER_PHASE_LABELS[phase] : '—'}
          {uptime !== null && state?.phase === 'running'
            ? ` · ${formatDuration(uptime, 'clock')}`
            : ''}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
        <span className="hidden md:inline">
          {data.config?.server.world ?? '—'} · :{formatPort(data.config?.server.port)}
        </span>
        <Separator />
        <span title="Игроки онлайн">
          {players !== null && players !== undefined ? `${players}/10` : '—/10'}
        </span>
        <Separator />
        <span className="hidden sm:inline" title="Версия сервера">
          {formatVersion(state?.version)}
        </span>
        <Separator />
        <span>
          {data.appInfo
            ? `v${data.appInfo.version} · ${data.appInfo.os}/${data.appInfo.arch}`
            : 'v0.1.0'}
        </span>
      </div>
    </footer>
  );
}
