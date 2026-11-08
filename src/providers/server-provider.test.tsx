import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useServer } from '@/hooks/use-server';
import { emitPreviewEvent, resetPreviewBackend } from '@/lib/preview';
import { ServerProvider } from '@/providers/server-provider';
import type { LogLine } from '@/lib/types';

/**
 * Test harness: renders store state as text and exposes actions as buttons, so
 * the test itself never touches the store object outside of React.
 */
function Harness() {
  const store = useServer();

  return (
    <div>
      <span data-testid="status">{store.status}</span>
      <span data-testid="world">{store.data.config?.server.world ?? 'none'}</span>
      <span data-testid="phase">{store.data.serverState?.phase ?? 'none'}</span>
      <span data-testid="join-code">{store.data.serverState?.joinCode ?? 'none'}</span>
      <span data-testid="logs">{store.data.logs.length}</span>
      <span data-testid="admins">{store.data.players?.admins.length ?? 0}</span>
      <span data-testid="banned">{store.data.players?.banned.length ?? 0}</span>
      <span data-testid="backups">{store.data.backups.length}</span>
      <span data-testid="toasts">{store.toasts.length}</span>
      <span data-testid="app-name">{store.data.appInfo?.name ?? 'none'}</span>
      <span data-testid="worlds-dir">{store.data.paths?.worldsDir ?? 'none'}</span>
      <span data-testid="server-installed">
        {String(store.data.installStatus?.serverInstalled ?? false)}
      </span>
      <span data-testid="known">{store.data.knownPlayers?.length ?? -1}</span>
      <span data-testid="network">{store.data.network ? 'yes' : 'none'}</span>
      <button
        type="button"
        onClick={() => {
          void store.addPlayer('banned', 'V_76561198000000055', 'Тестовый игрок');
        }}
      >
        Добавить игрока
      </button>
      <button
        type="button"
        onClick={() => {
          void store.createBackup('проверка');
        }}
      >
        Создать бэкап
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ServerProvider>
      <Harness />
    </ServerProvider>,
  );
}

describe('ServerProvider (browser preview)', () => {
  beforeEach(() => {
    resetPreviewBackend();
    window.localStorage.clear();
  });

  it('loads every slice of preview state', async () => {
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });

    // Быстрое ядро доступно сразу после ready.
    expect(screen.getByTestId('world')).toHaveTextContent('Midgard');
    expect(screen.getByTestId('phase')).toHaveTextContent('running');
    expect(screen.getByTestId('join-code')).toHaveTextContent('483920');
    expect(screen.getByTestId('app-name')).toHaveTextContent('Valheim Server Manager');
    expect(screen.getByTestId('worlds-dir')).toHaveTextContent('worlds_local');
    expect(screen.getByTestId('server-installed')).toHaveTextContent('true');

    // Срезы догружаются в фоне и не блокируют ready.
    await waitFor(() => {
      expect(Number(screen.getByTestId('logs').textContent)).toBeGreaterThan(20);
      expect(screen.getByTestId('admins')).toHaveTextContent('2');
      expect(screen.getByTestId('backups')).toHaveTextContent('4');
      expect(screen.getByTestId('known')).toHaveTextContent('5');
    });

    // Сетевая диагностика при старте не запускается и не блокирует загрузку.
    expect(screen.getByTestId('network')).toHaveTextContent('none');
  });

  it('appends live log events', async () => {
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });

    const before = Number(screen.getByTestId('logs').textContent);
    const line: LogLine = {
      seq: 100_000,
      ts: Date.now(),
      source: 'server',
      level: 'info',
      line: 'Game server connected',
    };

    emitPreviewEvent('server-log', line);

    await waitFor(() => {
      expect(Number(screen.getByTestId('logs').textContent)).toBe(before + 1);
    });
  });

  it('adds players through the store action and shows a toast', async () => {
    const user = userEvent.setup();
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });

    await user.click(screen.getByRole('button', { name: 'Добавить игрока' }));

    await waitFor(() => {
      expect(screen.getByTestId('banned')).toHaveTextContent('2');
    });
    await waitFor(() => {
      expect(Number(screen.getByTestId('toasts').textContent)).toBeGreaterThan(0);
    });
  });

  it('creates backups through the store action', async () => {
    const user = userEvent.setup();
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });

    await user.click(screen.getByRole('button', { name: 'Создать бэкап' }));

    await waitFor(() => {
      expect(screen.getByTestId('backups')).toHaveTextContent('5');
    });
  });
});
