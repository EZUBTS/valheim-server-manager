/**
 * Серверные читы мира — флаги `-setkey`.
 *
 * Каждый ключ включает отдельное правило мира; применяется только после
 * перезапуска сервера (ключи передаются аргументами командной строки). Порядок
 * ключей здесь — стабильный: именно в этом порядке ядро добавляет `-setkey` в
 * командную строку.
 */

import type { WorldSetKey } from '@/lib/types';

export interface WorldSetKeyDefinition {
  key: WorldSetKey;
  /** Название переключателя на странице «Админ». */
  label: string;
  /** Короткая суть эффекта. */
  description: string;
  /** Что меняется в игре. */
  effect: string;
  /** Дополнительное предупреждение (если есть). */
  warning: string | null;
}

export const WORLD_SET_KEY_DEFINITIONS: readonly WorldSetKeyDefinition[] = [
  {
    key: 'nobuildcost',
    label: 'Бесплатное строительство',
    description: 'Постройки и ремонт не требуют материалов.',
    effect: 'Можно строить любые объекты без затрат ресурсов.',
    warning: null,
  },
  {
    key: 'playerevents',
    label: 'События у игроков',
    description: 'Рейды привязаны к игрокам, а не к миру.',
    effect: 'События запускаются рядом с игроками и не «запоминаются» миром.',
    warning: null,
  },
  {
    key: 'passivemobs',
    label: 'Пассивные монстры',
    description: 'Монстры не атакуют первыми.',
    effect: 'Враждебные существа игнорируют игроков, пока те не спровоцируют их.',
    warning: null,
  },
  {
    key: 'nomap',
    label: 'Без карты',
    description: 'Карта мира отключена.',
    effect: 'Карта недоступна игрокам, исследование мира — только «на глаз».',
    warning: 'Мир становится сложнее для новичков.',
  },
];

/** Плоский список ключей в стабильном порядке. */
export const WORLD_SET_KEY_ORDER: readonly WorldSetKey[] = WORLD_SET_KEY_DEFINITIONS.map(
  (definition) => definition.key,
);

/** Сортирует ключи в стабильном порядке ядра (и убирает повторы). */
export function sortSetKeys(keys: readonly WorldSetKey[]): WorldSetKey[] {
  const selected = new Set(keys);

  return WORLD_SET_KEY_ORDER.filter((key) => selected.has(key));
}

/** Переключает ключ в списке, сохраняя стабильный порядок. */
export function toggleSetKey(keys: readonly WorldSetKey[], key: WorldSetKey): WorldSetKey[] {
  const selected = new Set(keys);

  if (selected.has(key)) {
    selected.delete(key);
  } else {
    selected.add(key);
  }

  return sortSetKeys([...selected]);
}

/** Метаданные ключа или `undefined` для неизвестного значения. */
export function getWorldSetKeyDefinition(key: WorldSetKey): WorldSetKeyDefinition | undefined {
  return WORLD_SET_KEY_DEFINITIONS.find((definition) => definition.key === key);
}
