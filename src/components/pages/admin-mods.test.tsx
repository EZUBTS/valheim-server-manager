import { render, screen, waitFor } from '@testing-library/react';
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

  return render(
    <NavigationContext.Provider value={navigation}>
      <ServerProvider>
        <AdminPage />
      </ServerProvider>
    </NavigationContext.Provider>,
  );
}

async function openModsTab() {
  const user = userEvent.setup();

  await screen.findByRole('heading', { level: 1, name: 'Админ' });
  await user.click(screen.getByRole('tab', { name: /^Моды/ }));

  return user;
}

describe('AdminPage mods support (desktop IPC)', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.listen.mockResolvedValue(() => undefined);
  });

  it('installs server mods and refreshes the status', async () => {
    const { handler, calls } = createAdminInvokeHandler({ running: false });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    const user = await openModsTab();

    expect(await screen.findByText('vanilla — читы отключены')).toBeInTheDocument();

    const installButton = screen.getByRole('button', { name: 'Установить моды' });
    expect(installButton).toBeEnabled();

    await user.click(installButton);

    await waitFor(() => {
      expect(calls.some((call) => call.command === 'install_server_mods')).toBe(true);
    });
    expect(await screen.findByText('моды установлены')).toBeInTheDocument();
    expect(screen.getByText(/v5\.4\.2360/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Переустановить моды' })).toBeInTheDocument();
  });

  it('disables installation while the server is running', async () => {
    const { handler } = createAdminInvokeHandler({ running: true });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    await openModsTab();

    expect(await screen.findByText('vanilla — читы отключены')).toBeInTheDocument();

    const installButton = screen.getByRole('button', { name: 'Установить моды' });

    expect(installButton).toBeDisabled();
    expect(installButton).toHaveAttribute('title', 'Остановите сервер перед установкой модов');
  });

  it('shows installed status and opens the BepInEx folder', async () => {
    const { handler, calls } = createAdminInvokeHandler({ running: false, modsInstalled: true });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    const user = await openModsTab();

    expect(await screen.findByText('моды установлены')).toBeInTheDocument();
    expect(screen.getByText(/v1\.116\.0/)).toBeInTheDocument();

    const openButton = screen.getByRole('button', { name: 'Открыть папку BepInEx' });
    expect(openButton).toBeEnabled();

    await user.click(openButton);

    await waitFor(() => {
      expect(calls.some((call) => call.command === 'open_path')).toBe(true);
      expect(calls.find((call) => call.command === 'open_path')?.args?.['target']).toBe(
        'bepinexDir',
      );
    });
  });

  it('copies client mod links from the mods tab', async () => {
    const clipboardWrite = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const { handler } = createAdminInvokeHandler({ running: false });
    mocks.invoke.mockImplementation(handler);
    renderAdminPage();
    const user = await openModsTab();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });

    await user.click(
      screen.getByRole('button', {
        name: 'Копировать ссылку BepInExPack_Valheim (Thunderstore)',
      }),
    );

    expect(clipboardWrite).toHaveBeenCalledWith(
      'https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/',
    );
  });
});
