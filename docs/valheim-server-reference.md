# Valheim Dedicated Server (Windows) — справочник для десктоп-менеджера

> **Назначение.** Техническая спецификация выделенного сервера Valheim под Windows (Tauri 2 + Rust менеджер).
> Только факты, пути, флаги, форматы строк и ограничения. Код приложения здесь не рассматривается.
>
> **Дата составления:** 2026-11-08.
> **Целевая версия игры:** Valheim **1.0.x** (1.0 вышла 2026-09-09; на момент написания в логах фигурирует `1.0.20`).
> **Целевая ОС:** Windows 10/11 x64.
>
> **Важно про версию 1.0.** Iron Gate сменила формат сохранений мира и перешла на более новый Unity, но **не меняла и не добавляла параметры запуска** — `-name`, `-world`, `-password`, `-port`, `-crossplay`, пресеты и модификаторы работают как раньше ([Host Havoc, patch notes 1.0](https://hosthavoc.com/en-GB/blog/valheim-1-0-update-server-owners); про смену движка — [low.ms](https://low.ms/knowledgebase/valheim-dedicated-server-crashes-on-startup)). Всё, что ниже помечено `1.0`, относится именно к новому формату; старый формат (`*.fwl` + `*.db`) описан отдельно, потому что он всё ещё встречается и конвертируется при первом сохранении.

## Легенда достоверности

| Метка | Значение |
| --- | --- |
| ✅ | Подтверждено официальной документацией Iron Gate / Valve или прямым наблюдением в коде/конфиге сервера |
| 🟡 | Подтверждено несколькими независимыми community-источниками (хостинги, docker-проекты, вики) |
| ⚠️ | Единственный источник, косвенные данные или логический вывод — требует проверки на живом сервере |

> **Методика.** Документ собран по официальному руководству Iron Gate, документации Valve по SteamCMD, Thunderstore/BepInEx и community-документации (lloesche/valheim-server-docker, хостинговые базы знаний, разборы логов).
> Ограничение среды: инструмент полного скачивания страниц в этой сессии возвращал HTTP 404, поэтому текст источников читался через поисковые выдержки. Там, где формулировка источника неоднозначна, это явно отмечено в разделе [«Открытые вопросы»](#13-открытые-вопросы).

## Содержание

1. [Кратко: что важно знать до начала реализации](#1-кратко-что-важно-знать-до-начала-реализации)
2. [SteamCMD: установка, обновление, структура файлов](#2-steamcmd-установка-обновление-структура-файлов)
3. [Аргументы командной строки сервера](#3-аргументы-командной-строки-сервера)
4. [Порты и сеть](#4-порты-и-сеть)
5. [Сохранения мира на Windows](#5-сохранения-мира-на-windows)
6. [adminlist.txt / bannedlist.txt / permittedlist.txt](#6-adminlisttxt--bannedlisttxt--permittedlisttxt)
7. [Логи: расположение, форматы строк, парсинг](#7-логи-расположение-форматы-строк-парсинг)
8. [Корректная остановка сервера на Windows](#8-корректная-остановка-сервера-на-windows)
9. [Crossplay](#9-crossplay)
10. [Лимиты, требования, публичный список серверов](#10-лимиты-требования-публичный-список-серверов)
11. [BepInEx / Thunderstore: моды на сервере](#11-bepinex--thunderstore-моды-на-сервере)
12. [Сводка для реализации](#12-сводка-для-реализации)
13. [Открытые вопросы](#13-открытые-вопросы)
14. [Источники](#14-источники)

---

## 1. Кратко: что важно знать до начала реализации

- Сервер — **отдельное бесплатное приложение Steam** `896660` («Valheim Dedicated Server»), ставится через SteamCMD с `anonymous`-логином; владеть Valheim на аккаунте не нужно ([Flux](https://runonflux.com/games/valheim/self-host-valheim), [ConnectHosting](https://connecthosting.net/blog/valheim-dedicated-server-setup-guide)).
- Конфигурация — **только аргументы командной строки**. Файла конфигурации у сервера нет ([SurvivalServers Wiki](https://www.survivalservers.com/wiki/Valheim_Server_Settings), [Spawnly](https://spawnly.net/tools/config-generator/valheim)).
- Сохранения и три списка доступа (admin/ban/permit) лежат **не в папке установки**, а в каталоге сохранений пользователя, от которого запущен процесс: по умолчанию `%USERPROFILE%\AppData\LocalLow\IronGate\Valheim` ([Loafhosts](https://loafhosts.com/guides/valheim-server-files/), [Valheim Companion](https://www.valheimcompanion.com/servers/dedicated-server-setup)).
- Один процесс = один мир. Мир идентифицируется **именем**, а не путём и не seed ([hebergtonserv](https://hebergtonserv.com/tutoriels/plusieurs-mondes-serveur-valheim/)).
- Готовность сервера определяется строкой `Game server connected` в логе, а не фактом запуска процесса ([Valheim Companion](https://www.valheimcompanion.com/servers/server-not-showing)).
- Корректная остановка — **Ctrl+C** в консоли сервера (так рекомендует Iron Gate); после неё в логе должна появиться строка `World saved` ([официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/), [renode.space](https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost)).
- **Vanilla-сервер не читает stdin**: консольные команды `save`/`quit` по stdin не работают, для этого нужен мод ([ConsoleStdinHeeler](https://thunderstore.io/c/valheim/p/DreamWraith/ConsoleStdinHeeler/), [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/)).
- Лимит игроков в 1.0 — **10**, как и раньше ([Game8](https://game8.co/games/Valheim/archives/620588), [Host Havoc](https://hosthavoc.com/en-GB/blog/valheim-1-0-update-server-owners)).

---

## 2. SteamCMD: установка, обновление, структура файлов

### 2.1. Официальная загрузка (Windows)

| Что | Значение | Источник |
| --- | --- | --- |
| Страница документации | `https://developer.valvesoftware.com/wiki/SteamCMD` | [Valve Developer Wiki](https://developer.valvesoftware.com/wiki/SteamCMD) |
| Прямая ссылка на Windows-архив | `https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip` | [Valve Developer Wiki](https://developer.valvesoftware.com/wiki/SteamCMD), URL воспроизведён в [North Beach Games KB](https://northbeachgames.freshdesk.com/support/solutions/articles/154000217670-can-i-use-steamcmd-to-install-the-dedicated-server-) |
| Исполняемый файл | `steamcmd.exe` (x86, 32-битный) | [Valve Developer Wiki](https://developer.valvesoftware.com/wiki/SteamCMD) |
| Куда распаковывать | любая папка, которую не блокирует Windows; **не в корень диска** — иначе возможна ошибка «out of disk space» | [North Beach Games KB](https://northbeachgames.freshdesk.com/support/solutions/articles/154000217670-can-i-use-steamcmd-to-install-the-dedicated-server-) |
| Первый запуск | запустить `steamcmd.exe` и дать ему самообновиться (`.\steamcmd +quit`) | [FireDaemon KB](https://kb.firedaemon.com/support/solutions/articles/4000195004-valheim-dedicated-server-as-windows-service) |

> 🟡 SteamCMD для Windows не требует установки: это self-updating консольный распаковываемый архив. После первого запуска в папке появляются `steamapps/`, `package/`, `public/`, `steamcmd.exe`.

### 2.2. Команды установки и обновления

**Однострочная команда (рекомендуемый вариант для менеджера):**

```bat
steamcmd.exe +force_install_dir "D:\Servers\Valheim\server" +login anonymous +app_update 896660 validate +quit
```

- Порядок `+force_install_dir` **до** `+login` рекомендует сама Valve ([space-node](https://space-node.net/blog/valheim-incompatible-version-connect-fix-2026): «Valve's SteamCMD page says to set the install folder before logging in»).
- `anonymous` — корректный логин для этого appid ([ConnectHosting](https://connecthosting.net/blog/valheim-dedicated-server-setup-guide), [lloesche/valheim-server-docker](https://hub.docker.com/r/lloesche/valheim-server)).
- `validate` — сверяет файлы с эталоном Steam и перезаписывает изменённые; **файлы, не входящие в поставку (ваши скрипты, BepInEx), не удаляются** ([space-node](https://space-node.net/blog/valheim-incompatible-version-connect-fix-2026), [uGetFix](https://ugetfix.com/dll/winhttp.dll)).
- `-beta public` — необязательный явный выбор обычной (не-beta) ветки ([space-node](https://space-node.net/blog/valheim-incompatible-version-connect-fix-2026)).

**Интерактивный вариант (то же самое по шагам):**

```text
login anonymous
force_install_dir C:\ValheimServer
app_update 896660 validate
quit
```

([VolticHost KB](https://voltichost.com/knowledgebase/a/how-to-install-and-configure-a-valheim-dedicated-server-on-a-windows-vps))

**Через GUI Steam (альтернатива):** библиотека → фильтр «Инструменты» → «Valheim Dedicated Server» → установить. Файлы те же, но путь задаёт Steam ([Game8](https://game8.co/games/Valheim/archives/620871), [vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html)).

### 2.3. Идентификаторы приложения

| Сущность | ID | Источник |
| --- | --- | --- |
| Valheim Dedicated Server (app) | `896660` | [ConnectHosting](https://connecthosting.net/blog/valheim-dedicated-server-setup-guide), [lloesche](https://hub.docker.com/r/lloesche/valheim-server) |
| Windows depot | `896663` | [SteamDB depot 896663](https://steamdb.info/depot/896663/) |
| Linux depot | `896661` | [SteamDB depot 896661](https://steamdb.info/depot/896661/history/) |
| Клиент Valheim (game appid) | `892970` | [официальный `start_headless_server.bat` через vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html), [fandom](https://valheim.fandom.com/wiki/Dedicated_servers) |

> ✅ Клиентский appid `892970` важен: официальный скрипт запуска выставляет `set SteamAppId=892970`. Если в `steam_appid.txt` лежит `896660` вместо `892970`, crossplay-аутентификация через PlayFab может не работать — это одна из типовых причин ([WinterNode](https://winternode.com/blog/valheim/valheim-server-won-t-start-real-error-causes-and-fixes)).

### 2.4. Размер и структура установки

| Параметр | Значение | Источник |
| --- | --- | --- |
| Размер файлов 1.0 | «чуть больше 2 GB» в распакованном виде | [ConnectHosting](https://connecthosting.net/blog/valheim-dedicated-server-setup-guide) |
| Рекомендуемый диск | 10 GB (с запасом на бэкапы и миры) | [Flux](https://runonflux.com/games/valheim/self-host-valheim), [Corallium](https://www.coralliumstudios.net/templates/valheim) |
| Основной исполняемый файл | `valheim_server.exe` | [Fly-Serv](https://www.fly-serv.com/br/blog/servidor-valheim-dedicado-configurar-passo-a-passo), [Spawnly](https://spawnly.net/tools/config-generator/valheim) |
| Официальный стартовый скрипт Windows | `start_headless_server.bat` | [vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html), [Valheim Companion](https://www.valheimcompanion.com/servers/dedicated-server-setup) |
| Стартовый скрипт Linux | `start_server.sh`, бинарь `valheim_server.x86_64` | [vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html) |

Типовая структура каталога установки (Windows):

```text
<install_dir>\
├─ valheim_server.exe            # главный исполняемый файл
├─ valheim_server_Data\          # Unity data: Managed\*.dll, resources, MonoBleedingEdge\
├─ start_headless_server.bat     # официальный шаблон запуска (править лучше копию)
├─ steam_appid.txt               # должен содержать 892970
└─ (служебные файлы SteamCMD)
```

Доказательства состава: в манифестах Windows-депота фигурируют пути вида `valheim_server/Data/Managed/System.Xml.dll`, `.../Unity.InputSystem.dll` и т.д. ([SteamDB, depot 896663](https://steamdb.info/depot/896663/history/?changeid=M:932473376395593663)) — то есть `*_Data\Managed` с Managed-сборками Unity присутствует, а BepInEx-хуки ставятся именно в корень рядом с `valheim_server.exe`.

> ⚠️ Точный список файлов корня (`*.bat`, наличие `steam_appid.txt`, `doorstop`-файлов по умолчанию) по источникам не сверялся построчно: в поставке точно есть `valheim_server.exe`, `valheim_server_Data\` и `start_headless_server.bat`. Менеджеру не следует завязываться на полный перечень — достаточно проверять наличие `valheim_server.exe` и `valheim_server_Data\`.

### 2.5. Как проверить установку и версию

| Способ | Как | Что даёт | Источник |
| --- | --- | --- | --- |
| Файловая проверка | существует `<install_dir>\valheim_server.exe` и папка `valheim_server_Data\` | факт установки | [Fly-Serv](https://www.fly-serv.com/br/blog/servidor-valheim-dedicado-configurar-passo-a-passo) |
| Манифест SteamCMD | `<steamcmd>\steamapps\appmanifest_896660.acf`, поле `"buildid"` | установленный build, сравнение с удалённым | [паттерн разбора `appmanifest`/`app_info_print`](https://looselydecoupled.com/update-7-days-to-die-server-only-on-new-build/) |
| Запрос к Steam | `steamcmd.exe +login anonymous +app_info_update 1 +app_info_print 896660 +quit` → искать `"buildid"` | актуальный build в Steam (для «есть ли обновление») | [looselydecoupled](https://looselydecoupled.com/update-7-days-to-die-server-only-on-new-build/) |
| Лог сервера | строка `Valheim version: l-1.0.20 (network version 41)` | фактическая версия запущенного сервера | [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/), [renode.space](https://renode.space/blog/valheim-server-log-file-explained) |
| Код возврата SteamCMD | `0` — успех; иначе разбирать текст (`Error! App '896660' state is 0x6 after update job.`) | успешность обновления | [пример ошибки 0x6](https://steamcommunity.com/app/892970/discussions/0/573803804385009352/), [практика обработки кодов](https://github.com/pterodactyl/yolks/pull/49/files) |

Типовые маркеры проблем SteamCMD:

- `Error! App '896660' state is 0x6 after update job.` — обновление не завершилось; в обсуждении помогает переустановка/переименование каталога ([Steam Community](https://steamcommunity.com/app/892970/discussions/0/573803804385009352/)).
- `App '896660' already up to date.` — обновление не требуется (полезно для софт-проверки «есть ли обновление») ([renode.space, SteamCMD on Windows](https://renode.space/blog/steamcmd-on-windows)).

> 💡 Практика: обновлять только при **остановленном** сервере — иначе риск получить полуобновлённый набор файлов и/или повреждённый мир ([renode.space, SteamCMD on Windows](https://renode.space/blog/steamcmd-on-windows)).

---

## 3. Аргументы командной строки сервера

### 3.1. Общие правила

- Все параметры передаются **одной строкой** процессу `valheim_server.exe`. Значения с пробелами — в двойных кавычках ([Spawnly](https://spawnly.net/tools/config-generator/valheim), [vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html)).
- Регистр имён флагов в источниках встречается разный (`-logfile` / `-logFile`); официальное руководство Iron Gate использует написание `-logFile`, Unity-документация — `-logfile`. Менеджеру безопаснее писать **строчными** и не полагаться на регистрозависимость ([hebergtonserv](https://hebergtonserv.com/tutoriels/lire-logs-serveur-valheim/), [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/)).
- `-world` — **имя мира, а не seed**. Опечатка в имени не даёт ошибку: сервер молча создаст новый мир с этим именем ([Spawnly](https://spawnly.net/tools/config-generator/valheim)).
- Значения-перечисления (`preset`, `modifier`) — в нижнем регистре, как в таблицах ниже ([Host Havoc](https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server)).

### 3.2. Полная таблица параметров

| Параметр | Синтаксис | Допустимые значения | По умолчанию | Обязателен | Достоверность |
| --- | --- | --- | --- | --- | --- |
| `-name` | `-name "<string>"` | строка, до **53** символов; не должна содержать пароль | `My server` (в шаблоне Iron Gate) | фактически да | 🟡 |
| `-port` | `-port <int>` | 1–65535; занимает также `port+1` | `2456` | нет | ✅ |
| `-world` | `-world "<string>"` | имя мира, до **20** символов; если такого мира нет — создаётся новый | `Dedicated` (в шаблоне) | да | 🟡 |
| `-password` | `-password "<string>"` | 5–20 символов; не должно входить в имя мира/seed | нет (обязателен на практике) | да | 🟡 |
| `-public` | `-public <0\|1>` | `0` — скрыт из списка, `1` — виден | `1` в шаблоне Iron Gate | нет | 🟡 |
| `-savedir` | `-savedir "<path>"` | абсолютный путь к каталогу сохранений | `%USERPROFILE%\AppData\LocalLow\IronGate\Valheim` | нет | 🟡 |
| `-logfile` / `-logFile` | `-logfile "<path>"` | путь к файлу лога | нет файла: вывод в stdout/консоль | нет | 🟡 |
| `-crossplay` | `-crossplay` | флаг без значения | выключен (backend Steam) | нет | ✅ |
| `-preset` | `-preset <name>` | `normal`, `casual`, `easy`, `hard`, `hardcore`, `immersive`, `hammer` | не задан = правила из мира | нет | 🟡 |
| `-modifier` | `-modifier <key> <value>` | см. [3.5](#35-пресеты-и-модификаторы-мира) | значение из мира | нет | 🟡 |
| `-setkey` | `-setkey <key>` | `nobuildcost`, `playerevents`, `passivemobs`, `nomap` (+ недокументированные `fire`, `noportals`) | не задан | нет | 🟡 |
| `-saveinterval` | `-saveinterval <sec>` | целое, ≥ 60 | `1800` | нет | 🟡 |
| `-backups` | `-backups <int>` | целое, число хранимых бэкапов | ⚠️ не подтверждено | нет | ⚠️ |
| `-backupshort` | `-backupshort <sec>` | целое | ⚠️ не подтверждено | нет | ⚠️ |
| `-backuplong` | `-backuplong <sec>` | целое | ⚠️ не подтверждено | нет | ⚠️ |
| `-instanceid` | `-instanceid "<id>"` | любая уникальная строка на сервер | нет | нет (нужен при нескольких crossplay-серверах на одной машине/порту) | 🟡 |
| `-resetmodifiers` | `-resetmodifiers` | флаг | — | нет | 🟡 |
| `-batchmode` | `-batchmode` | флаг Unity | — | рекомендуется | ✅ |
| `-nographics` | `-nographics` | флаг Unity | — | рекомендуется | ✅ |

Источники по таблице: [SurvivalServers Wiki (1.0)](https://www.survivalservers.com/wiki/Valheim_Server_Settings), [Valheim Companion](https://www.valheimcompanion.com/servers/server-settings), [PlayNHost (правила валидации)](https://playnhost.com/knowledgebase/valheim/Valheim-settings-will-not-save/), [low.ms configuration guide](https://low.ms/knowledgebase/valheim-server-configuration-guide), [slashplay `-port`](https://slashplay.gg/commands/valheim/-port), [slashplay `-instanceid`](https://slashplay.gg/commands/valheim/-instanceid), [fandom](https://valheim.fandom.com/wiki/Dedicated_servers), [renode.space (лог)](https://renode.space/blog/valheim-server-log-file-explained).

### 3.3. Обязательные и почти обязательные параметры

**Шаблон Iron Gate (`start_headless_server.bat`)** — официальный пример строки запуска:

```bat
@echo off
set SteamAppId=892970
echo "Starting server PRESS CTRL-C to exit"
REM Tip: Make a local copy of this script to avoid it being overwritten by steam.
REM NOTE: Minimum password length is 5 characters & Password cant be in the server name.
REM NOTE: You need to make sure the ports 2456-2458 is being forwarded to your server through your local router & firewall.
valheim_server -nographics -batchmode -name "My server" -port 2456 -world "Dedicated" -password "secret" -public 1
```

Источник: текст скрипта воспроизведён в [обсуждении SteamDeck](https://www.sweclockers.com/forum/trad/1761962-valheim-server-pa-steamdeck-hjalp) и в [Spawnly](https://spawnly.net/tools/config-generator/valheim); те же требования дублирует [vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html).

Ключевые следствия:

- `-nographics -batchmode` — штатные флаги Unity для headless-режима; без них сервер пытается инициализировать графику ([Spawnly](https://spawnly.net/tools/config-generator/valheim)).
- `-name`, `-port`, `-world`, `-password` — минимальный рабочий набор; `-public` управляет видимостью ([gamenight docker](https://hub.docker.com/r/gamenight/valheim): «если установлено 1, сервер будет виден в server browser»).
- Пароль **обязателен** на практике и должен быть не короче 5 символов ([low.ms](https://low.ms/knowledgebase/valheim-getting-started): «Server Password needs at least 5 characters»).

### 3.4. Валидация значений (что проверять в UI менеджера)

| Поле | Правило | Сообщение/поведение при нарушении | Источник |
| --- | --- | --- | --- |
| Server Name (`-name`) | 1–53 символа | панель: «The value may not be greater than 53 characters.» | [PlayNHost](https://playnhost.com/knowledgebase/valheim/Valheim-settings-will-not-save/) |
| World Name (`-world`) | 1–20 символов | «The value may not be greater than 20 characters.» | [PlayNHost](https://playnhost.com/knowledgebase/valheim/Valheim-settings-will-not-save/) |
| Password (`-password`) | 5–20 символов | «The value must be at least 5 characters.» | [PlayNHost](https://playnhost.com/knowledgebase/valheim/Valheim-settings-will-not-save/) |
| Password vs World/Name | пароль **не должен входить** в имя мира (и, по данным low.ms, в seed) | сервер печатает `Error bad password:` и завершается — выглядит как «крэш» | [low.ms](https://low.ms/knowledgebase/valheim-dedicated-server-crashes-on-startup), [шаблон Iron Gate](https://www.sweclockers.com/forum/trad/1761962-valheim-server-pa-steamdeck-hjalp) |
| Port (`-port`) | целое 1–65535, свободен на хосте; занимает `port` и `port+1` | сервер не поднимется/порт занят | [slashplay](https://slashplay.gg/commands/valheim/-port) |
| Save Interval (`-saveinterval`) | целое ≥ 60 | «The value must be at least 60.» | [PlayNHost](https://playnhost.com/knowledgebase/valheim/Valheim-settings-will-not-save/) |
| Backup Count / Shorttime / Longtime | целые числа (без дробей) | «The value must be an integer.» | [PlayNHost](https://playnhost.com/knowledgebase/valheim/Valheim-settings-will-not-save/) |
| `-preset`, `-modifier` | значение из перечня | «The selected value is invalid.» (панель) | [PlayNHost](https://playnhost.com/knowledgebase/valheim/Valheim-settings-will-not-save/) |

> ⚠️ Лимиты 53/20/5–20 взяты из валидации хостинговой панели PlayNHost, которая повторяет ограничения игрового UI. Прямого подтверждения из кода сервера нет: трактуйте как «мягкие» ограничения UI менеджера, а окончательную проверку оставьте серверу (он печатает ошибку в лог).

### 3.5. Пресеты и модификаторы мира

Механизм появился в patch 0.217.19: модификаторы мира стали доступны выделенному серверу через аргументы запуска ([gamesguru о 0.217.19](https://gamesguru.pl/valheim-otrzymal-nowa-aktualizacje-update-wprowadza-wazna-funkcje-dla-serwerow-dedykowanych/)); в 1.0 набор не менялся ([Host Havoc](https://hosthavoc.com/en-GB/blog/valheim-1-0-update-server-owners)).

**Пресеты (`-preset`)** — задают сразу группу модификаторов:

| Пресет | Суть | Источник |
| --- | --- | --- |
| `normal` | стандартный баланс Valheim | [2hours.gg](https://2hours.gg/zh/guide/valheim-world-modifiers), [Host Havoc](https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server) |
| `casual` | очень лёгкие бои, вещи остаются при смерти, без рейдов, больше ресурсов, порталы без ограничений | [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-set-Valheim-world-modifiers-and-difficulty/) |
| `easy` | слабее враги, меньше рейдов | [Game8](https://game8.co/games/Valheim/archives/618899) |
| `hard` | сильнее враги, чаще рейды | [Game8](https://game8.co/games/Valheim/archives/618899) |
| `hardcore` | очень сильные враги, потеря вещей и навыков при смерти, без карты | [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-set-Valheim-world-modifiers-and-difficulty/) |
| `immersive` | без карты и порталов, огонь распространяется | [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-set-Valheim-world-modifiers-and-difficulty/) |
| `hammer` | бесплатное строительство (креативный режим) | [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-set-Valheim-world-modifiers-and-difficulty/) |

> 🟡 Часть статей перечисляет пресеты без `immersive` ([valheimgame.wiki](https://valheimgame.wiki/fr/tools/): «Normal, Casual, Easy, Hard, Hardcore, Hammer»), часть — с ним ([Host Havoc](https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server): `normal, casual, easy, hard, hardcore, immersive, hammer`). Считайте `immersive` валидным, но проверяйте фактический запуск по логу (`Setting world modifier preset: ...`).
> ⚠️ Принимает ли CLI значение `keep` («не менять правила мира»), как одноимённая опция в UI, не подтверждено.

**Модификаторы (`-modifier <key> <value>`)** — меняют один параметр:

| Ключ | Допустимые значения | Что регулирует | Источник |
| --- | --- | --- | --- |
| `combat` | `veryeasy`, `easy`, `normal`, `hard`, `veryhard` | сложность боя | [Host Havoc](https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server), [low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained) |
| `deathpenalty` | `casual`, `veryeasy`, `easy`, `normal`, `hard`, `hardcore` | штраф за смерть | [Host Havoc](https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server) |
| `resources` | `muchless`, `less`, `normal`, `more`, `muchmore` | количество ресурсов | [Host Havoc](https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server) |
| `raids` | `none`, `muchless`, `less`, `normal`, `more`, `muchmore` | частота рейдов | [Host Havoc](https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server) |
| `portals` | `casual`, `easy`, `normal`, `hard`, `veryhard` | правила порталов (в т.ч. провоз металла) | [Host Havoc](https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server), [low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained) |

**Булевы ключи мира (`-setkey <key>`)** — без значения; Iron Gate документирует четыре, ещё два работают де-факто:

| Ключ | Эффект | Источник |
| --- | --- | --- |
| `nobuildcost` | строительство без затрат материалов | [low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained), [Nodecraft](https://nodecraft.com/support/games/valheim/setup/unlock-all-recipes-and-buildings-on-a-valheim-server) |
| `playerevents` | события/рейды привязаны к игрокам, а не к миру | [low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained) |
| `passivemobs` | мобы пассивны, пока их не спровоцируют | [low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained) |
| `nomap` | отключает карту | [low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained) |
| `fire` | распространение огня (Ashlands / везде) | [low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained) |
| `noportals` | порталы запрещены | [low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained) |

> 🟡 `-setkey` принимает произвольную строку — поэтому работают и недокументированные ключи ([low.ms](https://low.ms/knowledgebase/valheim-world-modifiers-explained)). Менеджеру достаточно жёсткого списка выше плюс режим «своё значение».

**Сброс модификаторов**: `-resetmodifiers` возвращает значения по умолчанию ([Steam Community](https://steamcommunity.com/app/892970/discussions/1/601904634461686819/)).

**Как это выглядит в логе:** `Setting world modifier preset: hard` ([PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/)).

### 3.6. Несуществующие и ошибочно приписываемые параметры

| Параметр | Статус | Комментарий |
| --- | --- | --- |
| `-maxplayers` | ❌ не документирован | лимит 10 зашит в игру, официального аргумента для его изменения нет ([Game8](https://game8.co/games/Valheim/archives/620588)) |
| `-console` | ❌ не серверный | клиентский launch option Valheim для включения F5-консоли; на сервере не даёт эффекта ([RDSNode](https://docs.rdsnode.com/es/juegos/valheim/argumentos-adicionales), [Kinetic Hosting](https://www.kinetichosting.com/articles/valheim/basics/how-to-enable-the-console-for-valheim)) |
| `-adminlist` / `-bannedlist` | ❌ не существует | списки — только файлы в каталоге сохранений |
| `-saveinterval` | ✅ существует | по умолчанию 1800 с ([renode.space](https://renode.space/blog/valheim-server-log-file-explained)) |
| `-backups*` | ⚠️ упоминаются сообществом, в официальном руководстве не проверены | [hebergtonserv](https://hebergtonserv.com/tutoriels/sauvegarder-restaurer-monde-valheim/) |

### 3.7. Готовые примеры командных строк

**Минимум (Steam backend, локальная сеть и проброс портов):**

```bat
"D:\Servers\Valheim\server\valheim_server.exe" -nographics -batchmode ^
  -name "Valheim RU" -port 2456 -world "Dedicated" -password "SuperSecret1" -public 1
```

**С сохранениями и логом в отдельном каталоге (рекомендуется для менеджера):**

```bat
"D:\Servers\Valheim\server\valheim_server.exe" -nographics -batchmode ^
  -name "Valheim RU" -port 2456 -world "Midgard" -password "SuperSecret1" -public 1 ^
  -savedir "D:\Servers\Valheim\data" ^
  -logfile "D:\Servers\Valheim\logs\valheim_20261108_120000.log"
```

**Crossplay + сложность + интервал сохранения:**

```bat
"D:\Servers\Valheim\server\valheim_server.exe" -nographics -batchmode ^
  -name "Valheim RU" -port 2456 -world "Midgard" -password "SuperSecret1" -public 1 ^
  -crossplay -instanceid "valheim-1" ^
  -preset hard -modifier resources more -setkey nobuildcost ^
  -saveinterval 900 -logfile "D:\Servers\Valheim\logs\server.log"
```

**Второй сервер на той же машине (другие порт, мир и каталог):**

```bat
"D:\Servers\Valheim\server\valheim_server.exe" -nographics -batchmode ^
  -name "Valheim RU #2" -port 2466 -world "Yggdrasil" -password "OtherSecret2" ^
  -savedir "D:\Servers\Valheim\data2" -instanceid "valheim-2"
```

Источники примеров: [slashplay -port](https://slashplay.gg/commands/valheim/-port) (второй сервер — отдельный диапазон портов), [slashplay -instanceid](https://slashplay.gg/commands/valheim/-instanceid) (уникальный instanceid для crossplay), [hebergtonserv](https://hebergtonserv.com/tutoriels/plusieurs-mondes-serveur-valheim/) (свой `-port` и свой `-savedir` на каждый инстанс).

---

## 4. Порты и сеть

### 4.1. Назначение портов

| Порт (по умолчанию) | Протокол | Назначение | Обязателен | Источник |
| --- | --- | --- | --- | --- |
| `2456` | UDP | игровой трафик (game port) | да | [официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/), [redswitches](https://www.redswitches.com/blog/valheim-dedicated-server-guide/) |
| `2457` | UDP | Steam query — по нему сервер виден в server browser / Favorites; это **`port + 1`** | да (иначе сервер не находится) | [lloesche discussion #32](https://github.com/community-valheim-tools/valheim-server-docker/discussions/32): «The Steam server browser query port and the game server run on two different ports… the former on gameserver_port+1 so usually 2457» |
| `2458` | UDP | третий порт, `port + 2`; официальное руководство просит пробрасывать 2456–2458 | рекомендуется | [официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/), [gamepackets](https://hub.docker.com/r/gamepackets/valheim): «2458 UDP Mandatory Tertiary port (automatically SERVER_PORT + 2)» |

Правило расчёта при нестандартном `-port`: сервер занимает **`port` и `port + 1`** (а по официальной рекомендации — ещё и `port + 2`) ([slashplay `-port`](https://slashplay.gg/commands/valheim/-port): «Valheim uses this port and the next one, so 2456 means 2456 and 2457»; [hebergtonserv](https://hebergtonserv.com/tutoriels/ouvrir-ports-serveur-valheim/): «Valheim écoute sur le port défini par `-port` et sur le suivant»).

Пример: `-port 2466` → открыть UDP `2466` и `2467` ([slashplay](https://slashplay.gg/commands/valheim/-port)).

> ⚠️ Про 2458 есть расхождение: официальное руководство Iron Gate и часть докеров требуют 2456–2458 ([redswitches](https://www.redswitches.com/blog/valheim-dedicated-server-guide/), [gamepackets](https://hub.docker.com/r/gamepackets/valheim)), тогда как современные руководства ограничиваются 2456–2457 ([selfhosting.sh по образу lloesche](https://selfhosting.sh/apps/valheim-server/): «UDP ports 2456-2457»). Практический вывод для менеджера: **открывать 2456–2458** (лишний UDP-порт безвреден), а в тексте подсказки писать «port … port+2».

### 4.2. Нужен ли TCP?

Нет. Игровой трафик и Steam query идут по **UDP** ([официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/), [redswitches](https://www.redswitches.com/blog/valheim-dedicated-server-guide/): «Open UDP 2456–2458 only; block everything else inbound»).

> ⚠️ Отдельные контейнеры и панели публикуют порты как `tcp+udp` ([gamenight](https://hub.docker.com/r/gamenight/valheim), [ConoHa](https://doc.conoha.jp/products/vps-game/image-game/valheim-game/)), но это перестраховка шаблона, а не требование игры. Для Windows Firewall менеджеру достаточно правила UDP.

### 4.3. Crossplay и порты

- При `-crossplay` трафик идёт через relay PlayFab, и **проброс портов не нужен** ([официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/) в пересказе [vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html): «When using crossplay, router port forwarding is usually not needed»; [slashplay `-crossplay`](https://slashplay.gg/commands/valheim/-crossplay): «no port forwarding needed»).
- В crossplay-режиме сервер фактически слушает **случайный высокий порт** (наблюдение: 33240), а заданный `-port` служит только для различения нескольких серверов на одном IP ([анализ LinuxGSM](https://blog.gitcode.com/c5f5a5e41420df493db5b737faf107d7.html), [slashplay `-port`](https://slashplay.gg/commands/valheim/-port): «the port still tells apart several servers on the same public IP»).
- Обратная сторона: при crossplay **не работает подключение по локальному/loopback IP** ([LGSL](https://livegameserverlist.com/ru/blog/valheim-crossplay-server-local-ip-not-working), [doomhosting](https://www.doomhosting.com/help/articles/how-to-turn-off-valheim-server-crossplay)).
- Если сервер за CGNAT и проброс невозможен — crossplay остаётся единственным вариантом ([renode.space](https://renode.space/ru/blog/valheim-home-hosting-vs-rented-server)).

### 4.4. Firewall (Windows)

Нужно входящее правило UDP на `2456–2458` (или на выбранный диапазон `port…port+2`) для профиля, соответствующего сети (Private/Domain/Public). Официальный шаблон Iron Gate прямо напоминает про роутер **и** локальный firewall ([шаблон `start_headless_server.bat`](https://www.sweclockers.com/forum/trad/1761962-valheim-server-pa-steamdeck-hjalp), [hebergtonserv](https://hebergtonserv.com/tutoriels/ouvrir-ports-serveur-valheim/)).

> ⚠️ Автоматическое создание правила (`netsh advfirewall firewall add rule …`) требует прав администратора; в менеджере это должна быть опциональная операция с явным подтверждением, а не часть обычного запуска.

---

## 5. Сохранения мира на Windows

### 5.1. Каталог сохранений по умолчанию

| Что | Путь | Источник |
| --- | --- | --- |
| База сохранений (Windows) | `%USERPROFILE%\AppData\LocalLow\IronGate\Valheim` | [Valheim Companion](https://www.valheimcompanion.com/servers/dedicated-server-setup), [Loafhosts](https://loafhosts.com/guides/valheim-server-files/), [fandom](https://valheim.fandom.com/wiki/Dedicated_servers) |
| Миры | `<база>\worlds_local\` | [Host Havoc](https://hosthavoc.com/wiki/game-servers/valheim/upload-world), [Loafhosts](https://loafhosts.com/guides/valheim-server-files/) |
| Списки доступа | `<база>\adminlist.txt`, `<база>\bannedlist.txt`, `<база>\permittedlist.txt` (рядом с `worlds_local`, не внутри) | [hythost](https://hythost.com/guides/valheim-admin-commands), [low.ms](https://low.ms/knowledgebase/valheim-adminlist) |
| Переопределение | `-savedir "<path>"` — меняет **базу**; миры по-прежнему в `<path>\worlds_local`, списки — в `<path>` | [Loafhosts](https://loafhosts.com/guides/valheim-server-files/) («the start option `-savedir` changes it»), [ConnectHosting](https://connecthosting.net/blog/valheim-admin-commands-dedicated-server) («the folder your `-savedir` argument points at») |

> ✅ Важное следствие для менеджера: сохранения привязаны **к пользователю Windows**, от которого запущен процесс, а не к папке установки. Переустановка сервера мир не трогает; запуск от другого пользователя создаёт/ищет мир в другом профиле ([joingg](https://www.joingg.co/blog/valheim-dedicated-server-setup): «A Valheim dedicated server keeps its world in the save folder of the user it runs as, not the install directory»).

### 5.2. Формат 1.0: мир — это папка

Начиная с 1.0 мир хранится как **каталог с именем мира** внутри `worlds_local` ([gameserverkings](https://www.gameserverkings.com/knowledge-base/valheim/valheim-save-location/), [low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore), [Host Havoc](https://hosthavoc.com/wiki/game-servers/valheim/upload-world)).

Реальный листинг свежесозданного мира `Midgard` (после чистой остановки):

```text
worlds_local\
└─ Midgard\
   ├─ _main.1.fwl2        56 B      метаданные мира (замена .fwl)
   ├─ _main.1.db2         147 KB    данные мира (замена .db)
   ├─ _main.1.chunks      21 B      индекс чанков
   ├─ _main.1.ok          4 B       маркер «запись завершена»
   └─ 00_00__0_1.chunk    1.4 KB    чанк террейна (по файлу на чанк)
```

Источник листинга и трактовки: [gameserverkings](https://www.gameserverkings.com/knowledge-base/valheim/valheim-save-location/).

| Файл/шаблон | Что означает | Источник |
| --- | --- | --- |
| `_main.<N>.fwl2` | метаданные мира (эквивалент старого `.fwl`), `<N>` — номер поколения сохранения | [gameserverkings](https://www.gameserverkings.com/knowledge-base/valheim/valheim-save-location/), [low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore) |
| `_main.<N>.db2` | сами данные мира (эквивалент старого `.db`) | там же |
| `_main.<N>.chunks` | индекс чанков | там же |
| `_main.<N>.ok` | маркер успешного завершения записи; **наличие `.ok` = поколение пригодно для загрузки** | [low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore), [supercraft](https://supercraft.host/wiki/valheim/old_format_missing_db_after_1_0/) |
| `*.chunk` | отдельный участок террейна; при сохранении перезаписываются только изменённые чанки | [low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore) |
| `Midgard_backup_auto-YYYYMMDD-HHMMSS\` | автоматический бэкап: отдельная папка с полной копией мира | там же |

> ✅ Практика для менеджера: считать мир «здоровым», если в его папке есть `.ok`-файл последнего поколения; при бэкапе копировать **всю папку мира**, а не отдельные файлы ([low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore): «Don't rename anything inside it or pick files out of it»).

### 5.3. Старый формат (pre-1.0) и что остаётся после конвертации

| Файл | Что означает | Источник |
| --- | --- | --- |
| `<World>.fwl` | метаданные мира (старый формат) | [Host Havoc](https://hosthavoc.com/es/wiki/game-servers/valheim/upload-world) |
| `<World>.db` | данные мира (старый формат) | там же |
| `<World>.fwl.old`, `<World>.db.old` | предыдущее сохранение (ротация самим сервером) и/или следы конвертации в 1.0 | [low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore): «the last pre-1.0 save, renamed»; [supercraft](https://supercraft.host/wiki/valheim/old_format_missing_db_after_1_0/) |
| `<World>_backup_<YYYYMMDD-HHMMSS>.db` | бэкап старого формата | [low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore) |

Поведение при первом запуске 1.0-сервера со старым миром: пара `<World>.fwl` + `<World>.db` конвертируется в папку **при первом сохранении**, а исходные файлы остаются переименованными в `.old` ([Host Havoc](https://hosthavoc.com/es/wiki/game-servers/valheim/upload-world), [low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore)).

> ⚠️ `*.fwl.old` в старом формате — это не «бэкап на всякий случай», а именно предыдущая ротация; полагаться на него как на план восстановления нельзя, нужны собственные бэкапы.

### 5.4. Как создаётся новый мир

1. Взять любое имя, которого нет в `worlds_local`.
2. Запустить сервер с `-world "<Имя>"` и валидными `-name`/`-password`.
3. Сервер напечатает в лог `missing ...\worlds_local\<Имя>.db` и затем `Loading: Generating locations` — это и есть генерация нового мира ([PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/)).

Особенности:

- Seed **нельзя задать аргументом**: мир генерируется со случайным seed; чтобы получить конкретный seed, мир создают в клиенте и переносят файлы ([vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html): «Enter the world name, not the seed»).
- Признак «мир был создан заново, а не загружен» в логе — пара строк `missing …` + `Loading: Generating locations`; это же и главный симптом опечатки в `-world` ([PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/)).

### 5.5. Как выбрать существующий мир

- Имя мира = имя папки (`1.0`) или имя пары `.fwl`/`.db` (старый формат). Достаточно передать его в `-world` **точно как в файловой системе** ([Host Havoc](https://hosthavoc.com/wiki/game-servers/valheim/upload-world), [Spawnly](https://spawnly.net/tools/config-generator/valheim)).
- Мир из одиночной игры переносится копированием в `worlds_local` (при включённом Steam Cloud исходник может лежать в `…\Steam\userdata\<AccountID>\892970\remote\`) ([Host Havoc](https://hosthavoc.com/wiki/game-servers/valheim/upload-world)).
- Один процесс обслуживает **только один мир**; несколько миров = несколько инстансов с разными `-port`, `-savedir` (и `-instanceid` для crossplay) ([hebergtonserv](https://hebergtonserv.com/tutoriels/plusieurs-mondes-serveur-valheim/), [slashplay `-instanceid`](https://slashplay.gg/commands/valheim/-instanceid)).

### 5.6. Интервал и бэкапы

| Механизм | Аргумент | Значение по умолчанию | Источник |
| --- | --- | --- | --- |
| Периодическое сохранение | `-saveinterval <sec>` | `1800` (30 минут) | [renode.space](https://renode.space/blog/valheim-server-log-file-explained), [vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html) |
| Число хранимых бэкапов | `-backups <int>` | ⚠️ не подтверждено | [hebergtonserv](https://hebergtonserv.com/tutoriels/sauvegarder-restaurer-monde-valheim/) |
| Интервал «коротких» бэкапов | `-backupshort <sec>` | ⚠️ не подтверждено | там же |
| Интервал «длинных» бэкапов | `-backuplong <sec>` | ⚠️ не подтверждено | там же |

> 🟡 Наличие автоматических бэкапов подтверждается папками `*_backup_auto-*` в `worlds_local` ([low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore)); синтаксис `-backups*` взят из одного источника и требует проверки.

---

## 6. adminlist.txt / bannedlist.txt / permittedlist.txt

### 6.1. Расположение

Все три файла — **в каталоге сохранений**, рядом с папкой `worlds_local` (не внутри неё):

```text
%USERPROFILE%\AppData\LocalLow\IronGate\Valheim\
├─ adminlist.txt
├─ bannedlist.txt
├─ permittedlist.txt
└─ worlds_local\
```

Источники: [hythost](https://hythost.com/guides/valheim-admin-commands) («the same folder that holds `worlds_local`, not inside it»), [low.ms](https://low.ms/knowledgebase/valheim-adminlist), [wasabi](https://docs.wasabihosting.com/games/valheim/admin-commands), [fandom](https://valheim.fandom.com/wiki/Dedicated_servers) (`%UserProfile%\AppData\LocalLow\IronGate\Valheim`).

При использовании `-savedir` файлы лежат в указанном каталоге ([ConnectHosting](https://connecthosting.net/blog/valheim-admin-commands-dedicated-server): «the folder your `-savedir` argument points at»; [Loafhosts](https://loafhosts.com/guides/valheim-server-files/)).

Файлы **создаются сервером при первом старте**, если их нет ([ConnectHosting](https://connecthosting.net/blog/valheim-admin-commands-dedicated-server): «the server creates them on first start»).

### 6.2. Формат строк

| Аспект | Правило | Источник |
| --- | --- | --- |
| Одна запись на строку | ID игрока, без имени и без лишних символов | [low.ms](https://low.ms/knowledgebase/valheim-adminlist), [wasabi](https://docs.wasabihosting.com/games/valheim/admin-commands) |
| Комментарии | строки, начинающиеся с `//` | [wasabi](https://docs.wasabihosting.com/games/valheim/admin-commands) («Lines starting with `//` are comments») |
| Регистр | ID **регистрозависимы**, копировать точно как показывает игра | [ConnectHosting](https://connecthosting.net/blog/valheim-admin-commands-dedicated-server) |
| Формат до 1.0 | SteamID64 (17 цифр, начинается с `7656…`) | [fandom](https://valheim.fandom.com/wiki/Dedicated_servers), [wasabi](https://docs.wasabihosting.com/games/valheim/admin-commands) |
| Формат 1.0 | `[Platform]_[UserID]`: для Steam — `V_<SteamID64>`, для Xbox/Game Pass — `X_<ID>`; у PS5/Switch 2 свои префиксы | [Host Havoc](https://hosthavoc.com/en-GB/wiki/game-servers/valheim/add-admins), [mc-node](https://mc-node.net/blog/en/valheim-adminlist-ban-whitelist/) («Since Valheim 1.0, a Steam ID starts with `V_` instead of `Steam_`») |
| Кодировка/переводы строк | plain text; рекомендуются UTF-8/ASCII и CRLF | ⚠️ явно не документировано, вытекает из «plain text file» ([low.ms](https://low.ms/knowledgebase/valheim-adminlist)) |

Пример `adminlist.txt` для 1.0:

```text
// Admins
V_76561198000000001
V_76561198000000002
X_2535400000000001
```

Пример `permittedlist.txt` (включённый whitelist):

```text
V_76561198000000001
V_76561198000000003
```

> ⚠️ Совместимость «голого» SteamID64 без префикса в 1.0 не подтверждена: часть источников продолжает описывать формат `7656…` без префикса ([low.ms](https://low.ms/knowledgebase/valheim-adminlist) — статья обновлена 2026-09-13), часть настаивает на префиксе ([Host Havoc](https://hosthavoc.com/en-GB/wiki/game-servers/valheim/add-admins)). Для менеджера: **принимать оба варианта**, сохранять как ввёл пользователь, а в UI подсказывать «скопируй ID из F2-панели игрока или из лога подключения».

### 6.3. Семантика файлов

| Файл | Что даёт | Источник |
| --- | --- | --- |
| `adminlist.txt` | право использовать админ-команды в игре (`kick`, `ban`, `unban`, `save`, `info`, `ping`, …) | [fandom](https://valheim.fandom.com/wiki/Dedicated_servers), [mtxserv](https://mtxserv.com/valheim-server/doc/valheim-server-command-list) |
| `bannedlist.txt` | запрет на вход перечисленным ID | [hythost](https://hythost.com/guides/valheim-admin-commands) |
| `permittedlist.txt` | **whitelist**: если файл непустой, войти могут только перечисленные ID, все остальные блокируются | [gamenight](https://hub.docker.com/r/gamenight/valheim): «NOTE: Adding a person to the permitted list will ban everyone else in the server»; [slashplay](https://slashplay.gg/docs/games/valheim/admins-bans-and-permitted) |

> ✅ «Ловушка permitted list»: достаточно одной записи, чтобы сервер стал закрытым ([gamever.io](https://gamever.io/knowledge-base/every-valheim-server-startup-argument-the-permitted-list-trap)). Менеджер обязан предупреждать об этом при сохранении непустого `permittedlist.txt`.

### 6.4. Когда применяются изменения

- Требуется **перезапуск сервера** — списки читаются на старте ([mc-node](https://mc-node.net/blog/en/valheim-adminlist-ban-whitelist/): «restart the server after every change»; [hythost](https://hythost.com/guides/valheim-admin-commands): «Edit `adminlist.txt` there, then restart from the panel»).
- ⚠️ Горячего перечитывания файлов (file watcher) у vanilla-сервера не описано ни в одном источнике; считать, что его нет.

### 6.5. Бан и разбан

| Действие | Как | Источник |
| --- | --- | --- |
| Бан из игры | админ-команда `ban [name/ip/userID]` — игрок отключается, ID попадает в `bannedlist.txt` | [mtxserv](https://mtxserv.com/valheim-server/doc/valheim-server-command-list) |
| Список банов | команда `banned` | там же |
| Разбан | команда `unban [ip/userID]` **или** удаление строки из `bannedlist.txt` + перезапуск | там же, [hythost](https://hythost.com/guides/valheim-admin-commands) |
| Кик без бана | команда `kick [name/ip/userID]` | [mtxserv](https://mtxserv.com/valheim-server/doc/valheim-server-command-list) |
| Бан через файл | добавить ID в `bannedlist.txt`, перезапустить сервер | [hythost](https://hythost.com/guides/valheim-admin-commands) |

Ограничение: команды `ban`/`kick` вводятся **в игре** (F5-консоль) от имени админа, а не в консоли сервера — серверная консоль stdin-команды не обрабатывает (см. [раздел 8](#8-корректная-остановка-сервера-на-windows)) ([PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/): «The server does not answer commands typed here»).

> ⚠️ `devcommands` на выделенном сервере не работают так, как в одиночной игре; для админских действий нужны именно серверные команды `kick`/`ban`/`unban`/`save` ([ConnectHosting](https://connecthosting.net/blog/valheim-admin-commands-dedicated-server): «why devcommands don't work»).

---

## 7. Логи: расположение, форматы строк, парсинг

### 7.1. Куда пишется лог

| Режим | Куда идёт вывод | Источник |
| --- | --- | --- |
| Без `-logfile` | **stdout / окно консоли** (файла по умолчанию нет) | [hebergtonserv](https://hebergtonserv.com/tutoriels/lire-logs-serveur-valheim/): «Le serveur écrit son journal sur sa sortie standard… Pour obtenir un fichier… `-logFile`» |
| С `-logfile "<path>"` | указанный файл (официальное руководство использует написание `-logFile`) | [официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/) через [hebergtonserv](https://hebergtonserv.com/tutoriels/lire-logs-serveur-valheim/) |
| Хостинговые панели | собственный каталог `logs/` с файлом на каждый старт, имя вида `valheim_YYYYMMDD_HHMMSS.log` (UTC) | [Loafhosts](https://loafhosts.com/guides/valheim-server-logs/) |
| BepInEx | `BepInEx\LogOutput.log` (перезаписывается при каждом успешном старте) | [Valheim-Modding Wiki](https://github-wiki-see.page/m/Valheim-Modding/Wiki/wiki/Server-Troubleshooting) |

> ⚠️ Существует ли у vanilla-сервера **дефолтный** файл лога (например, `Player.log` в `LocalLow`), источниками не подтверждено. Для менеджера надёжный путь один: **всегда передавать `-logfile`** в свой каталог логов и дополнительно захватывать stdout.

### 7.2. Форматы строк (реальные примеры)

**Старт и версия**

```text
Valheim version: l-1.0.20 (network version 41)
Load world: Dedicated (Dedicated)
ZNet.LoadWorld: MyWorld (MyWorld), save number 7
Setting world modifier preset: hard
Opened Steam server
Game server connected
```

Источник: [PlayNHost, «How to read your Valheim server console»](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/) (таблица «Lines worth knowing»), [renode.space](https://renode.space/blog/valheim-server-log-file-explained).

**Создание нового мира вместо загрузки**

```text
missing .../worlds_local/MyWorld.db
Loading: Generating locations
```

Источник: [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/). 🟡 Пример в статье снят на 1.0.20, где миры уже хранятся папками, но строка `missing … .db` всё равно присутствует — то есть ориентироваться на неё можно и в 1.0.

**Подключение игрока (Steam backend)**

```text
Got connection SteamID 76561198012345678
Got handshake from client 76561198012345678
Server: New peer connected,sending global keys
Got character ZDOID from Sigrid : 1234567890:1
```

Источник: [renode.space](https://renode.space/blog/valheim-server-log-file-explained) (раздел «Connect, join and disconnect lines»).

**Отключение игрока**

```text
Closing socket 76561198012345678
```

Источник: [renode.space](https://renode.space/blog/valheim-server-log-file-explained): «the connection ended, for any reason: a normal logout, a crash, a kick, a timeout».

**Сохранение мира**

```text
World saved ( 412.5ms )
```

Источник: [renode.space](https://renode.space/blog/valheim-server-log-file-explained) — число в скобках = длительность сохранения; строка появляется каждые `-saveinterval` секунд и после корректной остановки.

**Crossplay: join code**

```text
Session "Ravenhold" with join code 483920 and IP 203.0.113.10:2456 is active with 0 players
```

Источник: [renode.space](https://renode.space/blog/valheim-server-log-file-explained) (пример приведён в статье; формат: `Session "<name>" with join code <6 digits> and IP <ip>:<port> is active with <n> players`). Альтернативная формулировка, встречающаяся в логах: `registered with join code 604510` ([low.ms](https://low.ms/knowledgebase/valheim-troubleshooting-guide)).

> 🟡 Строка сессии **периодически повторяется** и содержит актуальное число игроков — это дешёвый способ считать occupancy без парсинга join/leave ([renode.space](https://renode.space/blog/valheim-server-log-file-explained): «The line repeats while the server runs, and the player count in it changes as people come and go»). На Steam-only сервере (без `-crossplay`) этой строки может не быть вовсе.

**Ошибки**

```text
Error bad password:
World load failed mid-file
```

Источники: [low.ms (bad password)](https://low.ms/knowledgebase/valheim-dedicated-server-crashes-on-startup), [low.ms (world load failed)](https://low.ms/knowledgebase/valheim-troubleshooting-guide).

**Прочее, что встречается в логах 1.0**

```text
ZRpc timeout set to 30s
Opened Steam server
Network version check, their:40, mine:41
Player history entry with index 0: PlayerOne (Steam_76561198000000005, 1EC168833352B6CF)
```

Источник: [пример лога BepInEx/valheim_server на Pastebin](https://pastebin.com/rmNhAWvM), [renode.space](https://renode.space/blog/valheim-server-log-file-explained) (`Network version check`).

### 7.3. Что парсить: практическая таблица

| Задача менеджера | Строка-маркер | Замечания | Источник |
| --- | --- | --- | --- |
| Сервер стартовал | `Valheim version:` | самая ранняя стабильная строка с версией | [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/) |
| Сервер **готов** принимать игроков | `Game server connected` | именно этот маркер, а не «процесс жив» | [Valheim Companion](https://www.valheimcompanion.com/servers/server-not-showing) |
| Мир загружен | `ZNet.LoadWorld:` / `Load world:` | `save number N` полезен для UI | [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/) |
| Мир создан заново (тревога) | `Loading: Generating locations` (+ `missing …`) | признак опечатки в `-world` | там же |
| Игрок подключается | `Got connection SteamID <id>` | первый признак, что порт/файрвол в порядке | [renode.space](https://renode.space/blog/valheim-server-log-file-explained) |
| Игрок вошёл в мир | `Got character ZDOID from <name> :` | даёт **имя персонажа**; `0:0` = смерть, не вход | там же |
| Игрок вышел | `Closing socket <id>` | нормальный выход, кик, таймаут — неразличимы | там же |
| Сохранение выполнено | `World saved (` | подтверждение, что остановка была корректной | [renode.space, safe shutdown](https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost) |
| Join code (crossplay) | `join code <6 digits>` | меняется после каждого рестарта | [low.ms](https://low.ms/knowledgebase/valheim-troubleshooting-guide) |
| Пресет применён | `Setting world modifier preset:` | удобно для отображения текущего режима | [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/) |
| Ошибка пароля | `Error bad password:` | процесс завершается сразу | [low.ms](https://low.ms/knowledgebase/valheim-dedicated-server-crashes-on-startup) |

**Рекомендуемая модель счётчика игроков** (без модов): увеличивать на `Got character ZDOID from` (не на `Got connection`), уменьшать на `Closing socket`; периодически сверять со строкой `Session … is active with <n> players` ([renode.space](https://renode.space/blog/valheim-server-log-file-explained)).

### 7.4. Захват stdout

- Сервер — консольное приложение Unity, пишет в stdout/stderr; при запуске из менеджера stdout нужно перенаправлять в пайп и дублировать в файл (в Rust: `Stdio::piped()` + поток-читатель; при этом нельзя терять вывод, иначе лог будет неполным).
- ⚠️ Буферизация: если stdout — пайп (не консоль), вывод может приходить блоками. Гарантированно «построчный» поток не обещан ни одним источником; для точного времени событий лучше ориентироваться на `-logfile` (файл) + tail, а не только на пайп.
- Кодировка: UTF-8 ожидается, но имена игроков (кириллица) в логе могут отображаться некорректно при неверной кодовой странице консоли; ⚠️ не подтверждено, требует проверки.

---

## 8. Корректная остановка сервера на Windows

### 8.1. Официальная рекомендация

Iron Gate рекомендует останавливать сервер **Ctrl+C в окне консоли** и дождаться завершения процесса; закрывать окно крестиком — нельзя ([официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/); пересказ: [vgtimes](https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html) — «To properly shut down the server, press Ctrl+C in the open command window and wait for the process to finish»; [vgtimes, troubleshooting](https://es.vgtimes.com/guides/167249-gua-de-solucin-de-problemas-de-valheim-cadas-rendimiento-y-problemas-de-servidor.html) — «No cierres la ventana del servidor usando el botón X… los desarrolladores recomiendan usar Ctrl+C»).

Что при этом происходит: сервер сохраняет мир и игровые профили, в логе появляется `World saved`, затем процесс завершается ([renode.space, safe shutdown](https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost): «You send the stop → a `World saved` line appears, newer than anything before the stop → the process exits»).

> ℹ️ Терминология: в Windows нет POSIX-сигнала `SIGINT`. Нажатие Ctrl+C в консоли генерирует **console control event** `CTRL_C_EVENT`; для .NET-приложения (Unity/Mono) он выглядит как `Console.CancelKeyPress`, то есть «как SIGINT». Поэтому «Ctrl+C» и «SIGINT» здесь означают одно и то же событие. Инженерное уточнение, не из источника.

### 8.2. Сравнение способов остановки

| Способ | Что делает ОС | Сохраняется ли мир | Пригодность для менеджера | Источник |
| --- | --- | --- | --- | --- |
| **Ctrl+C в консоли** (`CTRL_C_EVENT`) | console control event → приложение обрабатывает и выходит | да, с записью `World saved` | ✅ основной способ | [официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/), [renode.space](https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost) |
| `taskkill /PID <pid>` (без `/F`) | посылает `WM_CLOSE` окну процесса | ⚠️ для консольного приложения без оконного message loop — обычно **не срабатывает**, процесс продолжает работать | ⚠️ не полагаться | инженерное замечание, прямого источника по Valheim нет |
| `taskkill /F /PID <pid>`, «End task», `Stop-Process` | `TerminateProcess` — немедленное убийство | **нет**; теряется всё с последнего `-saveinterval`/`World saved` | ❌ только как последняя мера | [renode.space](https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost), [о PowerShell `Stop-Process` как форсированном убийстве](https://stackoverflow.com/revisions/c0622e11-a311-4c97-9548-a6fffa67eb0c/view-source) |
| Закрытие окна консоли (X) | завершение сессии консоли | нет | ❌ запрещено | [vgtimes](https://es.vgtimes.com/guides/167249-gua-de-solucin-de-problemas-de-valheim-cadas-rendimiento-y-problemas-de-servidor.html) |
| stdin-команды (`save`, `quit`) | — | — | ❌ **vanilla-сервер stdin не читает** | [ConsoleStdinHeeler](https://thunderstore.io/c/valheim/p/DreamWraith/ConsoleStdinHeeler/), [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/) |
| Мод `ConsoleStdinHeeler` (`save`, `stop`) | мод читает stdin в отдельном потоке и вызывает `ZNet.instance.Save` + выход | да | 🟡 запасной путь, требует модов | [ConsoleStdinHeeler](https://thunderstore.io/c/valheim/p/DreamWraith/ConsoleStdinHeeler/) |

### 8.3. Про stdin: почему нельзя «просто написать save в консоль»

- Vanilla dedicated server **не обрабатывает stdin**. Мод `ConsoleStdinHeeler` существует именно потому, что в ваниле этого нет: он добавляет фоновый поток с `Console.ReadLine()` и команды `save`, `shutdown`/`stop`/`exit`, `players`, `kick`, `ban`, `unban`, `kickall` ([Thunderstore](https://thunderstore.io/c/valheim/p/DreamWraith/ConsoleStdinHeeler/), [Nexus](https://www.nexusmods.com/valheim/mods/4329)).
- Хостинговые панели, показывающие консоль, прямо предупреждают: «The server does not answer commands typed here» ([PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/)).
- Следствие: **предупреждать игроков о рестарте через сервер нельзя** — только внешними каналами (Discord/чат), либо модом ([renode.space](https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost): «vanilla сервер… не имеет многих способов распространить это из консоли»).

### 8.4. Как это делать из Rust (инженерные заметки, без источника)

> Раздел помечен как инженерный: конкретных подтверждений по Valheim нет, это стандартное поведение Win32.

1. Запуск сервера с `CREATE_NEW_PROCESS_GROUP` (обязательно для последующей посылки `CTRL_BREAK_EVENT`).
2. Остановка:
   - Вариант A (наиболее «как задумано»): `AttachConsole(pid)` + `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)`, затем `FreeConsole()`. Работает только если родитель может прикрепиться к консоли ребёнка (у GUI-приложения своей консоли нет — потребуется `AllocConsole`/`AttachConsole`).
   - Вариант B: `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid)` для группы процессов — не требует `AttachConsole`, но Unity/Mono должен обрабатывать `SIGBREAK`; ⚠️ поведение не проверено.
   - Вариант C (гарантированно работает, но грубо): `taskkill /F` — только после таймаута и с предупреждением пользователю.
3. Критерий успеха остановки — **не** код выхода, а появление `World saved` в логе после запроса на остановку и последующий выход процесса ([renode.space](https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost)).
4. Таймаут: большие миры сохраняются секундами; если через 30–60 с процесс жив — показать пользователю выбор «ждать / убить принудительно», а не убивать молча.
5. Всегда держать `-saveinterval` разумным (например, 600–900 с): это единственная страховка при аварийном завершении ([low.ms](https://low.ms/knowledgebase/valheim-server-backups-and-restore)).

> ⚠️ Про моды: с BepInEx/Doorstop обработка Ctrl+C может ломаться — на Linux это подтверждённый баг ([BepInEx issue #185](https://github.com/BepInEx/BepInEx/issues/185): «The regular Valheim server can be stopped via ctrl+c… After installing Valheim+ … neither ctrl+c … works… Killing via sigterm/sigkill can leave the world data corrupted»). Для Windows прямого подтверждения нет, но менеджер должен проверять факт `World saved`, а не предполагать его.

---

## 9. Crossplay

### 9.1. Что делает `-crossplay`

| Аспект | Значение | Источник |
| --- | --- | --- |
| Backend | PlayFab relay вместо Steam networking | [slashplay `-crossplay`](https://slashplay.gg/commands/valheim/-crossplay), [LGSL](https://livegameserverlist.com/ru/blog/valheim-crossplay-server-local-ip-not-working) |
| Флаг | без значения, просто `-crossplay` | [slashplay](https://slashplay.gg/commands/valheim/-crossplay) |
| Кто может подключаться | Steam, Xbox, Game Pass, PS5, Switch 2 — все платформы | [low.ms](https://low.ms/blog/valheim-crossplay-join-codes), [doomhosting](https://www.doomhosting.com/help/articles/how-to-join-valheim-server-xbox-ps5-switch-2) |
| Проброс портов | **не нужен** | [официальное руководство](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/), [slashplay](https://slashplay.gg/commands/valheim/-crossplay) |
| Порт, который слушает сервер | случайный высокий; `-port` служит лишь для различения инстансов на одном IP | [анализ LinuxGSM](https://blog.gitcode.com/c5f5a5e41420df493db5b737faf107d7.html), [slashplay `-port`](https://slashplay.gg/commands/valheim/-port) |
| Локальный IP | **не работает** — подключение только по join code, публичному IP или через список серверов | [LGSL](https://livegameserverlist.com/ru/blog/valheim-crossplay-server-local-ip-not-working) |
| Нужен ли Steam-аккаунт | сервер ставится и работает с `anonymous`; игрокам Steam-аккаунт не нужен, но нужен интернет к PlayFab | [Flux](https://runonflux.com/games/valheim/self-host-valheim), [low.ms](https://low.ms/knowledgebase/valheim-join-code-not-working) |

### 9.2. Join code (код приглашения)

- Генерируется при старте, **6 цифр**, только цифры ([low.ms](https://low.ms/blog/valheim-crossplay-join-codes): «Numeric, six characters… `604510` is the shape of it»).
- **Меняется после каждого рестарта** ([low.ms](https://low.ms/knowledgebase/valheim-join-code-not-working), [playyourway](https://playyourway.com.au/help/valheim-getting-started)).
- Где взять: (а) в игре — пауза → код с кнопкой копирования; (б) в логе сервера — строка `Session "…" with join code …` / `registered with join code …` ([low.ms](https://low.ms/blog/valheim-crossplay-join-codes), [renode.space](https://renode.space/blog/valheim-server-log-file-explained)).
- Задержка появления кода: ~30 с после старта (замер на 2026-10-21), у больших миров дольше ([Loafhosts](https://loafhosts.com/guides/valheim-server-not-showing/)).
- Если код не появляется — сервер не зарегистрировался в PlayFab: нет исходящего интернета, сбой PlayFab или сервер упал раньше ([renode.space](https://renode.space/blog/valheim-server-log-file-explained)).

### 9.3. Ограничения и подводные камни

| Ограничение | Детали | Источник |
| --- | --- | --- |
| Нет локального IP | loopback/LAN-адрес не работает | [LGSL](https://livegameserverlist.com/ru/blog/valheim-crossplay-server-local-ip-not-working) |
| Зависимость от PlayFab | недоступность сервиса = игроки не войдут по коду (Steam-игроки могут по IP, если порты открыты) | [low.ms](https://low.ms/knowledgebase/valheim-join-code-not-working) |
| `-public` | 🟡 по данным doomhosting, для crossplay публичный режим должен быть включён, иначе код не публикуется; официального подтверждения нет | [doomhosting](https://www.doomhosting.com/help/articles/how-to-turn-off-valheim-server-crossplay) |
| `steam_appid.txt` | должен содержать `892970`, иначе возможны проблемы с PlayFab-аутентификацией | [WinterNode](https://winternode.com/blog/valheim/valheim-server-won-t-start-real-error-causes-and-fixes) |
| Несколько серверов на одной машине | нужен уникальный `-instanceid`, иначе серверы «делят» PlayFab ID | [slashplay `-instanceid`](https://slashplay.gg/commands/valheim/-instanceid) |
| Моды | crossplay **совместим** с BepInEx; распространённое утверждение об обратном — неверно | [low.ms](https://low.ms/blog/valheim-crossplay-join-codes) |
| Консоли не могут хостить | сервер для консольных игроков — только внешний | [doomhosting](https://www.doomhosting.com/help/articles/how-to-join-valheim-server-xbox-ps5-switch-2) |

> ✅ Для менеджера: `-crossplay` — булев переключатель. При включении: скрыть/задизейблить настройку проброса портов, показать поле «join code» (парсится из лога), предупредить, что локальный IP не сработает.

---

## 10. Лимиты, требования, публичный список серверов

### 10.1. Игроки

| Параметр | Значение | Источник |
| --- | --- | --- |
| Максимум игроков в мире | **10** (включая хоста в player-hosted; на dedicated — 10 подключённых) | [Game8 (1.0)](https://game8.co/games/Valheim/archives/620588) |
| То же для crossplay | 10 суммарно по всем платформам | [Game8](https://game8.co/games/Valheim/archives/620588) |
| Аргумент для изменения | отсутствует | [Game8](https://game8.co/games/Valheim/archives/620588) |
| Изменение лимита | только моды/нестандартные сборки (вне официальной поддержки) | ⚠️ источников в рамках этого исследования не найдено |

### 10.2. Системные требования (практика, не официальный спек)

| Ресурс | Минимум | Комфортно | Источник |
| --- | --- | --- | --- |
| RAM | 4 GB | 6–8 GB (10 игроков, большие базы, моды, старые миры) | [ConnectHosting](https://connecthosting.net/blog/valheim-dedicated-server-setup-guide) |
| RAM в простое (свежий мир 1.0) | ~1.3 GB | — | [ConnectHosting](https://connecthosting.net/blog/valheim-dedicated-server-setup-guide) |
| CPU | 2 ядра, ~2.8 GHz | важнее частота, чем число ядер (плохо масштабируется по потокам) | [Flux](https://runonflux.com/games/valheim/self-host-valheim), [Liquid Web](https://www.liquidweb.com/dedicated-server/valheim/) |
| Диск | ~2 GB файлы + мир | 10 GB с запасом на бэкапы | [ConnectHosting](https://connecthosting.net/blog/valheim-dedicated-server-setup-guide), [Corallium](https://www.coralliumstudios.net/templates/valheim) |
| Сеть | 2 Mbit/s up на небольшую группу | — | [Liquid Web](https://www.liquidweb.com/dedicated-server/valheim/) |
| ОС | Windows 10/11 x64 | — | [SteamDB depot 896663](https://steamdb.info/depot/896663/history/?changeid=M:932473376395593663) (Windows-депот содержит `valheim_server.exe`) |

> ⚠️ Официальных «system requirements» для dedicated server Iron Gate не публиковала; таблица — консенсус хостингов. RAM растёт от размера/застроенности мира, а не от числа игроков ([ConnectHosting](https://connecthosting.net/blog/valheim-dedicated-server-setup-guide): «Memory grows with what your group builds and explores… not with player count»).

### 10.3. Публичный список серверов

- Видимость управляется `-public 1` (в поставке Iron Gate стоит именно `1`) ([gamenight](https://hub.docker.com/r/gamenight/valheim), [шаблон Iron Gate](https://www.sweclockers.com/forum/trad/1761962-valheim-server-pa-steamdeck-hjalp)).
- В список сервер попадает через **Steam query на `port+1`** ([lloesche discussion #32](https://github.com/community-valheim-tools/valheim-server-docker/discussions/32)).
- Сервер появляется в списке **не мгновенно**: готовность ~17 с после старта (замер), с crossplay join code — ~30 с, большой мир дольше ([Loafhosts](https://loafhosts.com/guides/valheim-server-not-showing/)).
- Несовпадение версий клиента и сервера даёт `Incompatible version` — частая причина «сервер не находится» после обновления ([low.ms](https://low.ms/knowledgebase/valheim-cant-connect-to-server)).
- Ручное подключение: «Join IP» `ip:2456`, либо добавление в избранное через `ip:2457` (порт запроса) ([zclimes, форк lloesche](https://github.com/zclimes/valheim-server-docker): «Enter Server IP and port+1»).

---

## 11. BepInEx / Thunderstore: моды на сервере

### 11.1. Пакет

| Что | Значение | Источник |
| --- | --- | --- |
| Пакет Thunderstore | `denikson/BepInExPack_Valheim` | [Thunderstore](https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/) |
| Версия BepInEx внутри | 5.4.23.5 (на 2026-08) | [NxLabs mirror](https://nxeon.cloud/mods/valheim/bepinex-valheim), [пример лога 5.4.23.5](https://pastebin.com/rmNhAWvM) |
| Поддерживается community | Azumatt, Vapok, Margmas | [NxLabs](https://nxeon.cloud/mods/valheim/bepinex-valheim) |
| Установка | «Manual Download» → распаковать **содержимое** архива в корень сервера (рядом с `valheim_server.exe`) | [EmeraldHost docs](https://docs.emeraldhost.de/en/gameserver/valheim/install-bepinex) |

### 11.2. Что появляется в каталоге сервера

```text
<install_dir>\
├─ valheim_server.exe
├─ valheim_server_Data\
├─ winhttp.dll              # Doorstop: DLL-подмена для загрузки BepInEx
├─ doorstop_config.ini      # настройки Doorstop (вкл/выкл, target assembly, аргументы)
└─ BepInEx\
   ├─ core\                 # сборки BepInEx (preloader, HarmonyX и т.п.)
   ├─ plugins\              # ← сюда кладутся моды (*.dll)
   ├─ config\               # конфиги модов (*.cfg)
   └─ LogOutput.log         # лог загрузки модов (перезаписывается каждый старт)
```

Источник структуры: [EmeraldHost](https://docs.emeraldhost.de/en/gameserver/valheim/install-bepinex) (`BepInEx/`, `doorstop_config.ini`, `winhttp.dll`, `plugins/`), [Valheim-Modding Wiki](https://github-wiki-see.page/m/Valheim-Modding/Wiki/wiki/Server-Troubleshooting) (`BepInEx/LogOutput.log`, строки `[Info : BepInEx] Loading [ModName 1.0.0]`), [BepInEx docs](https://docs.bepinex.dev/articles/advanced/proton_wine.html) (принцип DLL-форвардинга Doorstop).

> 🟡 На Linux аналог — `libdoorstop_x64.so` + `LD_PRELOAD` ([lloesche/valheim-server](https://raw.githubusercontent.com/lloesche/valheim-server-docker/main/valheim-server): `SERVER_LD_PRELOAD=libdoorstop_x64.so`). Для Windows-менеджера это неактуально, но объясняет, почему «моды» = «подмена загрузчика», а не «плагин в папке».

### 11.3. Установка и проверка

1. Остановить сервер (обязательно: `winhttp.dll` нельзя подменить на работающем процессе).
2. Скачать `BepInExPack_Valheim` (Manual Download) и распаковать в корень.
3. Запустить сервер; BepInEx инициализируется сам ([EmeraldHost](https://docs.emeraldhost.de/en/gameserver/valheim/install-bepinex)).
4. Проверка: появился `BepInEx\LogOutput.log`; если файла нет — BepInEx не загрузился ([Valheim-Modding Wiki](https://github-wiki-see.page/m/Valheim-Modding/Wiki/wiki/Server-Troubleshooting)).
5. Моды кладутся как `*.dll` в `BepInEx\plugins\` ([EmeraldHost](https://docs.emeraldhost.de/en/gameserver/valheim/install-bepinex)).

### 11.4. Что учесть менеджеру

| Аспект | Факт / рекомендация | Источник |
| --- | --- | --- |
| Обновление через SteamCMD | `validate` перезаписывает файлы игры, но **не удаляет** лишние (`winhttp.dll`, `BepInEx\`) | [uGetFix](https://ugetfix.com/dll/winhttp.dll): «It usually leaves extra files alone, so `winhttp.dll` and the `BepInEx` folder stay after a verify» |
| Совместимость с 1.0 | 1.0 вышла на новом Unity; моды, собранные под старый билд, падают с `HarmonyX`/`patch failed`, сервер может не дойти до `Game server connected` | [low.ms](https://low.ms/knowledgebase/valheim-dedicated-server-crashes-on-startup) |
| BepInEx и crossplay | совместимы | [low.ms](https://low.ms/blog/valheim-crossplay-join-codes) |
| Остановка | с модами Ctrl+C может не срабатывать (подтверждено на Linux) → проверять `World saved` | [BepInEx #185](https://github.com/BepInEx/BepInEx/issues/185) |
| Клиент/сервер | набор модов должен совпадать (или мод должен быть server-side); несовпадение — главная причина «не могу подключиться» | [low.ms](https://low.ms/knowledgebase/valheim-mod-installation-guide) |
| Бэкап | перед установкой модов сделать копию папки мира | [low.ms](https://low.ms/knowledgebase/valheim-mod-installation-guide) |
| Запуск через r2modman | в `start_headless_server.bat` нужно добавить `%*` в строку запуска, иначе аргументы лаунчера не дойдут | [Valheim-Modding Wiki](https://github-wiki-see.page/m/Valheim-Modding/Wiki/wiki/Server-Troubleshooting) |

**Минимальный набор детекторов для будущей поддержки модов:**

- `FileExists(<install>\winhttp.dll)` **и** `FileExists(<install>\doorstop_config.ini)` → BepInEx установлен.
- `FileExists(<install>\BepInEx\LogOutput.log)` + время модификации → BepInEx реально загружался в последнем запуске.
- `Directory::read(<install>\BepInEx\plugins\*.dll)` → список модов для UI.
- Парсинг `LogOutput.log` на `[Info : BepInEx] Loading [` → подтверждение загрузки конкретного плагина.
- ⚠️ Отключение BepInEx «на лету» без переименования `winhttp.dll` невозможно: Doorstop стартует до управляемого кода.

---

## 12. Сводка для реализации

### 12.1. Пути по умолчанию (Windows)

```text
install_dir      : <любой>\Valheim Dedicated Server     # задаётся +force_install_dir
executable       : <install_dir>\valheim_server.exe
start_script     : <install_dir>\start_headless_server.bat
steamcmd         : <любой>\steamcmd\steamcmd.exe
appmanifest      : <steamcmd>\steamapps\appmanifest_896660.acf

save_dir_default : %USERPROFILE%\AppData\LocalLow\IronGate\Valheim
worlds           : <save_dir>\worlds_local\<WorldName>\        # 1.0: папка
worlds_legacy    : <save_dir>\worlds_local\<WorldName>.fwl|.db # pre-1.0
access_lists     : <save_dir>\adminlist.txt, bannedlist.txt, permittedlist.txt
logs (default)   : stdout; файла нет
logs (explicit)  : любое значение -logfile
bepinex_log      : <install_dir>\BepInEx\LogOutput.log
```

### 12.2. Обязательная валидация перед запуском

| Проверка | Правило | Реакция |
| --- | --- | --- |
| `valheim_server.exe` существует | файл есть | иначе — предложить установку/обновление |
| `-name` | 1–53 символа, непустое | блокировать запуск |
| `-world` | 1–20 символов, непустое | блокировать |
| `-password` | 5–20 символов; не входит в `-world`/`-name` | блокировать с пояснением |
| `-port` | 1–65535; свободен `port` и `port+1` | предупредить/блокировать |
| `-savedir` | абсолютный путь, доступен на запись | блокировать |
| `-logfile` | родительский каталог существует | создать каталог |
| `-preset`/`-modifier`/`-setkey` | значения из белых списков | блокировать |
| Уже запущенный инстанс | нет другого процесса с тем же `-port` | блокировать |

### 12.3. Машина состояний (по логу)

```text
IDLE → STARTING (процесс создан)
STARTING → LOADING   (появилась строка "Load world:" или "Loading: Generating locations")
LOADING  → READY     ("Game server connected")
READY    → STOPPING  (отправлен Ctrl+C / stop)
STOPPING → IDLE      (процесс вышел; желательно увидеть "World saved")
STARTING/LOADING/READY → CRASHED (процесс вышел без запроса остановки)
```

Источники маркеров: [PlayNHost](https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/), [Valheim Companion](https://www.valheimcompanion.com/servers/server-not-showing), [renode.space](https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost).

### 12.4. Что можно показать в UI без модов

- Версия сервера (`Valheim version: …`).
- Текущий мир и номер сохранения (`ZNet.LoadWorld: … save number N`).
- Join code (если crossplay) и число игроков из строки `Session …`.
- Список игроков: имя из `Got character ZDOID from <name> :`, ID из `Got connection SteamID <id>`.
- Время последнего сохранения и его длительность (`World saved ( …ms )`).
- Статус «мир создан заново» — по `Loading: Generating locations` (важное предупреждение пользователю).

---

## 13. Открытые вопросы

Ниже — то, что **не удалось подтвердить** в рамках этого исследования. Каждый пункт стоит проверить на живом сервере (запуск + чтение лога) до реализации соответствующей функции.

1. **Дефолтный файл лога.** Источники сходятся, что без `-logfile` вывод идёт в stdout, но существует ли у Windows-сборки неявный `Player.log`/`valheim_server.log` в `LocalLow` — не подтверждено.
2. **`-logfile -`** (вывод в stdout через Unity-синтаксис) — не проверено, поддерживает ли Valheim такое значение.
3. **Точный набор `-backups`, `-backupshort`, `-backuplong`** и их значения по умолчанию: синтаксис встречается в одном community-источнике, официального подтверждения нет.
4. **`-public` по умолчанию**, если флаг не передан (в шаблоне Iron Gate стоит `1`, но это лишь шаблон). Также неизвестно, существует ли значение `2` и что оно делает.
5. **Формат ID в `adminlist.txt`/`bannedlist.txt` после 1.0.** Одни источники требуют префикс `V_`/`X_`, другие продолжают описывать «голый» SteamID64. Нужен эксперимент: добавить оба варианта и проверить, кого сервер признаёт админом.
6. **`-preset keep`** — принимает ли CLI значение «не менять правила мира», как одноимённая опция в UI.
7. **Максимальная длина `-name` (53) и `-world` (20)** — взяты из валидации хостинговой панели, а не из документации Iron Gate; фактическое поведение сервера при превышении не проверено.
8. **Проверка пароля на вхождение в seed** — low.ms утверждает, что пароль не должен встречаться и в seed; официальный комментарий в скрипте говорит только про имя сервера. Нужно проверить, что именно валидирует сервер.
9. **`taskkill` без `/F`** для `valheim_server.exe`: ожидаемо не работает (нет оконного message loop), но прямого подтверждения нет.
10. **Обработка Ctrl+C при установленном BepInEx на Windows** — подтверждено только для Linux (issue #185).
11. **Точная семантика модификаторов** `portals` (что именно разрешает каждое значение) и `raids` (`none` vs `muchless`) — в документации Iron Gate есть только названия, не значения коэффициентов.
12. **Порты 2458** — нужен ли он в 1.0 (официальное руководство требует 2456–2458, современные руководства — только 2456–2457).
13. **`-crossplay` + `-public 0`** — блокирует ли это выдачу join code.
14. **Требование `-nographics`/`-batchmode`** при запуске из GUI-приложения без консоли: не проверено, достаточно ли их, или нужен `CREATE_NO_WINDOW`/скрытая консоль.
15. **Кодировка лога** при кириллических именах игроков (UTF-8 vs текущая кодовая страница Windows).
16. **Поведение `-savedir` с относительным путём** (трактуется относительно рабочего каталога процесса или каталога установки) — не подтверждено; использовать только абсолютные пути.

---

## 14. Источники

### Официальные

- Iron Gate, «A Guide to Dedicated Servers» — <https://www.valheimgame.com/support/a-guide-to-dedicated-servers/> *(основной официальный документ; в этой сессии текст читался через пересказы, см. пометку в начале)*
- Valve, SteamCMD — <https://developer.valvesoftware.com/wiki/SteamCMD>
- Valve, архив SteamCMD для Windows — <https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip>
- SteamDB, Valheim Dedicated Server, Windows depot 896663 — <https://steamdb.info/depot/896663/>
- SteamDB, Linux depot 896661 — <https://steamdb.info/depot/896661/history/>
- BepInEx docs (Doorstop/DLL forwarding) — <https://docs.bepinex.dev/articles/advanced/proton_wine.html>
- Thunderstore, BepInExPack_Valheim — <https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/>
- Thunderstore, ConsoleStdinHeeler — <https://thunderstore.io/c/valheim/p/DreamWraith/ConsoleStdinHeeler/>
- BepInEx issue #185 (Ctrl+C/SIGINT на Linux) — <https://github.com/BepInEx/BepInEx/issues/185>
- Valheim Modding Wiki, Server Troubleshooting — <https://github-wiki-see.page/m/Valheim-Modding/Wiki/wiki/Server-Troubleshooting>

### Community-документация и базы знаний

- lloesche/valheim-server-docker — <https://hub.docker.com/r/lloesche/valheim-server>, скрипт запуска — <https://raw.githubusercontent.com/lloesche/valheim-server-docker/main/valheim-server>
- community-valheim-tools/valheim-server-docker, обсуждение портов — <https://github.com/community-valheim-tools/valheim-server-docker/discussions/32>
- gamenight/valheim (docker) — <https://hub.docker.com/r/gamenight/valheim>
- gamepackets/valheim (docker) — <https://hub.docker.com/r/gamepackets/valheim>
- Fandom, Dedicated servers — <https://valheim.fandom.com/wiki/Dedicated_servers>
- renode.space, «Valheim server log explained» — <https://renode.space/blog/valheim-server-log-file-explained>; RU-версия — <https://renode.space/ru/blog/valheim-server-log-file-explained>
- renode.space, «Valheim server killed: what is lost and how to stop safely» — <https://renode.space/blog/valheim-safe-shutdown-and-what-gets-lost>
- renode.space, «SteamCMD on Windows» — <https://renode.space/blog/steamcmd-on-windows>
- PlayNHost, «How to read your Valheim server console» — <https://playnhost.com/knowledgebase/valheim/How-to-read-your-Valheim-server-console/>
- PlayNHost, «Valheim settings will not save» (правила валидации) — <https://playnhost.com/knowledgebase/valheim/Valheim-settings-will-not-save/>
- PlayNHost, «Set Valheim world modifiers and difficulty» — <https://playnhost.com/knowledgebase/valheim/How-to-set-Valheim-world-modifiers-and-difficulty/>
- low.ms, adminlist.txt — <https://low.ms/knowledgebase/valheim-adminlist>
- low.ms, world modifiers explained — <https://low.ms/knowledgebase/valheim-world-modifiers-explained>
- low.ms, server configuration guide — <https://low.ms/knowledgebase/valheim-server-configuration-guide>
- low.ms, backups and restore (формат 1.0) — <https://low.ms/knowledgebase/valheim-server-backups-and-restore>
- low.ms, «server crashes on startup» (правила пароля) — <https://low.ms/knowledgebase/valheim-dedicated-server-crashes-on-startup>
- low.ms, crossplay и join codes — <https://low.ms/blog/valheim-crossplay-join-codes>
- low.ms, mod installation guide — <https://low.ms/knowledgebase/valheim-mod-installation-guide>
- ConnectHosting, dedicated server setup (1.0) — <https://connecthosting.net/blog/valheim-dedicated-server-setup-guide>
- ConnectHosting, admin commands (1.0 ID change) — <https://connecthosting.net/blog/valheim-admin-commands-dedicated-server>
- Host Havoc, patch notes 1.0 для владельцев серверов — <https://hosthavoc.com/en-GB/blog/valheim-1-0-update-server-owners>
- Host Havoc, upload world (формат 1.0) — <https://hosthavoc.com/wiki/game-servers/valheim/upload-world>
- Host Havoc, add admins (`V_`/`X_` префиксы) — <https://hosthavoc.com/en-GB/wiki/game-servers/valheim/add-admins>
- Host Havoc, «how to create a valheim dedicated server» (таблица модификаторов) — <https://hosthavoc.com/es/blog/how-to-create-a-valheim-dedicated-server>
- gameserverkings, save location и листинг мира 1.0 — <https://www.gameserverkings.com/knowledge-base/valheim/valheim-save-location/>
- Loafhosts, «Where the files are on a Valheim server» — <https://loafhosts.com/guides/valheim-server-files/>
- Loafhosts, «Valheim server logs» — <https://loafhosts.com/guides/valheim-server-logs/>
- Loafhosts, «Valheim server not showing in the server list» — <https://loafhosts.com/guides/valheim-server-not-showing/>
- mc-node, adminlist/bans/whitelist в 1.0 — <https://mc-node.net/blog/en/valheim-adminlist-ban-whitelist/>
- Wasabi Hosting, admin commands & access lists — <https://docs.wasabihosting.com/games/valheim/admin-commands>
- hythost, Valheim admin commands — <https://hythost.com/guides/valheim-admin-commands>
- slashplay, `-port` — <https://slashplay.gg/commands/valheim/-port>; `-crossplay` — <https://slashplay.gg/commands/valheim/-crossplay>; `-instanceid` — <https://slashplay.gg/commands/valheim/-instanceid>
- SurvivalServers Wiki, Valheim server settings (1.0) — <https://www.survivalservers.com/wiki/Valheim_Server_Settings>
- Valheim Companion, dedicated server setup — <https://www.valheimcompanion.com/servers/dedicated-server-setup>; server settings — <https://www.valheimcompanion.com/servers/server-settings>; server not showing — <https://www.valheimcompanion.com/servers/server-not-showing>
- WinterNode, «Valheim server won't start» — <https://winternode.com/blog/valheim/valheim-server-won-t-start-real-error-causes-and-fixes>
- EmeraldHost, установка BepInEx на сервер — <https://docs.emeraldhost.de/en/gameserver/valheim/install-bepinex>
- NxLabs, BepInExPack Valheim (версия 5.4.23.5) — <https://nxeon.cloud/mods/valheim/bepinex-valheim>
- LGSL, crossplay и локальный IP — <https://livegameserverlist.com/ru/blog/valheim-crossplay-server-local-ip-not-working>
- doomhosting, отключение crossplay — <https://www.doomhosting.com/help/articles/how-to-turn-off-valheim-server-crossplay>; join code — <https://www.doomhosting.com/help/articles/how-to-join-valheim-server>
- hebergtonserv, порты Valheim — <https://hebergtonserv.com/tutoriels/ouvrir-ports-serveur-valheim/>; логи — <https://hebergtonserv.com/tutoriels/lire-logs-serveur-valheim/>; несколько миров — <https://hebergtonserv.com/tutoriels/plusieurs-mondes-serveur-valheim/>; бэкапы — <https://hebergtonserv.com/tutoriels/sauvegarder-restaurer-monde-valheim/>
- Flux, self-host Valheim — <https://runonflux.com/games/valheim/self-host-valheim>
- Corallium Studios, Valheim template (ресурсы) — <https://www.coralliumstudios.net/templates/valheim>
- Liquid Web, Valheim dedicated server — <https://www.liquidweb.com/dedicated-server/valheim/>
- Game8, max players (1.0) — <https://game8.co/games/Valheim/archives/620588>; difficulty/modifiers — <https://game8.co/games/Valheim/archives/618899>; dedicated server setup — <https://game8.co/games/Valheim/archives/620871>
- Spawnly, генератор `start_headless_server.bat` — <https://spawnly.net/tools/config-generator/valheim>
- vgtimes, dedicated server setup guide (1.0) — <https://vgtimes.com/guides/167260-valheim-dedicated-server-setup-guide.html>
- пересказ официального руководства Iron Gate (zh) — <https://zh.vgtimes.com/guides/167260-valheim-%E4%B8%93%E7%94%A8%E6%9C%8D%E5%8A%A1%E5%99%A8%E8%AE%BE%E7%BD%AE%E6%8C%87%E5%8D%97.html>
- FireDaemon KB, Valheim как Windows-служба — <https://kb.firedaemon.com/support/solutions/articles/4000195004-valheim-dedicated-server-as-windows-service>
- VolticHost KB, установка на Windows VPS — <https://voltichost.com/knowledgebase/a/how-to-install-and-configure-a-valheim-dedicated-server-on-a-windows-vps>
- space-node, обновление и `-beta public` — <https://space-node.net/blog/valheim-incompatible-version-connect-fix-2026>
- Steam Community: `-resetmodifiers` — <https://steamcommunity.com/app/892970/discussions/1/601904634461686819/>; ошибка `state 0x6` — <https://steamcommunity.com/app/892970/discussions/0/573803804385009352/>
- пример лога сервера с BepInEx (сентябрь 2026) — <https://pastebin.com/rmNhAWvM>

### Дополнительные точечные ссылки

- шаблон `start_headless_server.bat` (полный текст) — <https://www.sweclockers.com/forum/trad/1761962-valheim-server-pa-steamdeck-hjalp>
- SteamCMD: официальный URL архива и распаковка — <https://northbeachgames.freshdesk.com/support/solutions/articles/154000217670-can-i-use-steamcmd-to-install-the-dedicated-server->
- SteamCMD: разбор `appmanifest` / `+app_info_print` — <https://looselydecoupled.com/update-7-days-to-die-server-only-on-new-build/>
- SteamCMD: обработка кодов возврата — <https://github.com/pterodactyl/yolks/pull/49/files>
- Steam: `validate` оставляет посторонние файлы — <https://ugetfix.com/dll/winhttp.dll>
- `Stop-Process` как форсированное убийство (обоснование «не сохраняет») — <https://stackoverflow.com/revisions/c0622e11-a311-4c97-9548-a6fffa67eb0c/view-source>
- порты 2456–2458 UDP — <https://www.redswitches.com/blog/valheim-dedicated-server-guide/>
- «только 2456–2457» — <https://selfhosting.sh/apps/valheim-server/>
- crossplay: случайный порт прослушивания — <https://blog.gitcode.com/c5f5a5e41420df493db5b737faf107d7.html>
- сохранения привязаны к пользователю ОС — <https://www.joingg.co/blog/valheim-dedicated-server-setup>
- `.ok`-маркер и восстановление старого мира — <https://supercraft.host/wiki/valheim/old_format_missing_db_after_1_0/>
- «ловушка permitted list» — <https://gamever.io/knowledge-base/every-valheim-server-startup-argument-the-permitted-list-trap>
- серверные команды `kick`/`ban`/`unban`/`save` — <https://mtxserv.com/valheim-server/doc/valheim-server-command-list>
- `-setkey`/`NoBuildCost` — <https://nodecraft.com/support/games/valheim/setup/unlock-all-recipes-and-buildings-on-a-valheim-server>
- join code меняется при рестарте — <https://playyourway.com.au/help/valheim-getting-started>
- Ctrl+C вместо закрытия окна (es) — <https://es.vgtimes.com/guides/167249-gua-de-solucin-de-problemas-de-valheim-cadas-rendimiento-y-problemas-de-servidor.html>
- `-console` — клиентский параметр — <https://docs.rdsnode.com/es/juegos/valheim/argumentos-adicionales>, <https://www.kinetichosting.com/articles/valheim/basics/how-to-enable-the-console-for-valheim>
- пресеты мира (с `immersive` и без) — <https://2hours.gg/zh/guide/valheim-world-modifiers>, <https://valheimgame.wiki/fr/tools/>
- появление модификаторов в 0.217.19 — <https://gamesguru.pl/valheim-otrzymal-nowa-aktualizacje-update-wprowadza-wazna-funkcje-dla-serwerow-dedykowanych/>
- консоли не могут хостить сервер — <https://www.doomhosting.com/help/articles/how-to-join-valheim-server-xbox-ps5-switch-2>
- low.ms (прочее): join code — <https://low.ms/knowledgebase/valheim-join-code-not-working>; пароль — <https://low.ms/knowledgebase/valheim-getting-started>; join code в логе и `World load failed` — <https://low.ms/knowledgebase/valheim-troubleshooting-guide>; `Incompatible version` — <https://low.ms/knowledgebase/valheim-cant-connect-to-server>
- порт+1 для избранного Steam — <https://github.com/zclimes/valheim-server-docker>

