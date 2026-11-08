import { Terminal } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { getAdminCommandBadges, type AdminCommand, type AdminCombo } from '@/lib/admin-commands';
import { CopyGlyph, useCopyAction } from '@/components/pages/admin/admin-shared';

export interface CommandCardProps {
  command: AdminCommand;
  /** Компактная карточка для обзорного раздела. */
  compact?: boolean;
}

/** Карточка одной консольной команды с копированием примера. */
export function CommandCard({ command, compact = false }: CommandCardProps) {
  const copy = useCopyAction();
  const copyValue = command.example;

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        command.source === 'mod' ? 'border-primary/25 bg-primary/5' : 'border-border/70 bg-card/60',
        compact && 'gap-1.5 p-2.5',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{command.name}</p>
          <code className="mt-0.5 block font-mono text-[11px] break-all text-primary">
            {command.syntax}
          </code>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Копировать команду ${command.name}`}
          title={`Копировать: ${copyValue}`}
          className="size-7 shrink-0"
          onClick={() => {
            void copy(copyValue, `Команда скопирована: ${command.name}`);
          }}
        >
          <CopyGlyph />
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">{command.description}</p>
      {!compact && command.note && (
        <p className="text-[10px] leading-4 text-muted-foreground/80">ℹ {command.note}</p>
      )}
      <div className="mt-auto flex flex-wrap gap-1">
        {getAdminCommandBadges(command).map((badge) => (
          <Badge
            key={badge}
            variant={
              badge === 'требует devcommands'
                ? 'warning'
                : badge === 'только с модом'
                  ? 'primary'
                  : badge === 'на выделенном сервере'
                    ? 'success'
                    : 'neutral'
            }
          >
            {badge}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export interface ComboCardProps {
  combo: AdminCombo;
  compact?: boolean;
}

/** Готовый набор команд, копируемый одной кнопкой. */
export function ComboCard({ combo, compact = false }: ComboCardProps) {
  const copy = useCopyAction();

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3',
        compact && 'gap-1.5 p-2.5',
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Terminal className="size-3 text-primary" aria-hidden="true" />
        {combo.name}
      </p>
      <p className="text-[11px] leading-4 text-muted-foreground">{combo.description}</p>
      <code className="block rounded bg-background/60 px-2 py-1.5 font-mono text-[10px] leading-4 break-all whitespace-pre-wrap text-foreground/90">
        {combo.commands.join('\n')}
      </code>
      <div className="mt-auto">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 w-full px-2 text-[11px]"
          onClick={() => {
            void copy(combo.commands.join('\n'), `Набор скопирован: ${combo.name}`);
          }}
        >
          <CopyGlyph />
          Копировать набор
        </Button>
      </div>
    </div>
  );
}
