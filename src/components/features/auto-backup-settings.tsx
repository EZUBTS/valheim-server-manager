import { Loader2, Save } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import type { AppConfig } from '@/lib/types';
import { validateKeepBackups } from '@/lib/validation';

interface AutoBackupFormProps {
  config: AppConfig;
  className?: string | undefined;
}

/**
 * Controlled by a `key` on the saved values: when the config is saved the form
 * remounts with the persisted values, so no effect-based state syncing is
 * needed (and unsaved edits survive every unrelated re-render).
 */
function AutoBackupForm({ config, className }: AutoBackupFormProps) {
  const store = useServer();
  const { pending } = store;
  const [beforeUpdate, setBeforeUpdate] = useState(config.autoBackupBeforeUpdate);
  const [beforeStop, setBeforeStop] = useState(config.autoBackupBeforeStop);
  const [keepBackups, setKeepBackups] = useState(String(config.keepBackups));

  const keepError = validateKeepBackups(Number(keepBackups));
  const parsedKeep = Number(keepBackups);
  const dirty =
    beforeUpdate !== config.autoBackupBeforeUpdate ||
    beforeStop !== config.autoBackupBeforeStop ||
    parsedKeep !== config.keepBackups;

  const save = () => {
    if (keepError) {
      return;
    }

    void store.saveConfig({
      ...config,
      autoBackupBeforeUpdate: beforeUpdate,
      autoBackupBeforeStop: beforeStop,
      keepBackups: parsedKeep,
    });
  };

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle>Автобэкапы</CardTitle>
        <CardDescription>
          Резервные копии создаются перед обновлением и остановкой сервера, старые архивы удаляются
          по лимиту.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
            <span className="space-y-0.5">
              <span className="block text-xs font-medium text-foreground">Перед обновлением</span>
              <span className="block text-[11px] text-muted-foreground">
                Создавать копию миров перед SteamCMD-обновлением.
              </span>
            </span>
            <Switch
              checked={beforeUpdate}
              onCheckedChange={setBeforeUpdate}
              aria-label="Резервная копия перед обновлением"
              className="mt-0.5"
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
            <span className="space-y-0.5">
              <span className="block text-xs font-medium text-foreground">Перед остановкой</span>
              <span className="block text-[11px] text-muted-foreground">
                Делать копию мира перед graceful-остановкой.
              </span>
            </span>
            <Switch
              checked={beforeStop}
              onCheckedChange={setBeforeStop}
              aria-label="Резервная копия перед остановкой"
              className="mt-0.5"
            />
          </div>
        </div>

        <Field label="Хранить копий" htmlFor="keep-backups" hint="от 1 до 100" error={keepError}>
          <Input
            id="keep-backups"
            type="number"
            min={1}
            max={100}
            step={1}
            value={keepBackups}
            onChange={(event) => {
              setKeepBackups(event.target.value);
            }}
            aria-invalid={keepError !== null}
          />
        </Field>

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <p className="text-[11px] text-muted-foreground">
            {dirty ? 'Есть несохранённые изменения' : 'Настройки сохранены'}
          </p>
          <Button onClick={save} disabled={!dirty || keepError !== null || pending['save-config']}>
            {pending['save-config'] ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            Сохранить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Auto-backup switches and rotation count backed by the config file. */
export function AutoBackupSettings({ className }: { className?: string }) {
  const store = useServer();
  const config = store.data.config;

  if (!config) {
    return null;
  }

  const key = [config.autoBackupBeforeUpdate, config.autoBackupBeforeStop, config.keepBackups].join(
    ':',
  );

  return <AutoBackupForm key={key} config={config} className={className} />;
}
