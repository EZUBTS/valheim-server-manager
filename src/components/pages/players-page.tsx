import { Copy, Loader2, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { useState } from 'react';

import { PageContent, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useServer } from '@/hooks/use-server';
import { STEAM_ID_HINT, formatPlayerCount, isValidSteamId } from '@/lib/format';
import { PAGE_META } from '@/lib/pages';
import { isServerActive } from '@/lib/status';
import type { PlayerListEntry, PlayerListKind } from '@/lib/types';

const TABS: ReadonlyArray<{ value: PlayerListKind; label: string }> = [
  { value: 'admins', label: 'Администраторы' },
  { value: 'banned', label: 'Бан' },
  { value: 'permitted', label: 'Допущенные' },
];

const LIST_HINTS: Record<PlayerListKind, string> = {
  admins:
    'Администраторы могут использовать серверные команды: kick, ban, unban, save, info, ping.',
  banned: 'Забаненные игроки не смогут подключиться к серверу.',
  permitted:
    'Непустой список допущенных включает режим whitelist: войти смогут только перечисленные игроки.',
};

function entriesFor(lists: ReturnType<typeof useServer>['data']['players'], kind: PlayerListKind) {
  if (!lists) {
    return [];
  }

  return lists[kind];
}

/** Admins / banned / permitted player lists with SteamID validation. */
export function PlayersPage() {
  const store = useServer();
  const { data, pending } = store;
  const [kind, setKind] = useState<PlayerListKind>('admins');
  const [idInput, setIdInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PlayerListEntry | null>(null);
  const [removePending, setRemovePending] = useState(false);

  const lists = data.players;
  const entries = entriesFor(lists, kind);
  const serverRunning = isServerActive(data.serverState?.phase ?? null);
  const permittedCount = lists?.permitted.length ?? 0;
  const bannedCount = lists?.banned.length ?? 0;

  const tabItems = TABS.map((tab) => ({
    ...tab,
    count: entriesFor(lists, tab.value).length,
  }));

  const handleAdd = async () => {
    const trimmed = idInput.trim();

    if (!trimmed) {
      setAddError('Укажите SteamID64 или ID с префиксом V_/X_');
      return;
    }

    if (!isValidSteamId(trimmed)) {
      setAddError('Некорректный ID: проверьте количество цифр и префикс');
      return;
    }

    if (entries.some((entry) => entry.id.toLowerCase() === trimmed.toLowerCase())) {
      setAddError('Игрок уже есть в этом списке');
      return;
    }

    setAddError(null);
    const added = await store.addPlayer(kind, trimmed, nameInput.trim() || null);

    if (added) {
      setIdInput('');
      setNameInput('');
    }
  };

  const handleRemove = async () => {
    if (!removing) {
      return;
    }

    setRemovePending(true);
    const removed = await store.removePlayer(kind, removing.id);
    setRemovePending(false);

    if (removed) {
      setRemoving(null);
    }
  };

  return (
    <PageContent>
      <PageHeader
        title={PAGE_META.players.label}
        description={PAGE_META.players.description}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void store.refreshLists();
            }}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Обновить списки
          </Button>
        }
      />

      <Tabs
        items={tabItems}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setAddError(null);
        }}
        label="Списки игроков"
      />

      {serverRunning && (
        <Notice tone="warning" title="Требуется перезапуск">
          Сервер работает. Списки игроков читаются только при старте — изменения вступят в силу
          после перезапуска сервера.
        </Notice>
      )}

      {kind === 'permitted' && permittedCount > 0 && (
        <Notice tone="warning" title="Включён белый список">
          В списке допущенных {formatPlayerCount(permittedCount)}. Пока список не пуст, подключиться
          смогут только эти игроки — все остальные будут заблокированы.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Добавить игрока</CardTitle>
            <CardDescription>{LIST_HINTS[kind]}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAdd();
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="player-id" className="text-xs font-medium">
                  ID игрока
                </label>
                <Input
                  id="player-id"
                  value={idInput}
                  onChange={(event) => {
                    setIdInput(event.target.value);
                    setAddError(null);
                  }}
                  placeholder="V_76561198000000005"
                  className="font-mono"
                  aria-invalid={Boolean(addError)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="player-name" className="text-xs font-medium">
                  Имя <span className="font-normal text-muted-foreground">(необязательно)</span>
                </label>
                <Input
                  id="player-name"
                  value={nameInput}
                  onChange={(event) => {
                    setNameInput(event.target.value);
                  }}
                  placeholder="Рагнар"
                  autoComplete="off"
                  maxLength={64}
                />
              </div>

              {addError && (
                <p className="text-[11px] text-destructive" role="alert">
                  {addError}
                </p>
              )}

              <Button type="submit" disabled={pending.players} className="w-full">
                {pending.players ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                Добавить в список
              </Button>

              <p className="text-[11px] leading-4 text-muted-foreground">{STEAM_ID_HINT}</p>
            </form>
          </CardContent>
        </Card>

        <Card className="flex flex-col lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{TABS.find((tab) => tab.value === kind)?.label ?? 'Игроки'}</CardTitle>
              <CardDescription>
                {entries.length > 0
                  ? `${formatPlayerCount(entries.length)} · изменения требуют перезапуска`
                  : 'Список пуст'}
              </CardDescription>
            </div>
            {kind === 'banned' && bannedCount > 0 && (
              <Badge variant="danger">{formatPlayerCount(bannedCount)}</Badge>
            )}
          </CardHeader>
          <CardContent className="flex-1">
            {entries.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5" aria-hidden="true" />}
                title="Пока пусто"
                description={LIST_HINTS[kind]}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>ID</TH>
                      <TH>Имя</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {entries.map((entry) => (
                      <TR key={entry.id}>
                        <TD>
                          <div className="flex items-center gap-1.5">
                            <Copy
                              className="size-3 shrink-0 text-muted-foreground/60"
                              aria-hidden="true"
                            />
                            <span className="font-mono text-[11px] font-medium">{entry.id}</span>
                            <CopyButton value={entry.id} label={`Копировать ID ${entry.id}`} />
                          </div>
                        </TD>
                        <TD className="text-xs">{entry.name ?? '—'}</TD>
                        <TD className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              setRemoving(entry);
                            }}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                            Удалить
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="Удалить игрока из списка?"
        description={removing ? `${removing.id}` : null}
        confirmLabel="Удалить"
        tone="danger"
        pending={removePending}
        onConfirm={() => {
          void handleRemove();
        }}
        onCancel={() => {
          setRemoving(null);
        }}
      >
        <Notice tone="warning">
          Изменение вступит в силу только после перезапуска сервера. Удаление из списка банов не
          разбанивает игрока, который уже подключён.
        </Notice>
      </ConfirmDialog>
    </PageContent>
  );
}
