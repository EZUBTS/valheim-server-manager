import { ChevronDown, FileText, HelpCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { CopyAction } from '@/components/pages/admin/admin-shared';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface FaqItem {
  id: string;
  question: string;
  answer: ReactNode;
}

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: 'become-admin',
    question: 'Как стать админом сервера?',
    answer: (
      <>
        <p>
          Добавьте свой ID в <span className="font-mono">adminlist.txt</span>: раздел «Игроки» → «В
          adminlist» или введите ID вручную. Формат Valheim 1.0:{' '}
          <span className="font-mono">V_&lt;SteamID64&gt;</span> для Steam и{' '}
          <span className="font-mono">X_&lt;ID&gt;</span> для Xbox/Game Pass; «голый» SteamID64 тоже
          принимается.
        </p>
        <p>
          Списки читаются только при старте сервера — после изменения нужен{' '}
          <span className="font-medium text-foreground">перезапуск</span>. Менеджер показывает
          предупреждение об этом.
        </p>
      </>
    ),
  },
  {
    id: 'why-cheats',
    question: 'Почему читы не работают без мода?',
    answer: (
      <>
        <p>
          Vanilla выделенный сервер Iron Gate отклоняет{' '}
          <span className="font-mono">devcommands</span> и все читы (
          <span className="font-mono">god</span>, <span className="font-mono">fly</span>,{' '}
          <span className="font-mono">spawn</span>, <span className="font-mono">itemset</span>) даже
          для админа. Это ограничение игры, а не менеджера.
        </p>
        <p>
          Читы включают серверные моды BepInEx + Server Devcommands (раздел «Моды»). Модерация{' '}
          <span className="font-mono">kick/ban/unban/save</span> работает без модов — в игре от
          админа через F5.
        </p>
        <p>
          Без модов на сервере доступны только world-модификаторы:{' '}
          <span className="font-mono">-preset casual</span>,{' '}
          <span className="font-mono">-modifier combat veryeasy</span>,{' '}
          <span className="font-mono">-setkey passivemobs/nobuildcost</span> (раздел «Мир»).
        </p>
      </>
    ),
  },
  {
    id: 'find-id',
    question: 'Как узнать свой SteamID64 / platform ID?',
    answer: (
      <ol>
        <li>
          В игре нажмите <span className="font-mono">F2</span> — в панели игрока виден ID (SteamID64
          / platform ID).
        </li>
        <li>
          Подключитесь к серверу и откройте раздел «Игроки» — менеджер парсит строки подключения из
          лога.
        </li>
        <li>
          В логе смотрите строки{' '}
          <span className="font-mono">Got connection SteamID &lt;id&gt;</span> и{' '}
          <span className="font-mono">PlayFab socket … Platform ID</span>.
        </li>
      </ol>
    ),
  },
  {
    id: 'achievements',
    question: 'Что с достижениями после включения читов?',
    answer: (
      <>
        <p>
          В 1.0 включение читов помечает персонажа/мир как «читерский» и блокирует достижения Iron
          Gate. Часть world-модификаторов и <span className="font-mono">-setkey</span> тоже может
          влиять на достижения.
        </p>
        <p>
          Вернуть достижения можно командой{' '}
          <span className="font-mono">yesiuseddevcommandsbutiwantmyachievementsanyway 1</span>{' '}
          (появилась в хотфиксе 1.0.12).
        </p>
      </>
    ),
  },
  {
    id: 'give-items',
    question: 'Как выдать предметы и готовые наборы?',
    answer: (
      <>
        <p>
          Предмет/существо: <span className="font-mono">spawn &lt;prefab&gt; &lt;amount&gt;</span>{' '}
          (в разделе «Предметы» у каждой карточки есть кнопка копирования). Готовый набор:{' '}
          <span className="font-mono">itemset &lt;name&gt; &lt;level&gt; [keep]</span> — качество
          задаётся уровнем 1–5, <span className="font-mono">keep</span> оставляет надетые вещи.
        </p>
        <p>
          Команды читерские: работают в одиночной игре после{' '}
          <span className="font-mono">devcommands</span> или на сервере с Server Devcommands.
          Предметы создаются у вашего персонажа.
        </p>
      </>
    ),
  },
  {
    id: 'rcon',
    question: 'Можно ли администрировать сервер удалённо (RCON)?',
    answer: (
      <>
        <p>
          Vanilla-сервер не читает stdin и не имеет RCON, поэтому менеджер не может отправлять
          команды удалённо. Всё, что можно делать из приложения: файлы списков, аргументы запуска,
          рестарт, бэкапы, логи, корректная остановка.
        </p>
        <p>
          Удалённое выполнение команд требует сторонних модов: RCON-Next (ferrinius) + мост команд,
          ValheimRcon, ConsoleStdinHeeler. Их интеграции в v1 нет — используйте на свой риск,
          RCON-порт нельзя выставлять в интернет без пароля/фаервола.
        </p>
      </>
    ),
  },
  {
    id: 'player-limit',
    question: 'Сколько игроков поддерживает сервер?',
    answer: (
      <p>
        Лимит Valheim — <span className="font-medium text-foreground">10 игроков</span>. Аргумента
        для его изменения не существует; сервер не принимает больше 10 подключений.
        Кросссплей-игроки учитываются в том же лимите.
      </p>
    ),
  },
  {
    id: 'world-modifiers',
    question: 'Как изменить сложность мира и читы мира?',
    answer: (
      <>
        <p>
          Раздел «Мир»: 4 флага <span className="font-mono">-setkey</span> (nobuildcost,
          playerevents, passivemobs, nomap), быстрые пресеты (Casual, Hammer, Hard, Normal) и
          предпросмотр аргументов. Тонкая настройка — на одноимённой странице «Мир».
        </p>
        <p>
          Флаги применяются при старте сервера. Часть правил мир запоминает — для сброса используйте{' '}
          <span className="font-mono">-preset normal</span>.
        </p>
      </>
    ),
  },
];

const DOC_LINKS: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'Справочник по админке (канонический)', path: 'docs/ADMIN-REFERENCE.md' },
  { label: 'Данные каталога предметов/команд', path: 'docs/admin-items.json' },
];

/** Раздел «Справка»: сворачиваемый FAQ и ссылки на документацию. */
export function AdminHelpTab() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <HelpCircle className="size-4 text-primary" aria-hidden="true" />
            Справка по администрированию
          </p>
          <p className="text-[11px] text-muted-foreground">
            Короткие ответы на частые вопросы. Разделы раскрываются по клику.
          </p>
        </div>

        <div className="space-y-2">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.id}
              className="group rounded-lg border border-border/70 bg-card/50 open:bg-card/70"
            >
              <summary
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium text-foreground',
                  'list-none outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring/50',
                  '[&::-webkit-details-marker]:hidden',
                )}
              >
                {item.question}
                <ChevronDown
                  className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="space-y-2 px-3 pb-3 text-[11px] leading-5 text-muted-foreground">
                {item.answer}
              </div>
            </details>
          ))}
        </div>

        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <FileText className="size-3.5 text-primary" aria-hidden="true" />
              Документация проекта
            </p>
            <p className="text-[11px] leading-4 text-muted-foreground">
              Материалы лежат в репозитории и доступны разработчикам; приложение их не открывает.
            </p>
            {DOC_LINKS.map((link) => (
              <div
                key={link.path}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/50 px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-foreground">{link.label}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {link.path}
                  </p>
                </div>
                <CopyAction
                  value={link.path}
                  title="Путь скопирован"
                  label={`Копировать путь ${link.path}`}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
