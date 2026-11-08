import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import App from '@/App';
import { resetPreviewBackend } from '@/lib/preview';

const PAGES: ReadonlyArray<{ nav: string; heading: string; marker: string }> = [
  { nav: 'Сервер', heading: 'Сервер', marker: 'Valheim Dedicated Server' },
  { nav: 'Мир', heading: 'Мир', marker: 'Основные параметры' },
  { nav: 'Игроки', heading: 'Игроки', marker: 'Добавить игрока' },
  { nav: 'Админ', heading: 'Админ', marker: 'Как стать админом' },
  { nav: 'Бэкапы', heading: 'Бэкапы', marker: 'Архивы миров' },
  { nav: 'Логи', heading: 'Логи', marker: 'Все источники' },
  { nav: 'Сеть', heading: 'Сеть', marker: 'UDP-порты' },
  { nav: 'Настройки', heading: 'Настройки', marker: 'Каталоги приложения' },
  { nav: 'Обзор', heading: 'Обзор', marker: 'Готовность к игре' },
];

describe('application smoke test (browser preview)', () => {
  beforeEach(() => {
    resetPreviewBackend();
    window.localStorage.clear();
  });

  it('renders the dashboard and navigates through every page', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Обзор' })).toBeInTheDocument();

    for (const page of PAGES) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${page.nav}`) }));
      expect(
        await screen.findByRole('heading', { level: 1, name: page.heading }, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(await screen.findByText(page.marker, {}, { timeout: 3000 })).toBeInTheDocument();
    }
  });

  it('shows live preview data on the dashboard', async () => {
    render(<App />);

    await screen.findByRole('heading', { level: 1, name: 'Обзор' });

    await waitFor(() => {
      expect(screen.getAllByText('Работает').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/Midgard/).length).toBeGreaterThan(0);
    expect(screen.getByText('483920')).toBeInTheDocument();
  });

  it('intercepts window close while the server is running', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { level: 1, name: 'Обзор' });
    await waitFor(() => {
      expect(screen.getAllByText('Работает').length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole('button', { name: 'Закрыть окно' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Остановить сервер и закрыть приложение?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Остановить и выйти' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Отмена' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('renders the logs page with live lines', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { level: 1, name: 'Обзор' });
    await waitFor(() => {
      expect(screen.getAllByText('Работает').length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole('button', { name: /^Логи/ }));

    expect(await screen.findByRole('log')).toBeInTheDocument();
    expect(await screen.findByText('Game server connected')).toBeInTheDocument();
  });
});
