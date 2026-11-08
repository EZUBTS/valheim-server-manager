import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from '@/components/pages/admin/admin-page';
import { resetPreviewBackend } from '@/lib/preview';
import { NavigationContext, type NavigationStore } from '@/providers/navigation-context';
import { ServerProvider } from '@/providers/server-provider';

interface RenderResult {
  user: ReturnType<typeof userEvent.setup>;
  navigation: NavigationStore;
}

function renderAdminPage(): RenderResult {
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

  return { user, navigation };
}

async function waitForShell() {
  expect(await screen.findByRole('heading', { level: 1, name: 'Админ' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(7);
  // Ждём быстрое ядро и фоновую загрузку игроков: счётчик таба появляется,
  // когда `knownPlayers` уже не null.
  await screen.findByText('Готов к админке');
  await screen.findByRole('tab', { name: 'Игроки (5)' });
}

describe('AdminPage shell and tabs (browser preview)', () => {
  beforeEach(() => {
    resetPreviewBackend();
    window.localStorage.clear();
  });

  it('renders the sticky header, status chips and seven tabs with counters', async () => {
    renderAdminPage();
    await waitForShell();

    expect(screen.getByRole('tablist', { name: 'Разделы страницы «Админ»' })).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');

    expect(tabs[0]).toContain('Обзор');
    expect(tabs[1]).toContain('Игроки');
    expect(tabs[1]).toContain('5');
    expect(tabs[2]).toContain('Читы');
    expect(tabs[2]).toContain('159');
    expect(tabs[3]).toContain('Предметы');
    expect(tabs[3]).toContain('449');
    expect(tabs[4]).toContain('Мир');
    expect(tabs[5]).toContain('Моды');
    expect(tabs[6]).toContain('Справка');

    // Счётчики доступны и через accessible name: «Читы (159)», «Предметы (449)».
    expect(screen.getByRole('tab', { name: 'Игроки (5)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Читы (159)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Предметы (449)' })).toBeInTheDocument();

    // Status chips in the header.
    expect(screen.getAllByText(/adminlist:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/известно:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/моды:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Работает').length).toBeGreaterThan(0);
    expect(screen.getByText('483920')).toBeInTheDocument();
  });

  it('switches between all seven sections', async () => {
    const { user } = renderAdminPage();
    await waitForShell();

    const sections: ReadonlyArray<{ tab: RegExp; marker: string }> = [
      { tab: /^Игроки/, marker: 'ID игрока' },
      { tab: /^Читы/, marker: 'Все команды' },
      { tab: /^Предметы/, marker: 'Готовый сет' },
      { tab: /^Мир/, marker: 'Читы мира и сложность' },
      { tab: /^Моды/, marker: 'Читы на сервере: поддержка модов' },
      { tab: /^Справка/, marker: 'Справка по администрированию' },
      { tab: /^Обзор/, marker: 'Готов к админке' },
    ];

    for (const section of sections) {
      const tab = screen.getByRole('tab', { name: section.tab });

      await user.click(tab);

      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(await screen.findByRole('tabpanel')).toBeInTheDocument();
      expect(await screen.findByText(section.marker)).toBeInTheDocument();
    }
  });

  it('supports keyboard navigation in the tab list', async () => {
    const { user } = renderAdminPage();
    await waitForShell();

    const overviewTab = screen.getByRole('tab', { name: /^Обзор/ });
    overviewTab.focus();
    expect(overviewTab).toHaveFocus();

    await user.keyboard('{ArrowRight}');

    const playersTab = screen.getByRole('tab', { name: /^Игроки/ });

    expect(playersTab).toHaveAttribute('aria-selected', 'true');
    expect(playersTab).toHaveFocus();

    await user.keyboard('{End}');

    expect(screen.getByRole('tab', { name: /^Справка/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the overview checklist, combos, recent players and logs', async () => {
    renderAdminPage();
    await waitForShell();

    expect(screen.getByText('Быстрые комбо')).toBeInTheDocument();
    expect(screen.getByText('Последние игроки')).toBeInTheDocument();
    expect(screen.getByText('Последние события лога')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Остановить' })).toBeInTheDocument();
    expect(screen.getAllByText('Админ-набор').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Рагнар').length).toBeGreaterThan(0);

    // Клиентские моды — info-пункт, вне автоматического счёта.
    expect(screen.getByText('Клиентские моды (проверьте у себя)')).toBeInTheDocument();
    expect(
      screen.getByText((content) => /^\d+\/4 автоматических пунктов$/.test(content)),
    ).toBeInTheDocument();
    expect(screen.queryByText((content) => /^\d+\/5$/.test(content))).not.toBeInTheDocument();
    expect(screen.getByText(/не входят в автоматический счёт/)).toBeInTheDocument();
  });

  it('navigates from the overview quick actions', async () => {
    const { user, navigation } = renderAdminPage();
    await waitForShell();

    await user.click(screen.getByRole('button', { name: /Игроки и adminlist/ }));
    expect(screen.getByRole('tab', { name: /^Игроки/ })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: /^Обзор/ }));
    await user.click(screen.getByRole('button', { name: 'Логи' }));
    expect(navigation.navigate).toHaveBeenCalledWith('logs');
  });

  it('renders the help FAQ with expandable blocks and documentation links', async () => {
    const { user } = renderAdminPage();
    await waitForShell();

    await user.click(screen.getByRole('tab', { name: /^Справка/ }));

    expect(screen.getByText('Справка по администрированию')).toBeInTheDocument();
    expect(screen.getByText('Как стать админом сервера?')).toBeInTheDocument();
    expect(screen.getByText('Почему читы не работают без мода?')).toBeInTheDocument();
    expect(
      screen.getByText('Можно ли администрировать сервер удалённо (RCON)?'),
    ).toBeInTheDocument();
    expect(screen.getByText('docs/ADMIN-REFERENCE.md')).toBeInTheDocument();
    expect(screen.getByText('docs/admin-items.json')).toBeInTheDocument();

    const summary = screen.getByText('Как стать админом сервера?');
    const details = summary.closest('details');

    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');

    await user.click(summary);
    expect(details).toHaveAttribute('open');

    const faqBody = within(details as HTMLElement);
    expect(faqBody.getByText(/V_<SteamID64>/)).toBeInTheDocument();
  });
});
