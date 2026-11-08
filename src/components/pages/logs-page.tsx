import { Eraser, Pause, Play, ScrollText, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { LogLineRow } from '@/components/features/log-line-row';
import { PageContent, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs } from '@/components/ui/tabs';
import { useServer } from '@/hooks/use-server';
import {
  DEFAULT_LOG_FILTERS,
  LOG_LEVEL_LABELS,
  LOG_SOURCE_LABELS,
  countLogLevels,
  countLogSources,
  filterLogs,
  type LogLevelFilter,
  type LogSourceFilter,
} from '@/lib/log-filter';
import { PAGE_META } from '@/lib/pages';

/** Maximum number of rows rendered at once (the buffer keeps everything). */
const RENDER_LIMIT = 800;

/** Live log with source/level filters, search, autoscroll and counters. */
export function LogsPage() {
  const store = useServer();
  const { data, pending } = store;

  const [source, setSource] = useState<LogSourceFilter>('all');
  const [level, setLevel] = useState<LogLevelFilter>('all');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const scrollRef = useRef<HTMLDivElement>(null);

  const levelCounts = useMemo(() => countLogLevels(data.logs), [data.logs]);
  const sourceCounts = useMemo(() => countLogSources(data.logs), [data.logs]);
  const filtered = useMemo(
    () => filterLogs(data.logs, { source, level, query: deferredQuery }),
    [data.logs, source, level, deferredQuery],
  );
  const visible = filtered.slice(-RENDER_LIMIT);
  const hiddenCount = filtered.length - visible.length;
  const filtersActive =
    source !== DEFAULT_LOG_FILTERS.source ||
    level !== DEFAULT_LOG_FILTERS.level ||
    query.trim().length > 0;

  useEffect(() => {
    if (!autoScroll || paused) {
      return;
    }

    if (data.logs.length === 0) {
      return;
    }

    const node = scrollRef.current;

    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [autoScroll, paused, data.logs.length]);

  const levelTabs: ReadonlyArray<{ value: LogLevelFilter; label: string; count: number }> = [
    { value: 'all', label: 'Все', count: data.logs.length },
    { value: 'debug', label: LOG_LEVEL_LABELS.debug, count: levelCounts.debug },
    { value: 'info', label: LOG_LEVEL_LABELS.info, count: levelCounts.info },
    { value: 'warn', label: LOG_LEVEL_LABELS.warn, count: levelCounts.warn },
    { value: 'error', label: LOG_LEVEL_LABELS.error, count: levelCounts.error },
  ];

  const sourceTabs: ReadonlyArray<{ value: LogSourceFilter; label: string; count: number }> = [
    { value: 'all', label: 'Все источники', count: data.logs.length },
    { value: 'server', label: LOG_SOURCE_LABELS.server, count: sourceCounts.server },
    { value: 'steamcmd', label: LOG_SOURCE_LABELS.steamcmd, count: sourceCounts.steamcmd },
    { value: 'app', label: LOG_SOURCE_LABELS.app, count: sourceCounts.app },
  ];

  const resetFilters = () => {
    setSource('all');
    setLevel('all');
    setQuery('');
  };

  return (
    <PageContent>
      <PageHeader
        title={PAGE_META.logs.label}
        description={PAGE_META.logs.description}
        badge={
          <Badge variant="outline" className="font-mono">
            {data.logs.length} / 2000
          </Badge>
        }
        actions={
          <>
            <div className="flex items-center gap-2 rounded-md border border-border/70 bg-card/60 px-2.5 py-1.5 text-[11px]">
              Автоскролл
              <Switch
                checked={autoScroll}
                onCheckedChange={(checked) => {
                  setAutoScroll(checked);
                  setPaused(false);
                }}
                aria-label="Автоматическая прокрутка лога"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPaused((current) => !current);
              }}
            >
              {paused ? (
                <Play className="size-3.5" aria-hidden="true" />
              ) : (
                <Pause className="size-3.5" aria-hidden="true" />
              )}
              {paused ? 'Продолжить' : 'Пауза'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setClearDialogOpen(true);
              }}
              disabled={pending['clear-logs'] || data.logs.length === 0}
            >
              <Eraser className="size-3.5" aria-hidden="true" />
              Очистить
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs items={sourceTabs} value={source} onChange={setSource} label="Источник лога" />
        <Tabs items={levelTabs} value={level} onChange={setLevel} label="Уровень лога" />
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Поиск по строкам лога…"
                aria-label="Поиск по логу"
                className="pl-8"
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="neutral">{filtered.length} строк</Badge>
              {hiddenCount > 0 && (
                <Badge variant="outline">показаны последние {RENDER_LIMIT}</Badge>
              )}
              {paused && <Badge variant="warning">Прокрутка на паузе</Badge>}
              {filtersActive && (
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              )}
            </div>
          </div>

          <div
            ref={scrollRef}
            role="log"
            aria-live={paused ? 'off' : 'polite'}
            aria-label="Живой лог сервера"
            className="h-[480px] overflow-y-auto rounded-lg border border-border/70 bg-background/70 p-2"
          >
            {data.logs.length === 0 ? (
              <EmptyState
                className="h-full border-0 bg-transparent"
                icon={<ScrollText className="size-5" aria-hidden="true" />}
                title="Лог пуст"
                description="Запустите сервер или обновление — строки появятся здесь."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                className="h-full border-0 bg-transparent"
                title="Ничего не найдено"
                description="Измените фильтры или поисковый запрос."
                action={
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    Сбросить фильтры
                  </Button>
                }
              />
            ) : (
              <div className="space-y-0.5">
                {visible.map((line) => (
                  <LogLineRow key={line.seq} line={line} />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={clearDialogOpen}
        title="Очистить лог?"
        description="Будет очищен только буфер в памяти — файл лога на диске останется."
        confirmLabel="Очистить"
        tone="danger"
        pending={pending['clear-logs']}
        onConfirm={() => {
          void (async () => {
            await store.clearLogs();
            setClearDialogOpen(false);
          })();
        }}
        onCancel={() => {
          setClearDialogOpen(false);
        }}
      />
    </PageContent>
  );
}
