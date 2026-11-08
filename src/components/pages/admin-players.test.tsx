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

async function openPlayersTab() {
  const user = userEvent.setup();

  await screen.findByRole('heading', { level: 1, name: 'Админ' });
  await user.click(screen.getByRole('tab', { name: /^Игроки/ }));
  await screen.findByText('Бьорн');

  return user;
}

describe('Admin players tab (desktop IPC)', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.listen.mockResolvedValue(() => undefined);
  });

  it('adds a known player to adminlist via add_player', async () => {
    const { handler, calls } = createAdminInvokeHandler({ running: true });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    const user = await openPlayersTab();

    const row = screen.getByText('Бьорн').closest('tr');
    expect(row).not.toBeNull();

    await user.click(within(row as HTMLElement).getByRole('button', { name: /В adminlist/ }));

    await waitFor(() => {
      expect(calls.some((call) => call.command === 'add_player')).toBe(true);
    });

    const addCall = calls.find((call) => call.command === 'add_player');
    expect(addCall?.args).toMatchObject({ list: 'admins', id: 'V_76561198000000002' });

    await waitFor(() => {
      const refreshed = screen.getByText('Бьорн').closest('tr');
      expect(
        within(refreshed as HTMLElement).getByRole('button', { name: /Убрать/ }),
      ).toBeInTheDocument();
    });
  });

  it('removes an admin via remove_player after confirmation', async () => {
    const { handler, calls } = createAdminInvokeHandler({ running: true });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    const user = await openPlayersTab();

    const row = screen.getByText('Рагнар').closest('tr');
    expect(row).not.toBeNull();

    await user.click(within(row as HTMLElement).getByRole('button', { name: /В adminlist/ }));

    await waitFor(() => {
      const refreshed = screen.getByText('Рагнар').closest('tr');
      expect(
        within(refreshed as HTMLElement).getByRole('button', { name: /Убрать/ }),
      ).toBeInTheDocument();
    });

    const adminRow = screen.getByText('Рагнар').closest('tr');
    await user.click(within(adminRow as HTMLElement).getByRole('button', { name: /Убрать/ }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Убрать из adminlist' }));

    await waitFor(() => {
      expect(calls.some((call) => call.command === 'remove_player')).toBe(true);
    });

    const removeCall = calls.find((call) => call.command === 'remove_player');
    expect(removeCall?.args).toMatchObject({ list: 'admins', id: 'V_76561198000000001' });

    await waitFor(() => {
      const refreshed = screen.getByText('Рагнар').closest('tr');
      expect(
        within(refreshed as HTMLElement).getByRole('button', { name: /В adminlist/ }),
      ).toBeInTheDocument();
    });
  });
});
