import { open } from '@tauri-apps/plugin-dialog';
import {
  Check,
  FolderOpen,
  Info,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Sun,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { AutoBackupSettings } from '@/components/features/auto-backup-settings';
import { PageContent, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { InfoList, InfoRow } from '@/components/ui/info-row';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { useTheme } from '@/hooks/use-theme';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import { PAGE_META } from '@/lib/pages';
import type { AppConfig, OpenTarget } from '@/lib/types';
import type { ThemePreference } from '@/lib/theme';
import {
  hasErrors,
  validateAppConfig,
  type AppConfigErrors,
  type ConfigField,
} from '@/lib/validation';

type DirectoryField = 'installDir' | 'steamcmdDir' | 'backupsDir';

interface DirectoryRowProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  error: string | null;
  openTarget: OpenTarget;
  onChange: (value: string) => void;
  onPick: () => void;
  onOpen: (target: OpenTarget) => void;
}

function DirectoryRow({
  id,
  label,
  hint,
  value,
  error,
  openTarget,
  onChange,
  onPick,
  onOpen,
}: DirectoryRowProps) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="font-mono text-xs"
          spellCheck={false}
          aria-invalid={Boolean(error)}
        />
        <Button variant="outline" size="md" className="shrink-0" onClick={onPick}>
          <FolderOpen className="size-4" aria-hidden="true" />
          Выбрать…
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Открыть ${label.toLowerCase()}`}
          onClick={() => {
            onOpen(openTarget);
          }}
        >
          <FolderOpen className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </Field>
  );
}

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  icon: ReactNode;
}> = [
  { value: 'light', label: 'Светлая', icon: <Sun className="size-3.5" /> },
  { value: 'dark', label: 'Тёмная', icon: <Moon className="size-3.5" /> },
  { value: 'system', label: 'Системная', icon: <Monitor className="size-3.5" /> },
];

/** Directories, backup policy, theme and application info. */
export function SettingsPage() {
  const config = useServer().data.config;

  if (!config) {
    return (
      <PageContent>
        <PageHeader title={PAGE_META.settings.label} description={PAGE_META.settings.description} />
        <Notice tone="info">Загружаем настройки…</Notice>
      </PageContent>
    );
  }

  // Keyed by the saved paths: after saving (or resetting) the form remounts
  // with the persisted values instead of syncing via an effect.
  return (
    <SettingsContent
      key={`${config.installDir}|${config.steamcmdDir}|${config.backupsDir}`}
      config={config}
    />
  );
}

function SettingsContent({ config }: { config: AppConfig }) {
  const store = useServer();
  const { data, pending } = store;
  const { preference, setPreference } = useTheme();

  const [directories, setDirectories] = useState<Record<DirectoryField, string>>({
    installDir: config.installDir,
    steamcmdDir: config.steamcmdDir,
    backupsDir: config.backupsDir,
  });
  const [errors, setErrors] = useState<AppConfigErrors>({});
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const dirty =
    directories.installDir !== config.installDir ||
    directories.steamcmdDir !== config.steamcmdDir ||
    directories.backupsDir !== config.backupsDir;

  const setDirectory = (field: DirectoryField, value: string) => {
    setDirectories((current) => ({ ...current, [field]: value }));
    setErrors({});
  };

  const saveDirectories = async () => {
    const candidate = {
      ...config,
      installDir: directories.installDir.trim(),
      steamcmdDir: directories.steamcmdDir.trim(),
      backupsDir: directories.backupsDir.trim(),
    };
    const nextErrors = validateAppConfig(candidate);
    const pathErrors: AppConfigErrors = {};

    for (const field of ['installDir', 'steamcmdDir', 'backupsDir'] as const) {
      const message = nextErrors[field];

      if (message) {
        pathErrors[field] = message;
      }
    }

    setErrors(pathErrors);

    if (hasErrors(pathErrors)) {
      return;
    }

    await store.saveConfig(candidate);
  };

  const pickDirectory = async (field: DirectoryField) => {
    if (store.isPreview) {
      store.notify({
        tone: 'info',
        title: 'Режим предпросмотра',
        description:
          'Системный диалог выбора каталога доступен только в десктопном приложении. Введите путь вручную.',
      });
      return;
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Выберите каталог',
      });

      if (typeof selected === 'string') {
        setDirectory(field, selected);
      }
    } catch (error) {
      store.notify({
        tone: 'error',
        title: 'Не удалось открыть диалог',
        description: error instanceof Error ? error.message : 'Неизвестная ошибка диалога',
      });
    }
  };

  const errorFor = (field: ConfigField): string | null => {
    if (
      field === 'installDir' ||
      field === 'steamcmdDir' ||
      field === 'backupsDir' ||
      field === 'keepBackups'
    ) {
      return errors[field] ?? null;
    }

    return null;
  };

  return (
    <PageContent>
      <PageHeader
        title={PAGE_META.settings.label}
        description={PAGE_META.settings.description}
        badge={data.appInfo?.debug ? <Badge variant="warning">debug-сборка</Badge> : null}
      />

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Каталоги приложения</CardTitle>
            <CardDescription>
              Установка, SteamCMD и бэкапы хранятся независимо. Пути должны быть абсолютными.
            </CardDescription>
          </div>
          <Badge variant={dirty ? 'warning' : 'outline'}>
            {dirty ? 'есть изменения' : 'сохранено'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <DirectoryRow
            id="settings-install-dir"
            label="Каталог сервера"
            hint="installDir — здесь valheim_server.exe"
            value={directories.installDir}
            error={errorFor('installDir')}
            openTarget="installDir"
            onChange={(value) => {
              setDirectory('installDir', value);
            }}
            onPick={() => {
              void pickDirectory('installDir');
            }}
            onOpen={(target) => {
              void store.openPath(target);
            }}
          />
          <DirectoryRow
            id="settings-steamcmd-dir"
            label="Каталог SteamCMD"
            hint="steamcmdDir — здесь steamcmd.exe"
            value={directories.steamcmdDir}
            error={errorFor('steamcmdDir')}
            openTarget="steamcmdDir"
            onChange={(value) => {
              setDirectory('steamcmdDir', value);
            }}
            onPick={() => {
              void pickDirectory('steamcmdDir');
            }}
            onOpen={(target) => {
              void store.openPath(target);
            }}
          />
          <DirectoryRow
            id="settings-backups-dir"
            label="Каталог резервных копий"
            hint="backupsDir — сюда сохраняются ZIP-архивы"
            value={directories.backupsDir}
            error={errorFor('backupsDir')}
            openTarget="backupsDir"
            onChange={(value) => {
              setDirectory('backupsDir', value);
            }}
            onPick={() => {
              void pickDirectory('backupsDir');
            }}
            onOpen={(target) => {
              void store.openPath(target);
            }}
          />

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty}
              onClick={() => {
                setDirectories({
                  installDir: config.installDir,
                  steamcmdDir: config.steamcmdDir,
                  backupsDir: config.backupsDir,
                });
                setErrors({});
              }}
            >
              Отменить изменения
            </Button>
            <Button
              size="sm"
              disabled={!dirty || pending['save-config']}
              onClick={() => {
                void saveDirectories();
              }}
            >
              {pending['save-config'] ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Сохранить пути
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <AutoBackupSettings />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-3.5 text-primary" aria-hidden="true" />
              Оформление
            </CardTitle>
            <CardDescription>
              Тёмная тема «Ночной лес» включена по умолчанию. Выбор сохраняется в браузере.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map((option) => {
                const active = preference === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setPreference(option.value);
                    }}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-lg border px-2 py-3 text-xs font-medium transition-colors outline-none',
                      active
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border/70 bg-muted/20 text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                      'focus-visible:ring-2 focus-visible:ring-ring/50',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex size-7 items-center justify-center rounded-full border',
                        active
                          ? 'border-primary/50 bg-primary/15 text-primary'
                          : 'border-border/70 text-muted-foreground',
                      )}
                    >
                      {option.icon}
                    </span>
                    {option.label}
                    {active && <Check className="size-3 text-primary" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">
              «Системная» следует настройке Windows. На всех темах сохраняются контрастность и
              reduced-motion.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Вычисленные пути</CardTitle>
              <CardDescription>
                Абсолютные пути, которые использует ядро в этом запуске.
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono">
              resolved
            </Badge>
          </CardHeader>
          <CardContent>
            <InfoList>
              <InfoRow label="config.json" mono title={data.paths?.configFile}>
                {data.paths?.configFile ?? '—'}
              </InfoRow>
              <InfoRow label="Каталог данных" mono title={data.paths?.dataDir}>
                {data.paths?.dataDir ?? '—'}
              </InfoRow>
              <InfoRow label="Логи" mono title={data.paths?.logsDir}>
                {data.paths?.logsDir ?? '—'}
              </InfoRow>
              <InfoRow label="Сохранения" mono title={data.paths?.saveDir}>
                {data.paths?.saveDir ?? '—'}
              </InfoRow>
              <InfoRow label="Миры" mono title={data.paths?.worldsDir}>
                {data.paths?.worldsDir ?? '—'}
              </InfoRow>
            </InfoList>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void store.openPath('configFile');
                }}
              >
                <Info className="size-3.5" aria-hidden="true" />
                Открыть config.json
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void store.openPath('logsDir');
                }}
              >
                <FolderOpen className="size-3.5" aria-hidden="true" />
                Открыть логи
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void store.openPath('worldsDir');
                }}
              >
                <FolderOpen className="size-3.5" aria-hidden="true" />
                Открыть миры
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>О приложении</CardTitle>
            <CardDescription>Valheim Server Manager для Windows.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <InfoList>
              <InfoRow label="Приложение">{data.appInfo?.name ?? 'Valheim Server Manager'}</InfoRow>
              <InfoRow label="Версия">
                <span className="font-mono">{data.appInfo?.version ?? '0.1.0'}</span>
              </InfoRow>
              <InfoRow label="Tauri">
                <span className="font-mono">{data.appInfo?.tauriVersion ?? '—'}</span>
              </InfoRow>
              <InfoRow label="Платформа">
                <span className="font-mono">
                  {data.appInfo ? `${data.appInfo.os} / ${data.appInfo.arch}` : '—'}
                </span>
              </InfoRow>
              <InfoRow label="Сборка">
                {data.appInfo?.debug ? 'debug (разработка)' : 'release'}
              </InfoRow>
            </InfoList>

            <div className="mt-auto">
              <Notice tone="danger" title="Сброс конфигурации">
                Вернуть все настройки сервера и путей к значениям по умолчанию. Миры и бэкапы не
                удаляются.
                <div className="mt-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setResetDialogOpen(true);
                    }}
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    Сбросить конфигурацию
                  </Button>
                </div>
              </Notice>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={resetDialogOpen}
        title="Сбросить конфигурацию?"
        description="Все параметры вернутся к значениям по умолчанию."
        confirmLabel="Сбросить"
        tone="danger"
        pending={pending['reset-config']}
        onConfirm={() => {
          void (async () => {
            const reset = await store.resetConfig();
            setResetDialogOpen(false);

            if (reset) {
              store.notify({
                tone: 'success',
                title: 'Конфигурация сброшена',
                description: 'Проверьте каталоги и параметры сервера.',
              });
            }
          })();
        }}
        onCancel={() => {
          setResetDialogOpen(false);
        }}
      >
        <Notice tone="warning">
          Файлы миров, логи и резервные копии остаются на диске. Затронуты только настройки
          приложения.
        </Notice>
      </ConfirmDialog>
    </PageContent>
  );
}
