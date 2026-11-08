# Эмпирические наблюдения: Valheim Dedicated Server на Windows

Документ фиксирует **фактическое поведение** реального выделенного сервера
Valheim, установленного и проверенного на этой машине 2026-11-08. Все строки
логов — подлинные (скопированы из файлов). Официальная справка —
[`valheim-server-reference.md`](./valheim-server-reference.md), практическое
руководство — [`SERVER-SETUP.md`](./SERVER-SETUP.md). Расхождения с
документацией/справочником собраны в §12.

## 1. Окружение и методика

| Параметр | Значение |
| --- | --- |
| ОС | Windows 11 IoT Enterprise LTSC, 10.0.26100 |
| Права | администратор (сессия elevation) |
| Сервер | Valheim Dedicated Server **1.0.21** (network version 41), BuildID **26266951** |
| SteamCMD | Steam Console Client, client version 1792617903 |
| Раскладка | `D:\Servers\Valheim\{steamcmd,server,savedir,backups,logs,runtime}` |
| Размер установки | 1003–1031 файла, **2014–2015 МБ** (2,01 ГБ), download 1,76 ГБ |
| Память процесса сервера | ~1,35 ГБ WorkingSet |
| Время | 2026-11-08, ~20:00–20:35 (+07:00) |

Методика: установка через официальный SteamCMD; запуск `valheim_server.exe` в
разных режимах (своя консоль, `CreateNoWindow`, `CREATE_NO_WINDOW` из .NET
`ProcessStartInfo`); фиксация логов, `netstat -ano -p UDP`, `Get-NetUDPEndpoint`,
деревьев файлов, кодов выхода (через `System.Diagnostics.Process.ExitCode`),
времени; для graceful-остановки — Win32 helper (`FreeConsole` → `AttachConsole` →
`GenerateConsoleCtrlEvent`). Сервер после тестов остановлен, тестовые логи
удалены.

## 2. Установка (SteamCMD)

- `steamcmd.zip` с `https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip`:
  **774 825 байт**, скачан за 0,6 с; распаковка → 1 файл `steamcmd.exe`
  (1 687 464 байта, версия 11.15.70.27).
- Первый `steamcmd.exe +quit` (self-update) занял **14,0 с**, скачал ~30 МБ,
  завершился с **exit code 7** — при этом всё обновилось (см. §12). Повторный
  `+quit` на уже обновлённом клиенте — 1,3 с, exit 0.
- Первая попытка установки appid 896660 завершилась ошибкой за 19 с:
  `ERROR! Failed to install app '896660' (Missing configuration)`, exit code **8**,
  в `appinfo_log.txt`: `RequestAppInfoUpdate: AppIDs 896660` →
  `Requested 67 app access tokens, 0 received, 67 denied`. **Вторая попытка той же
  команды прошла успешно** (скачивание 1,76 ГБ → установка): 867 с
  (≈14,5 мин, средняя скорость ~2,3 МБ/с), exit code 0, финальная строка
  `Success! App '896660' fully installed.`
- Итог установки: `server\valheim_server.exe` **672 256 байт**,
  FileVersion `6000.0.75.2503836` (это Unity-лаунчер, а не «игра»);
  рядом `valheim_server_Data\`, `UnityPlayer.dll`, `MonoBleedingEdge\`, `D3D12\`,
  `steamclient64.dll`, `steamwebrtc64.dll`, `UnityCrashHandler64.exe`,
  `start_headless_server.bat`, `Valheim Dedicated Server Manual.pdf`,
  `steam_appid.txt` (содержимое: `892970`), `steamapps\appmanifest_896660.acf`.
- `appmanifest_896660.acf`: `"buildid" "26266951"`, `"SizeOnDisk" "2112248548"`,
  `"BytesToDownload" "1891190176"`, `"StateFlags""4"` (fully installed).
- Вывод SteamCMD **локализован**: на этой машине русский — `Загрузка обновления`,
  `Проверка установки`, `Разархивирование пакета`; числовой прогресс:
  `[ 55%] Загрузка обновления (… из 29 960 КБ)...`,
  `Update state (0x61) downloading, progress: 55.00 (…/…)`,
  `Update state (0x81) verifying update, progress: 91.14 (…/…)`.
- В каталоге SteamCMD остаются служебные `steamcmd.exe.old`,
  `steamcmd.exe.1.delete`, `.crash`, `.ntfs_transaction_failed` — это нормально.
- SteamCMD-логи: `steamcmd\logs\{console_log,content_log,appinfo_log,bootstrap_log}.txt`.
  Ключевые подтверждения установки в `content_log.txt`:
  `AppID 896660 starting commit from "...steamapps\downloading\896660" to "...server" : 1022 updated...`
  и `AppID 896660 finished update, 2 mounted depots (BuildID 26266951)`.

## 3. Запуск и готовность

**Рабочая командная строка** (проверена):

```text
valheim_server.exe -nographics -batchmode -name TestServer -port 2456 -world TestWorld
  -password test12345 -public 0 -savedir D:\Servers\Valheim\server\savedir
  -logfile D:\Servers\Valheim\logs\server-YYYYMMDD-HHMMSS.log
```

`-nographics -batchmode` работают штатно (GfxDevice = Null). Сервер стартует и
без них, но с ними — корректный headless-режим. Официальный шаблон
`start_headless_server.bat` в 1.0.21 содержит `-nographics -batchmode` и
`-crossplay`, а также напоминание про порты 2456–2458 и пароль.

Тайминги (замеры):

| Сценарий | Время |
| --- | --- |
| Старт процесса → `Valheim version` | 4–5 с |
| Старт → `Game server connected` (существующий мир) | **11,8–12,3 с** |
| Старт → `Opened Steam server` + `Game server connected` (существующий мир) | 11,9–15,7 с (готовность) |
| Старт → `Opened Steam server` (НОВЫЙ мир, с генерацией) | **~31 с**, генерация `Genloc duration: 18569 ms` (18,7 с) |
| Graceful-остановка (Ctrl+C) | **2,4–3,1 с** |
| `taskkill /F` | 0,1 с |

**Порядок строк для существующего мира** (реальный лог, boot 2, мир `TestWorld`
уже создан):

```text
11/08/2026 20:17:10: Setting -savedir to: D:\Servers\Valheim\server\savedir
11/08/2026 20:17:10: Setting -logfile to: D:\Servers\Valheim\logs\server-20261108-201705.log
11/08/2026 20:17:10: Get create world TestWorld
11/08/2026 20:17:10: Using steam_appid.txt
11/08/2026 20:17:10: Using steam APPID:892970
11/08/2026 20:17:10: Server ID 90071992547409920
11/08/2026 20:17:10: Authentication:k_ESteamNetworkingAvailability_Waiting
11/08/2026 20:17:10: Steam game server initialized
11/08/2026 20:17:10: Valheim version: 1.0.21 (network version 41)
11/08/2026 20:17:10: Worldgenerator version setup:2
11/08/2026 20:17:10: Console: Valheim 1.0.21 (network version 41)
11/08/2026 20:17:10: isModded: False
11/08/2026 20:17:13: Loading: ZNet Start
11/08/2026 20:17:13: ZNet.LoadWorld: TestWorld (TestWorld), save number 1
11/08/2026 20:17:17: Registering lobby
11/08/2026 20:17:17: Opened Steam server
11/08/2026 20:17:17: Game server connected
```

(!) В логе 1.0.21 **нет** строки `Shutting down`/`Load world: ...` перед
`ZNet.LoadWorld`; есть `Get create world <World>` (ещё на этапе Unity).

**Новый мир** (boot 1, мир `TestWorld` создавался): `Game server connected`
появляется **рано**, за ~19 с ДО реальной готовности:

```text
11/08/2026 20:15:44: Loading: ZNet Start
11/08/2026 20:15:44: Load world: TestWorld (TestWorld)
11/08/2026 20:15:44:   missing D:\Servers\Valheim\server\savedir/worlds_local/TestWorld.db
11/08/2026 20:15:48: Game server connected          <-- ещё НЕ готов (идёт генерация мира)
11/08/2026 20:15:48: Loading: Generating locations
… (18,7 с генерации) …
11/08/2026 20:16:07: Registering lobby
11/08/2026 20:16:07: Opened Steam server            <-- реальная готовность: порты 2456/2457 заняты
11/08/2026 20:16:07: Loading: Done. Total seconds sinze ZNet start: 22,3779577, Genloc duration: 18569,4475 ms, (Total genloc time: 00:00:18.6748163, locations: 183, iterations: 0)
```

(!) Обратите внимание на `sinze` (опечатка Iron Gate в логе) и запятую как
десятичный разделитель (`22,3779577`) — из-за русской локали сервера. Парсер не
должен полагаться на точку.

**Вывод для приложения:** надёжный маркер готовности — `Opened Steam server`
(+ проверить занятость UDP 2456/2457). `Game server connected` для нового мира
ложный; строка `Loading: Done. Total seconds sinze ZNet start:` бывает только
при генерации нового мира (для существующего её нет).

## 4. Порты и сеть

Замеры во время работы (два запуска, `Get-NetUDPEndpoint -OwningProcess`,
`netstat -ano -p UDP`):

**Обычный режим (без crossplay):**

| Сокет | Адрес | Комментарий |
| --- | --- | --- |
| UDP 2456 | `::` (IPv6 any, dual-stack) | игровой порт (`-port`) |
| UDP 2457 | `0.0.0.0` | Steam query / видимость (`port+1`) |
| UDP эфемерный #1 | `::`/`0.0.0.0` | случайный высокий (напр. 49776, 53993, 50431) |
| UDP эфемерный #2 | `::`/`0.0.0.0` | случайный высокий, меняется каждый запуск |
| TCP `127.0.0.1:<random>` | loopback | внутренний сокет (напр. 63158), меняется |
| исходящие TCP 443 | Steam/PlayFab | напр. 155.133.250.20:27023, 95.100.107.174:443, 150.171.109.195:443 |

- **UDP 2458 vanilla 1.0.21 НЕ занимает** (ни в одном замере). При этом
  официальное руководство и шаблон Iron Gate требуют пробрасывать 2456–2458 —
  правило/проброс на диапазон оставляем, но «2458 closed» — норма, а не ошибка.
- В первые ~12 с после старта (до `Opened Steam server`) занят только 2457;
  проверка «порт 2456 слушается» до `Opened Steam server` даст false.
- В `netstat -ano -p UDP` порт 2456 может отображаться как `0.0.0.0:2456`, а
  `Get-NetUDPEndpoint` — как `::` (dual-stack bind). Для проверки занятости
  смотреть оба (`Get-NetUDPEndpoint -LocalPort 2456` видит `[::]`).

**Crossplay (`-crossplay`):** при `-port 2466` занят UDP **2467** (`port+1`) + два
эфемерных UDP (в прогоне `:::54025`, `0.0.0.0:58700`); сам `-port` и 2456/2458 **не
занимаются**. Это согласуется с моделью PlayFab-relay: проброс портов не нужен,
игроки входят по join code (см. §10 — реальные строки сессии и формат join code).

## 5. Остановка: три способа и их результат

Сервер запускался **с `CREATE_NO_WINDOW`** (.NET `ProcessStartInfo
UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput/Error=true`) —
именно так его запускает менеджер (Rust `Command` + `CREATE_NO_WINDOW`).

| Способ | Результат | Код выхода | Мир | Время |
| --- | --- | --- | --- | --- |
| Ctrl+C helper (`stop-graceful.ps1`) | **OK**, graceful | **0** | сохраняется (`World save (5/5) done`) | 2,4–3,1 с |
| `taskkill /PID` (без `/F`) | **OK**, graceful (закрытие консоли) | **0** | сохраняется | 2,4–3,0 с |
| `taskkill /F /PID` | жёстко, без сохранения | **1** | не сохраняется; последняя завершённая генерация `.ok` цела | 0,1 с |

- HELPER работает даже при `CREATE_NO_WINDOW`: `AttachConsole(pid)` → успех,
  `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)` → доставлен, процесс завершился.
  Вывод helper'а (ASCII, чтобы не ломалась кодировка в перенаправленном потоке):
  `OK: GenerateConsoleCtrlEvent(0) sent to pid 9656`,
  `LOG: world save detected: 11/08/2026 20:18:57: World save (5/5) done. Total time [28ms]`,
  `DONE: process exited in 2,4s (graceful).`
- Механизм `taskkill /PID` без `/F` (WM_CLOSE консольному процессу) на этой
  Windows тоже приводит к корректному `OnApplicationQuit` + сохранению.
- После жёсткого `/F` в логе **нет** `Game - OnApplicationQuit` и `World save`;
  файлы последней завершённой генерации (`_main.N.*` c `.ok`) остаются
  неизменными, следующий запуск грузит `save number N` — данные с момента
  последнего автосохранения теряются.
- **Graceful-остановка во время генерации мира тоже сработала**: сервер записал
  мир (`World save (5/5) done. Total time [31ms]`, save number 1) и вышел с
  кодом 0.

Реальная последовательность graceful-остановки (Ctrl+C, 1.0.21):

```text
11/08/2026 20:16:27: Game - OnApplicationQuit
11/08/2026 20:16:27: Available space to current user: 1802703880192. Saving is blocked if below: 213909504 bytes. Warnings are given if below: 427819008
11/08/2026 20:16:27: ZNet Shutdown
11/08/2026 20:16:27: ZSteamSocket  UnregisterGlobalCallbacks, existing sockets:0
11/08/2026 20:16:27: World save (1/5) Cloud & Backup checks done [0ms] => Save number 1
11/08/2026 20:16:27: World save (2/5) Chunks writing done [11ms]
11/08/2026 20:16:27: World save (3/5) DB2 writing done [15ms]
11/08/2026 20:16:27: World save (4/5) FWL writing done [2ms]
11/08/2026 20:16:27: World save (5/5) done. Total time [35ms]
11/08/2026 20:16:27: Unloading unused assets
11/08/2026 20:16:27: Sending disconnect msg
ZPlayFabMatchmaking::UnregisterServer - unregistering server now. State: Uninitialized
11/08/2026 20:16:27: Disposing socket
11/08/2026 20:16:27: Stopping listening socket
11/08/2026 20:16:27: Last socket, unregistering callback
11/08/2026 20:16:27: ZSteamSocket  UnregisterGlobalCallbacks, existing sockets:0
11/08/2026 20:16:27: Stopping build thread
11/08/2026 20:16:29: ZNet OnDestroy
11/08/2026 20:16:29: Net scene destroyed
11/08/2026 20:16:29: Steam manager on destroy
[Physics::Module] Cleanup current backned.
Input System module state changed to: Shutdown.
```

(!) Сохранение пишется **после** `ZNet Shutdown` и **до** `ZNet OnDestroy` —
между `OnApplicationQuit` и `World save` ~0–1 с; читающий лог должен успеть
зафиксировать `World save (5/5) done` (пауза 1–2 с после выхода процесса
достаточна).

## 6. Файлы мира и списки игроков

**Структура `<savedir>\` после первого старта** (с `-savedir`, реальный листинг):

```text
D:\Servers\Valheim\server\savedir\
├─ adminlist.txt        40 B
├─ bannedlist.txt       41 B
├─ permittedlist.txt    43 B
└─ worlds_local\
   └─ TestWorld\
      ├─ _main.0.fwl2   54 B    (создан до генерации)
      ... после сохранения:
      ├─ _main.1.fwl2   54 B
      ├─ _main.1.db2    146 912 B
      ├─ _main.1.chunks 21 B
      ├─ _main.1.ok     4 B
      └─ 00_00__0_1.chunk  1 484 B
```

- Мир в 1.0 — **папка** `<World>` в `worlds_local`; поколения `_main.N.*`;
  `.ok` — маркер завершённого сохранения; `*.chunk` — чанки террейна.
- `_main.N.fwl2` содержит имя мира в открытом виде (`TestWorld`) + бинарные
  данные; `.ok` — 4 байта (`*` + пробелы). `_main.0.fwl2` — «пустой» мир до
  первого сохранения, после сохранения появляется поколение 1.
- Имя файла `missing`-строки для нового мира использует **смешанные слеши**:
  `missing D:\Servers\Valheim\server\savedir/worlds_local/TestWorld.db`
  (в начале `\`, после savedir — `/`). При дефолтном savedir путь целиком
  прямой: `missing C:/Users/<user>/AppData/LocalLow/IronGate/Valheim/worlds_local/DefaultTestWorld.db`.
  Парсер путей должен нормализовать слеши.
- `-saveinterval` и авто-бэкапы: сервер сам печатает
  `Considering autobackup for World. World time: 0,9399996, short time: 7200, long time: 43200, backup count: 4`
  и `Skipping backup. World session not long enough.` (пороги авто-бэкапа:
  short 7200 / long 43200 с, count 4). При достаточной сессии сервер **создаёт
  папку авто-бэкапа** `worlds_local\<World>_backup_auto-YYYYMMDD-HHMMSS\` с полной
  копией поколения — наблюдали `TestWorld_backup_auto-20261108-202835`
  (21/146912/54/4 B + chunk, копия `_main.5.*`; сам мир ушёл на поколение 6).
  Т.е. собственные бэкапы всё равно нужны, но авто-бэкап стоит учитывать при
  сканировании `worlds_local` (папки `*_backup_auto-*` — не миры).

**Списки игроков** — в **корне `-savedir`** (НЕ в `installDir`!), создаются
сервером при первом старте. Реальное содержимое (hex подтверждает CRLF `0D 0A`,
UTF-8/ASCII без BOM):

```text
adminlist.txt (40 байт):     // List admin players ID  ONE per line\r\n
bannedlist.txt (41 байт):    // List banned players ID  ONE per line\r\n
permittedlist.txt (43 байта): // List permitted players ID ONE per line\r\n
```

- Заголовки-комментарии `//` сервер создаёт сам; строки `//` считаются
  комментариями и сохраняются при перезаписи.
- Формат записи 1.0: `V_<SteamID64>` (Steam) или `X_<ID>` (Xbox/Game Pass).
  Проверить на реальном подключении игрока не удалось (нет второго клиента) —
  доверяем исследованию (`valheim-server-reference.md` §6.2), UI должен
  принимать оба варианта, подсказывая `V_…`.

**Дефолтный savedir (без `-savedir`)** — профиль пользователя
`%USERPROFILE%\AppData\LocalLow\IronGate\Valheim\`; проверено: сервер создал там
`worlds_local\DefaultTestWorld\`, `adminlist.txt` (40 B), `bannedlist.txt` (41 B),
`permittedlist.txt` (43 B). После graceful-остановки мир:
`_main.1.chunks` 10 B, `_main.1.db2` 62 793 B, `_main.1.fwl2` 61 B,
`_main.1.ok` 4 B (свежий мир маленький). Тестовый мир удалён; клиентские папки
`characters/`, `worlds/`, `Player.log` (от клиента, 18:51) не затрагивались.
**Вывод: всегда передавать `-savedir`, иначе мир уходит в профиль Windows.**

## 7. Аргументы командной строки

| Аргумент | Эмпирика |
| --- | --- |
| `-name`, `-port`, `-world`, `-password`, `-public` | работают; имена/пароли с пробелами — в кавычках; `-public 0/1` |
| `-savedir` | работает, каталог создаётся; миры в `<savedir>\worlds_local`, списки в корне `<savedir>` |
| `-logfile` | работает; файл **перезаписывается** при старте (не append) |
| `-nographics`, `-batchmode` | работают (NullGfxDevice), headless |
| `-preset hard` | **подтверждён**: `Setting world modifier preset: hard` |
| `-modifier combat hard` | **подтверждён** (пара через пробел): `Setting world modifier: combat->hard`; формат `key:value` тоже принимается скриптом (проверено на `-Modifier 'combat:hard'` — см. ниже про лог) |
| `-saveinterval 60` | принимается без ошибок (лог не эхом); автосохранение по таймеру — см. тест §10 |
| `-crossplay` | работает; порты меняются (2457 + эфемерные, без 2456); join code — §10 |
| `-instanceid` | принимается (синтаксис `-instanceid <id>`) — проверен запуском вместе с crossplay |
| `-setkey`, `-resetmodifiers` | не проверялись запуском (вне критичного объёма) |
| `-maxplayers`, `-console`, `-adminlist` | не существуют (см. reference §3.6) — не проверялись, т.к. сервер не выдаёт ошибок на неизвестные аргументы |

(!) На неизвестные аргументы сервер **не ругается** — просто игнорирует; поэтому
валидация аргументов в приложении обязательна.

## 8. Логи

- С `-logfile <path>`: файл создаётся/перезаписывается, **UTF-8 без BOM**,
  **CRLF**; строки игрового лога с префиксом `MM/DD/YYYY HH:mm:ss: `
  (US-формат!), строки Unity — без префикса (`Mono path[0] = ...`,
  `Initialize engine version: 6000.0.75f1 (26349cd2a5c8)`).
  Первая строка файла — `Mono path[0] = 'D:/Servers/Valheim/server/valheim_server_Data/Managed'`.
- Без `-logfile` файла по умолчанию нет (вывод в stdout). `Player.log` клиента
  сервер не трогал (mtime остался 18:51).
- stdout при `-logfile` почти пуст: 1771 байт Unity memory setup
  (`[UnityMemory] Configuration Parameters ...`), stderr — 0 байт. Но stdout-пайп
  всё равно надо вычитывать (риск блокировки при заполнении буфера).
- Маркеры для парсера: `Valheim version: 1.0.21 (network version 41)`,
  `ZNet.LoadWorld: <W> (<W>), save number N`, `Registering lobby`,
  `Opened Steam server`, `Game server connected`, `Loading: Generating locations`,
  `Loading: Done. Total seconds sinze ZNet start:`,
  `World save (1/5) … => Save number N`, `World save (5/5) done. Total time [Nms]`,
  `Game - OnApplicationQuit`, `ZNet Shutdown`, `ZNet OnDestroy`,
  `Steam manager on destroy`, `Error bad password:` (при неверном пароле).
  В crossplay дополнительно: `Opened PlayFab server`,
  `Session "<name>" registered with join code <6 digits>`,
  `Session "<name>" with join code <6 digits> and IP <ip>:<port> is active with N player(s)`
  (и ловушка `New session server "…" that has join code , …` с ПУСТЫМ кодом).
- В логе есть «шумные» строки Unity/шэйдеров (`The referenced script ... is
  missing!`, `Could not find ... shader`, `HDR Render Texture not supported`) —
  их не считать ошибками сервера.
- Локаль сервера влияет на числа в логе (запятая) и на вывод SteamCMD (русский).

## 9. Брандмауэр (проверено)

Добавлено входящее правило UDP 2456–2458 (elevation required):

```powershell
netsh advfirewall firewall add rule name="Valheim Server (UDP 2456-2458)" `
  dir=in action=allow protocol=UDP localport=2456-2458 profile=any `
  description="Valheim dedicated server game/query ports (2456 game, 2457 query, 2458 tertiary)"
```

`netsh advfirewall firewall show rule name="Valheim Server (UDP 2456-2458)" verbose`:

```text
Rule Name:                            Valheim Server (UDP 2456-2458)
Enabled:                              Yes
Direction:                            In
Profiles:                             Domain,Private,Public
LocalIP:                              Any
RemoteIP:                             Any
Protocol:                             UDP
LocalPort:                            2456-2458
Edge traversal:                       No
Action:                               Allow
```

`Get-NetFirewallRule -DisplayName 'Valheim Server*'` → `Enabled True, Inbound,
Allow, Any`. Профили брандмауэра включены (`Domain/Private/Public: True`).

## 10. Дополнительно проверенное (crossplay / -saveinterval / preset / modifier)

**`-preset` + `-modifier` подтверждены запуском** (лог 1.0.21):

```text
11/08/2026 20:27:18: Setting world modifier preset: hard
11/08/2026 20:27:18: Setting world modifier: combat->hard
11/08/2026 20:27:18: Valheim version: 1.0.21 (network version 41)
```

Т.е. `-modifier combat hard` (ключ и значение отдельными аргументами) работает,
а в лог пишется `combat->hard` (не `combat:hard`).

**`-crossplay`** (проверен запуском, 1.0.21):

- Стартует штатно; при остановке в логе `ZPlayFabMatchmaking::UnregisterServer -
  unregistering server now. State: Uninitialized`, в начале —
  `Sending PlayFab login request (attempt 1)`.
- Порты: замер показал UDP **2457** + два эфемерных высоких UDP
  (`0.0.0.0:53550`, `::65223`), **UDP 2456 не занимается** (как и 2458). Проброс
  портов для crossplay не нужен (relay PlayFab).
- (!) **`Opened Steam server` в crossplay-режиме не появляется** — сервер
  регистрируется через PlayFab, а не Steam-сокетом; вместо него в конце
  генерации печатается `Opened PlayFab server`. Для crossplay признак
  готовности существующего мира — `Game server connected` (появляется через
  ~4 с после `ZNet.LoadWorld`, до появления `Registering lobby`); для НОВОГО
  мира он, как и в Steam-режиме, приходит рано (в тот же момент, что
  `Loading: Generating locations`), а реальные маркеры готовности —
  `Loading: Done. Total seconds sinze ZNet start: …` и/или строка с join code.

**Подтверждено отдельным crossplay-прогоном (новый мир, порт 2466, реальный лог):**

```text
11/08/2026 20:36:48: Get create world OpsCrossplayNew2
11/08/2026 20:36:48: Valheim version: 1.0.21 (network version 41)
11/08/2026 20:36:48: Sending PlayFab login request (attempt 1)
11/08/2026 20:36:51: Loading: ZNet Start
11/08/2026 20:36:51:   missing D:\...\savedir/worlds_local/OpsCrossplayNew2.db
11/08/2026 20:36:54: Game server connected                <-- НЕ готово, до генерации
11/08/2026 20:36:54: Loading: Generating locations
… (~20 c генерация) …
11/08/2026 20:37:14: PlayFab custom ID set to "PlayFab_OpsCrossplayTest_2466_<hash>"
11/08/2026 20:37:14: Sending PlayFab login request (attempt 2)
11/08/2026 20:37:14: Opened PlayFab server                    <-- crossplay-аналог Opened Steam server
11/08/2026 20:37:14: Loading: Done. Total seconds sinze ZNet start: 23,3088205, Genloc duration: 19543,8185 ms, (Total genloc time: 00:00:19.6330563, locations: 183, iterations: 0)
11/08/2026 20:37:15: Logged in PlayFab user via custom ID
11/08/2026 20:37:15: New session server "OpsCrossplayTest" that has join code , now 0 player(s)   <-- код ПУСТОЙ в этой строке!
11/08/2026 20:37:15: Register PlayFab server "OpsCrossplayTest" with IP 203.0.113.10:2466
11/08/2026 20:37:17: Joined PlayFab Party network with ID "…"
11/08/2026 20:37:18: Created PlayFab lobby with ID "…"
11/08/2026 20:37:18: Session "OpsCrossplayTest" registered with join code 863039
11/08/2026 20:37:18: Session "OpsCrossplayTest" with join code 863039 and IP 203.0.113.10:2466 is active with 0 player(s)
```

Выводы для парсера:
- `Loading: Done. Total seconds sinze ZNet start:` **есть и в crossplay+новый мир**
  (через ~20 с после `Game server connected`) — fallback на нём корректен.
- Формат join code в 1.0.21: `Session "<name>" registered with join code <6 digits>`
  и `Session "<name>" with join code <6 digits> and IP <public_ip>:<port> is active
  with N player(s)`. Join code — **6 цифр** (в прогоне `863039`).
- Ловушка: строка `New session server "<name>" that has join code , now 0 player(s)`
  содержит **пустой** join code — нельзя парсить её как код; ждать `\d{6}`.
- Строка Session содержит **публичный** IP:порт (`203.0.113.10:2466`), не локальный.
- Порты crossplay: при `-port 2466` занят UDP **2467** (`port+1`) + 2 эфемерных UDP
  (в прогоне `:::54025`, `0.0.0.0:58700`); сам `-port` (2466) и 2456 не занимаются.
- `Registering lobby` в crossplay не появляется; `Sending PlayFab login request` —
  info-строка, не готовность.
- Graceful-остановка crossplay-сервера работает так же (`taskkill /PID` → exit 0,
  `World save (5/5) done`, мир сохранён: `_main.1.*` + `.ok`).
- Join code меняется после рестарта (регистрация в PlayFab выполняется заново).

**`-saveinterval`**:

- Аргумент принимается без ошибок (`-saveinterval 60`), сервер стартует и
  сохраняется штатно; в логе значение не echoed.
- Автосохранение по таймеру в 60 с в рамках тестов наблюдать не удалось (окна
  прогонов были короче; параллельно на машине Lead запускал e2e приложения, один
  из прогонов был внешне завершён — повторные прогоны тех же аргументов
  стартовали и останавливались штатно). Косвенно таймер подтверждается логом
  авто-бэкапов: `Considering autobackup for World. World time: N, short time:
  7200, long time: 43200, backup count: 4` и `Skipping backup. World session not
  long enough.` (пороги авто-бэкапа зашиты: 7200/43200 с, count 4).
- Практический вывод: значение передавать, но не полагаться на него как на
  гарантию бэкапа — собственные бэкапы (`backup-server.ps1`) обязательны.

**Прочее из прогонов**: `-nographics -batchmode -savedir -logfile -public -port
-world -name -password -crossplay -preset -modifier -saveinterval` — все
принимаются; на неизвестные аргументы сервер не ругается (молча игнорирует),
поэтому валидация аргументов должна быть в приложении.

## 11. Инструменты и артефакты проверки

- Скрипты (в поставке): `D:\Servers\Valheim\scripts\{install-server,start-server,
  stop-server,stop-graceful,backup-server}.ps1` — см. [`SCRIPTS.md`](./SCRIPTS.md).
- Результаты прогонов (runtime, gitignored): `runtime\test-*.json` (запуск/
  остановка в разных режимах, коды выхода, порты), `runtime\remaining-tests.txt`,
  `runtime\crossplay-saveinterval.txt`, `runtime\diag-console.ps1`.
- Логи серверных прогонов (оставлены как эталон): `logs\server-20261108-201536.log`
  (новый мир, boot 1), `logs\server-20261108-201705.log` (существующий мир,
  boot 2). Остальные тестовые логи удалены после проверок.
- Все тестовые серверы остановлены; `valheim_server.exe` не запущен, порты
  2456/2457 свободны.

## 12. Расхождения с документацией / справочником

| Что ожидалось (reference/официально) | Что реально (1.0.21) |
| --- | --- |
| `World saved ( 412.5ms )` — маркер сохранения | строки нет; реально `World save (5/5) done. Total time [35ms]` (+ `World save (1/5) … => Save number N`); старый формат `World saved (…)` в 1.0.21 не встречается |
| `Shutting down` при остановке | строки нет; `Game - OnApplicationQuit` → `ZNet Shutdown` → `World save…` → `ZNet OnDestroy` → `Steam manager on destroy` |
| `Game server connected` = готов | для **нового** мира появляется за ~19 с до готовности; надёжный маркер — `Opened Steam server` (+ занятые UDP 2456/2457) |
| UDP 2456+2457(+2458) слушаются | 2456 (IPv6 dual-stack) + 2457 (IPv4); **2458 не слушается**; ещё 2 эфемерных UDP и loopback TCP |
| `taskkill /PID` без /F «не сработает» (нет message loop) | **сработал**: корректное завершение + сохранение мира, exit code 0 (на этой Windows, для консольного процесса) |
| `-modifier` формат `<key> <value>` | подтверждён (`Setting world modifier: combat->hard`); лог использует `->` |
| Списки в каталоге сохранений | подтверждено: `<savedir>\adminlist.txt` и т.д., рядом с `worlds_local` |
| Дефолтный savedir — `%USERPROFILE%\AppData\LocalLow\IronGate\Valheim` | подтверждено (миры, списки создаются там) |
| SteamCMD `+quit` возвращает 0 | первый self-update может вернуть **7**; `app_update` при успехе — 0, при «Missing configuration» — 8 (транзиентно, retry помогает) |
| Пароль обязателен, 5–20 символов, не в имени | подтверждено официальным шаблоном; поведение `Error bad password:` — из документации (не воспроизводили отдельно) |
| `-saveinterval` — дефолт 1800 | аргумент принимается; автосохранение см. §10 |

## 13. Подводные камни и риски (кратко)

1. `-world` с опечаткой молча создаёт новый мир (и `missing`-строка — маркер).
2. Всегда передавать `-savedir` — иначе мир в профиле Windows (трудно найти,
   ломается при смене пользователя/перезапуске сервиса).
3. `-logfile` перезаписывается при старте — ротация/архив логов на стороне
   менеджера; логи сервера не ротируются.
4. Маркер готовности: `Opened Steam server` (+порты), а не `Game server
   connected` (особенно для нового мира).
5. Останавливать только graceful (Ctrl+C helper или `taskkill /PID` без `/F`);
   `/F` — крайний случай, теряются изменения с последнего сохранения (до 30 мин),
   риск убить в момент записи сохранения.
6. `permittedlist.txt` с любой записью закрывает сервер для всех остальных
   (whitelist) — предупреждать в UI.
7. SteamCMD: транзиентная `Missing configuration`; exit 7 при первом `+quit`;
   локализованный вывод.
8. Сервер открывает исходящий трафик Steam/PlayFab — сеть обязательна; для
   crossplay нет прямого IP-подключения, только join code.
9. Мир 1.0 — папка: бэкапить/восстанавливать `worlds_local\<World>\` целиком;
   `.ok` = признак завершённого поколения.
10. Логи/числа локализованы (русская локаль: `22,3779577`, русские строки
    SteamCMD) — не парсить по точке/английским словам SteamCMD.
