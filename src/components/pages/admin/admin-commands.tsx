import { Search, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ComboCard, CommandCard } from '@/components/pages/admin/admin-command-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  ADMIN_COMMANDS,
  ADMIN_COMMAND_CATEGORY_ORDER,
  ADMIN_COMBOS,
  groupAdminCommands,
  searchAdminCommands,
} from '@/lib/admin-commands';

/** Фильтр категорий: `'all'` или русское название категории. */
type CategoryFilter = string;

/** Раздел «Читы»: комбо, поиск и каталог команд по категориям. */
export function AdminCommandsTab() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const groups = useMemo(() => groupAdminCommands(), []);
  const matched = useMemo(() => searchAdminCommands(query), [query]);
  const visible = useMemo(
    () =>
      category === 'all' ? matched : matched.filter((command) => command.category === category),
    [category, matched],
  );
  const combos = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      return ADMIN_COMBOS;
    }

    return ADMIN_COMBOS.filter(
      (combo) =>
        combo.name.toLowerCase().includes(needle) ||
        combo.description.toLowerCase().includes(needle) ||
        combo.commands.some((line) => line.toLowerCase().includes(needle)),
    );
  }, [query]);

  const categoryItems = [
    { id: 'all' as const, label: 'Все команды', count: ADMIN_COMMANDS.length },
    ...ADMIN_COMMAND_CATEGORY_ORDER.map((name) => ({
      id: name,
      label: name,
      count: ADMIN_COMMANDS.filter((command) => command.category === name).length,
    })),
  ];

  return (
    <div className="flex h-full min-h-0 gap-3 p-4">
      <nav
        aria-label="Категории команд"
        className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 bg-card/40 p-1.5"
      >
        {categoryItems.map((item) => {
          const active = category === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setCategory(item.id);
              }}
              aria-pressed={active}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring/50',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              )}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] leading-4 tabular-nums',
                  active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Поиск команды: god, телепорт, время, kick…"
              aria-label="Поиск по админ-командам"
              className="pl-8"
              autoComplete="off"
            />
          </div>
          <Badge variant="outline" className="shrink-0">
            {visible.length} команд
          </Badge>
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            {combos.length} наборов
          </Badge>
        </div>

        {combos.length > 0 && (
          <section aria-label="Готовые наборы команд" className="shrink-0">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {combos.slice(0, 6).map((combo) => (
                <ComboCard key={combo.id} combo={combo} compact />
              ))}
            </div>
          </section>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {visible.length === 0 ? (
            <EmptyState
              className="h-full"
              icon={<Terminal className="size-5" aria-hidden="true" />}
              title="Команды не найдены"
              description="Попробуйте другой запрос или категорию: например, «god», «телепорт», «время» или «ban»."
              action={
                <button
                  type="button"
                  className="text-[11px] font-medium text-primary hover:underline"
                  onClick={() => {
                    setQuery('');
                    setCategory('all');
                  }}
                >
                  Сбросить фильтры
                </button>
              }
            />
          ) : category === 'all' && !query.trim() ? (
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.category} aria-label={group.label}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <h3 className="text-[11px] font-semibold tracking-wide text-foreground uppercase">
                      {group.label}
                    </h3>
                    <span className="text-[10px] text-muted-foreground">
                      {group.commands.length}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {group.commands.map((command) => (
                      <CommandCard key={command.id} command={command} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {visible.map((command) => (
                <CommandCard key={command.id} command={command} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
