import { describe, expect, it } from 'vitest';

import {
  WORLD_SET_KEY_DEFINITIONS,
  WORLD_SET_KEY_ORDER,
  getWorldSetKeyDefinition,
  sortSetKeys,
  toggleSetKey,
} from '@/lib/set-keys';

describe('world set keys', () => {
  it('defines the whitelist in the contract order', () => {
    expect(WORLD_SET_KEY_ORDER).toEqual(['nobuildcost', 'playerevents', 'passivemobs', 'nomap']);
    expect(WORLD_SET_KEY_DEFINITIONS).toHaveLength(4);
    expect(getWorldSetKeyDefinition('nomap')?.label).toBe('Без карты');
  });

  it('sorts keys into the stable server order', () => {
    expect(sortSetKeys(['playerevents', 'nobuildcost', 'nomap'])).toEqual([
      'nobuildcost',
      'playerevents',
      'nomap',
    ]);
    expect(sortSetKeys([])).toEqual([]);
    expect(sortSetKeys(['nomap', 'nomap'])).toEqual(['nomap']);
  });

  it('toggles keys and keeps the order', () => {
    expect(toggleSetKey(['nobuildcost'], 'nomap')).toEqual(['nobuildcost', 'nomap']);
    expect(toggleSetKey(['nobuildcost', 'nomap'], 'nobuildcost')).toEqual(['nomap']);
  });
});
