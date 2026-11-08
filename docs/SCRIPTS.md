# Скрипты обслуживания Valheim-сервера

Рабочие PowerShell-скрипты в `D:\Servers\Valheim\scripts\`. Все проверены
запуском на реальном сервере (Valheim Dedicated Server 1.0.21). Рекомендуемый
хост — PowerShell 7 (`pwsh`); скрипты сохранены в UTF-8 с BOM и разбираются
также Windows PowerShell 5.1.

Общее для всех: база раскладки — `%PSScriptRoot%\..` (т.е. `D:\Servers\Valheim`),
каждый путь можно переопределить параметром. Сообщения на русском; ошибки — с
понятным текстом; коды выхода перечислены ниже.

## install-server.ps1

Установка/обновление SteamCMD и сервера (appid 896660) + проверка результата.

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `-Root` | родитель `scripts` | база раскладки |
| `-SteamCmdDir` | `<root>\steamcmd` | каталог SteamCMD |
| `-ServerDir` | `<root>\server` | каталог установки сервера |
| `-AppId` | `896660` | appid Valheim Dedicated Server |
| `-SkipSelfUpdate` | — | не делать self-update SteamCMD |
| `-MaxAttempts` | `3` | попыток `app_update` (транзиентная ошибка Steam) |
| `-SteamCmdUrl` | официальный URL | откуда качать `steamcmd.zip` |

Поведение: при отсутствии `steamcmd.exe` скачивает официальный zip (0,74 МБ) и
распаковывает; self-update (`+quit`, exit 7 на свежем клиенте = норма);
`+force_install_dir … +login anonymous +app_update 896660 validate +quit` с
повторами; проверяет `valheim_server.exe`, печатает размер/файлы/время.

```powershell
pwsh -File .\install-server.ps1
```

Коды выхода: `0` — установлено/обновлено; `1` — не скачался/не распаковался
SteamCMD; `2` — `app_update` не удался после всех попыток; `3` — успех
SteamCMD, но `valheim_server.exe` отсутствует.

## start-server.ps1

Запуск сервера отдельным процессом со скрытой собственной консолью (обязательно
для корректной остановки), ожидание готовности, запись `runtime\server.json` и
`runtime\server.pid`.

Основные параметры: `-Name`, `-Port` (2456), `-World` (`Dedicated`),
`-Password` (**обязателен**, 5–20 символов), `-Public` (switch),
`-Savedir` (`<server>\savedir`), `-LogFile` (`<root>\logs\server-<ts>.log`),
`-Crossplay`, `-InstanceId`, `-Preset`, `-Modifier` (`'combat','hard'` или
`'combat:hard'`), `-SetKey`, `-SaveInterval` (0 = дефолт 1800), `-ExtraArgs`,
`-ReadyTimeoutSec` (180), `-NoWait`, `-VisibleConsole`.

Проверки перед запуском: наличие `valheim_server.exe`; длина пароля; пароль не
входит в имя/мир; UDP-порты `port..port+2` свободны; уже запущенный
`valheim_server` отсутствует. Готовность: в логе `Game server connected`
(см. `ops-findings.md` §3 — для нового мира надёжнее `Opened Steam server`, но
скрипт проверяет оба состояния по факту выхода процесса).

```powershell
pwsh -File .\start-server.ps1 -Name "Valheim RU" -Password "SuperSecret1"
pwsh -File .\start-server.ps1 -Port 2458 -World Midgard -Password "SuperSecret1" -Public -Preset hard -SaveInterval 900
```

Коды выхода: `0` — сервер готов; `1` — ошибка параметров; `2` — нет установки/
порт занят/ошибка запуска; `3` — процесс завершился до готовности; `4` — процесс
жив, готовность не подтверждена за `-ReadyTimeoutSec`.

## stop-server.ps1

Остановка сервера: по умолчанию graceful — Ctrl+C через `stop-graceful.ps1`
(отдельным процессом), fallback `taskkill /PID` без `/F`; принудительно —
только с `-Method Force` / `-AllowForceFallback`.

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `-ServerPid` | из `runtime\server.json`/`server.pid` | PID сервера |
| `-Method` | `Auto` | `Auto` / `CtrlC` / `Taskkill` / `Force` |
| `-TimeoutSec` | `60` | ожидание завершения |
| `-AllowForceFallback` | — | в Auto разрешить добить `/F` |

После остановки проверяет лог на маркер сохранения
`World save (5/5) done` (в 1.0.21 строки `World saved` нет) и сообщает результат.

```powershell
pwsh -File .\stop-server.ps1
pwsh -File .\stop-server.ps1 -Method Force
```

Коды выхода: `0` — корректно остановлен (или уже не работал); `1` — внутренняя
ошибка; `2` — процесса нет; `3` — graceful не удался, процесс жив (нужен
`-Method Force`); `4` — убит принудительно (`/F`).

## stop-graceful.ps1

Низкоуровневый helper корректной остановки (используется `stop-server.ps1`;
может вызываться напрямую). Win32 через P/Invoke, без внешних утилит:
`FreeConsole()` → `AttachConsole(pid)` → `SetConsoleCtrlHandler(NULL,TRUE)` →
`GenerateConsoleCtrlEvent(CTRL_C_EVENT,0)` → `FreeConsole()`, затем ожидание
выхода процесса и проверка сохранения в логе. Работает и для процесса,
запущенного с `CREATE_NO_WINDOW` (проверено).

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `-ServerPid` | — (обязателен) | PID `valheim_server.exe` |
| `-CtrlEvent` | `0` | `0` = CTRL_C_EVENT, `1` = CTRL_BREAK_EVENT |
| `-WaitSec` | `60` | сколько ждать завершения |
| `-LogFile` | — | лог сервера для проверки `World save` |

Вывод — ASCII-строки (`OK: …`, `LOG: …`, `DONE: …`), чтобы не ломалась
кодировка при перенаправлении в файл/пайп.

```powershell
pwsh -File .\stop-graceful.ps1 -ServerPid 12345 -LogFile D:\Servers\Valheim\logs\server-....log
```

Коды выхода: `0` — сигнал отправлен, процесс завершился (graceful); `1` — ошибка
`AttachConsole`/`GenerateConsoleCtrlEvent`/доступа; `2` — процесс жив после
`-WaitSec`; `3` — процесса с таким PID нет.

## backup-server.ps1

Бэкап и восстановление мира: zip `savedir\worlds_local` + `adminlist.txt`,
`bannedlist.txt`, `permittedlist.txt`; проверка архива; ротация; восстановление
с автоматическим страховочным бэкапом и переименованием текущих файлов в
`*.pre-restore-<timestamp>`.

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `-Savedir` | `<server>\savedir` | каталог сохранений |
| `-BackupsDir` | `<root>\backups` | куда класть zip |
| `-Keep` | `10` | сколько архивов хранить (0 = не удалять) |
| `-Label` | — | суффикс имени архива |
| `-Force` | — | разрешить операцию при запущенном сервере |
| `-Restore` + `-Zip <path>` | — | восстановление из архива |

```powershell
pwsh -File .\backup-server.ps1
pwsh -File .\backup-server.ps1 -Keep 20 -Label before-update
pwsh -File .\backup-server.ps1 -Restore -Zip .\backups\valheim-backup-20261108-202823.zip
```

Проверено: архив 212 061 байт, 12 записей, пути внутри `worlds_local/<World>/…`
и списки в корне; при запущенном сервере скрипт отказывает (exit 3).

Коды выхода: `0` — успех; `1` — ошибка архивации/распаковки; `2` — нет
`savedir`/`worlds_local`; `3` — сервер запущен (без `-Force`); `4` — не найден
архив для восстановления.

## Типовые сценарии

```powershell
# Первичная установка
pwsh -File .\install-server.ps1

# Запуск + проверка
pwsh -File .\start-server.ps1 -Name "Valheim RU" -Password "SuperSecret1"
Get-NetUDPEndpoint -LocalPort 2456,2457 | Format-Table LocalAddress,LocalPort,OwningProcess

# Плановая остановка + бэкап + обновление
pwsh -File .\stop-server.ps1
pwsh -File .\backup-server.ps1 -Label before-update
pwsh -File .\install-server.ps1
pwsh -File .\start-server.ps1 -Name "Valheim RU" -Password "SuperSecret1"
```
