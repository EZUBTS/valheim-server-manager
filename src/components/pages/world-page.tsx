import { Eye, EyeOff, Globe2, Loader2, RefreshCw, Save, Search, Undo2 } from 'lucide-react';
import { useState } from 'react';

import { PageContent, PageHeader } from '@/components/layout/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import { formatBytes, formatDateTime, formatRelativeTime } from '@/lib/format';
import { PAGE_META } from '@/lib/pages';
import { MODIFIER_DEFINITIONS, PRESET_OPTIONS, withModifier } from '@/lib/presets';
import type { AppConfig, ServerSettings, WorldPreset } from '@/lib/types';
import {
  getServerWarnings,
  hasErrors,
  validateServerSettings,
  type ServerSettingsErrors,
} from '@/lib/validation';

function parseExtraArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** World, difficulty and network visibility configuration form. */
export function WorldPage() {
  const config = useServer().data.config;

  if (!config) {
    return (
      <PageContent>
        <PageHeader title={PAGE_META.world.label} description={PAGE_META.world.description} />
        <Notice tone="info">Загружаем конфигурацию сервера…</Notice>
      </PageContent>
    );
  }

  // The form is keyed by the saved settings: after a successful save (or a
  // config reset) it remounts with fresh values, so no effect-based syncing.
  return <WorldForm key={JSON.stringify(config.server)} config={config} />;
}

function WorldForm({ config }: { config: AppConfig }) {
  const store = useServer();
  const { data, pending } = store;

  const [form, setForm] = useState<ServerSettings>(config.server);
  const [errors, setErrors] = useState<ServerSettingsErrors>({});
  const [portText, setPortText] = useState(String(config.server.port));
  const [saveIntervalText, setSaveIntervalText] = useState(
    config.server.saveIntervalSec === null ? '' : String(config.server.saveIntervalSec),
  );
  const [extraArgsText, setExtraArgsText] = useState(config.server.extraArgs.join('\n'));
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [portCheckPending, setPortCheckPending] = useState(false);
  const [portCheckResult, setPortCheckResult] = useState<boolean | null>(null);

  const extraArgs = parseExtraArgs(extraArgsText);
  const parsedPort = Number.parseInt(portText, 10);
  const parsedSaveInterval =
    saveIntervalText.trim().length === 0 ? null : Number.parseInt(saveIntervalText, 10);
  const candidate: ServerSettings = {
    ...form,
    port: Number.isFinite(parsedPort) ? parsedPort : 0,
    saveIntervalSec:
      parsedSaveInterval === null || Number.isFinite(parsedSaveInterval)
        ? parsedSaveInterval
        : null,
    extraArgs,
  };
  const warnings = getServerWarnings(candidate);
  const dirty =
    JSON.stringify(candidate) !== JSON.stringify(config.server) ||
    portText !== String(config.server.port) ||
    saveIntervalText !==
      (config.server.saveIntervalSec === null ? '' : String(config.server.saveIntervalSec)) ||
    extraArgsText !== config.server.extraArgs.join('\n');
  const presetInfo = PRESET_OPTIONS.find((option) => option.value === form.preset);
  const worldExists = data.worlds.some((world) => world.name === form.world.trim());

  const update = <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors({});
    setPortCheckResult(null);
  };

  const handleSubmit = async () => {
    const nextErrors = validateServerSettings(candidate);
    setErrors(nextErrors);

    if (hasErrors(nextErrors)) {
      store.notify({
        tone: 'warning',
        title: 'Проверьте параметры',
        description: 'Некоторые поля заполнены некорректно.',
      });
      return;
    }

    await store.saveConfig({ ...config, server: candidate });
  };

  const handleReset = () => {
    setForm(config.server);
    setPortText(String(config.server.port));
    setSaveIntervalText(
      config.server.saveIntervalSec === null ? '' : String(config.server.saveIntervalSec),
    );
    setExtraArgsText(config.server.extraArgs.join('\n'));
    setErrors({});
    setPortCheckResult(null);
  };

  const checkPort = async () => {
    if (!Number.isFinite(parsedPort)) {
      return;
    }

    setPortCheckPending(true);
    const available = await store.checkPortAvailable(parsedPort);
    setPortCheckPending(false);
    setPortCheckResult(available);
  };

  return (
    <PageContent>
      <PageHeader
        title={PAGE_META.world.label}
        description={PAGE_META.world.description}
        badge={
          <Badge variant="outline">
            {PRESET_OPTIONS.find((option) => option.value === form.preset)?.label ?? '—'}
          </Badge>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!dirty || pending['save-config']}
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              Сбросить изменения
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={pending['save-config']}
            >
              {pending['save-config'] ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Сохранить
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <form
          className="space-y-4 lg:col-span-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Основные параметры</CardTitle>
              <CardDescription>
                Значения передаются серверу аргументами командной строки.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Имя сервера"
                htmlFor="server-name"
                required
                hint="1–53 символа"
                error={errors.name}
              >
                <Input
                  id="server-name"
                  value={form.name}
                  maxLength={53}
                  onChange={(event) => {
                    update('name', event.target.value);
                  }}
                  aria-invalid={Boolean(errors.name)}
                  placeholder="Дружина Одина"
                />
              </Field>

              <Field
                label="Имя мира"
                htmlFor="world-name"
                required
                hint="латиница, 1–20 символов"
                error={errors.world}
              >
                <Input
                  id="world-name"
                  value={form.world}
                  maxLength={20}
                  onChange={(event) => {
                    update('world', event.target.value);
                  }}
                  aria-invalid={Boolean(errors.world)}
                  placeholder="Midgard"
                  className="font-mono"
                />
              </Field>

              <div className="sm:col-span-2">
                <Notice tone={worldExists ? 'info' : 'warning'}>
                  {worldExists
                    ? 'Мир найден в worlds_local — сервер загрузит существующий мир.'
                    : 'Если мира с таким именем нет, сервер создаст его с нуля при первом запуске. Прогресс существующего мира не пострадает.'}
                </Notice>
              </div>

              <Field
                label="Пароль"
                htmlFor="server-password"
                required
                hint="5–20 символов"
                error={errors.password}
              >
                <div className="relative">
                  <Input
                    id="server-password"
                    type={passwordVisible ? 'text' : 'password'}
                    value={form.password}
                    maxLength={20}
                    onChange={(event) => {
                      update('password', event.target.value);
                    }}
                    aria-invalid={Boolean(errors.password)}
                    className="pr-9 font-mono"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    aria-label={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                    onClick={() => {
                      setPasswordVisible((current) => !current);
                    }}
                    className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    {passwordVisible ? (
                      <EyeOff className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </Field>

              <Field
                label="Порт"
                htmlFor="server-port"
                required
                hint="UDP 1024–65535"
                error={errors.port}
              >
                <div className="flex gap-2">
                  <Input
                    id="server-port"
                    type="number"
                    min={1024}
                    max={65535}
                    value={portText}
                    onChange={(event) => {
                      setPortText(event.target.value);
                      setErrors({});
                      setPortCheckResult(null);
                    }}
                    aria-invalid={Boolean(errors.port)}
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    size="md"
                    className="shrink-0"
                    onClick={() => {
                      void checkPort();
                    }}
                    disabled={portCheckPending}
                  >
                    {portCheckPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Search className="size-4" aria-hidden="true" />
                    )}
                    Проверить
                  </Button>
                </div>
              </Field>

              {portCheckResult !== null && (
                <div className="sm:col-span-2">
                  <Notice tone={portCheckResult ? 'success' : 'danger'}>
                    {portCheckResult
                      ? `Порт ${parsedPort} свободен. Также понадобятся UDP ${parsedPort + 1} и ${parsedPort + 2}.`
                      : `Порт ${parsedPort} занят другой программой. Выберите другой порт.`}
                  </Notice>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Доступ и видимость</CardTitle>
              <CardDescription>Публикация в Steam и кроссплатформенная игра.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="space-y-0.5">
                  <span className="block text-xs font-medium text-foreground">
                    Публичный сервер
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Виден в списке серверов Steam. Если выключено — только подключение по IP или
                    коду приглашения.
                  </span>
                </span>
                <Switch
                  checked={form.isPublic}
                  onCheckedChange={(checked) => {
                    update('isPublic', checked);
                  }}
                  aria-label="Публичный сервер"
                  className="mt-0.5"
                />
              </div>

              <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="space-y-0.5">
                  <span className="block text-xs font-medium text-foreground">Crossplay</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Игроки с Xbox/Game Pass и других платформ. Трафик идёт через PlayFab, проброс
                    портов не нужен, но подключение по локальному IP не работает.
                  </span>
                </span>
                <Switch
                  checked={form.crossplay}
                  onCheckedChange={(checked) => {
                    update('crossplay', checked);
                  }}
                  aria-label="Кроссплатформенная игра"
                  className="mt-0.5"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Сложность и сохранения</CardTitle>
              <CardDescription>
                Пресет мира, модификаторы и интервал автосохранения.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Пресет мира" htmlFor="world-preset">
                <Select
                  id="world-preset"
                  value={form.preset}
                  onChange={(event) => {
                    update('preset', event.target.value as WorldPreset);
                  }}
                >
                  {PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Интервал автосохранения, с"
                htmlFor="save-interval"
                hint="минимум 60, по умолчанию 300"
                error={errors.saveIntervalSec}
              >
                <Input
                  id="save-interval"
                  type="number"
                  min={60}
                  step={30}
                  value={saveIntervalText}
                  onChange={(event) => {
                    setSaveIntervalText(event.target.value);
                    setErrors({});
                  }}
                  aria-invalid={Boolean(errors.saveIntervalSec)}
                  className="font-mono"
                  placeholder="300"
                />
              </Field>

              {presetInfo && (
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground sm:col-span-2">
                  {presetInfo.description}
                </div>
              )}

              {form.preset === 'custom' && (
                <div className="space-y-3 sm:col-span-2">
                  <div className="rune-divider text-[11px] font-medium">
                    <span>Модификаторы мира</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {MODIFIER_DEFINITIONS.map((definition) => (
                      <Field
                        key={definition.key}
                        label={definition.label}
                        htmlFor={`modifier-${definition.key}`}
                        hint={definition.hint}
                      >
                        <Select
                          id={`modifier-${definition.key}`}
                          value={form.modifiers[definition.key]}
                          onChange={(event) => {
                            update(
                              'modifiers',
                              withModifier(form.modifiers, definition.key, event.target.value),
                            );
                          }}
                        >
                          {definition.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ))}
                  </div>
                </div>
              )}

              <Field
                label="Дополнительные аргументы"
                htmlFor="extra-args"
                hint="по одному на строку"
                error={errors.extraArgs}
                className="sm:col-span-2"
              >
                <Textarea
                  id="extra-args"
                  value={extraArgsText}
                  rows={3}
                  placeholder={'-setkey nobuildcost\n-instanceid valheim-1'}
                  onChange={(event) => {
                    setExtraArgsText(event.target.value);
                    setErrors({});
                  }}
                  aria-invalid={Boolean(errors.extraArgs)}
                />
              </Field>

              {warnings.length > 0 && (
                <div className="space-y-2 sm:col-span-2">
                  {warnings.map((warning) => (
                    <Notice key={warning} tone="warning">
                      {warning}
                    </Notice>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {dirty
                ? 'Есть несохранённые изменения'
                : pending['save-config']
                  ? 'Сохранение…'
                  : 'Конфигурация сохранена'}
            </p>
            <Button
              type="submit"
              disabled={!dirty || pending['save-config']}
              variant={dirty ? 'primary' : 'outline'}
            >
              {pending['save-config'] ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Сохранить конфигурацию
            </Button>
          </div>
        </form>

        <div className="space-y-4">
          <Card className="flex flex-col">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Globe2 className="size-3.5 text-primary" aria-hidden="true" />
                  Миры в worlds_local
                </CardTitle>
                <CardDescription>
                  В Valheim 1.0 мир — это каталог внутри каталога сохранений.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Обновить список миров"
                onClick={() => {
                  void store.refreshWorlds();
                }}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              {data.worlds.length === 0 ? (
                <EmptyState
                  title="Миров пока нет"
                  description="Первый мир будет создан автоматически при запуске сервера с новым именем."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Мир</TH>
                        <TH className="text-right">Размер</TH>
                        <TH>Изменён</TH>
                        <TH />
                      </TR>
                    </THead>
                    <TBody>
                      {data.worlds.map((world) => {
                        const selected = world.name === form.world.trim();

                        return (
                          <TR key={world.name}>
                            <TD>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-medium">{world.name}</span>
                                {(world.isActive || selected) && (
                                  <Badge variant={world.isActive ? 'success' : 'warning'}>
                                    {world.isActive ? 'активный' : 'выбран'}
                                  </Badge>
                                )}
                              </div>
                            </TD>
                            <TD className="text-right font-mono text-[11px] text-muted-foreground">
                              {formatBytes(world.sizeBytes)}
                            </TD>
                            <TD
                              className="text-[11px] whitespace-nowrap text-muted-foreground"
                              title={formatDateTime(world.modifiedAt)}
                            >
                              {formatRelativeTime(world.modifiedAt)}
                            </TD>
                            <TD className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={world.name === form.world.trim()}
                                onClick={() => {
                                  update('world', world.name);
                                }}
                              >
                                Выбрать
                              </Button>
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </div>
              )}
              <p className="text-[11px] leading-4 text-muted-foreground">
                Активный мир берётся из поля «Имя мира». Выбор в таблице меняет поле формы — не
                забудьте сохранить конфигурацию.
              </p>
            </CardContent>
          </Card>

          <Notice tone="info" title="Бэкапы перед изменениями">
            Перед переименованием или сменой мира создайте резервную копию: <br />
            <button
              type="button"
              className={cn('mt-1 text-primary underline-offset-2 hover:underline')}
              onClick={() => {
                void store.createBackup(null);
              }}
            >
              Создать бэкап сейчас
            </button>
          </Notice>
        </div>
      </div>
    </PageContent>
  );
}
