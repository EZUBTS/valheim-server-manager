import { lazy, Suspense, useCallback, useMemo, useState, type ComponentType } from 'react';

import { BackupsPage } from '@/components/pages/backups-page';
import { DashboardPage } from '@/components/pages/dashboard-page';
import { LogsPage } from '@/components/pages/logs-page';
import { NetworkPage } from '@/components/pages/network-page';
import { PlayersPage } from '@/components/pages/players-page';
import { ServerPage } from '@/components/pages/server-page';
import { SettingsPage } from '@/components/pages/settings-page';
import { WorldPage } from '@/components/pages/world-page';
import { ErrorBoundary } from '@/components/error-boundary';
import { ResizeHandles } from '@/components/layout/resize-handles';
import { Sidebar } from '@/components/layout/sidebar';
import { StatusBar } from '@/components/layout/status-bar';
import { TitleBar } from '@/components/titlebar/title-bar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { ToastViewport } from '@/components/ui/toast';
import { useServer } from '@/hooks/use-server';
import { useWindowControls } from '@/hooks/use-window-controls';
import { formatDuration } from '@/lib/format';
import { DEFAULT_PAGE, type PageId } from '@/lib/pages';
import { getDesktopPlatform } from '@/lib/platform';
import { NavigationContext } from '@/providers/navigation-context';
import { ServerProvider } from '@/providers/server-provider';

/**
 * The admin page carries the full command/item catalogs (~2000 entries), so it
 * is code-split: the initial bundle stays small and the catalogs load on demand.
 */
const AdminPage = lazy(async () => {
  const module = await import('@/components/pages/admin/admin-page');

  return { default: module.AdminPage };
});

const PAGE_COMPONENTS: Record<PageId, ComponentType> = {
  dashboard: DashboardPage,
  server: ServerPage,
  world: WorldPage,
  players: PlayersPage,
  admin: AdminPage,
  backups: BackupsPage,
  logs: LogsPage,
  network: NetworkPage,
  settings: SettingsPage,
};

/** Default `-saveinterval` when the configuration does not define one. */
const DEFAULT_SAVE_INTERVAL_SEC = 300;

/** Loading placeholder while a code-split page chunk is fetched. */
function PageFallback() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="mt-2 h-96 w-full rounded-xl" />
    </div>
  );
}

/**
 * Window shell: custom title bar, sidebar navigation, active page and status
 * bar. Also intercepts closing the window while the server process is alive.
 */
function AppShell() {
  const controls = useWindowControls();
  const store = useServer();
  const [page, setPage] = useState<PageId>(DEFAULT_PAGE);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const isMac = getDesktopPlatform() === 'macos';

  const phase = store.data.serverState?.phase ?? null;
  const serverIsBusy = phase === 'running' || phase === 'starting';
  const serverIsStopping = phase === 'stopping';
  const saveIntervalLabel = formatDuration(
    store.data.config?.server.saveIntervalSec ?? DEFAULT_SAVE_INTERVAL_SEC,
    'short',
  );
  const { stopServer } = store;
  const { pending } = store;
  const closeWindow = controls.close;

  const requestClose = useCallback(async () => {
    if (phase === 'running' || phase === 'starting' || phase === 'stopping') {
      setCloseDialogOpen(true);
      return;
    }

    await closeWindow();
  }, [closeWindow, phase]);

  const handleStopAndExit = useCallback(async () => {
    const stopped = await stopServer(false);

    if (stopped) {
      setCloseDialogOpen(false);
      await closeWindow();
    }
  }, [closeWindow, stopServer]);

  const handleCloseAnyway = useCallback(async () => {
    setCloseDialogOpen(false);
    await closeWindow();
  }, [closeWindow]);

  const ActivePage = PAGE_COMPONENTS[page];
  const navigation = useMemo(() => ({ page, navigate: setPage }), [page]);

  return (
    <NavigationContext.Provider value={navigation}>
      <div className="relative flex h-full flex-col overflow-hidden bg-background text-foreground">
        <TitleBar
          controls={{ ...controls, close: requestClose }}
          page={page}
          phase={phase}
          isPreview={store.isPreview}
        />

        <div className="flex min-h-0 flex-1">
          <Sidebar activePage={page} onNavigate={setPage} />

          <main className="app-background relative min-h-0 flex-1 overflow-y-auto">
            <Suspense fallback={<PageFallback />}>
              <ActivePage />
            </Suspense>
          </main>
        </div>

        <StatusBar />
        <ToastViewport />

        <ConfirmDialog
          open={closeDialogOpen && serverIsBusy}
          title="Сервер работает"
          description="Остановить сервер и закрыть приложение?"
          confirmLabel="Остановить и выйти"
          cancelLabel="Отмена"
          tone="danger"
          pending={pending.stop}
          onConfirm={() => {
            void handleStopAndExit();
          }}
          onCancel={() => {
            setCloseDialogOpen(false);
          }}
        >
          <div className="space-y-2.5">
            <Notice tone="warning" title="Несохранённый прогресс">
              Прогресс с последнего автосохранения (интервал {saveIntervalLabel}) может потеряться.
              Ядро сохранит мир при корректной остановке.
            </Notice>
            <p className="text-xs leading-5 text-muted-foreground">
              {store.data.config?.autoBackupBeforeStop
                ? 'Перед остановкой будет создана резервная копия мира.'
                : 'Автобэкап перед остановкой отключён в настройках.'}
            </p>
          </div>
        </ConfirmDialog>

        <ConfirmDialog
          open={closeDialogOpen && serverIsStopping}
          title="Сервер останавливается"
          description="Процесс уже завершает работу и сохраняет мир."
          confirmLabel="Закрыть приложение"
          cancelLabel="Отмена"
          tone="danger"
          onConfirm={() => {
            void handleCloseAnyway();
          }}
          onCancel={() => {
            setCloseDialogOpen(false);
          }}
        >
          <Notice tone="info">
            Обычно остановка занимает несколько секунд. Если закрыть окно раньше, ядро всё равно
            завершит процесс само.
          </Notice>
        </ConfirmDialog>

        {/* macOS windows keep their native resize edges; the custom grips are for
          Windows/Linux where frameless windows may lose the resize border. */}
        {!isMac && <ResizeHandles onResizeStart={controls.startResizeDragging} />}
      </div>
    </NavigationContext.Provider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ServerProvider>
        <AppShell />
      </ServerProvider>
    </ErrorBoundary>
  );
}
