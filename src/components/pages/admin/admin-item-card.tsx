import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  ADMIN_ITEM_CATEGORY_LABELS,
  buildSpawnCommand,
  type AdminCreature,
  type AdminItem,
} from '@/lib/admin-items';
import { CopyGlyph, useCopyAction } from '@/components/pages/admin/admin-shared';

export interface AdminItemCardProps {
  item: AdminItem;
  amount: number;
  className?: string;
}

/** Карточка предмета с командой `spawn`. */
export function AdminItemCard({ item, amount, className }: AdminItemCardProps) {
  const copy = useCopyAction();
  const command = buildSpawnCommand(item.prefab, amount);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2',
        className,
      )}
      title={item.note ?? item.nameEn}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{item.name}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {item.prefab}
          {item.category ? ` · ${ADMIN_ITEM_CATEGORY_LABELS[item.category]}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <code className="hidden font-mono text-[10px] text-muted-foreground lg:block">
          {command}
        </code>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Копировать команду spawn для ${item.name}`}
          title={`Скопировать: ${command}`}
          className="size-7"
          onClick={() => {
            void copy(command, `Команда скопирована: ${item.name}`);
          }}
        >
          <CopyGlyph />
        </Button>
      </div>
    </div>
  );
}

export interface AdminCreatureCardProps {
  creature: AdminCreature;
  amount: number;
  className?: string;
}

/** Карточка существа с командой `spawn`. */
export function AdminCreatureCard({ creature, amount, className }: AdminCreatureCardProps) {
  const copy = useCopyAction();
  const command = buildSpawnCommand(creature.prefab, amount);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2',
        className,
      )}
      title={creature.note ?? creature.nameEn}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{creature.name}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">{creature.prefab}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <code className="hidden font-mono text-[10px] text-muted-foreground lg:block">
          {command}
        </code>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Копировать команду spawn для ${creature.name}`}
          title={`Скопировать: ${command}`}
          className="size-7"
          onClick={() => {
            void copy(command, `Команда скопирована: ${creature.name}`);
          }}
        >
          <CopyGlyph />
        </Button>
      </div>
    </div>
  );
}

/** Заголовок панели внутри таба. */
export function AdminPanelTitle({
  icon,
  title,
  description,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-2', className)}>
      {icon && <span className="mt-0.5 shrink-0 text-primary">{icon}</span>}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-[11px] leading-4 text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
