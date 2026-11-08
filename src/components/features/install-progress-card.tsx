import { Loader2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useServer } from '@/hooks/use-server';
import { formatPercent } from '@/lib/format';
import { INSTALL_PHASE_LABELS } from '@/lib/status';
import type { InstallProgress } from '@/lib/types';

const PHASE_HINTS: Record<InstallProgress['phase'], string> = {
  idle: 'Операция ещё не начата',
  downloading: 'SteamCMD загружает архив с сервера Valve',
  extracting: 'Распаковка файлов в каталог SteamCMD',
  updating: 'Загрузка обновления Valheim Dedicated Server',
  verifying: 'Проверка целостности файлов сервера',
  done: 'Операция завершена успешно',
  error: 'Операция завершилась ошибкой — подробности в логе',
};

/** Progress card shown while SteamCMD downloads or updates the server. */
export function InstallProgressCard() {
  const { data } = useServer();
  const progress = data.installProgress;

  if (!progress) {
    return null;
  }

  const label = INSTALL_PHASE_LABELS[progress.phase];
  const isDone = progress.phase === 'done';
  const isError = progress.phase === 'error';

  return (
    <Card
      className={
        isError ? 'border-destructive/35' : isDone ? 'border-success/30' : 'border-primary/30'
      }
    >
      <CardContent className="space-y-2.5 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-semibold">
            {!isDone && !isError && (
              <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
            )}
            {label}
          </p>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {formatPercent(progress.percent)}
          </span>
        </div>
        <Progress
          value={isDone ? 100 : progress.percent}
          tone={isError ? 'primary' : isDone ? 'success' : 'primary'}
          label={`Установка: ${label}`}
        />
        <p className="text-[11px] leading-4 text-muted-foreground">{progress.message}</p>
        <p className="text-[10px] text-muted-foreground/80">{PHASE_HINTS[progress.phase]}</p>
      </CardContent>
    </Card>
  );
}
