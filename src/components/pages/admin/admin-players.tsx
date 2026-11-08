import {
  ArrowDownUp,
  Loader2,
  RefreshCw,
  Search,
  ShieldMinus,
  ShieldPlus,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  AdminLoadError,
  CopyAction,
  CopyGlyph,
  SOURCE_BADGES,
  getAdminTarget,
  getDisplayId,
  getPlayerDisplayName,
  getPlayerReference,
  useCopyAction,
} from '@/components/pages/admin/admin-shared';
import { useAdminDataTimeout } from '@/components/pages/admin/use-admin-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useNow } from '@/hooks/use-clock';
import { useServer } from '@/hooks/use-server';
import { formatDateTime, formatRelativeTime, isValidSteamId } from '@/lib/format';
import { isServerActive } from '@/lib/status';
import type { KnownPlayer } from '@/lib/types';

const PAGE_SIZE = 10;

type PlayerFilter = 'all' | 'admins' | 'steam';
type PlayerSort = 'activity' | 'name';

/** Раздел «Игроки»: поиск, фильтры, сортировка, adminlist и модерация. */
export function AdminPlayersTab() {
  const store = useServer();
  const copy = useCopyAction();
  const { data, pending, status } = store;
  const now = useNow(30_000);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PlayerFilter>('all');
  const [sort, setSort] = useState<PlayerSort>('activity');
  const [page, setPage] = useState(0);

  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const [removing, setRemoving] = useState<KnownPlayer | null>(null);
  const [removePending, setRemovePending] = useState(false);

  const knownPlayers = data.knownPlayers;
  const players = useMemo(() => knownPlayers ?? [], [knownPlayers]);
  const { loading, failed, retry } = useAdminDataTimeout(
    knownPlayers !== null,
    store.refreshKnownPlayers,
  );

  const adminEntries = data.players?.admins ?? [];
  const adminsSet = useMemo(
    () => new Set((data.players?.admins ?? []).map((entry) => entry.id.toLowerCase())),
    [data.players],
  );
  const phase = data.serverState?.phase ?? null;

  const isAdmin = (player: KnownPlayer): boolean => {
    const target = getAdminTarget(player);

    return player.isAdmin || (target !== null && adminsSet.has(target.toLowerCase()));
  };

  /** ID существующей записи adminlist, соответствующей игроку (для удаления). */
  const findAdminEntryId = (player: KnownPlayer): string | null => {
    const target = getAdminTarget(player);

    const entry = adminEntries.find((candidate) => {
      const id = candidate.id.toLowerCase();

      if (target !== null && id === target.toLowerCase()) {
        return true;
      }

      if (player.platformId && id === player.platformId.toLowerCase()) {
        return true;
      }

      return player.steamId64 !== null && id === player.steamId64.toLowerCase();
    });

    return entry?.id ?? target;
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = players.filter((player) => {
      const target = getAdminTarget(player);
      const admin = player.isAdmin || (target !== null && adminsSet.has(target.toLowerCase()));

      if (filter === 'admins' && !admin) {
        return false;
      }

      if (filter === 'steam' && player.steamId64 === null) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return (
        (player.name ?? '').toLowerCase().includes(needle) ||
        (player.steamId64 ?? '').toLowerCase().includes(needle) ||
        (player.platformId ?? '').toLowerCase().includes(needle)
      );
    });

    return matching.toSorted((left, right) => {
      if (sort === 'name') {
        return getPlayerDisplayName(left).localeCompare(getPlayerDisplayName(right), 'ru');
      }

      return right.lastSeenAt - left.lastSeenAt;
    });
  }, [adminsSet, filter, players, query, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const adminCount = players.filter((player) => isAdmin(player)).length;
  const steamCount = players.filter((player) => player.steamId64 !== null).length;
  const running = isServerActive(phase);

  const makeAdmin = async (player: KnownPlayer) => {
    const target = getAdminTarget(player);

    if (!target) {
      store.notify({
        tone: 'warning',
        title: 'Нельзя добавить в adminlist',
        description: 'У игрока нет SteamID64 или поддерживаемого платформенного ID.',
      });
      return;
    }

    await store.addPlayer('admins', target, player.name);
  };

  const confirmRemoveAdmin = async () => {
    if (!removing) {
      return;
    }

    const entryId = findAdminEntryId(removing);

    if (!entryId) {
      setRemoving(null);
      return;
    }

    setRemovePending(true);
    await store.removePlayer('admins', entryId);
    setRemovePending(false);
    setRemoving(null);
  };

  const handleAdd = async () => {
    const trimmed = addId.trim();

    if (!trimmed) {
      setAddError('Укажите SteamID64 или ID с префиксом V_/X_');
      return;
    }

    if (!isValidSteamId(trimmed)) {
      setAddError('Некорректный ID: 17 цифр SteamID64 или формат V_/X_');
      return;
    }

    if (adminEntries.some((entry) => entry.id.toLowerCase() === trimmed.toLowerCase())) {
      setAddError('Этот ID уже есть в adminlist');
      return;
    }

    setAddError(null);
    const added = await store.addPlayer('admins', trimmed, addName.trim() || null);

    if (added) {
      setAddId('');
      setAddName('');
    }
  };

  if (knownPlayers === null) {
    if (status === 'error' || failed) {
      return (
        <AdminLoadError
          title="Игроки не загрузились"
          onRetry={() => {
            retry();
            void store.refreshKnownPlayers();
          }}
          retrying={pending['known-players']}
        />
      );
    }

    if (loading) {
      return (
        <div data-testid="admin-players-loading" className="h-full space-y-3 overflow-y-auto p-5">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-10 w-72 rounded-md" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Поиск по имени, SteamID64 или platform ID…"
            aria-label="Поиск игроков"
            className="pl-8"
            autoComplete="off"
          />
        </div>
        <Tabs
          items={[
            { value: 'all', label: 'Все', count: players.length },
            { value: 'admins', label: 'Админы', count: adminCount },
            { value: 'steam', label: 'С SteamID', count: steamCount },
          ]}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(0);
          }}
          label="Фильтр игроков"
        />
        <div className="flex items-center gap-1.5">
          <ArrowDownUp className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <Select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as PlayerSort);
              setPage(0);
            }}
            aria-label="Сортировка игроков"
            className="h-8 w-36 text-xs"
          >
            <option value="activity">По активности</option>
            <option value="name">По имени</option>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending['known-players']}
          onClick={() => {
            void store.refreshKnownPlayers();
          }}
        >
          {pending['known-players'] ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Обновить
        </Button>
      </div>

      {running && (
        <Notice tone="warning" title="Требуется перезапуск">
          Сервер работает. adminlist читается только при старте — новые админы и снятие прав
          применятся после перезапуска сервера.
        </Notice>
      )}

      <Card>
        <CardContent className="grid gap-2 pt-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <label htmlFor="admin-player-id" className="text-[11px] font-medium text-foreground">
              ID игрока
            </label>
            <Input
              id="admin-player-id"
              value={addId}
              onChange={(event) => {
                setAddId(event.target.value);
                setAddError(null);
              }}
              placeholder="V_76561198000000005 или 76561198000000005"
              className="font-mono text-xs"
              aria-invalid={Boolean(addError)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="admin-player-name" className="text-[11px] font-medium text-foreground">
              Имя <span className="font-normal text-muted-foreground">(необязательно)</span>
            </label>
            <Input
              id="admin-player-name"
              value={addName}
              onChange={(event) => {
                setAddName(event.target.value);
              }}
              placeholder="Рагнар"
              autoComplete="off"
              maxLength={64}
              className="text-xs"
            />
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              className="w-full md:w-auto"
              disabled={pending.players}
              onClick={() => {
                void handleAdd();
              }}
            >
              {pending.players ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus className="size-3.5" aria-hidden="true" />
              )}
              Добавить в adminlist
            </Button>
          </div>
          <div className="md:col-span-3">
            {addError ? (
              <p className="text-[11px] text-destructive" role="alert">
                {addError}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Принимаются SteamID64, V_&lt;SteamID64&gt; и X_&lt;ID&gt;. ID можно скопировать из
                F2-панели игрока или из строки подключения в логе.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
          {players.length === 0 ? (
            <EmptyState
              icon={<ShieldPlus className="size-5" aria-hidden="true" />}
              title="Пока никого не видели"
              description="Список заполняется из строк подключения в логе и из adminlist.txt. Запустите сервер и подключите игроков — или добавьте ID вручную выше."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Ничего не найдено"
              description="Измените запрос или фильтр."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                    setPage(0);
                  }}
                >
                  Сбросить фильтры
                </Button>
              }
            />
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60">
                <Table>
                  <THead className="sticky top-0 z-10">
                    <TR>
                      <TH>Игрок</TH>
                      <TH>ID</TH>
                      <TH>Статус</TH>
                      <TH>Активность</TH>
                      <TH className="text-right">Действия</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {visible.map((player) => {
                      const target = getAdminTarget(player);
                      const admin = isAdmin(player);
                      const sourceMeta = SOURCE_BADGES[player.source];
                      const reference = getPlayerReference(player);

                      return (
                        <TR
                          key={`${player.platformId ?? ''}-${player.steamId64 ?? ''}-${player.lastSeenAt}`}
                        >
                          <TD>
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-foreground">
                                {getPlayerDisplayName(player)}
                              </p>
                              <Badge variant={sourceMeta.variant}>{sourceMeta.label}</Badge>
                            </div>
                          </TD>
                          <TD>
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-[11px] break-all">
                                {getDisplayId(player)}
                              </span>
                              <CopyAction
                                value={getDisplayId(player)}
                                title="ID игрока скопирован"
                                label={`Копировать ID игрока ${getPlayerDisplayName(player)}`}
                              />
                            </div>
                          </TD>
                          <TD>
                            {admin ? (
                              <Badge variant="success">админ</Badge>
                            ) : (
                              <Badge variant="outline">игрок</Badge>
                            )}
                          </TD>
                          <TD
                            className="text-[11px] whitespace-nowrap text-muted-foreground"
                            title={formatDateTime(player.lastSeenAt)}
                          >
                            {formatRelativeTime(player.lastSeenAt, now)}
                          </TD>
                          <TD>
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {admin ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-[10px]"
                                  disabled={pending.players}
                                  onClick={() => {
                                    setRemoving(player);
                                  }}
                                >
                                  <ShieldMinus className="size-3" aria-hidden="true" />
                                  Убрать
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-[10px]"
                                  disabled={target === null || pending.players}
                                  title={
                                    target === null
                                      ? 'Нужен SteamID64 или X_/V_-ID'
                                      : `Добавить ${target} в adminlist`
                                  }
                                  onClick={() => {
                                    void makeAdmin(player);
                                  }}
                                >
                                  <ShieldPlus className="size-3" aria-hidden="true" />В adminlist
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label={`Копировать команду kick для ${reference}`}
                                title={`Скопировать: kick ${reference}`}
                                onClick={() => {
                                  void copy(`kick ${reference}`, 'Команда kick скопирована');
                                }}
                              >
                                <CopyGlyph />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label={`Копировать команду ban для ${reference}`}
                                title={`Скопировать: ban ${reference}`}
                                onClick={() => {
                                  void copy(`ban ${reference}`, 'Команда ban скопирована');
                                }}
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </Button>
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-[11px] text-muted-foreground">
                  {filtered.length} из {players.length} игроков · стр. {safePage + 1} из{' '}
                  {totalPages}
                </p>
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
        </CardContent>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        title="Убрать игрока из админов?"
        description={removing ? getPlayerDisplayName(removing) : null}
        confirmLabel="Убрать из adminlist"
        tone="danger"
        pending={removePending}
        onConfirm={() => {
          void confirmRemoveAdmin();
        }}
        onCancel={() => {
          setRemoving(null);
        }}
      >
        <Notice tone="warning">
          Права снимутся только после перезапуска сервера. Если игрок уже в игре, до рестарта он
          сохранит админ-команды.
        </Notice>
      </ConfirmDialog>
    </div>
  );
}
