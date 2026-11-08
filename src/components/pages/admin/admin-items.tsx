import { Package, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AdminCreatureCard, AdminItemCard } from '@/components/pages/admin/admin-item-card';
import { CopyGlyph, useCopyAction } from '@/components/pages/admin/admin-shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs } from '@/components/ui/tabs';
import {
  ADMIN_CREATURES,
  ADMIN_CREATURE_CATEGORY_LABELS,
  ADMIN_CREATURE_CATEGORY_ORDER,
  ADMIN_ITEM_CATEGORY_LABELS,
  ADMIN_ITEM_CATEGORY_ORDER,
  ADMIN_ITEMS,
  buildItemsetCommand,
  buildSpawnCommand,
  normalizeItemAmount,
  searchAdminCreatures,
  searchAdminItems,
  type AdminCreatureCategory,
  type AdminItemCategory,
} from '@/lib/admin-items';

const PAGE_SIZE = 24;

type ItemsSubTab = 'items' | 'creatures' | 'itemset';

/** Раздел «Предметы»: каталог предметов/существ с пагинацией и конструктор наборов. */
export function AdminItemsTab() {
  const [subTab, setSubTab] = useState<ItemsSubTab>('items');
  const [query, setQuery] = useState('');
  const [itemCategory, setItemCategory] = useState<AdminItemCategory | 'all'>('all');
  const [creatureCategory, setCreatureCategory] = useState<AdminCreatureCategory | 'all'>('all');
  const [amountText, setAmountText] = useState('1');
  const [page, setPage] = useState(0);

  const [itemsetPreset, setItemsetPreset] = useState('Ashlands');
  const [itemsetLevel, setItemsetLevel] = useState('4');
  const [itemsetKeep, setItemsetKeep] = useState(false);

  const copy = useCopyAction();
  const amount = normalizeItemAmount(Number.parseInt(amountText, 10));

  const items = useMemo(() => searchAdminItems(query, itemCategory), [itemCategory, query]);
  const creatures = useMemo(
    () => searchAdminCreatures(query, creatureCategory),
    [creatureCategory, query],
  );

  const filtered = subTab === 'items' ? items : creatures;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleItems = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const visibleCreatures = creatures.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const visible = subTab === 'items' ? visibleItems : visibleCreatures;

  const itemCategoryTabs = [
    { value: 'all' as const, label: 'Все', count: ADMIN_ITEMS.length },
    ...ADMIN_ITEM_CATEGORY_ORDER.map((category) => ({
      value: category,
      label: ADMIN_ITEM_CATEGORY_LABELS[category],
      count: ADMIN_ITEMS.filter((item) => item.category === category).length,
    })),
  ];
  const creatureCategoryTabs = [
    { value: 'all' as const, label: 'Все', count: ADMIN_CREATURES.length },
    ...ADMIN_CREATURE_CATEGORY_ORDER.filter((category) =>
      ADMIN_CREATURES.some((creature) => creature.category === category),
    ).map((category) => ({
      value: category,
      label: ADMIN_CREATURE_CATEGORY_LABELS[category],
      count: ADMIN_CREATURES.filter((creature) => creature.category === category).length,
    })),
  ];

  const itemsetCommand = buildItemsetCommand(
    itemsetPreset.trim().length > 0 ? itemsetPreset : 'Ashlands',
    Number.parseInt(itemsetLevel, 10) || 1,
    itemsetKeep,
  );

  const resetPage = () => {
    setPage(0);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          items={[
            { value: 'items', label: 'Предметы', count: ADMIN_ITEMS.length },
            { value: 'creatures', label: 'Существа', count: ADMIN_CREATURES.length },
            { value: 'itemset', label: 'Готовый сет' },
          ]}
          value={subTab}
          onChange={(value) => {
            setSubTab(value);
            resetPage();
          }}
          label="Каталог выдачи"
        />

        {subTab !== 'itemset' && (
          <>
            <div className="relative min-w-48 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetPage();
                }}
                placeholder={
                  subTab === 'items'
                    ? 'Поиск предмета: меч, железо, мёд…'
                    : 'Поиск существа: тролль, волк, босс…'
                }
                aria-label={subTab === 'items' ? 'Поиск по предметам' : 'Поиск по существам'}
                className="pl-8"
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="admin-items-amount"
                className="text-[11px] whitespace-nowrap text-muted-foreground"
              >
                Кол-во
              </label>
              <Input
                id="admin-items-amount"
                type="number"
                min={1}
                max={9999}
                value={amountText}
                onChange={(event) => {
                  setAmountText(event.target.value);
                }}
                className="h-8 w-20 font-mono text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={filtered.length === 0}
              onClick={() => {
                void copy(
                  (subTab === 'items'
                    ? visibleItems.map((item) => buildSpawnCommand(item.prefab, amount))
                    : visibleCreatures.map((creature) => buildSpawnCommand(creature.prefab, amount))
                  ).join('\n'),
                  `Скопировано ${visible.length} команд`,
                );
              }}
            >
              <CopyGlyph />
              Копировать видимые
            </Button>
          </>
        )}
      </div>

      {subTab === 'itemset' ? (
        <Card className="min-h-0 flex-1 overflow-y-auto">
          <CardContent className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-5">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Package className="size-4 text-primary" aria-hidden="true" />
                Готовый набор экипировки (itemset)
              </p>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                <span className="font-mono">itemset &lt;name&gt; &lt;level&gt; [keep]</span> выдаёт
                заранее собранный набор предметов. Уровень задаёт качество экипировки, keep
                оставляет уже надетые вещи.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <Field
                label="Название набора"
                htmlFor="itemset-preset"
                hint="Meadows, Ashlands, AshlandsMage, Fisherman…"
              >
                <Input
                  id="itemset-preset"
                  value={itemsetPreset}
                  onChange={(event) => {
                    setItemsetPreset(event.target.value);
                  }}
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
              <Field label="Уровень" htmlFor="itemset-level" className="w-24">
                <Select
                  id="itemset-level"
                  value={itemsetLevel}
                  onChange={(event) => {
                    setItemsetLevel(event.target.value);
                  }}
                >
                  {[1, 2, 3, 4, 5].map((level) => (
                    <option key={level} value={String(level)}>
                      {level}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end pb-1">
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
                  <span className="text-[11px] text-foreground">keep</span>
                  <Switch
                    checked={itemsetKeep}
                    onCheckedChange={setItemsetKeep}
                    aria-label="Не выбрасывать текущие предметы (keep)"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
              <code className="min-w-0 font-mono text-sm break-all text-foreground">
                {itemsetCommand}
              </code>
              <Button
                size="sm"
                onClick={() => {
                  void copy(itemsetCommand, 'Команда itemset скопирована');
                }}
              >
                <CopyGlyph />
                Копировать
              </Button>
            </div>

            <Notice tone="info">
              Команды выдачи работают только с читами: в одиночной игре после{' '}
              <span className="font-mono">devcommands</span> или на сервере с модом Server
              Devcommands. Точный список наборов проверяйте командой{' '}
              <span className="font-mono">itemset</span> с Tab в F5-консоли.
            </Notice>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="shrink-0">
            {subTab === 'items' ? (
              <Tabs
                items={itemCategoryTabs}
                value={itemCategory}
                onChange={(value) => {
                  setItemCategory(value);
                  resetPage();
                }}
                label="Категория предметов"
              />
            ) : (
              <Tabs
                items={creatureCategoryTabs}
                value={creatureCategory}
                onChange={(value) => {
                  setCreatureCategory(value);
                  resetPage();
                }}
                label="Категория существ"
              />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <EmptyState
                className="h-full"
                icon={<Package className="size-5" aria-hidden="true" />}
                title={subTab === 'items' ? 'Предметы не найдены' : 'Существа не найдены'}
                description="Измените поисковый запрос или категорию."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      if (subTab === 'items') {
                        setItemCategory('all');
                      } else {
                        setCreatureCategory('all');
                      }
                      resetPage();
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-1.5 md:grid-cols-2">
                {subTab === 'items'
                  ? visibleItems.map((item) => (
                      <AdminItemCard key={item.prefab} item={item} amount={amount} />
                    ))
                  : visibleCreatures.map((creature) => (
                      <AdminCreatureCard
                        key={creature.prefab}
                        creature={creature}
                        amount={amount}
                      />
                    ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {filtered.length} {subTab === 'items' ? 'предметов' : 'существ'}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                стр. {safePage + 1} из {totalPages}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={safePage === 0}
                onClick={() => {
                  setPage(Math.max(0, safePage - 1));
                }}
              >
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                disabled={safePage >= totalPages - 1}
                onClick={() => {
                  setPage(Math.min(totalPages - 1, safePage + 1));
                }}
              >
                Вперёд
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
