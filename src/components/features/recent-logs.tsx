import { ArrowRight, ScrollText } from 'lucide-react';

import { LogLineRow } from '@/components/features/log-line-row';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useServer } from '@/hooks/use-server';

export interface RecentLogsProps {
  limit?: number;
  onOpenLogs?: () => void;
}

/** Last lines of the live log, used on the dashboard. */
export function RecentLogs({ limit = 9, onOpenLogs }: RecentLogsProps) {
  const { data } = useServer();
  const lines = data.logs.slice(-limit);

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Последние события</CardTitle>
          <CardDescription>Живой вывод сервера, SteamCMD и приложения.</CardDescription>
        </div>
        {onOpenLogs && (
          <Button variant="outline" size="sm" onClick={onOpenLogs}>
            Все логи
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1">
        {lines.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="size-5" aria-hidden="true" />}
            title="Лог пока пуст"
            description="После запуска сервера здесь появятся первые строки."
          />
        ) : (
          <div className="space-y-0.5">
            {lines.map((line) => (
              <LogLineRow key={line.seq} line={line} hideSource />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
