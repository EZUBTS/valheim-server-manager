/** Page identity shared by the title bar, sidebar and router in `App.tsx`. */

export type PageId =
  | 'dashboard'
  | 'server'
  | 'world'
  | 'players'
  | 'admin'
  | 'backups'
  | 'logs'
  | 'network'
  | 'settings';

export const PAGE_ORDER: readonly PageId[] = [
  'dashboard',
  'server',
  'world',
  'players',
  'admin',
  'backups',
  'logs',
  'network',
  'settings',
];

export interface PageMeta {
  label: string;
  description: string;
}

export const PAGE_META: Record<PageId, PageMeta> = {
  dashboard: {
    label: 'Обзор',
    description: 'Состояние сервера, готовность к игре и быстрые действия',
  },
  server: {
    label: 'Сервер',
    description: 'SteamCMD, файлы сервера, обновления и аргументы запуска',
  },
  world: {
    label: 'Мир',
    description: 'Параметры мира, сложность и видимость сервера',
  },
  players: {
    label: 'Игроки',
    description: 'Администраторы, баны и белый список',
  },
  admin: {
    label: 'Админ',
    description: 'Известные игроки, читы F5-консоли, предметы и читы мира',
  },
  backups: {
    label: 'Бэкапы',
    description: 'Резервные копии миров и автоматическое резервирование',
  },
  logs: {
    label: 'Логи',
    description: 'Живой вывод сервера, SteamCMD и приложения',
  },
  network: {
    label: 'Сеть',
    description: 'Порты, брандмауэр и подключение к серверу',
  },
  settings: {
    label: 'Настройки',
    description: 'Каталоги, тема и параметры резервного копирования',
  },
};

export const DEFAULT_PAGE: PageId = 'dashboard';

export function isPageId(value: string): value is PageId {
  return (PAGE_ORDER as readonly string[]).includes(value);
}
