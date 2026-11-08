import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from '@/components/pages/admin/admin-page';
import { createAdminInvokeHandler } from '@/components/pages/admin/admin-test-fixtures';
import { useAdminDataTimeout } from '@/components/pages/admin/use-admin-data';
import { NavigationContext, type NavigationStore } from '@/providers/navigation-context';
import { ServerProvider } from '@/providers/server-provider';
import { Button } from '@/components/ui/button';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  listen:
    vi.fn<(event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'windows',
}));

function renderAdminPage() {
  const navigation: NavigationStore = {
    page: 'admin',
    navigate: vi.fn<NavigationStore['navigate']>(),
  };

  render(
    <NavigationContext.Provider value={navigation}>
      <ServerProvider>
        <AdminPage />
      </ServerProvider>
    </NavigationContext.Provider>,
  );

  return { navigation };
}

async function waitForReady() {
  await screen.findByRole('heading', { level: 1, name: 'Админ' });
  await screen.findByText('Готов к админке');
}

/** Мини-компонент для проверки локального хука таймаута. */
function TimeoutHarness({
  hasData,
  request,
}: {
  hasData: boolean;
  request: () => Promise<unknown>;
}) {
  const { loading, failed, retry } = useAdminDataTimeout(hasData, request, 40);

  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : failed ? 'failed' : 'ready'}</span>
      <Button
        onClick={() => {
          retry();
        }}
      >
        Повторить
      </Button>
    </div>
  );
}

describe('Admin data loading without network', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.listen.mockResolvedValue(() => undefined);
  });

  it('renders admin data without calling diagnose_network', async () => {
    const { handler, calls } = createAdminInvokeHandler({ running: true });
    mocks.invoke.mockImplementation(handler);
    const { navigation } = renderAdminPage();
    await waitForReady();

    expect(await screen.findByRole('tab', { name: 'Игроки (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Читы (159)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Предметы (449)' })).toBeInTheDocument();
    expect(calls.some((call) => call.command === 'diagnose_network')).toBe(false);

    // Диагностика запускается только осознанным переходом на страницу «Сеть».
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Проверить сеть' }));
    expect(navigation.navigate).toHaveBeenCalledWith('network');
    expect(calls.some((call) => call.command === 'diagnose_network')).toBe(false);
  });

  it('shows skeleton while players are pending, not forever', async () => {
    const { handler } = createAdminInvokeHandler({ running: true, knownPlayersPending: true });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    await waitForReady();
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: /^Игроки/ }));

    expect(await screen.findByTestId('admin-players-loading')).toBeInTheDocument();

    // Пока счётчик не пришёл, не показываем пустые скобки «Игроки ()».
    expect(screen.getByRole('tab', { name: 'Игроки' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Игроки ()' })).not.toBeInTheDocument();
    expect(screen.getByRole('tablist').textContent ?? '').not.toContain('()');
  });

  it('shows an error banner and content instead of skeletons on fatal errors', async () => {
    const { handler } = createAdminInvokeHandler({ running: true, failConfig: true });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();

    await screen.findByRole('heading', { level: 1, name: 'Админ' });

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(/Не удалось загрузить данные/);
    expect(screen.queryByTestId('admin-overview-loading')).not.toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: 'Обновить' });
    expect(retryButton).toBeInTheDocument();

    // Контент статических табов доступен несмотря на ошибку ядра.
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^Читы/ }));
    expect(await screen.findByText('Все команды')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Не удалось загрузить данные/);
  });

  it('switches to failed state after the local timeout and can retry', async () => {
    const request = vi.fn<() => Promise<unknown>>().mockResolvedValue(null);
    render(<TimeoutHarness hasData={false} request={request} />);

    expect(screen.getByTestId('state')).toHaveTextContent('loading');

    await waitFor(
      () => {
        expect(screen.getByTestId('state')).toHaveTextContent('failed');
      },
      { timeout: 1000 },
    );
    expect(request).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
    });
  });

  it('does not request or skeleton when data is already present', () => {
    const request = vi.fn<() => Promise<unknown>>().mockResolvedValue(null);
    render(<TimeoutHarness hasData request={request} />);

    expect(screen.getByTestId('state')).toHaveTextContent('ready');
    expect(request).not.toHaveBeenCalled();
  });
});
