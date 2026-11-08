import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const windowMock = vi.hoisted(() => ({
  minimize: vi.fn<() => Promise<void>>(),
  toggleMaximize: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
  isMaximized: vi.fn<() => Promise<boolean>>(),
  onResized: vi.fn<(callback: () => void) => Promise<() => void>>(),
  show: vi.fn<() => Promise<void>>(),
  startResizeDragging: vi.fn<(direction: string) => Promise<void>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowMock,
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'windows',
}));

import { TitleBar, type TitleBarProps } from '@/components/titlebar/title-bar';
import type { WindowControls } from '@/hooks/use-window-controls';

function createControls(overrides: Partial<WindowControls> = {}): WindowControls {
  return {
    isMaximized: false,
    minimize: windowMock.minimize,
    toggleMaximize: windowMock.toggleMaximize,
    close: windowMock.close,
    startResizeDragging: windowMock.startResizeDragging,
    ...overrides,
  };
}

function renderTitleBar(overrides: Partial<TitleBarProps> = {}) {
  return render(
    <TitleBar
      controls={createControls()}
      page="dashboard"
      phase="running"
      isPreview={false}
      {...overrides}
    />,
  );
}

describe('TitleBar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    windowMock.minimize.mockResolvedValue(undefined);
    windowMock.toggleMaximize.mockResolvedValue(undefined);
    windowMock.close.mockResolvedValue(undefined);
    windowMock.isMaximized.mockResolvedValue(false);
    windowMock.onResized.mockResolvedValue(() => undefined);
  });

  it('renders the Valheim brand, page title and phase', () => {
    renderTitleBar();

    expect(screen.getByText('Valheim Server Manager')).toBeInTheDocument();
    expect(screen.getByText('Обзор')).toBeInTheDocument();
    expect(screen.getByText('Работает')).toBeInTheDocument();
  });

  it('shows the preview badge in browser preview mode', () => {
    renderTitleBar({ isPreview: true });

    expect(screen.getByText('предпросмотр')).toBeInTheDocument();
  });

  it('renders the Russian window controls', () => {
    renderTitleBar();

    expect(screen.getByRole('button', { name: 'Свернуть окно' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Развернуть окно' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Закрыть окно' })).toBeInTheDocument();
  });

  it('does not show native tooltips on the system window buttons', () => {
    renderTitleBar();

    for (const label of ['Свернуть окно', 'Развернуть окно', 'Закрыть окно']) {
      expect(screen.getByRole('button', { name: label })).not.toHaveAttribute('title');
    }
  });

  it('uses native Windows caption glyphs and the default cursor', () => {
    renderTitleBar();

    const minimize = screen.getByRole('button', { name: 'Свернуть окно' });
    const maximize = screen.getByRole('button', { name: 'Развернуть окно' });
    const close = screen.getByRole('button', { name: 'Закрыть окно' });

    expect(minimize).toHaveTextContent('\uE921');
    expect(maximize).toHaveTextContent('\uE922');
    expect(close).toHaveTextContent('\uE8BB');
    expect(minimize).toHaveClass('cursor-default');
    expect(close).toHaveClass('cursor-default');
  });

  it('marks the whole header as a native drag region', () => {
    renderTitleBar();

    expect(screen.getByRole('banner')).toHaveAttribute('data-tauri-drag-region', 'deep');
  });

  it('wires the window buttons to the Tauri window API', async () => {
    const user = userEvent.setup();
    renderTitleBar();

    await user.click(screen.getByRole('button', { name: 'Свернуть окно' }));
    await user.click(screen.getByRole('button', { name: 'Развернуть окно' }));
    await user.click(screen.getByRole('button', { name: 'Закрыть окно' }));

    expect(windowMock.minimize).toHaveBeenCalledTimes(1);
    expect(windowMock.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(windowMock.close).toHaveBeenCalledTimes(1);
  });

  it('shows a restore action when the window is maximized', () => {
    render(
      <TitleBar
        controls={createControls({ isMaximized: true })}
        page="dashboard"
        phase="running"
        isPreview={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Восстановить окно' })).toBeInTheDocument();
  });

  it('cycles the theme starting from the dark default', async () => {
    const user = userEvent.setup();
    renderTitleBar();

    await user.click(screen.getByRole('button', { name: 'Следовать системной теме' }));
    expect(window.localStorage.getItem('valheim:theme')).toBe('system');

    await user.click(screen.getByRole('button', { name: 'Включить светлую тему' }));
    expect(window.localStorage.getItem('valheim:theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Включить тёмную тему' }));
    expect(window.localStorage.getItem('valheim:theme')).toBe('dark');
  });
});
