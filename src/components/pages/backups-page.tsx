import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';

import { AutoBackupSettings } from '@/components/features/auto-backup-settings';
import { PageContent, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useServer } from '@/hooks/use-server';
import { formatBackupCount, formatBytes, formatDateTime, formatRelativeTime } from '@/lib/format';
import { PAGE_META } from '@/lib/pages';
import { isServerActive } from '@/lib/status';
import type { BackupInfo } from '@/lib/types';

/** ZIP backups: create, restore with a safety copy, delete and auto-backup policy. */
export function BackupsPage() {
  const store = useServer();
  const { data, pending } = store;
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [deleting, setDeleting] = useState<BackupInfo | null>(null);
  const [safetyBackup, setSafetyBackup] = useState(true);

  const phase = data.serverState?.phase ?? null;
  const serverActive = isServerActive(phase);
  const canRestore = phase === 'stopped' || phase === 'error';
  const backups = data.backups;

  const handleCreate = async () => {
    const created = await store.createBackup(label.trim() || null);

    if (created) {
      setCreateOpen(false);
      setLabel('');
    }
  };

  const handleRestore = async () => {
    if (!restoring) {
      return;
    }

    const restored = await store.restoreBackup(restoring.name, safetyBackup);

    if (restored) {
      setRestoring(null);
    }
  };

  const handleDelete = async () => {
    if (!deleting) {
      return;
    }

    const deleted = await store.deleteBackup(deleting.name);

    if (deleted) {
      setDeleting(null);
    }
  };

  return (
    <PageContent>
      <PageHeader
        title={PAGE_META.backups.label}
        description={PAGE_META.backups.description}
        badge={<Badge variant="outline">{formatBackupCount(backups.length)}</Badge>}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void store.openPath('backupsDir');
              }}
            >
              <FolderOpen className="size-3.5" aria-hidden="true" />
              Открыть каталог
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void store.refreshBackups();
              }}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Обновить
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Создать бэкап
            </Button>
          </>
        }
      />

      {serverActive && (
        <Notice tone="info" title="Сервер работает">
          Резервную копию можно создать и на работающем сервере. Восстановление мира доступно только
          после остановки.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Archive className="size-3.5 text-primary" aria-hidden="true" />
              Архивы миров
            </CardTitle>
            <CardDescription>
              ZIP-архив всего каталога worlds_local и списков игроков.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            {backups.length === 0 ? (
              <EmptyState
                icon={<Archive className="size-5" aria-hidden="true" />}
                title="Резервных копий пока нет"
                description="Создайте первую копию перед обновлением или изменением мира."
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setCreateOpen(true);
                    }}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Создать бэкап
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Архив</TH>
                      <TH>Миры</TH>
                      <TH className="text-right">Размер</TH>
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {backups.map((backup) => (
                      <TR key={backup.name}>
                        <TD>
                          <p className="max-w-72 truncate font-mono text-[11px] font-medium">
                            {backup.name}
                          </p>
                          <p
                            className="text-[11px] text-muted-foreground"
                            title={formatDateTime(backup.createdAt)}
                          >
                            {formatRelativeTime(backup.createdAt)}
                          </p>
                        </TD>
                        <TD>
                          <div className="flex flex-wrap gap-1">
                            {backup.worlds.map((world) => (
                              <Badge key={world} variant="outline">
                                {world}
                              </Badge>
                            ))}
                          </div>
                        </TD>
                        <TD className="text-right font-mono text-[11px] whitespace-nowrap">
                          {formatBytes(backup.sizeBytes)}
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canRestore || pending['backup-restore']}
                              title={
                                canRestore ? undefined : 'Остановите сервер, чтобы восстановить мир'
                              }
                              onClick={() => {
                                setRestoring(backup);
                                setSafetyBackup(true);
                              }}
                            >
                              <ArchiveRestore className="size-3.5" aria-hidden="true" />
                              Восстановить
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                setDeleting(backup);
                              }}
                              disabled={pending['backup-delete']}
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" />
                              Удалить
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <AutoBackupSettings />
          <Card>
            <CardHeader>
              <CardTitle>Что попадает в архив</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[11px] leading-5 text-muted-foreground">
              <p>• каталог worlds_local со всеми мирами (1.0: папка мира с .fwl2/.db2);</p>
              <p>• списки игроков adminlist, bannedlist, permittedlist;</p>
              <p>• метаданные: имя архива и дата создания;</p>
              <p>• ротация удаляет старые копии сверх лимита.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        title="Создать резервную копию"
        description="Архив можно создавать на работающем сервере."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
              }}
              disabled={pending['backup-create']}
            >
              Отмена
            </Button>
            <Button
              onClick={() => {
                void handleCreate();
              }}
              disabled={pending['backup-create']}
            >
              {pending['backup-create'] ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Archive className="size-4" aria-hidden="true" />
              )}
              Создать
            </Button>
          </>
        }
      >
        <Field label="Метка (необязательно)" htmlFor="backup-label" hint="попадёт в имя архива">
          <Input
            id="backup-label"
            value={label}
            maxLength={40}
            placeholder="before-update"
            onChange={(event) => {
              setLabel(event.target.value);
            }}
            autoComplete="off"
          />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={restoring !== null}
        title="Восстановить мир из архива?"
        description={restoring?.name ?? null}
        confirmLabel="Восстановить"
        tone="danger"
        pending={pending['backup-restore']}
        onConfirm={() => {
          void handleRestore();
        }}
        onCancel={() => {
          setRestoring(null);
        }}
      >
        <div className="space-y-2.5">
          <Notice tone="warning" title="Текущие миры будут заменены">
            Файлы миров из архива перезапишут текущие. Это необратимая операция для текущего
            состояния мира.
          </Notice>
          <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
            <span className="space-y-0.5">
              <span className="block text-xs font-medium text-foreground">
                Создать страховочную копию
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Сначала сохранит текущее состояние миров в новый архив.
              </span>
            </span>
            <Switch
              checked={safetyBackup}
              onCheckedChange={setSafetyBackup}
              aria-label="Создать страховочную копию перед восстановлением"
              className="mt-0.5"
            />
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleting !== null}
        title="Удалить резервную копию?"
        description={deleting?.name ?? null}
        confirmLabel="Удалить"
        tone="danger"
        pending={pending['backup-delete']}
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => {
          setDeleting(null);
        }}
      >
        <p className="text-xs leading-5 text-muted-foreground">
          Архив будет удалён из каталога бэкапов без возможности восстановления.
        </p>
      </ConfirmDialog>
    </PageContent>
  );
}
