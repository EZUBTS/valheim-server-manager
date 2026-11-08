import { ArrowRight, Globe2, Loader2, RefreshCw, Rocket, Save, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AdminLoadError, CopyAction, StatusChip } from '@/components/pages/admin/admin-shared';
import { useAdminDataTimeout } from '@/components/pages/admin/use-admin-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useNavigate } from '@/hooks/use-navigate';
import { useServer } from '@/hooks/use-server';
import {
  buildServerArgs,
  buildServerLogFilePath,
  formatCommandLine,
  maskServerArgs,
} from '@/lib/args';
import { cn } from '@/lib/cn';
import { PRESET_LABELS } from '@/lib/presets';
import { WORLD_SET_KEY_DEFINITIONS, sortSetKeys, toggleSetKey } from '@/lib/set-keys';
import type { AppConfig, WorldModifiers, WorldPreset, WorldSetKey } from '@/lib/types';

interface QuickPreset {
  preset: WorldPreset;
  label: string;
  description: string;
}

const QUICK_PRESETS: readonly QuickPreset[] = [
  { preset: 'casual', label: 'Касуал', description: 'Лёгкие бои, без рейдов, больше ресурсов.' },
  { preset: 'hammer', label: 'Хаммер', description: 'Бесплатная стройка без смены сложности.' },
  { preset: 'hard', label: 'Сложный', description: 'Сильнее враги, чаще рейды.' },
  { preset: 'normal', label: 'Обычный', description: 'Стандартный баланс Valheim.' },
];

interface QuickModifier {
  label: string;
  description: string;
  overrides: Partial<WorldModifiers>;
}

const QUICK_MODIFIERS: readonly QuickModifier[] = [
  {
    label: 'Без рейдов',
    description: 'События не нападают на базы.',
    overrides: { raids: 'none' },
  },
  {
    label: 'Много ресурсов',
    description: 'Больше добычи с узлов и дропа.',
    overrides: { resources: 'muchmore' },
  },
  {
    label: 'Мягкая смерть',
    description: 'Минимальные потери при смерти.',
    overrides: { deathPenalty: 'casual' },
  },
];

function buildTentativeConfig(config: AppConfig, setKeys: readonly WorldSetKey[]): AppConfig {
  return { ...config, server: { ...config.server, setKeys: [...setKeys] } };
}

/** Раздел «Мир»: серверные читы -setkey, быстрые пресеты и аргументы запуска. */
export function AdminWorldTab() {
  const store = useServer();
  const navigate = useNavigate();
  const { data, pending } = store;
  const config = data.config;

  const [selectedKeys, setSelectedKeys] = useState<WorldSetKey[]>(() =>
    config ? sortSetKeys(config.server.setKeys) : [],
  );
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const phase = data.serverState?.phase ?? null;
  const running = phase === 'running';
  const { loading, failed, retry } = useAdminDataTimeout(config !== null, store.refreshAll);

  const savedKeys = config ? sortSetKeys(config.server.setKeys) : [];
  const dirty = selectedKeys.join(',') !== savedKeys.join(',');

  const tentativeConfig = useMemo(
    () => (config ? buildTentativeConfig(config, selectedKeys) : null),
    [config, selectedKeys],
  );

  const commandLines = useMemo(() => {
    if (!tentativeConfig) {
      return { runtime: '', preview: '' };
    }

    const logFile = data.paths ? buildServerLogFilePath(data.paths.logsDir) : null;
    const saveDir = data.paths?.saveDir ?? tentativeConfig.installDir;
    const args = buildServerArgs(tentativeConfig, { saveDir }, logFile);
    const maskedArgs = maskServerArgs(args, tentativeConfig.server.password);
    const executable =
      data.installStatus?.serverExePath ?? `${tentativeConfig.installDir}\\valheim_server.exe`;

    return {
      // Полная строка — для кнопки «Копировать»; в UI-предпросмотре пароль скрыт.
      runtime: formatCommandLine(executable, args),
      preview: formatCommandLine(executable, maskedArgs),
    };
  }, [data.installStatus?.serverExePath, data.paths, tentativeConfig]);
  const { runtime: commandLine, preview: previewCommandLine } = commandLines;

  if (!config) {
    if (store.status === 'error' || failed) {
      return (
        <AdminLoadError
          title="Конфигурация не загрузилась"
          onRetry={() => {
            retry();
            void store.refreshAll();
          }}
          retrying={store.status === 'loading'}
        />
      );
    }

    if (loading) {
      return (
        <div data-testid="admin-world-loading" className="h-full space-y-3 overflow-y-auto p-5">
          <Skeleton className="h-10 w-64 rounded-md" />
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      );
    }

    return (
      <AdminLoadError
        title="Конфигурация ещё не пришла"
        onRetry={() => {
          retry();
          void store.refreshAll();
        }}
      />
    );
  }

  const saveOnly = async (): Promise<boolean> => {
    const saved = await store.saveConfig(buildTentativeConfig(config, selectedKeys));

    if (saved) {
      setSelectedKeys(sortSetKeys(selectedKeys));
    }

    return saved;
  };

  const applyPreset = async (preset: WorldPreset) => {
    await store.saveConfig({
      ...config,
      server: { ...config.server, preset },
    });
  };

  const applyModifiers = async (overrides: Partial<WorldModifiers>) => {
    await store.saveConfig({
      ...config,
      server: {
        ...config.server,
        preset: 'custom',
        modifiers: { ...config.server.modifiers, ...overrides },
      },
    });
  };

  const saveAndRestart = async () => {
    setRestarting(true);
    const saved = await store.saveConfig(buildTentativeConfig(config, selectedKeys));

    if (saved) {
      const stopped = await store.stopServer(false);

      if (stopped) {
        await store.startServer();
      }
    }

    setRestarting(false);
    setRestartDialogOpen(false);
  };

  const busy = restarting || pending['save-config'] || pending.stop || pending.start;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Globe2 className="size-4 text-primary" aria-hidden="true" />
              Читы мира и сложность
            </p>
            <p className="text-[11px] leading-4 text-muted-foreground">
              Флаги <span className="font-mono">-setkey</span> и пресеты передаются серверу при
              запуске — применяются после перезапуска. Мир запоминает часть правил.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip tone={dirty ? 'warning' : 'neutral'}>
              {dirty ? 'есть несохранённые изменения' : 'сохранено'}
            </StatusChip>
            {dirty && <Badge variant="warning">применится после перезапуска</Badge>}
            <Badge variant="outline">пресет: {PRESET_LABELS[config.server.preset]}</Badge>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-2 pt-4">
              <p className="text-xs font-semibold text-foreground">
                Читы мира (<span className="font-mono">-setkey</span>)
              </p>
              {WORLD_SET_KEY_DEFINITIONS.map((definition) => {
                const enabled = selectedKeys.includes(definition.key);

                return (
                  <div
                    key={definition.key}
                    className={cn(
                      'flex items-start justify-between gap-3 rounded-lg border px-2.5 py-2 transition-colors',
                      enabled ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-muted/20',
                    )}
                  >
                    <div className="space-y-0.5">
                      <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-foreground">
                        {definition.label}
                        <code className="rounded bg-background/70 px-1 font-mono text-[10px] text-muted-foreground">
                          -setkey {definition.key}
                        </code>
                      </p>
                      <p className="text-[10px] leading-4 text-muted-foreground">
                        {definition.effect}
                      </p>
                      {definition.warning && (
                        <p className="text-[10px] leading-4 text-warning">{definition.warning}</p>
                      )}
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={() => {
                        setSelectedKeys((current) => toggleSetKey(current, definition.key));
                      }}
                      aria-label={`Включить ${definition.label}`}
                      className="mt-0.5 shrink-0"
                    />
                  </div>
                );
              })}

              <div className="rounded-lg border border-border/70 bg-background/50 px-2.5 py-1.5">
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Аргументы
                </p>
                <p className="mt-0.5 font-mono text-[10px] break-all text-foreground/90">
                  {selectedKeys.length > 0
                    ? selectedKeys.map((key) => `-setkey ${key}`).join(' ')
                    : '— ключи не выбраны'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">Быстрые пресеты</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={() => {
                    navigate('world');
                  }}
                >
                  Все модификаторы
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {QUICK_PRESETS.map((quickPreset) => {
                  const active = config.server.preset === quickPreset.preset;

                  return (
                    <button
                      key={quickPreset.preset}
                      type="button"
                      disabled={pending['save-config']}
                      onClick={() => {
                        void applyPreset(quickPreset.preset);
                      }}
                      className={cn(
                        'rounded-lg border px-2.5 py-2 text-left transition-colors outline-none',
                        'focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
                        active
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-border/60 bg-card/50 hover:bg-accent/40',
                      )}
                    >
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                        {quickPreset.label}
                        {active && <Badge variant="success">активен</Badge>}
                      </p>
                      <p className="text-[10px] leading-4 text-muted-foreground">
                        {quickPreset.description}
                      </p>
                      <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                        -preset {quickPreset.preset}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] font-semibold text-foreground">Быстрые модификаторы</p>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {QUICK_MODIFIERS.map((modifier) => (
                  <button
                    key={modifier.label}
                    type="button"
                    disabled={pending['save-config']}
                    onClick={() => {
                      void applyModifiers(modifier.overrides);
                    }}
                    className={cn(
                      'rounded-lg border border-border/60 bg-card/50 px-2 py-1.5 text-left transition-colors outline-none',
                      'hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
                    )}
                  >
                    <p className="text-[11px] font-medium text-foreground">{modifier.label}</p>
                    <p className="text-[10px] leading-4 text-muted-foreground">
                      {modifier.description}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">
                Пресет перезатирает модификаторы, поэтому передаётся раньше них. Выбор модификатора
                переключает мир в режим «Свои настройки». Тонкая настройка — на странице «Мир».
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="space-y-2 pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Terminal className="size-3.5 text-primary" aria-hidden="true" />
                Предпросмотр аргументов запуска
              </p>
              <CopyAction
                value={commandLine}
                title="Командная строка скопирована"
                label="Копировать командную строку запуска"
              />
            </div>
            <pre
              data-testid="admin-world-preview"
              className="max-h-32 overflow-auto rounded-lg border border-border/70 bg-muted/30 p-2.5 font-mono text-[10px] leading-4 break-all whitespace-pre-wrap text-foreground/90"
            >
              {previewCommandLine || '—'}
            </pre>
            <p className="text-[10px] leading-4 text-muted-foreground">
              Пароль в предпросмотре скрыт маской; кнопка «Копировать» копирует полную строку. Дата
              в имени лог-файла подставляется текущая, <span className="font-mono">-savedir</span> и{' '}
              <span className="font-mono">-logfile</span> подставляет ядро, порядок аргументов
              фиксирован.
            </p>
          </CardContent>
        </Card>

        {running && (
          <Notice tone="warning" title="Сервер работает">
            Новые ключи и пресеты применятся только после перезапуска. Кнопка «Сохранить и
            перезапустить» сделает автобэкап (если включён), корректно остановит и запустит сервер.
          </Notice>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!dirty || busy}
              onClick={() => {
                void saveOnly();
              }}
            >
              {pending['save-config'] ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-3.5" aria-hidden="true" />
              )}
              Сохранить
            </Button>
            {running ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setRestartDialogOpen(true);
                }}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
                Сохранить и перезапустить
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!dirty || busy}
                title="Сервер остановлен — сохранение применится при следующем запуске"
                onClick={() => {
                  void saveOnly();
                }}
              >
                <Rocket className="size-3.5" aria-hidden="true" />
                Сохранить к следующему запуску
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-[11px]"
            onClick={() => {
              navigate('world');
            }}
          >
            <ArrowRight className="size-3" aria-hidden="true" />
            Открыть полную страницу «Мир»
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-[11px]"
            onClick={() => {
              navigate('network');
            }}
          >
            <ArrowRight className="size-3" aria-hidden="true" />
            Проверить сеть
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={restartDialogOpen}
        title="Сохранить и перезапустить сервер?"
        description="Игроки будут отключены на время перезапуска (обычно 10–20 секунд)."
        confirmLabel="Сохранить и перезапустить"
        tone="danger"
        pending={restarting}
        onConfirm={() => {
          void saveAndRestart();
        }}
        onCancel={() => {
          setRestartDialogOpen(false);
        }}
      >
        <div className="space-y-2">
          <Notice tone="warning">
            Перед остановкой сервер сохранит мир; при включённом автобэкапе будет создана резервная
            копия. Новые читы мира вступят в силу сразу после старта.
          </Notice>
          <p className="text-[11px] text-muted-foreground">
            Изменения: {selectedKeys.length > 0 ? selectedKeys.join(', ') : 'ключи не выбраны'}
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
