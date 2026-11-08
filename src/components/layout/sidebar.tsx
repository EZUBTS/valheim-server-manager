import {
  Archive,
  Globe2,
  LayoutDashboard,
  Network,
  ScrollText,
  Server,
  Settings,
  ShieldHalf,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useNow } from '@/hooks/use-clock';
import { useServer } from '@/hooks/use-server';
import { cn } from '@/lib/cn';
import { formatDuration, formatPlayerCount } from '@/lib/format';
import { PAGE_META, PAGE_ORDER, type PageId } from '@/lib/pages';
import { SERVER_PHASE_LABELS, getPhaseTone, isServerActive } from '@/lib/status';

const PAGE_ICONS: Record<PageId, LucideIcon> = {
  dashboard: LayoutDashboard,
  server: Server,
  world: Globe2,
  players: Users,
  admin: ShieldHalf,
  backups: Archive,
  logs: ScrollText,
  network: Network,
  settings: Settings,
};

const TONE_DOT: Record<string, string> = {
  neutral: 'bg-muted-foreground/60',
  active: 'animate-pulse bg-warning',
  success: 'bg-success status-glow',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

/** Primary navigation with live counters for logs, players and backups. */
export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { data, isPreview } = useServer();
  const now = useNow(10_000);
  const serverState = data.serverState;
  const phase = serverState?.phase ?? null;
  const phaseTone = getPhaseTone(phase);
  const errorCount = data.logs.filter((line) => line.level === 'error').length;
  const onlinePlayers = isServerActive(phase) ? (serverState?.playersOnline ?? null) : null;
  const uptime =
    serverState?.phase === 'running' && serverState.startedAt !== null
      ? Math.floor((now - serverState.startedAt) / 1000)
      : null;

  const counters: Partial<Record<PageId, number | null>> = {
    players: data.players
      ? data.players.admins.length + data.players.banned.length + data.players.permitted.length
      : null,
    admin: (data.knownPlayers?.length ?? 0) > 0 ? (data.knownPlayers?.length ?? 0) : null,
    backups: data.backups.length,
    logs: errorCount > 0 ? errorCount : null,
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border/70 bg-card/45 backdrop-blur-sm">
      <div className="border-b border-border/60 px-3 py-3">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Текущий сервер
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-foreground">
          {data.config?.server.name ?? 'Не настроен'}
        </p>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[phaseTone])}
          />
          <span className="shrink-0">{phase ? SERVER_PHASE_LABELS[phase] : 'Нет данных'}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">
            {onlinePlayers !== null ? formatPlayerCount(onlinePlayers) : '— игроков'}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="truncate">
            {data.config?.server.world ?? '—'} · :{data.config?.server.port ?? '—'}
          </span>
          <span className="shrink-0 font-mono tabular-nums">
            {uptime !== null ? formatDuration(uptime, 'clock') : '—'}
          </span>
        </div>
      </div>

      <nav aria-label="Основная навигация" className="min-h-0 flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {PAGE_ORDER.map((page) => {
            const meta = PAGE_META[page];
            const Icon = PAGE_ICONS[page];
            const isActive = page === activePage;
            const counter = counters[page];

            return (
              <li key={page}>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate(page);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group flex w-full items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2 text-left text-[13px] transition-colors outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring/50',
                    isActive
                      ? 'border-primary bg-accent/80 font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground group-hover:text-foreground',
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                  {counter !== null && counter !== undefined && counter > 0 && (
                    <Badge
                      variant={page === 'logs' ? 'danger' : 'neutral'}
                      className="h-4 px-1.5 text-[10px] tabular-nums"
                    >
                      {counter}
                    </Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-border/60 px-3 py-3 text-[10px] text-muted-foreground">
        <p className="flex items-center justify-between">
          <span>Лимит игроков</span>
          <span className="font-mono text-foreground">10</span>
        </p>
        <p className="flex items-center justify-between">
          <span>Тема</span>
          <span className="text-foreground">Тёмный лес</span>
        </p>
        {isPreview && (
          <p className="rounded border border-warning/30 bg-warning/10 px-1.5 py-1 leading-4 text-warning-foreground">
            Режим предпросмотра: данные имитируются, Rust-ядро не подключено.
          </p>
        )}
      </div>
    </aside>
  );
}
