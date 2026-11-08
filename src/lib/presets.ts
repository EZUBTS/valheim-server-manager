/** Russian labels and descriptions for Valheim world presets and modifiers. */

import type { WorldModifiers, WorldPreset } from '@/lib/types';

/** Keys of the `-modifier` pairs. */
export type WorldModifierKey = keyof WorldModifiers;

export interface PresetOption {
  value: WorldPreset;
  label: string;
  description: string;
}

/** `-preset` values from Valheim 1.0; `custom` replaces the preset with modifiers. */
export const PRESET_OPTIONS: readonly PresetOption[] = [
  {
    value: 'normal',
    label: 'Обычный',
    description: 'Стандартный баланс Valheim.',
  },
  {
    value: 'casual',
    label: 'Казуальный',
    description: 'Лёгкие бои, предметы остаются после смерти, без рейдов, больше ресурсов.',
  },
  {
    value: 'easy',
    label: 'Лёгкий',
    description: 'Слабее враги и меньше рейдов.',
  },
  {
    value: 'hard',
    label: 'Сложный',
    description: 'Сильнее враги, чаще рейды.',
  },
  {
    value: 'hardcore',
    label: 'Хардкор',
    description: 'Очень сильные враги, потеря вещей и навыков при смерти, без карты.',
  },
  {
    value: 'immersive',
    label: 'Иммерсивный',
    description: 'Без карты и порталов, огонь распространяется.',
  },
  {
    value: 'hammer',
    label: 'Молот',
    description: 'Бесплатное строительство — креативный режим.',
  },
  {
    value: 'custom',
    label: 'Свои настройки',
    description: 'Каждый модификатор настраивается отдельно.',
  },
];

export const PRESET_LABELS: Record<WorldPreset, string> = Object.fromEntries(
  PRESET_OPTIONS.map((option) => [option.value, option.label]),
) as Record<WorldPreset, string>;

export interface ModifierDefinition {
  key: WorldModifierKey;
  label: string;
  hint: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export const MODIFIER_DEFINITIONS: readonly ModifierDefinition[] = [
  {
    key: 'combat',
    label: 'Бой',
    hint: 'Сложность противников',
    options: [
      { value: 'veryeasy', label: 'Очень легко' },
      { value: 'easy', label: 'Легко' },
      { value: 'normal', label: 'Обычно' },
      { value: 'hard', label: 'Сложно' },
      { value: 'veryhard', label: 'Очень сложно' },
    ],
  },
  {
    key: 'deathPenalty',
    label: 'Штраф за смерть',
    hint: 'Что теряется при смерти',
    options: [
      { value: 'casual', label: 'Без потерь' },
      { value: 'veryeasy', label: 'Очень мягкий' },
      { value: 'easy', label: 'Мягкий' },
      { value: 'normal', label: 'Обычный' },
      { value: 'hard', label: 'Суровый' },
      { value: 'hardcore', label: 'Хардкор' },
    ],
  },
  {
    key: 'resources',
    label: 'Ресурсы',
    hint: 'Количество добычи и материалов',
    options: [
      { value: 'muchless', label: 'Гораздо меньше' },
      { value: 'less', label: 'Меньше' },
      { value: 'normal', label: 'Обычно' },
      { value: 'more', label: 'Больше' },
      { value: 'muchmore', label: 'Гораздо больше' },
    ],
  },
  {
    key: 'raids',
    label: 'Рейды',
    hint: 'Частота нападений на базы',
    options: [
      { value: 'none', label: 'Нет' },
      { value: 'muchless', label: 'Гораздо реже' },
      { value: 'less', label: 'Реже' },
      { value: 'normal', label: 'Обычно' },
      { value: 'more', label: 'Чаще' },
      { value: 'muchmore', label: 'Гораздо чаще' },
    ],
  },
  {
    key: 'portals',
    label: 'Порталы',
    hint: 'Правила использования порталов',
    options: [
      { value: 'casual', label: 'Без ограничений' },
      { value: 'easy', label: 'Мягкие' },
      { value: 'normal', label: 'Обычные' },
      { value: 'hard', label: 'Суровые' },
      { value: 'veryhard', label: 'Очень суровые' },
    ],
  },
];

/** Returns the modifier definition for a key. */
export function getModifierDefinition(key: WorldModifierKey): ModifierDefinition | undefined {
  return MODIFIER_DEFINITIONS.find((definition) => definition.key === key);
}

/** Returns a new modifiers object with a single value replaced safely. */
export function withModifier(
  modifiers: WorldModifiers,
  key: WorldModifierKey,
  value: string,
): WorldModifiers {
  if (key === 'combat') {
    return { ...modifiers, combat: value as WorldModifiers['combat'] };
  }

  if (key === 'deathPenalty') {
    return { ...modifiers, deathPenalty: value as WorldModifiers['deathPenalty'] };
  }

  if (key === 'resources') {
    return { ...modifiers, resources: value as WorldModifiers['resources'] };
  }

  if (key === 'raids') {
    return { ...modifiers, raids: value as WorldModifiers['raids'] };
  }

  return { ...modifiers, portals: value as WorldModifiers['portals'] };
}
