import { describe, expect, it } from 'vitest';

import {
  ADMIN_COMMANDS,
  ADMIN_COMMAND_CATEGORY_ORDER,
  ADMIN_COMBOS,
  getAdminCommandBadges,
  groupAdminCommands,
  searchAdminCommands,
} from '@/lib/admin-commands';

describe('admin command catalog (research data)', () => {
  it('contains the authoritative vanilla commands and the mod group', () => {
    const ids = new Set(ADMIN_COMMANDS.map((command) => command.id));

    for (const id of [
      'devcommands',
      'confirmcheats',
      'god',
      'heal',
      'killall',
      'spawn',
      'itemset',
      'resetkeys',
      'setworldmodifier',
      'setworldpreset',
      'kick',
      'ban',
      'unban',
      'banned',
      'save',
      'tod',
      'env',
      'wind',
      'event',
      'stopevent',
      'goto',
      'pos',
      'mod_pos',
      'mod_tp',
      'mod_shutdown',
      'mod_broadcast',
    ]) {
      expect(ids.has(id), `missing command: ${id}`).toBe(true);
    }

    const modCommands = ADMIN_COMMANDS.filter((command) => command.source === 'mod');

    expect(modCommands.length).toBeGreaterThanOrEqual(20);
    expect(modCommands.every((command) => command.category === 'Мод Server Devcommands')).toBe(
      true,
    );
    expect(
      modCommands.every((command) => getAdminCommandBadges(command).includes('только с модом')),
    ).toBe(true);
  });

  it('has unique ids and non-empty metadata', () => {
    const ids = ADMIN_COMMANDS.map((command) => command.id);

    expect(new Set(ids).size).toBe(ids.length);

    for (const command of ADMIN_COMMANDS) {
      expect(command.name.length).toBeGreaterThan(0);
      expect(command.syntax.length).toBeGreaterThan(0);
      expect(command.description.length).toBeGreaterThan(10);
      expect(command.example.length).toBeGreaterThan(0);
    }
  });

  it('groups by the game registry categories', () => {
    const groups = groupAdminCommands();
    const labels = groups.map((group) => group.label);

    expect(labels).toEqual([...ADMIN_COMMAND_CATEGORY_ORDER]);
    expect(labels).toEqual([
      'Отладка',
      'Читы',
      'Предметы',
      'Игроки',
      'Мир',
      'Модерация',
      'Мод Server Devcommands',
    ]);
    expect(groups.every((group) => group.commands.length > 0)).toBe(true);
  });

  it('searches by id, name, syntax, description and note', () => {
    expect(searchAdminCommands('god').map((command) => command.id)).toContain('god');
    expect(searchAdminCommands('телепорт').map((command) => command.id)).toEqual(
      expect.arrayContaining(['goto', 'findtp']),
    );
    expect(searchAdminCommands('kick').map((command) => command.id)).toContain('kick');
    expect(searchAdminCommands('  ВРЕМЯ ').map((command) => command.id)).toContain('tod');
    expect(searchAdminCommands('Мод Server Devcommands').length).toBeGreaterThanOrEqual(20);
    expect(searchAdminCommands('такого-точно-нет')).toHaveLength(0);
  });

  it('explains where commands work with badges', () => {
    const god = ADMIN_COMMANDS.find((command) => command.id === 'god');
    const kick = ADMIN_COMMANDS.find((command) => command.id === 'kick');
    const devcommands = ADMIN_COMMANDS.find((command) => command.id === 'devcommands');
    const modPos = ADMIN_COMMANDS.find((command) => command.id === 'mod_pos');

    expect(god).toBeDefined();
    expect(kick).toBeDefined();
    expect(devcommands).toBeDefined();
    expect(modPos).toBeDefined();

    expect(getAdminCommandBadges(god!)).toContain('требует devcommands');
    expect(getAdminCommandBadges(kick!)).toContain('на выделенном сервере');
    expect(getAdminCommandBadges(devcommands!)).toContain('на сервере нужен мод');
    expect(getAdminCommandBadges(modPos!)).toContain('только с модом');
  });

  it('ships combos whose base commands exist in the catalog', () => {
    const known = new Set(ADMIN_COMMANDS.map((command) => command.id));

    expect(ADMIN_COMBOS.length).toBeGreaterThanOrEqual(8);
    expect(ADMIN_COMBOS.find((combo) => combo.id === 'admin-kit')?.commands).toEqual([
      'devcommands',
      'god',
      'nocost',
    ]);

    for (const combo of ADMIN_COMBOS) {
      for (const commandLine of combo.commands) {
        const base = commandLine.split(' ')[0] ?? '';

        expect(
          known.has(base) || known.has(`mod_${base}`),
          `combo ${combo.id}: unknown command ${commandLine}`,
        ).toBe(true);
      }
    }
  });
});
