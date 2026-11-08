import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from '@/components/pages/admin/admin-page';
import { resetPreviewBackend } from '@/lib/preview';
import { NavigationContext, type NavigationStore } from '@/providers/navigation-context';
import { ServerProvider } from '@/providers/server-provider';

const clipboardWrite = vi.fn<(text: string) => Promise<void>>();

function renderAdminPage() {
  const user = userEvent.setup();
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

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite },
  });

  return user;
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  expect(await screen.findByRole('heading', { level: 1, name: 'Админ' })).toBeInTheDocument();
  // Данные провайдера должны загрузиться до переключения (иначе счётчики/фазы пустые).
  await screen.findByText('Готов к админке');
  await user.click(screen.getByRole('tab', { name }));
}

describe('Admin tabs (browser preview)', () => {
  beforeEach(() => {
    resetPreviewBackend();
    window.localStorage.clear();
    clipboardWrite.mockReset();
    clipboardWrite.mockResolvedValue(undefined);
  });

  it('players: filters, search, adminlist actions and clipboard', async () => {
    const user = renderAdminPage();
    await openTab(user, /^Игроки/);

    expect(await screen.findByText('Рагнар')).toBeInTheDocument();
    expect(screen.getByText('Бьорн')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Админы/ }));
    expect(screen.getByText('Рагнар')).toBeInTheDocument();
    expect(screen.queryByText('Бьорн')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Все/ }));

    const search = screen.getByLabelText('Поиск игроков');
    await user.type(search, 'Бьорн');

    let row = screen.getByText('Бьорн').closest('tr');
    expect(row).not.toBeNull();

    await user.click(within(row as HTMLElement).getByRole('button', { name: /В adminlist/ }));

    await waitFor(() => {
      row = screen.getByText('Бьорн').closest('tr');
      expect(
        within(row as HTMLElement).getByRole('button', { name: /Убрать/ }),
      ).toBeInTheDocument();
    });

    // Очищаем поиск, чтобы в таблице снова были все игроки.
    await user.clear(search);

    await user.click(screen.getByRole('button', { name: 'Копировать ID игрока Рагнар' }));
    expect(clipboardWrite).toHaveBeenCalledWith('76561198000000001');

    // Ручное добавление: ошибка валидации и успешное добавление.
    const idInput = screen.getByLabelText('ID игрока');
    await user.type(idInput, 'плохой-id');
    await user.click(screen.getByRole('button', { name: 'Добавить в adminlist' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Некорректный ID/);

    await user.clear(idInput);
    await user.type(idInput, '76561198000000077');
    await user.click(screen.getByRole('button', { name: 'Добавить в adminlist' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(idInput).toHaveValue('');
    });

    // Снятие прав через подтверждение.
    row = screen.getByText('Бьорн').closest('tr');
    await user.click(within(row as HTMLElement).getByRole('button', { name: /Убрать/ }));

    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Убрать из adminlist' }));

    await waitFor(() => {
      row = screen.getByText('Бьорн').closest('tr');
      expect(
        within(row as HTMLElement).getByRole('button', { name: /В adminlist/ }),
      ).toBeInTheDocument();
    });
  });

  it('commands: category navigation, search and combo copying', async () => {
    const user = renderAdminPage();
    await openTab(user, /^Читы/);

    expect(await screen.findByText('Все команды')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Модерация/ }));
    expect(screen.getByText('Кикнуть игрока')).toBeInTheDocument();
    expect(screen.queryByText('Бессмертие')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Все команды/ }));
    const search = screen.getByLabelText('Поиск по админ-командам');
    await user.type(search, 'телепорт');

    expect(screen.getByText('Телепорт по координатам')).toBeInTheDocument();
    expect(screen.getByText('Телепорт к объекту')).toBeInTheDocument();
    expect(screen.queryByText('Кикнуть игрока')).not.toBeInTheDocument();

    await user.clear(search);
    const comboButton = screen.getAllByRole('button', { name: /Копировать набор/ })[0];
    expect(comboButton).toBeDefined();
    await user.click(comboButton as HTMLElement);
    expect(clipboardWrite).toHaveBeenLastCalledWith(expect.stringContaining('devcommands'));
  });

  it('items: pagination, search, creatures and itemset builder', async () => {
    const user = renderAdminPage();
    await openTab(user, /^Предметы/);

    expect(await screen.findByText('384 предметов')).toBeInTheDocument();
    expect(screen.getByText('стр. 1 из 16')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Вперёд' }));
    expect(screen.getByText('стр. 2 из 16')).toBeInTheDocument();

    const search = screen.getByLabelText('Поиск по предметам');
    await user.type(search, 'SwordIron');
    expect(await screen.findByText('Железный меч')).toBeInTheDocument();
    expect(screen.getByText('стр. 1 из 1')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Копировать команду spawn для Железный меч' }),
    );
    expect(clipboardWrite).toHaveBeenLastCalledWith('spawn SwordIron 1');

    await user.click(screen.getByRole('tab', { name: /^Существа/ }));
    const creatureSearch = screen.getByLabelText('Поиск по существам');
    await user.clear(creatureSearch);
    await user.type(creatureSearch, 'Тролль');
    expect(await screen.findByText('Тролль')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Готовый сет/ }));
    expect(screen.getByText('itemset Ashlands 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Копировать' }));
    expect(clipboardWrite).toHaveBeenLastCalledWith('itemset Ashlands 4');
  });

  it('world: setkey toggles, save flow and quick presets', async () => {
    const user = renderAdminPage();
    await openTab(user, /^Мир/);

    expect(await screen.findByText('Читы мира и сложность')).toBeInTheDocument();
    expect(screen.getByText('пресет: Обычный')).toBeInTheDocument();

    // Предпросмотр аргументов: без плейсхолдеров, с реальной датой и скрытым паролем.
    const previewText = screen.getByTestId('admin-world-preview').textContent ?? '';

    expect(previewText).not.toMatch(/[{}]/);
    expect(previewText).toMatch(/-password ••••••/);
    expect(previewText).not.toContain('OdinRaven42');
    expect(previewText).toMatch(/server-\d{8}-\d{6}\.log/);

    const nomapSwitch = screen.getByRole('switch', { name: 'Включить Без карты' });
    expect(nomapSwitch).toHaveAttribute('aria-checked', 'false');

    await user.click(nomapSwitch);
    expect(nomapSwitch).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(screen.getByText('Все изменения сохранены')).toBeInTheDocument();
    });
    expect(
      screen.getAllByText((content) => content.includes('-setkey nomap')).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Касуал/ }));
    await waitFor(() => {
      expect(screen.getByText('пресет: Казуальный')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Сохранить и перезапустить' })).toBeInTheDocument();
  });

  it('mods: vanilla status, disabled installation and client instructions', async () => {
    const user = renderAdminPage();
    await openTab(user, /^Моды/);

    expect(await screen.findByText('Читы на сервере: поддержка модов')).toBeInTheDocument();
    expect(screen.getByText('vanilla — читы отключены')).toBeInTheDocument();

    const installButton = screen.getByRole('button', { name: 'Установить моды' });

    expect(installButton).toBeDisabled();
    expect(installButton).toHaveAttribute('title', 'Остановите сервер перед установкой модов');
    expect(screen.getByText('BepInExPack_Valheim (Thunderstore)')).toBeInTheDocument();
    expect(screen.getByText('Server_devcommands (Thunderstore)')).toBeInTheDocument();
    expect(screen.getByText(/RCON-Next/)).toBeInTheDocument();
  });
});
