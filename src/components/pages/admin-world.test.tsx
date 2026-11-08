import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from '@/components/pages/admin/admin-page';
import { createAdminInvokeHandler } from '@/components/pages/admin/admin-test-fixtures';
import { NavigationContext, type NavigationStore } from '@/providers/navigation-context';
import { ServerProvider } from '@/providers/server-provider';

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
}

async function openWorldTab() {
  const user = userEvent.setup();

  await screen.findByRole('heading', { level: 1, name: 'Админ' });
  await user.click(screen.getByRole('tab', { name: /^Мир/ }));

  return user;
}

describe('Admin world tab (desktop IPC)', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.listen.mockResolvedValue(() => undefined);
  });

  it('saves world keys and restarts the server in order', async () => {
    const { handler, calls } = createAdminInvokeHandler({ running: true });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    const user = await openWorldTab();

    expect(await screen.findByText('Читы мира и сложность')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Включить Без карты' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить и перезапустить' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить и перезапустить' }));

    await waitFor(() => {
      const commands = calls.map((call) => call.command);
      const saveIndex = commands.indexOf('save_config');
      const stopIndex = commands.indexOf('stop_server');
      const startIndex = commands.indexOf('start_server');

      expect(saveIndex).toBeGreaterThanOrEqual(0);
      expect(stopIndex).toBeGreaterThan(saveIndex);
      expect(startIndex).toBeGreaterThan(stopIndex);
    });

    const saveCall = calls.find((call) => call.command === 'save_config');
    const savedConfig = saveCall?.args?.['config'] as
      { server?: { setKeys?: string[] } } | undefined;

    expect(savedConfig?.server?.setKeys).toContain('nomap');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('offers plain save when the server is stopped', async () => {
    const { handler } = createAdminInvokeHandler({ running: false });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    await openWorldTab();

    expect(await screen.findByText('Читы мира и сложность')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Сохранить и перезапустить' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Сохранить к следующему запуску' }),
    ).toBeInTheDocument();
  });
});
