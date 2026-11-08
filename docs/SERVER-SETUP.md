# Valheim Dedicated Server на Windows — установка, запуск, сеть, бэкапы

Практическое руководство по обслуживанию выделенного сервера Valheim на этой
Windows-машине (раскладка `D:\Servers\Valheim`). Всё в документе **проверено
эмпирически** на реальном сервере (Valheim Dedicated Server 1.0.21, network 41);
подробные наблюдения и реальные строки логов — в
[`ops-findings.md`](./ops-findings.md), официальная справка — в
[`valheim-server-reference.md`](./valheim-server-reference.md).

Раскладка:

```text
D:\Servers\Valheim\
├─ steamcmd\        # SteamCMD (steamcmd.exe), скачивается официальным zip
├─ server\          # файлы сервера: valheim_server.exe, valheim_server_Data\, …
│  └─ savedir\      # -savedir: worlds_local\, adminlist.txt, bannedlist.txt, permittedlist.txt
├─ backups\         # zip-архивы бэкапов
├─ logs\            # логи сервера: server-YYYYMMDD-HHMMSS.log, файлы test-* (только тесты)
├─ runtime\         # server.json / server.pid (состояние запуска), stdout/stderr
└─ scripts\         # install-server.ps1, start-server.ps1, stop-server.ps1,
                    # stop-graceful.ps1, backup-server.ps1
```

Требования: Windows 10/11 x64, **права администратора** (брандмауэр, при желании —
установка), ~3 ГБ диска на сервер, открытый исходящий HTTPS (SteamCMD качает с
`steamcontent.com`). Скрипты рассчитаны на PowerShell 7 (`pwsh`); они также
разбираются Windows PowerShell 5.1 (файлы сохранены в UTF-8 с BOM).

## 1. Быстрый старт

```powershell
# 1. Установка/обновление сервера (SteamCMD + appid 896660, ~2 ГБ, 10–20 мин)
pwsh -File D:\Servers\Valheim\scripts\install-server.ps1

# 2. Запуск (пароль 5–20 символов, не должен входить в имя сервера/мира)
pwsh -File D:\Servers\Valheim\scripts\start-server.ps1 -Name "Valheim RU" -Password "SuperSecret1"

# 3. Корректная остановка (мир сохраняется)
pwsh -File D:\Servers\Valheim\scripts\stop-server.ps1

# 4. Бэкап (при остановленном сервере)
pwsh -File D:\Servers\Valheim\scripts\backup-server.ps1
```

Проверить, что сервер готов: в логе последняя строка — `Opened Steam server`
(и/или `Game server connected`), UDP-порты `2456`/`2457` заняты процессом
`valheim_server.exe`.

## 2. Установка и обновление

Официальные компоненты:

| Что | Значение |
| --- | --- |
| SteamCMD zip | `https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip` (0,74 МБ) |
| AppID выделенного сервера | **896660** (Valheim Dedicated Server) |
| Логин | `anonymous` (аккаунт Steam не нужен) |
| Каталог установки | `D:\Servers\Valheim\server` (через `+force_install_dir`) |
| Размер установки | ~2,01 ГБ (1003 файла), download ~1,76 ГБ, BuildID 26266951 |

Ручная команда (то же, что делает `install-server.ps1`):

```bat
D:\Servers\Valheim\steamcmd\steamcmd.exe ^
  +force_install_dir D:\Servers\Valheim\server ^
  +login anonymous +app_update 896660 validate +quit
```

`install-server.ps1` дополнительно: скачивает/распаковывает SteamCMD, если его
нет; делает self-update; повторяет `app_update` до 3 раз; проверяет
`server\valheim_server.exe`; печатает размер, время и версию.

Эмпирические особенности SteamCMD (важно для автоматизации):

- Первый `steamcmd.exe +quit` на свежераспакованном клиенте завершается с
  **exit code 7**, хотя обновление проходит успешно. Код 7 не считать ошибкой.
- Первая попытка `app_update` может упасть с
  `ERROR! Failed to install app '896660' (Missing configuration)` и exit code 8 —
  это **транзиентная** ошибка (прогрев appcache/токенов доступа). Повторный
  запуск той же команды проходит; поэтому в скрипте retry.
- Вывод SteamCMD **локализован** (на этой машине — русский: «Загрузка
  обновления», «Проверка установки»). Прогресс парсить по числам:
  `[ 55%]`, `Update state (0x61) downloading, progress: 55.00 (…/…)`,
  `Update state (0x81) verifying update, progress: …`.
- Признак успеха установки: строка `Success! App '896660' fully installed.` и
  exit code 0. Признак уже установленного/актуального: `Success! App '…' fully
  installed.` тоже; при повторном validate может не быть скачивания.
- После установки в каталоге появляются `start_headless_server.bat`,
  `Valheim Dedicated Server Manual.pdf`, `steam_appid.txt` (там `892970`) и
  `valheim_server_Data\`; сам `valheim_server.exe` — небольшой Unity-лаунчер
  (~0,64 МБ), это нормально.

Обновление: выполнить `install-server.ps1` (это `+app_update … validate`).
Обновляйте при остановленном сервере и **сделайте бэкап** мира. Если сервер
запущен, SteamCMD может не суметь перезаписать занятые файлы.

## 3. Запуск сервера

`start-server.ps1` запускает `valheim_server.exe` отдельным процессом со своей
(скрытой) консолью — это обязательное условие корректной остановки по Ctrl+C
(см. §4), пишет состояние в `runtime\server.json` и ждёт в логе готовности.

```powershell
pwsh -File D:\Servers\Valheim\scripts\start-server.ps1 `
  -Name "Valheim RU" -Port 2456 -World "Dedicated" -Password "SuperSecret1" -Public
```

Ключевые параметры (полный список — `Get-Help .\start-server.ps1 -Full`):

| Параметр | По умолчанию | Примечание |
| --- | --- | --- |
| `-Name` | `Valheim Server` | до 53 символов (`-name`) |
| `-Port` | `2456` | занимает также `port+1` (и официально `port+2`) |
| `-World` | `Dedicated` | до 20 символов; нет такого мира → создаётся новый |
| `-Password` | — (обязателен) | 5–20 символов, не входит в name/world |
| `-Public` | выкл (`-public 0`) | видимость в server browser |
| `-Savedir` | `<server>\savedir` | каталог сохранений |
| `-LogFile` | `<root>\logs\server-<ts>.log` | файл лога (перезаписывается при старте) |
| `-Crossplay` | выкл | PlayFab relay + join code, проброс портов не нужен |
| `-Preset` | — | `normal casual easy hard hardcore immersive hammer` |
| `-Modifier` | — | напр. `-Modifier 'combat','hard'` или `-Modifier 'combat:hard'` |
| `-SetKey` | — | `nobuildcost playerevents passivemobs nomap fire noportals` |
| `-SaveInterval` | 0 = дефолт 1800 | секунды (≥60), `-saveinterval` |
| `-InstanceId` | — | уникальный id при нескольких crossplay-серверах |
| `-ExtraArgs` | — | произвольные дополнительные аргументы |
| `-ReadyTimeoutSec` | `180` | ожидание готовности |
| `-NoWait` | выкл | не ждать готовности (только запустить) |
| `-VisibleConsole` | выкл | показать окно консоли (отладка) |

Эквивалентная ручная команда:

```bat
"D:\Servers\Valheim\server\valheim_server.exe" -nographics -batchmode ^
  -name "Valheim RU" -port 2456 -world "Dedicated" -password "SuperSecret1" -public 1 ^
  -savedir "D:\Servers\Valheim\server\savedir" ^
  -logfile "D:\Servers\Valheim\logs\server.log"
```

- `-nographics -batchmode` — штатные Unity-флаги headless-режима; скрипт добавляет
  их всегда. Сервер запускается и без них (официальный `start_headless_server.bat`
  содержит их же).
- Несколько серверов на одной машине — разные `-port`, `-world`, `-savedir`
  (и `-instanceid` при crossplay).
- Один процесс обслуживает только один мир.

Официальный шаблон, поставляемый Steam (`server\start_headless_server.bat`), в
1.0.21 выглядит так:

```bat
@echo off
set SteamAppId=892970
echo "Starting server PRESS CTRL-C to exit"
REM NOTE: Minimum password length is 5 characters & Password cant be in the server name.
REM NOTE: You need to make sure the ports 2456-2458 is being forwarded to your server through your local router & firewall.
valheim_server -nographics -batchmode -name "My server" -port 2456 -world "Dedicated" -password "secret" -crossplay
```

## 4. Остановка сервера

Vanilla-сервер **не читает stdin** (команды в его консоли бесполезны). Штатный
способ Iron Gate — Ctrl+C в консоли сервера; при этом мир сохраняется. Windows
не умеет «отправить Ctrl+C по PID» из коробки, поэтому используется helper
`scripts\stop-graceful.ps1` (FreeConsole → AttachConsole(pid) →
GenerateConsoleCtrlEvent(CTRL_C_EVENT,0) → FreeConsole), запускаемый **отдельным
процессом**.

`stop-server.ps1` делает это сам и по умолчанию пробует по порядку:

1. **Ctrl+C через helper** — корректно, мир сохраняется (`World save (5/5) done`);
2. `taskkill /PID <pid>` **без** `/F` — на практике также корректно завершает
   консольный процесс (эквивалент закрытия консоли), мир сохраняется;
3. `taskkill /F` — только явно (`-Method Force` или `-AllowForceFallback`):
   мгновенно, **без сохранения**, exit code процесса 1.

```powershell
pwsh -File .\stop-server.ps1                  # graceful (рекомендуется)
pwsh -File .\stop-server.ps1 -Method Force    # принудительно, без сохранения
```

Что происходит при корректной остановке (реальные строки 1.0.21):

```text
11/08/2026 20:18:57: Game - OnApplicationQuit
11/08/2026 20:18:57: ZNet Shutdown
11/08/2026 20:18:57: World save (1/5) Cloud & Backup checks done [0ms] => Save number 3
11/08/2026 20:18:57: World save (2/5) Chunks writing done [8ms]
11/08/2026 20:18:57: World save (3/5) DB2 writing done [11ms]
11/08/2026 20:18:57: World save (4/5) FWL writing done [3ms]
11/08/2026 20:18:57: World save (5/5) done. Total time [28ms]
11/08/2026 20:18:57: Sending disconnect msg
11/08/2026 20:18:59: ZNet OnDestroy
11/08/2026 20:18:59: Steam manager on destroy
```

- Время остановки: ~2,4–3,1 с; код выхода процесса `0`.
- Маркер сохранения — `World save (5/5) done. Total time [Nms]` (строки
  `World saved ( 412.5ms )` в 1.0.21 нет; см. §12).
- Жёсткое убийство (`/F`) не повреждает последнее *завершённое* сохранение
  (`_main.N.*` с маркером `.ok`), но теряются изменения с момента последнего
  автосохранения (по умолчанию — до 30 минут). Не убивайте /F в момент записи
  сохранения.
- Останавливать сервер, запущенный приложением, должен сам менеджер; скрипты —
  эталон поведения для приложения.

## 5. Порты и сеть

| Порт | Протокол | Назначение | Реально занимается? |
| --- | --- | --- | --- |
| `2456` | UDP | игровой трафик | да (dual-stack, `::`) |
| `2457` | UDP | Steam query / видимость в списке | да (`0.0.0.0`) |
| `2458` | UDP | третий порт (`port+2`) | **нет** (vanilla 1.0.21 его не биндит) — но проброс/правило брандмауэра оставляем, как требует официальное руководство |
| случайные высокие UDP | UDP | Steam relay / сетевые сокеты | да, меняются каждый запуск |
| `127.0.0.1:<случайный>` | TCP (loopback) | внутренний сокет PlayFab/Steam | да, локально |

- При нестандартном `-port 2466` открывать/пробрасывать нужно `2466–2468`
  (`port … port+2`).
- `netstat -ano -p UDP | findstr <PID>` и `Get-NetUDPEndpoint -OwningProcess <PID>`
  показывают занятые порты; проверка «порт свободен» должна смотреть `2456` и
  `2457` (плюс, для перестраховки, `2458`).
- Сервер открывает исходящие TCP-соединения к Steam/PlayFab (443) — интернет
  обязателен даже при `-public 0` и без crossplay.
- **Crossplay**: трафик идёт через relay PlayFab, проброс портов на роутере не
  нужен; игроки подключаются по **join code** (6 цифр, напр. `863039`), который
  печатается в логе (`Session "<name>" registered with join code 863039`,
  `Session "<name>" with join code 863039 and IP <public_ip>:<port> is active with
  N player(s)`). Готовность crossplay-сервера: `Opened PlayFab server` и
  `Loading: Done. Total seconds sinze ZNet start:` (строки `Opened Steam server`
  в crossplay нет; `Game server connected` у нового мира приходит до готовности).
  `-port` нужен, чтобы различать несколько crossplay-серверов на одном IP; он и
  производные порты при crossplay не занимаются — слушается UDP `port+1` +
  случайные высокие порты. Подключение по локальному IP при crossplay может не
  работать.

## 6. Брандмауэр Windows

Нужно входящее правило UDP на `2456–2458` (проверено на этой машине; требуется
elevation — сессия администратора):

```powershell
netsh advfirewall firewall add rule name="Valheim Server (UDP 2456-2458)" `
  dir=in action=allow protocol=UDP localport=2456-2458 profile=any `
  description="Valheim dedicated server game/query ports (2456 game, 2457 query, 2458 tertiary)"
```

Проверка:

```powershell
netsh advfirewall firewall show rule name="Valheim Server (UDP 2456-2458)" verbose
Get-NetFirewallRule -DisplayName 'Valheim Server*' | Format-Table DisplayName,Enabled,Direction,Action,Profile
```

Ожидаемый результат: `Enabled: Yes`, `Direction: In`, `Profiles: Domain,Private,Public`,
`Protocol: UDP`, `LocalPort: 2456-2458`, `Action: Allow`.

Удалить правило: `netsh advfirewall firewall delete rule name="Valheim Server (UDP 2456-2458)"`.
Приложение делает ту же операцию опционально и с подтверждением (менеджер может
требовать запуск от администратора).

## 7. Проброс портов на роутере

1. Узнать локальный IPv4 сервера: `Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.PrefixOrigin -ne 'WellKnown'}`
   (или `ipconfig`). Для сервера лучше закрепить статический IP/DHCP-reservation.
2. В роутере: Port Forwarding, **UDP** `2456–2458` → `<локальный IP>:2456–2458`.
3. Если у провайдера CGNAT (серый IP) — проброс не поможет: варианты — публичный
   IP, туннель или **crossplay** (`-crossplay`), которому проброс не нужен.
4. Проверка доступности снаружи — подключением из Valheim по `IP:2456` (Steam
   Favorites → Add server by IP) или внешним UDP-сканером портов.

Firewall и проброс обязательны **оба**: правила Windows не отменяют NAT роутера.

## 8. Как подключиться

- **Steam-клиент, `-public 1`**: сервер виден в списке (`Join Game` → Friends/Community);
  либо «Добавить сервер по IP» (`IP:2456`, если порт нестандартный — указать его).
- **`-public 0`**: в списке не виден; подключаться по IP (`<внешний IP>:2456`) или
  через join code при crossplay.
- **Crossplay**: в логе строка `Session "<name>" with join code NNNNNN …`; игроки
  (в т.ч. Xbox/Game Pass) вводят join code. Join code меняется после рестарта.
- Пароль обязателен (5–20 символов) — без него публичный сервер не стартует.
- Имена/пароли: пароль не должен быть частью имени сервера или мира (иначе
  `Error bad password:` и завершение).

## 9. Мир и сохранения

База сохранений — `-savedir`. По умолчанию (если аргумент не задан) сервер
использует профиль пользователя:
`%USERPROFILE%\AppData\LocalLow\IronGate\Valheim\` (проверено: там создаются
`worlds_local\`, `adminlist.txt`, `bannedlist.txt`, `permittedlist.txt`).
Поэтому scripts/ и приложение всегда передают `-savedir <installDir>\savedir`,
чтобы данные были рядом с сервером и не зависели от профиля Windows.

Мир в 1.0 — это **папка** с именем мира внутри `worlds_local`:

```text
<savedir>\worlds_local\TestWorld\
├─ _main.1.fwl2      54 B      метаданные мира (поколение 1)
├─ _main.1.db2      147 KB     данные мира
├─ _main.1.chunks    21 B      индекс чанков
├─ _main.1.ok         4 B      маркер «сохранение завершено»
└─ 00_00__0_1.chunk  1,5 KB    чанк террейна (по файлу на чанк)
```

- `<N>` в `_main.N.*` — номер поколения; увеличивается при каждом сохранении
  (в логе `… => Save number N`).
- `.ok` = сохранение дописано; для здорового мира должен присутствовать у
  последнего поколения.
- Автосохранение — `-saveinterval` секунд (по умолчанию 1800 = 30 мин) + при
  корректной остановке. Дополнительные авто-бэкапы (`<World>_backup_auto-*`)
  сервер делает сам (в нашем прогоне — «Skipping backup. World session not long
  enough.», т.е. на короткой сессии авто-бэкап не создаётся).
- Мир создаётся при первом запуске с новым `-world` (в логе
  `missing …\worlds_local\<World>.db` → `Loading: Generating locations`).
  Опечатка в имени молча создаёт новый мир — проверяйте имена.
- Перенос мира с клиента: скопировать папку мира в `worlds_local` (при
  необходимости — старую пару `<World>.fwl`+`<World>.db`, сервер сконвертирует
  при первом сохранении).

### Списки игроков (adminlist / bannedlist / permittedlist)

Лежат **в корне `-savedir`**, рядом с `worlds_local` (не в `installDir`!):

```text
D:\Servers\Valheim\server\savedir\
├─ adminlist.txt
├─ bannedlist.txt
├─ permittedlist.txt
└─ worlds_local\
```

Создаются сервером при первом старте, если их нет. Формат: одна запись на
строку, комментарии — строки с `//`; CRLF. Заголовки, которые пишет сам сервер:

```text
// List admin players ID  ONE per line
// List banned players ID  ONE per line
// List permitted players ID ONE per line
```

В 1.0 ID игроков — `V_<SteamID64>` (Steam) или `X_<ID>` (Xbox/Game Pass),
например `V_76561198000000001`; старый «голый» SteamID64 часть серверов ещё
понимает, но в UI менеджера подсказывайте формат `V_…`. Изменения применяются
**после перезапуска сервера** (горячего перечитывания нет).

- `adminlist.txt` — право админ-команд в игре (`kick`, `ban`, `unban`, `save`, …),
  вводятся в игре (F5), не в консоли сервера.
- `bannedlist.txt` — запрет входа.
- `permittedlist.txt` — **whitelist**: одна запись закрывает сервер для всех
  остальных. Предупреждайте пользователей; очищайте файл (или оставляйте только
  комментарии), чтобы снять ограничение.

## 10. Бэкапы и восстановление

`backup-server.ps1` пакует `worlds_local` (мир целиком — папку!) и списки
игроков в `backups\valheim-backup-YYYYMMDD-HHMMSS[-label].zip`, проверяет архив
и удаляет старые сверх `-Keep` (по умолчанию 10).

```powershell
pwsh -File .\backup-server.ps1                        # снять бэкап (сервер лучше остановить)
pwsh -File .\backup-server.ps1 -Keep 20 -Label before-update
pwsh -File .\backup-server.ps1 -Restore -Zip .\backups\valheim-backup-20261108-200000.zip
```

Правила:

- Бэкап делать при **остановленном** сервере (иначе возможна недописанная
  генерация; скрипт предупредит и потребует `-Force`).
- Восстановление — только при остановленном сервере; скрипт автоматически
  делает страховочный бэкап текущего состояния и переименовывает текущие файлы
  в `*.pre-restore-<timestamp>` (операция отменяема).
- Ручное восстановление: остановить сервер → распаковать zip в `savedir`
  (перезаписав `worlds_local` и списки) → запустить сервер, проверить строку
  `ZNet.LoadWorld: <World> (…)` (`save number N`).
- Хранить бэкапы вне диска `D:` (копия на другой диск/в облако) — при выходе из
  строя диска бэкапы рядом не помогут.

## 11. Логи

- С `-logfile <path>` сервер пишет туда; файл **перезаписывается** при каждом
  старте (не append). Без `-logfile` файла по умолчанию нет — вывод в stdout.
- Кодировка UTF-8 без BOM, переводы строк CRLF. Строки игрового лога имеют
  префикс `MM/DD/YYYY HH:mm:ss: ` (US-формат даты!), строки Unity — без префикса.
- Полезные маркеры: `Valheim version: 1.0.21 (network version 41)`;
  `ZNet.LoadWorld: <World> (<World>), save number N`; `Opened Steam server`
  (готовность); `Game server connected` (**не** для нового мира — появляется до
  генерации); `Loading: Done. Total seconds sinze ZNet start: …` (конец генерации
  нового мира); `World save (5/5) done`; `Game - OnApplicationQuit`.
- Логи приложения менеджера и скриптов — `logs\` + `runtime\` (stdout/stderr,
  `server.json` с PID/портом/миром). Ротацию/очистку делайте самостоятельно:
  сервер свои логи не ротирует.

## 12. Troubleshooting

| Симптом | Причина / решение |
| --- | --- |
| Сервер не виден в списке | `-public 0` (подключайтесь по IP/join code), неверный проброс NAT, брандмауэр, другой порт (`port…port+2`), Steam-клиент не видит сервер из-за crossplay-режима; проверьте заняты ли UDP 2456/2457 и строки `Opened Steam server`/`Registering lobby` |
| Игроки подключаются, но «Connecting/Handshake failed» | версии клиента и сервера расходятся (network version в логе), пароль, `permittedlist.txt` закрывает вход, VPN/провайдер |
| `Error bad password:` и процесс завершился | пароль <5 или >20 символов, либо входит в имя сервера/мира |
| Порт занят | `Get-NetUDPEndpoint -LocalPort 2456`; закрыть предыдущий экземпляр (`stop-server.ps1`), сменить `-Port`, проверить другой софт |
| Мир «пропал»/создался новый | `-world` не совпадает с именем папки в `worlds_local` (регистр), другой `-savedir`, запуск от другого пользователя Windows (default savedir — в профиле!) |
| Сервер упал во время сохранения | не убивать `/F` во время записи; восстановить последний завершённый `.ok`-пакет из бэкапа (`_main.N.ok`), удалить неполное новое поколение |
| Crossplay: не подключаются по IP | crossplay игнорирует прямой IP — только join code; проверьте строку `Session … join code …`, интернет, PlayFab |
| SteamCMD: `Missing configuration` | транзиентная ошибка — повторить `install-server.ps1` (несколько раз) |
| Логи пустые | не передан `-logfile`; путь в защищённую папку; проверить `runtime\server.stdout.log` |
| Приложение не может остановить сервер graceful | сервер должен иметь консоль (приложение запускает его с `CREATE_NO_WINDOW` — это работает); иначе используйте `stop-server.ps1 -Method Force` и бэкап |

## 13. Скрипты

См. [`SCRIPTS.md`](./SCRIPTS.md) — параметры, примеры и коды выхода пяти
скриптов (`install-server.ps1`, `start-server.ps1`, `stop-server.ps1`,
`stop-graceful.ps1`, `backup-server.ps1`).
