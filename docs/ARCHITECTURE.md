# Valheim Server Manager — архитектура и контракт

Документ — обязательный контракт для всех участников Agent Teams. Код пишется
строго по нему; расхождения фиксируются здесь и в `src/lib/types.ts` в первую
очередь, а уже потом в коде. Если контракт конфликтует с реальным поведением
Valheim — прав фактическая сторона, но контракт обновляется.

## 1. Что делаем

Десктоп-приложение **Valheim Server Manager** — менеджер выделенного сервера
Valheim для Windows. Проект создан из шаблона `D:\Projects\ZEAS` (Tauri 2 + Rust
+ React 19 + TS 7 + Vite 8 + Tailwind 4, кастомный титлбар) и сохраняет его
инфраструктуру качества (oxlint, Prettier, Vitest, clippy, CI).

Возможности первой версии:

1. Установка SteamCMD (скачивание и распаковка) и установка/обновление
   Valheim Dedicated Server через SteamCMD (`appid 896660`, anonymous).
2. Настройка сервера: имя, мир, порт, пароль, публичность, crossplay, пресет и
   модификаторы сложности, доп. аргументы.
3. Запуск/остановка процесса, статус с аптаймом, PID, версией, игроками.
4. Живой лог сервера и SteamCMD (кольцевой буфер + события), фильтры,
   автоскролл, поиск.
5. Списки админов/забаненных/допущенных (`adminlist.txt`, `bannedlist.txt`,
   `permittedlist.txt`).
6. Резервные копии миров (zip), восстановление, авто-бэкапы перед
   обновлением/остановкой, ротация.
7. Диагностика сети: занятость UDP 2456–2458, правила брандмауэра, локальные
   IP, подсказки; добавление правил брандмауэра.
8. Безопасная установка путей (install/steamcmd/backups), открытие каталогов,
   режим предпросмотра в браузере (без Rust).

Модов (BepInEx) в v1 нет, но код не должен мешать их добавить позже:
установка сервера — это просто SteamCMD-апдейт в `installDir`; структура
команд/конфига расширяема.

## 2. Железо и окружение

- Windows 10/11 x64; WebView2 установлен; MSVC Build Tools есть.
- Node.js 26, pnpm 12.16.1, Rust 1.99 (edition 2024, MSRV 1.85).
- Кэш сборки: `src-tauri/target` уже скопирован из ZEAS (~12 ГБ), первый
  `cargo build` не должен быть холодным. Если `cargo` предлагает почистить
  target — не соглашаться.
- Сеть для cargo/npm/SteamCMD доступна. Запускать GUI-приложение из агента не
  нужно; проверка — сборка, тесты и e2e-проверка сервера через CLI.

## 3. Идентичность приложения

| Параметр            | Значение                                        |
| ------------------- | ----------------------------------------------- |
| productName         | `Valheim Server Manager`                        |
| identifier          | `com.valheim.servermanager`                     |
| package.json name   | `valheim-server-manager`                        |
| Rust crate / lib    | `valheim-server-manager` / `valheim_server_manager_lib` |
| exe                 | `valheim-server-manager.exe`                    |
| Окно                | 1280×800, min 1024×640, frameless (как в ZEAS)  |
| Язык UI             | русский                                         |
| Язык кода/коммитов  | английский                                      |

Брендинг: тёмно-зелёный фон, золотой акцент, рунический стиль. Иконка уже
сгенерирована (`assets/app-icon.png` + `src-tauri/icons/*`, favicon в
`public/favicon.png`); менять её не нужно.

## 4. Раскладка каталогов на диске

База (`layout root`) выбирается один раз при первом запуске:

1. env `VALHEIM_SERVER_ROOT`, если задан;
2. `D:\Servers\Valheim`, если каталог существует (portable-раскладка на
   машине разработки — так требует пользователь);
3. иначе `%LOCALAPPDATA%\com.valheim.servermanager`.

Внутри базы:

```
<root>/
├─ server/            # installDir — файлы выделенного сервера
│  ├─ valheim_server.exe
│  └─ savedir/        # -savedir (менеджер ВСЕГДА передаёт его явно)
│     ├─ worlds_local/   # миры: в 1.0 — каталог на мир (_main.1.fwl2, .db2, .chunks)
│     ├─ adminlist.txt
│     ├─ bannedlist.txt
│     └─ permittedlist.txt
├─ steamcmd/          # steamcmdDir — steamcmd.exe
├─ backups/           # backupsDir — zip-архивы
└─ ...
```

> Важно (Valheim 1.0): по умолчанию сервер хранит сохранения и списки игроков в
> `%USERPROFILE%\AppData\LocalLow\IronGate\Valheim` (профиль пользователя, от
> которого запущен процесс), а не в каталоге установки. Менеджер всегда
> передаёт `-savedir <installDir>\savedir`, чтобы данные были изолированы и
> известны приложению. Списки игроков лежат в базе `savedir`, рядом с папкой
> `worlds_local` (не внутри неё).


Каталог конфигов приложения (Tauri `app_config_dir()`):
`%APPDATA%\com.valheim.servermanager\config.json`.
Каталог данных/логов (Tauri `app_local_data_dir()`):
`%LOCALAPPDATA%\com.valheim.servermanager\`,
логи приложения — в `app_log_dir()`, лог сервера — `<app_local_data_dir>/logs/server/server-<YYYYMMDD-HHMMSS>.log`.

Пути в конфиге можно менять на странице «Настройки»; `installDir`,
`steamcmdDir`, `backupsDir` — независимые. `savedir`/`worldsDir` вычисляются от
`installDir` (если в конфиге не задано иное — в v1 всегда
`<installDir>/savedir`).

## 5. Контракт IPC

### 5.1 Общие правила

- Имена команд — `snake_case`, JS вызывает по этим же именам.
- Аргументы в JS — `camelCase` (Tauri сам мапит на `snake_case` параметры).
- Результаты — JSON, поля `camelCase` (`#[serde(rename_all = "camelCase")]`).
- Ошибки — сериализованный `AppError`: `{ code, message }`.
- Все команды идемпотентны там, где это разумно; состояние читается командами
  `get_*`, изменения приходят через события.
- Фронтенд никогда не обращается к файловой системе/процессам напрямую —
  только через IPC.

### 5.2 Команды

| Команда | Аргументы | Возврат | Назначение |
| --- | --- | --- | --- |
| `app_info` | — | `AppInfo` | имя, версия, tauri, os, arch, debug |
| `get_config` | — | `AppConfig` | текущая конфигурация |
| `save_config` | `config: AppConfig` | `AppConfig` | валидирует (имя сервера 1–53 и не содержит пароль; пароль 5–20; имя мира 1–20 `^[A-Za-z0-9_-]{1,64}$`; порт 1024–65535; `saveIntervalSec` ≥60; crossplay-требования research) и сохраняет атомарно |
| `reset_config` | — | `AppConfig` | сброс к дефолтам |
| `get_paths` | — | `ResolvedPaths` | вычисленные абсолютные пути |
| `get_install_status` | — | `InstallStatus` | наличие steamcmd/сервера, размер каталога |
| `install_steamcmd` | — | `InstallProgress` | скачать `steamcmd.zip` и распаковать в `steamcmdDir`; шлёт `server-install-progress` и логи |
| `update_server` | `validate: boolean` | `InstallProgress` | `+force_install_dir <installDir> +login anonymous +app_update 896660 validate +quit`; шлёт прогресс/логи |
| `get_server_state` | — | `ServerState` | фаза, pid, uptime, версия, игроки |
| `start_server` | — | `ServerState` | валидация, проверка exe/порта, спавн, переход `starting → running` |
| `stop_server` | `force: boolean` | `ServerState` | опциональный бэкап, graceful → force kill |
| `get_logs` | `limit: number, source: LogSource \| null, sinceSeq: number \| null` | `LogLine[]` | последние строки кольцевого буфера (для first paint) |
| `clear_logs` | — | `void` | очистка буфера (файл лога не трогаем) |
| `list_worlds` | — | `WorldInfo[]` | сканирование `worldsDir` по `*.fwl` |
| `get_player_lists` | — | `PlayerLists` | чтение трёх файлов |
| `get_known_players` | — | `KnownPlayer[]` | игроки из логов/истории мира + признак админа из `adminlist.txt` (для страницы «Админ»); источники — кольцевой буфер и последний `logs_dir/server/server-*.log` (fallback после перезапуска приложения), `source = history \| live \| list`, сортировка по `lastSeenAt` desc |
| `add_player` | `list: PlayerListKind, id: string, name: string \| null` | `PlayerLists` | добавление записи; принимает `V_<SteamID64>`, `X_<ID>` (1.0) и голый SteamID64 (legacy), сохраняет как ввёл пользователь |
| `remove_player` | `list: PlayerListKind, id: string` | `PlayerLists` | удаление по id |
| `list_backups` | — | `BackupInfo[]` | zip-архивы в `backupsDir` |
| `create_backup` | `label: string \| null` | `BackupInfo` | zip миров (можно на работающем сервере) |
| `restore_backup` | `name: string, createSafetyBackup: boolean` | `void` | только при остановленном сервере |
| `delete_backup` | `name: string` | `void` | удалить архив |
| `diagnose_network` | — | `NetworkDiagnosis` | UDP-порты, firewall, IP, подсказки |
| `open_firewall_ports` | — | `NetworkDiagnosis` | добавить правила входящих UDP 2456–2458 для exe/портов (netsh); при отказе — `ELEVATION_REQUIRED` |
| `open_path` | `target: OpenTarget` | `void` | открыть каталог/файл в Explorer (включая `bepinexDir`) |
| `is_port_available` | `port: number` | `boolean` | быстрая проверка занятости UDP-порта (для формы) |
| `get_mod_status` | — | `ModStatus` | наличие BepInEx и Server Devcommands, их версии и список плагинов; только файловая система, без сети |
| `install_server_mods` | — | `ModStatus` | скачать с Thunderstore API (pinned fallback) и установить BepInExPack_Valheim в `installDir`, Server_devcommands в `BepInEx/plugins/ServerDevcommands`; прогресс через `server-install-progress`; сервер должен быть остановлен |

Команда `get_paths` возвращает `ResolvedPaths` — те же поля, что и в
`src/lib/types.ts`.

### 5.3 События (Rust → frontend)

| Событие | Payload | Когда |
| --- | --- | --- |
| `server-log` | `LogLine` | новая строка лога сервера/SteamCMD/приложения |
| `server-state` | `ServerState` | смена фазы, pid, версии, игроков |
| `server-install-progress` | `InstallProgress` | скачивание/обновление/установка |
| `server-lists-changed` | `PlayerLists` | списки игроков изменены извне (файлы поменялись) — опционально |

Подписка на фронте: `listen<LogLine>('server-log', handler)` из
`@tauri-apps/api/event`, обёртки — в `src/lib/ipc.ts`. Начальное состояние —
через `get_logs`/`get_server_state`/`get_install_status`. Порядок на маунте:
сначала подписки на события, затем `get_logs` — новые строки дедуплицируются по
`seq`, чтобы не терять/не дублировать строки между подпиской и первым запросом.

`ServerState.joinCode` — код приглашения crossplay (6 цифр), парсится из строки
лога вида `Session "…" with join code …` / `registered with join code …`; null,
если crossplay выключен или сервер ещё не зарегистрировался в PlayFab.

### 5.4 Коды ошибок

`VALIDATION`, `UNEXPECTED`, `IO`, `NOT_FOUND`, `CONFIG`, `ALREADY_RUNNING`,
`NOT_RUNNING`, `SERVER_NOT_INSTALLED`, `STEAMCMD_NOT_INSTALLED`, `PORT_IN_USE`,
`PROCESS`, `BACKUP_FAILED`, `ELEVATION_REQUIRED`, `NETWORK`, `UNSUPPORTED`.

Фронтенд показывает понятное русское сообщение и (где возможно) кнопку
исправления. `ELEVATION_REQUIRED` → подсказка «запустите приложение от имени
администратора или добавьте правило вручную».

## 6. Что должно быть в Rust-ядре (`src-tauri/src/`)

```
lib.rs                 # builder, плагины (dialog init), state init, commands, events
error.rs               # AppError + коды + Serialize + тесты
paths.rs               # layout root, ResolvedPaths, config/logs dirs (Tauri path API)
config.rs              # AppConfig/ServerSettings + defaults/validate/load/save
state.rs               # AppState { config, runtime, logs, install } + события
process/
  mod.rs
  server.rs            # spawn/stop/статус/waiter, аргументы командной строки
  steamcmd.rs          # download/install/update, парсинг прогресса
logs.rs                # кольцевой буфер, tail-таск, классификация, парсеры
players.rs             # adminlist/bannedlist/permittedlist + KnownPlayer (парсинг логов)
mods.rs                # BepInEx + Server Devcommands: детект/скачивание/установка
backups.rs             # zip/restore/prune
worlds.rs              # сканирование миров
network.rs             # netstat UDP, netsh firewall (быстро, с таймаутами), локальные IP
commands/
  mod.rs               # регистрация всех модулей
  system.rs            # app_info, get_paths, open_path
  config.rs            # get/save/reset_config
  install.rs           # get_install_status, install_steamcmd, update_server
  server.rs            # get_server_state, start_server, stop_server
  logs.rs              # get_logs, clear_logs
  worlds.rs            # list_worlds
  players.rs           # get/добавление/удаление
  admin.rs             # get_known_players (админка)
  mods.rs              # get_mod_status, install_server_mods
  backups.rs           # list/create/restore/delete
  network.rs           # diagnose_network, open_firewall_ports, is_port_available
```

Требования:

- `#![forbid(unsafe_code)]` сохраняется (шаблон); Win32 не используем.
- Все пути — через `std::path::PathBuf`, никаких `cmd /c` со склейкой строк;
  аргументы SteamCMD передаются массивом в `Command::args`.
- Процессы сервера/SteamCMD запускаются скрыто на Windows
  (`CREATE_NO_WINDOW` через `std::os::windows::process::CommandExt::creation_flags`,
  это не unsafe).
- Логи пишутся в файл и в буфер; `-logfile` применяется при запуске сервера.
- Кольцевой буфер: максимум 2000 строк; seq монотонный; из буфера отдаём
  последние `limit` (0 < limit ≤ 2000).
- Парсинг лога: версия сервера, подключение/отключение игроков, сохранение
  мира; ошибочные/предупреждающие строки классифицируются в `level`.
- Известные игроки (`get_known_players`): источник — кольцевой буфер текущей
  сессии **плюс до трёх самых свежих файлов `logs_dir/server/server-*.log`**
  (сортировка по mtime; читаются на blocking-потоке, лимит 20k строк / 5 МБ на
  файл, первые строки сохраняются ради `Player history`). Несколько файлов
  нужны, потому что самый новый по mtime лог может быть коротким тестовым
  запуском без игроков, а история — в предыдущем. Fallback на файлы нужен после
  перезапуска приложения, когда буфер пуст, а сервер ещё не запускался. Парсим
  форматы 1.0.21 (только `source = server`) — `Player history entry with index
  N: <NAME> (Steam_<SteamID64>, <HASH>)` (имя+SteamID64, `source=history`),
  `Got character ZDOID from <NAME> : <id>` (имя, `source=live`),
  `PlayFab socket with remote ID … received local Platform ID Steam_<SteamID64>`
  и `Got connection SteamID <SteamID64>` (платформенный id, `source=live`);
  `adminlist.txt` (`V_<SteamID64>`/`X_<id>`/голый SteamID64) даёт `isAdmin`
  и добавляет админов, которых ещё не было в логе (`source=list`).
  Дедупликация: по `steamId64`, затем по `platformId`, затем по имени
  (без учёта регистра); сортировка по `lastSeenAt` desc; лимит 50; пустой
  буфер → пустой массив. Живые имена из crossplay-логов могут не иметь
  SteamID64, если игрока нет в «Player history» — это не ошибка парсера.
- Диагностика сети (`diagnose_network`) — быстрая и без PowerShell: точечные
  `netsh advfirewall firewall show rule name="…"` по известным именам (правило
  менеджера + ops-варианты, `Valheim*`), один
  `netsh … show rule name=all dir=in` с жёстким таймаутом 1.5 с, `netstat -ano
  -p UDP` и `ipconfig` через `run_command_with_timeout` (процесс убивается по
  дедлайну), локальные IPv4 — `ipconfig` + socket fallback. Результат кэшируется
  на 12 с (кэш сбрасывается после изменения firewall-правил), длительности
  подшагов пишутся в лог. Причина требования: PowerShell
  `Get-NetFirewallRule | Get-NetFirewallPortFilter` занимал ~35–82 с; цель —
  <2 с на этом железе.
- Никаких блокирующих вызовов в UI-потоке: тяжёлые операции (скачивание,
  обновление, zip) — `async` или в отдельном потоке; команды остаются
  отзывчивыми.
- Юнит-тесты: валидация конфига, построение аргументов, парсинг лога,
  parse/serialize списков, netstat-парсер, zip round-trip (tempdir),
  имена/ротация бэкапов.
- `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test` — зелёные.
- **Жизненный цикл при закрытии приложения.** Сервером владеет приложение:
  сейчас оно спавнит процесс и отслеживает его. При выходе (закрытие окна,
  `RunEvent::ExitRequested`) приложение обязано остановить сервер, иначе
  процесс останется сиротой и состояние приложения разойдётся с реальностью.
  Порядок: если сервер запущен → авто-бэкап (если включён) → graceful-попытка
  → force kill → выход. Фронтенд заранее перехватывает кнопку закрытия и
  показывает модалку подтверждения, если сервер работает (см. §7), чтобы
  пользователь не терял прогресс случайно.

Валидация аргументов и состав командной строки (факты Valheim 1.0 — см. §12 и
`docs/valheim-server-reference.md`): всегда добавляем `-nographics -batchmode`,
`-name`, `-port`, `-world`, `-password`, `-public 0|1`, `-savedir <savedir>`,
`-logfile <logpath>`, при необходимости `-crossplay`, `-preset` (normal/casual/
easy/hard/hardcore/immersive/hammer), `-modifier` для custom-пресета,
`-saveinterval` (≥60), затем `extraArgs`. Порядок фиксирован — его проверяем
юнит-тестом.
Серверные читы мира (`setKeys`, §12): после preset/modifier и перед
`-saveinterval` добавляем `-setkey <key>` для каждого ключа из белого списка
(`nobuildcost`, `playerevents`, `passivemobs`, `nomap` — ровно четыре ключа
официального мануала 1.0.21; `fire` и `noportals` не являются аргументами
`-setkey` и отклоняются валидацией, см. `docs/ADMIN-REFERENCE.md` §4.3),
в стабильном порядке; ключи применяются после перезапуска сервера.

Остановка: официальный способ Iron Gate — Ctrl+C в консоли сервера (после неё в
логе `World saved`). Vanilla-сервер не читает stdin-команды, RCON нет. На
Windows приложение спавнит процесс скрыто; практическая стратегия — авто-бэкап
перед остановкой, попытка `taskkill /PID` без `/F`, затем `taskkill /F`, плюс
дефолтный `-saveinterval` 300 с, чтобы потеря несохранённого прогресса была
минимальной. Точную стратегию уточнить по эмпирическим результатам ops
(`docs/ops-findings.md`).

## 7. Что должно быть во фронтенде (`src/`)

Архитектура:

- `src/main.tsx` — как в шаблоне (тема, логирование, reveal окна).
- `src/App.tsx` — провайдер (`ServerProvider`) + layout: кастомный титлбар,
  сайдбар с навигацией, контент активной страницы, статус-бар.
- `src/lib/`:
  - `types.ts` — уже создан, менять только по согласованию, поля не
    переименовывать;
  - `ipc.ts` — типизированные обёртки всех команд и событий (§5.2/5.3);
  - `format.ts` — байты, длительность аптайма, даты, порты, SteamID;
  - `preview.ts` — детект `isTauri()` и мок-режим;
  - `theme.ts`, `window.ts`, `platform.ts`, `logging.ts` — из шаблона.
- `src/hooks/use-server.ts` (или эквивалент) — единый store через React
  контекст: config, installStatus, serverState, logs, worlds, backups, lists,
  network, действия; подписки на события; стартовая загрузка; обработка ошибок
  (`IpcError` → тост/баннер).
- `src/components/pages/`:
  - `dashboard-page.tsx` — статус (фаза, аптайм, PID, мир, порт, версия,
    игроки), кнопки «Запустить/Остановить», быстрые действия (установить/
    обновить, бэкап, логи), чек-лист «Сервер готов к игре», последние строки лога.
  - `server-page.tsx` — установка SteamCMD/сервера, версия, пути, обновление,
    аргументы запуска (preview), размер установки.
  - `world-page.tsx` — имя мира, активный мир, список миров, preset/модификаторы,
    saveinterval, crossplay/public/пароль — форма конфигурации сервера с
    валидацией и сохранением.
  - `players-page.tsx` — вкладки Админы/Бан/Допущенные, добавление по SteamID64
    (+ имя), удаление, пояснение как узнать SteamID.
  - `backups-page.tsx` — список, создание, восстановление (модалка с
    подтверждением), удаление, «открыть каталог», автобэкапы.
  - `logs-page.tsx` — живой лог, фильтры по источнику/уровню, поиск,
    автоскролл, очистка, счётчики.
  - `network-page.tsx` — таблица портов 2456–2458 со статусами, правила
    брандмауэра, кнопка «Разрешить в брандмауэре», локальные IP, чек-лист
    проброса на роутере, как подключиться (IP:2456 / join code).
  - `settings-page.tsx` — каталоги (с выбором через `@tauri-apps/plugin-dialog`
    open({ directory: true })), хранение бэкапов/ротация, автобэкапы, тема,
    сведения о приложении, «открыть каталоги», сброс конфига.
  - `admin-page.tsx` — «Админ»: игроки из логов/истории (`getKnownPlayers`) с
    кнопками «В adminlist», «Копировать ID», kick/ban; каталог админ-команд
    F5-консоли с копированием (`src/lib/admin-commands.ts`); каталог предметов
    и существ для `spawn` (`src/lib/admin-items.ts`); переключатели
    `-setkey` (setKeys, применяются после рестарта); блок про remote-админ
    (vanilla без RCON/stdin — только моды). Данные — из
    `docs/ADMIN-REFERENCE.md` / `docs/admin-items.json`.
- `src/components/layout/sidebar.tsx` — навигация (иконки lucide-react,
  активное состояние, счётчик логов/ошибок), брендинг.
- UI-примитивы: сохранить существующие (`button`, `card`, `badge`, `input`,
  `skeleton`) и добавить по необходимости `select`, `switch`, `dialog`,
  `progress`, `table`, `tabs`, `textarea`, `tooltip` в `src/components/ui/`.
- Стиль: дизайн-токены в `styles/globals.css` перекрасить в Valheim-палитру
  (тёмная тема по умолчанию, золото/мох/тёмный лес, light-тема остаётся
  аккуратной); рунические акценты — тонко, без ущерба читаемости.
- Тема: `initTheme()` по умолчанию `dark`, если в localStorage пусто.
- Режим предпросмотра: если `!isTauri()`, провайдер использует фикстуры
  (`preview-data.ts`) и имитацию событий — UI полностью рендерится в
  `pnpm dev`. Это основной способ разработки фронтенда без Rust.
- Ошибки: любой `IpcError` показывается понятным баннером/тостом; формы
  сохраняют введённое при ошибке.
- Локализация: все видимые строки — русские, даты/числа — `ru-RU`.
- Доступность: aria-label у icon-кнопок, focus-visible, reduced-motion.
- **Закрытие приложения.** Кнопка закрытия в кастомном титлбаре уже вызывает
  `getCurrentWindow().close()`; перед закрытием, если сервер в фазе
  `running`/`starting`, показывается модалка: «Сервер работает. Остановить его и
  закрыть приложение?» — [Остановить и выйти] (останавливает сервер, затем
  закрывает), [Отмена]. Если сервер остановлен — простое закрытие. Текст
  предупреждает о возможной потере прогресса с последнего автосохранения
  (интервал `saveinterval`).
- Тесты: обёртки IPC (мок `invoke`), `format.ts`, логика лога/фильтров,
  preview-провайдер, smoke-рендер ключевых страниц. `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `pnpm build` — зелёные.
- Новые npm-зависимости — минимально: `@tauri-apps/plugin-dialog` (обязательно),
  остальное без надобности.

## 8. Разделение владения файлами (write scopes)

| Владелец | Каталоги/файлы | Не трогать |
| --- | --- | --- |
| Lead | `docs/ARCHITECTURE.md`, `README.md`, `.github/`, финальная интеграция, git | `src-tauri/`, `src/` во время работы тиммейтов |
| rust-core | `src-tauri/**` (кроме `src-tauri/target`) | `src/**`, `docs/**`, `package.json` |
| frontend | `src/**`, `package.json`, `pnpm-lock.yaml`, `public/**`, `index.html`, `vite.config.ts`, `vitest.config.ts` | `src-tauri/**`, `docs/**`, `README.md` |
| ops/docs | `docs/**` (кроме `ARCHITECTURE.md`), `scripts/**`, `server/**`, `steamcmd/**`, `backups/**` | `src/**`, `src-tauri/**` |

`docs/valheim-server-reference.md` пишет research-субагент; `docs/SERVER-SETUP.md`
и скрипты — ops. Файлы не пересекаются по именам.

## 9. План работ и роли

1. **Lead**: контракт, скаффолд, ребрендинг, иконка, git-базлайн, интеграция,
   приёмка, README, сборка бандла.
2. **rust-core**: Rust-ядро целиком (§6), тесты, зелёные clippy/fmt.
3. **frontend**: React-UI целиком (§7), тесты, зелёные typecheck/lint/test/build.
4. **ops**: реальная установка SteamCMD + Valheim Dedicated Server в
   `D:\Servers\Valheim\server`, e2e-проверка запуска/портов/остановки/путей/логов,
   скрипты-обёртки, `docs/SERVER-SETUP.md` (порты, firewall, роутер, бэкапы,
   обновление, как подключиться).
5. Integration: Lead сводит фронт и бэк, правит расхождения в контракте,
   запускает все проверки, собирает `.msi`/`.exe`.

## 10. Приёмка (definition of done)

- `cd src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test` — успех.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — успех.
- `pnpm desktop:build` собирает установщик (`src-tauri/target/release/bundle`).
- Сервер Valheim реально установлен в `D:\Servers\Valheim\server`,
  запускается, логируется, останавливается; порты 2456–2458 проверены;
  бэкап/восстановление проверены на реальных файлах.
- Приложение в браузерном предпросмотре (`pnpm dev`) показывает все страницы
  с реалистичными данными без ошибок консоли.
- README описывает запуск, использование, порты, известные ограничения.

## 11. Правила работы команды

- Задача в общем борде: прочитать, взять (`claim`) с текущей ревизией, работать,
  по завершении — `complete`. Статус-апдейты и вопросы — `send_message` Lead'у.
- Не запускать `git commit`/`git checkout`/`git reset` — git ведёт Lead.
- Не менять файлы вне своего scope; если правка нужна в чужом scope — сообщить
  Lead'у.
- Перед отчётом о готовности прогнать свои проверки; в отчёте: что сделано,
  какие команды/тесты прошли, какие вопросы/риски.
- Если блокер >15 минут — сообщить Lead'у, не простаивать.

## 12. Факты Valheim 1.0 (сверено с `docs/valheim-server-reference.md`)

Игра обновилась до 1.0 — часть привычных фактов устарела. Реализация должна
учитывать:

1. **Мир — это каталог.** В `worlds_local` лежит папка с именем мира, внутри
   `_main.1.fwl2` (метаданные), `_main.1.db2` (данные), `_main.1.chunks`
   (индекс). Старый формат `*.fwl`/`*.db` тоже встречается (перенос старых
   миров) — `list_worlds` и бэкап должны поддерживать оба варианта, вычисляя
   мир как каталог либо как файл `<name>.fwl`. Бэкап — zip всего каталога
   `worlds_local` (все миры + списки игроков `*.txt` из базы `savedir`).
2. **ID игроков.** Формат 1.0: `V_<SteamID64>` (Steam), `X_<ID>` (Xbox/Game
   Pass), у PS5/Switch 2 — свои префиксы; legacy — голый SteamID64. Принимать
   все варианты, хранить как ввёл пользователь; комментарии `//` допустимы.
   `permittedlist.txt`, если непустой, превращает сервер в whitelist — UI
   предупреждает.
3. **Списки читаются только при старте** — после изменения нужен перезапуск
   сервера; UI показывает бейдж «требуется перезапуск», если списки менялись
   при работающем сервере (можно не делать в v1, но подсказку — да).
4. **Аргументы.** Минимальный набор: `-nographics -batchmode -name … -port …
   -world … -password … -public 0|1`; менеджер добавляет `-savedir`,
   `-logfile`, `-saveinterval`, опционально `-crossplay`, `-preset`,
   `-modifier`. `-preset`: `normal`, `casual`, `easy`, `hard`, `hardcore`,
   `immersive`, `hammer`; ключи `-modifier`: `combat`, `deathpenalty`,
   `resources`, `raids`, `portals`; `-setkey` (`nobuildcost`, `playerevents`,
   `passivemobs`, `nomap` — только эти четыре документированы в мануале
   1.0.21; `fire`/`noportals` не существуют как серверные аргументы) —
   управляется полем `setKeys`.
5. **Валидация.** Имя сервера ≤53 символов, пароль 5–20, имя мира ≤20,
   `saveinterval` ≥60, пароль не должен входить в имя сервера (иначе сервер
   печатает `Error bad password` и выходит). Порт 1–65535, занимает port…port+2.
6. **Маркеры лога** (эмпирика с реального сервера 1.0.21, лог
   `D:\Servers\Valheim\logs\server-20261108-201536.log`; версия в логе
   `Valheim version: 1.0.21 (network version 41)`, без `l-`):
   - `Valheim version: ...` — версия;
   - **`Game server connected` появляется РАНО** — на новом мире за ~20 с до
     готовности, ещё до `Loading: Generating locations`. **НЕ считать это
     маркером готовности.**
   - Реальная готовность — `Opened Steam server` (после `Registering lobby`;
     затем `Loading: Done. Total seconds sinze ZNet start: ...`);
   - `World save (5/5) done. Total time [35ms]` / `World save (1/5) ... =>
     Save number 1` / `World saved (...)` — успешное сохранение;
   - `Loading: Generating locations` — мир создаётся заново (важное
     предупреждение пользователю);
   - `Got character ZDOID from <name>` / `Closing socket <id>` /
     `Session ... is active with N players` — игроки;
   - `join code <6 цифр>` — код приглашения crossplay (меняется каждый рестарт);
   - **crossplay**: строки `Opened Steam server` нет; готовность даёт
     `Opened PlayFab server` / `Loading: Done. Total seconds sinze ZNet start:` /
     появление join code; для существующего мира — `ZNet.LoadWorld:` → `Game
     server connected`, для нового — `Game server connected` приходит раньше
     генерации и готовностью НЕ является; ловушка `New session server "…" that has
     join code , now 0 player(s)` содержит пустой код и игнорируется;
   - реальный формат: `Session "…" with join code 863039 and IP 203.0.113.10:2466
     is active with 0 player(s)` (именно `player(s)`);
   - `Game - OnApplicationQuit` → `ZNet Shutdown` → строки `World save` —
     корректная остановка.
   Готовность определяется строками лога, а не фактом процесса.
7. **steam_appid.txt**: в каталоге сервера должен лежать файл `steam_appid.txt`
   с содержимым `892970` (ID клиентской игры, не 896660) — иначе возможны
   проблемы с PlayFab/crossplay. Установщик сервера 1.0.21 кладёт его сам;
   бэкенд проверяет и при необходимости создаёт/исправляет.
8. **Остановка**: Ctrl+C — официальный способ. Эмпирически подтверждённый
   graceful-путь: Win32 `AttachConsole(pid)` + `SetConsoleCtrlHandler(NULL,
   TRUE)` + `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)` + `FreeConsole()` из
   ОТДЕЛЬНОГО PowerShell-процесса (готовый скрипт — `scripts/stop-graceful.ps1`,
   проверен на живом сервере: полный цикл сохранения и выхода). В Rust
   реализуется без `unsafe`: скрипт встраивается через `include_str!`,
   записывается в app-data и запускается `powershell.exe -NoProfile
   -NonInteractive -ExecutionPolicy Bypass -File ...`; exit code 0 — graceful,
   2 — таймаут → force kill (`taskkill /F`), 3 — процесса нет. Vanilla не читает
   stdin, RCON/консоли команд нет. Дефолтный `-saveinterval` менеджера — 300 с.
9. **Crossplay**: трафик через PlayFab relay, проброс портов не нужен, сервер
   слушает случайный высокий порт, `-port` различает несколько серверов на
   одном IP; подключение по локальному IP при crossplay не работает, игроки
   заходят по коду приглашения. Лимит игроков — 10.
10. **Savedir по умолчанию** — `%USERPROFILE%\AppData\LocalLow\IronGate\Valheim`;
   менеджер всегда передаёт `-savedir <installDir>\savedir`.
11. **Лог**: `-logfile` включает файл; без него — stdout. В логе: версия,
    `Game server connected`, `World saved ( … ms )`, строки подключений
    (SteamID), генерация мира (`Loading: Generating locations`), ошибки.
12. **Моды/BepInEx.** Vanilla выделенный сервер не даёт `devcommands`
    (god/fly/spawn/item не работают даже админу), поэтому менеджер умеет
    ставить серверные моды: **BepInExPack_Valheim** (`denikson`, распаковка
    содержимого пака в `installDir`: `winhttp.dll`, `doorstop_config.ini`,
    `.doorstop_version`, `BepInEx/`) и **Server_devcommands** (`JereKuusela`,
    в `installDir/BepInEx/plugins/ServerDevcommands/`). Источник — Thunderstore
    (`/api/experimental/package/…`, при недоступности API — закреплённые версии
    `5.4.2360`/`1.116.0` и URL `/package/download/…`). Требования: сервер
    остановлен (Doorstop подхватывает `winhttp.dll` только при старте);
    после установки — перезапуск сервера. `get_mod_status` — файловый детект
    (`winhttp.dll` + `BepInEx/core/BepInEx.Preloader.dll`,
    `BepInEx/plugins/ServerDevcommands/ServerDevcommands.dll`, версии из
    `mods.json` → `.doorstop_version`/`manifest.json`). Моды серверные:
    клиенту для `devcommands` они не нужны, но клиентские моды могут отключать
    достижения/ломать совместимость — предупреждаем в UI. Полное удалённое
    администрирование с RCON по-прежнему требует отдельных модов (в v1 нет).
13. **Порты (эмпирика 1.0.21)**: обычный режим — сервер реально занимает UDP
    2456 (IPv6 dual-stack) и 2457; 2458 не слушается, но Iron Gate рекомендует
    открывать 2456–2458 (менеджер проверяет весь диапазон и объясняет это в
    подсказках). Crossplay — занимает `port+1` + случайные эфемерные, основной
    `port` свободен, проброс не нужен. При `-port X` открывать `X…X+2`.
    `diagnose_network` работает за сотни миллисекунд: netsh-запросы по известным
    именам + bounded-перебор inbound правил (таймаут), `netstat`/`ipconfig` с
    kill по дедлайну, TTL-кэш 12 с; PowerShell в диагностике не используется
    (был источником 35–82 с).
14. **Проверено e2e**: `tools/run-e2e.ps1 -WithServer` поднимает desktop-приложение
    (WebView2 remote debugging), вызывает настоящие Tauri-команды через CDP,
    запускает реальный сервер, проверяет маркеры лога и корректную остановку;
    отчёт — `docs/E2E-REPORT.md` (2026-11-08: все проверки PASS, ready за 12 с,
    graceful stop за 3 с с сохранением мира).
15. **Админка (vanilla-ограничения и максимум без модов)** — см.
    `docs/ADMIN-REFERENCE.md`:
    - админом становится игрок из `adminlist.txt` (`V_<SteamID64>`/`X_<id>`),
      файл читается **только при старте** сервера → после добавления нужен
      перезапуск; менеджер показывает это предупреждение и умеет добавлять
      игроков в список со страницы «Админ»;
    - **vanilla dedicated-сервер отклоняет `devcommands` для всех, включая
      админов** (`god`/`fly`/`spawn`/`item` не работают) — это ограничение
      игры, а не прав; админ-команды вводятся **в игре в F5-консоли**, но у
      vanilla выделенного сервера нет ни RCON, ни stdin-команд, поэтому
      менеджер не может выполнять их удалённо — он даёт каталог команд,
      генераторы `spawn <prefab> <amount>` (отдельной команды `item` нет,
      команды `stamina` тоже нет) и копирование в буфер;
    - «бесконечные» возможности даются игровыми командами (`devcommands`,
      `god`, `debugmode`, `nocost` и т.п., точный список — в
      `docs/ADMIN-REFERENCE.md`) и/или серверными world-модификаторами:
      `-modifier combat veryeasy`, `-modifier deathpenalty casual`,
      `-preset casual`, `-setkey nobuildcost`, `-setkey playerevents`,
      `-setkey passivemobs`, `-setkey nomap` (ровно эти четыре ключа
      документированы в мануале 1.0.21; `fire` и `noportals` — не аргументы
      `-setkey`); серверные флаги применяются после перезапуска и влияют на
      весь мир;
    - **Server Devcommands** (BepInEx-мод, устанавливается менеджером, см.
      §12 п.12) снимает запрет читов на dedicated-сервере: после перезапуска
      админ может включить `devcommands`, а `god` отключает расход
      выносливости; RCON/stdin в vanilla по-прежнему нет — удалённое
      администрирование через RCON требует отдельных модов (в v1 нет).
    - `get_known_players` — максимум данных без модов: история мира
      (`Player history entry`), живые подключения (`PlayFab socket … Platform ID
      Steam_<id>`, `Got connection SteamID`), имена персонажей (`Got character
      ZDOID from`); админ-признак — по `adminlist.txt`. Ограничение: в crossplay
      имя из live-лога не всегда удаётся связать со SteamID64 (для этого нужна
      запись в «Player history»/админлисте), а списки применяются только после
      перезапуска сервера — UI показывает бейдж «требуется перезапуск».
16. **Значения `-modifier` по мануалу 1.0.21** (`docs/ADMIN-REFERENCE.md`
    §4.3): `combat` — `veryeasy|easy|hard|veryhard` (без `normal`),
    `deathpenalty` — `casual|veryeasy|easy|hard|hardcore` (без `normal`),
    `resources` — `muchless|less|more|muchmore|most` (есть `most`, нет
    `normal`), `raids` — `none|muchless|less|more|muchmore`, `portals` —
    `casual|hard|veryhard`. Наши enum/UI пока используют прежний список
    (включая `normal`, без `most`): часть значений сервер может игнорировать,
    но сам аргумент запуск не ломает. Массово менять типы/UI — отдельная
    задача; здесь расхождение только зафиксировано.

