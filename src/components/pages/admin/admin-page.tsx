import { CircleAlert, Crown, Hash, Loader2, Puzzle, RefreshCw, Users } from 'lucide-react';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

import { AdminCommandsTab } from '@/components/pages/admin/admin-commands';
import { AdminHelpTab } from '@/components/pages/admin/admin-help';
import { AdminItemsTab } from '@/components/pages/admin/admin-items';
import { AdminModsTab } from '@/components/pages/admin/admin-mods';
import { AdminOverviewTab } from '@/components/pages/admin/admin-overview';
import { AdminPlayersTab } from '@/components/pages/admin/admin-players';
import {
  ADMIN_TABS,
  StatusChip,
  CopyAction,
  type AdminTabId,
} from '@/components/pages/admin/admin-shared';
import { AdminWorldTab } from '@/components/pages/admin/admin-world';
import { ServerPhaseBadge } from '@/components/features/server-phase-badge';
import { Button } from '@/components/ui/button';
import { useServer } from '@/hooks/use-server';
import { ADMIN_COMMANDS } from '@/lib/admin-commands';
import { ADMIN_CREATURES, ADMIN_ITEMS } from '@/lib/admin-items';
import { cn } from '@/lib/cn';
import { PAGE_META } from '@/lib/pages';
import { isServerActive } from '@/lib/status';

/** Количество записей в табах-каталогах. */
function getTabCounts(
  data: ReturnType<typeof useServer>['data'],
): Partial<Record<AdminTabId, number>> {
  const counts: Partial<Record<AdminTabId, number>> = {
    commands: ADMIN_COMMANDS.length,
    items: ADMIN_ITEMS.length + ADMIN_CREATURES.length,
  };

  if (data.knownPlayers !== null) {
    counts.players = data.knownPlayers.length;
  }

  return counts;
}

/**
 * Страница «Админ» — оболочка с закреплённой шапкой, статусами и 7 разделами.
 *
 * Разделы рендерятся по одному (каталоги не держим в DOM одновременно), каждый
 * таб сам управляет внутренним скроллом и фильтрами.
 */
export function AdminPage() {
  const store = useServer();
  const { data, pending, status } = store;
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const phase = data.serverState?.phase ?? null;
  const joinCode = data.serverState?.joinCode ?? null;
  const adminsCount = data.players?.admins.length ?? 0;
  const knownCount = data.knownPlayers?.length ?? null;
  const modsReady =
    data.modStatus?.bepinexInstalled === true && data.modStatus.serverDevcommandsInstalled === true;
  const modsPartial = data.modStatus?.bepinexInstalled === true && !modsReady;
  const tabCounts = getTabCounts(data);
  const panelId = `admin-panel-${activeTab}`;

  const handleTabKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const lastIndex = ADMIN_TABS.length - 1;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = index === lastIndex ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = index === 0 ? lastIndex : index - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = lastIndex;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextTab = ADMIN_TABS[nextIndex];

    if (!nextTab) {
      return;
    }

    setActiveTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="sticky top-0 z-20 shrink-0 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2 px-5 pt-4 pb-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl leading-6 font-semibold tracking-tight">
                {PAGE_META.admin.label}
              </h1>
              <StatusChip tone="primary">панель управления</StatusChip>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Игроки, читы, предметы и серверные настройки — в одном месте.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <ServerPhaseBadge phase={phase} />
            <StatusChip
              tone={adminsCount > 0 ? 'success' : 'warning'}
              icon={<Crown className="size-3" aria-hidden="true" />}
              title="Записей в adminlist.txt; изменения применяются после перезапуска сервера"
            >
              adminlist: {adminsCount}
            </StatusChip>
            <StatusChip
              tone="neutral"
              icon={<Users className="size-3" aria-hidden="true" />}
              title="Игроки, замеченные менеджером в логах и списках"
            >
              известно: {knownCount === null ? '—' : knownCount}
            </StatusChip>
            <StatusChip
              tone={modsReady ? 'success' : modsPartial ? 'warning' : 'danger'}
              icon={<Puzzle className="size-3" aria-hidden="true" />}
              title="Серверные моды: BepInEx + Server Devcommands"
            >
              {modsReady ? 'моды: установлены' : modsPartial ? 'моды: частично' : 'моды: нет'}
            </StatusChip>
            {joinCode && isServerActive(phase) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pr-1 pl-2 text-[11px] leading-4 font-medium text-primary">
                <Hash className="size-3" aria-hidden="true" />
                <span className="font-mono tracking-wider">{joinCode}</span>
                <CopyAction
                  value={joinCode}
                  title="Код приглашения скопирован"
                  label="Копировать код приглашения"
                  className="size-6"
                />
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Обновить данные админки"
              title="Обновить игроков, списки и статус модов"
              disabled={pending['known-players'] || pending['mods-refresh']}
              onClick={() => {
                void Promise.all([
                  store.refreshKnownPlayers(),
                  store.refreshLists(),
                  store.refreshMods(),
                ]);
              }}
            >
              {pending['known-players'] || pending['mods-refresh'] ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Разделы страницы «Админ»"
          className="flex gap-1 overflow-x-auto px-3 pb-0"
        >
          {ADMIN_TABS.map((tab, index) => {
            const active = tab.id === activeTab;
            const Icon = tab.icon;
            const count = tabCounts[tab.id];

            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`admin-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={active ? panelId : undefined}
                aria-label={
                  count !== undefined && count > 0 ? `${tab.label} (${count})` : tab.label
                }
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  setActiveTab(tab.id);
                }}
                onKeyDown={(event) => {
                  handleTabKeyDown(event, index);
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                  active
                    ? 'border-primary bg-accent/50 text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                )}
              >
                <Icon
                  className={cn('size-3.5', active ? 'text-primary' : 'text-muted-foreground')}
                  aria-hidden="true"
                />
                {tab.label}
                {count !== undefined && count > 0 && (
                  <>
                    {' '}
                    <span
                      aria-hidden="true"
                      title={`${count} записей`}
                      className={cn(
                        'rounded-full px-1.5 text-[10px] leading-4 tabular-nums',
                        active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      ({count})
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {status === 'error' && (
        <output className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5">
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-destructive">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              Не удалось загрузить данные: {store.loadError ?? 'ошибка ядра'}
            </span>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-6 shrink-0 px-2 text-[10px]"
            onClick={() => {
              void store.refreshAll();
            }}
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            Обновить
          </Button>
        </output>
      )}

      <section
        role="tabpanel"
        id={panelId}
        aria-labelledby={`admin-tab-${activeTab}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-hidden outline-none"
      >
        {activeTab === 'overview' && <AdminOverviewTab onOpenTab={setActiveTab} />}
        {activeTab === 'players' && <AdminPlayersTab />}
        {activeTab === 'commands' && <AdminCommandsTab />}
        {activeTab === 'items' && <AdminItemsTab />}
        {activeTab === 'world' && <AdminWorldTab />}
        {activeTab === 'mods' && <AdminModsTab />}
        {activeTab === 'help' && <AdminHelpTab />}
      </section>
    </div>
  );
}
