import {
  Globe2,
  HelpCircle,
  LayoutDashboard,
  Package,
  Puzzle,
  RefreshCw,
  Terminal,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import type { KnownPlayer } from '@/lib/types';
import type { BadgeVariant } from '@/components/ui/badge';

/** Разделы страницы «Админ». */
export type AdminTabId = 'overview' | 'players' | 'commands' | 'items' | 'world' | 'mods' | 'help';

export interface AdminTabMeta {
  id: AdminTabId;
  label: string;
  icon: LucideIcon;
  /** Короткое описание раздела (для aria и пустых состояний). */
  hint: string;
}

export const ADMIN_TABS: readonly AdminTabMeta[] = [
  {
    id: 'overview',
    label: 'Обзор',
    icon: LayoutDashboard,
    hint: 'Статус, чек-лист и быстрые действия',
  },
  { id: 'players', label: 'Игроки', icon: Users, hint: 'Известные игроки и adminlist' },
  { id: 'commands', label: 'Читы', icon: Terminal, hint: 'Команды F5-консоли и модов' },
  { id: 'items', label: 'Предметы', icon: Package, hint: 'Выдача предметов и существ' },
  { id: 'world', label: 'Мир', icon: Globe2, hint: 'Читы мира и пресеты сложности' },
  { id: 'mods', label: 'Моды', icon: Puzzle, hint: 'BepInEx и Server Devcommands' },
  { id: 'help', label: 'Справка', icon: HelpCircle, hint: 'FAQ по администрированию' },
];

export function isAdminTabId(value: string): value is AdminTabId {
  return ADMIN_TABS.some((tab) => tab.id === value);
}

/** Быстрое копирование с тостом в общий стек уведомлений. */
export function useCopyAction(): (value: string, title: string) => Promise<void> {
  const { notify } = useServer();

  return useCallback(
    async (value: string, title: string): Promise<void> => {
      try {
        await navigator.clipboard?.writeText(value);
        notify({
          tone: 'success',
          title,
          description: value.length > 100 ? `${value.slice(0, 100)}…` : value,
        });
      } catch {
        notify({
          tone: 'error',
          title: 'Не удалось скопировать',
          description: 'Буфер обмена недоступен в этом окне.',
        });
      }
    },
    [notify],
  );
}

/** Иконка копирования (лёгкая SVG, чтобы не тянуть лишние компоненты). */
export function CopyGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export interface CopyActionProps {
  value: string;
  title: string;
  label: string;
  text?: string;
  variant?: 'ghost' | 'outline' | 'secondary';
  className?: string;
}

/** Кнопка копирования в буфер с уведомлением. */
export function CopyAction({
  value,
  title,
  label,
  text,
  variant = 'ghost',
  className,
}: CopyActionProps) {
  const copy = useCopyAction();

  return (
    <Button
      variant={variant}
      size="sm"
      aria-label={label}
      title={label}
      className={cn(text ? undefined : 'size-7 p-0', className)}
      onClick={() => {
        void copy(value, title);
      }}
    >
      {text}
      <CopyGlyph />
    </Button>
  );
}

export type StatusChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

const STATUS_CHIP_TONES: Record<StatusChipTone, string> = {
  neutral: 'border-border/70 bg-muted/40 text-muted-foreground',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/35 bg-warning/10 text-warning',
  danger: 'border-destructive/35 bg-destructive/10 text-destructive',
  primary: 'border-primary/30 bg-primary/10 text-primary',
};

export interface StatusChipProps {
  tone?: StatusChipTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  title?: string;
  className?: string;
}

/** Компактный чип статуса для закреплённой шапки. */
export function StatusChip({
  tone = 'neutral',
  icon,
  children,
  title,
  className,
}: StatusChipProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium',
        STATUS_CHIP_TONES[tone],
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Полное имя игрока для интерфейса. */
export function getPlayerDisplayName(player: KnownPlayer): string {
  return player.name ?? player.steamId64 ?? player.platformId ?? 'Без имени';
}

/** SteamID/платформенный ID, который можно записать в adminlist. */
export function getAdminTarget(player: KnownPlayer): string | null {
  if (player.steamId64) {
    return `V_${player.steamId64}`;
  }

  if (player.platformId && /^[A-Za-z]_[\w.-]+$/.test(player.platformId)) {
    return player.platformId;
  }

  return null;
}

/** ID игрока, по которому удобно банить/кикать. */
export function getPlayerReference(player: KnownPlayer): string {
  return player.name ?? player.steamId64 ?? player.platformId ?? '';
}

/** ID для отображения в таблице (SteamID64 в приоритете). */
export function getDisplayId(player: KnownPlayer): string {
  return player.steamId64 ?? player.platformId ?? '—';
}

export const SOURCE_BADGES: Record<
  KnownPlayer['source'],
  { label: string; variant: BadgeVariant }
> = {
  live: { label: 'в игре', variant: 'success' },
  history: { label: 'из логов', variant: 'outline' },
  list: { label: 'из списков', variant: 'neutral' },
};

export interface AdminLoadErrorProps {
  title?: string;
  description?: string;
  onRetry: () => void;
  retrying?: boolean;
}

/** Заглушка таба, когда данные не пришли (ошибка/таймаут) — с кнопкой повтора. */
export function AdminLoadError({
  title = 'Данные не загрузились',
  description = 'Ядро не ответило вовремя. Проверьте, что приложение запущено, и повторите запрос.',
  onRetry,
  retrying = false,
}: AdminLoadErrorProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="inline-flex size-9 items-center justify-center rounded-full bg-warning/10 text-warning">
        <TriangleAlert className="size-4" aria-hidden="true" />
      </span>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-[11px] leading-4 text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Обновить данные
      </Button>
    </div>
  );
}
