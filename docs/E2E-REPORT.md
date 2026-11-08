# E2E-отчёт: Valheim Server Manager

- Дата: 2026-11-08T17:36:02.545Z
- Приложение: Valheim Server Manager v0.1.0
- Конфигурация: installDir=D:\Servers\Valheim\server, port=2456, world=Tankograd, preset=normal
- Пути: config=C:\Users\user\AppData\Roaming\com.valheim.servermanager\config.json; server=D:\Servers\Valheim\server
- Режим с запуском сервера: да

| Проверка | Статус | Детали |
| --- | --- | --- |
| app_info: приложение отвечает по IPC | PASS | Valheim Server Manager v0.1.0, Tauri 2.12.5, windows/x86_64 |
| окно приложения создано и активно | PASS | document ready, видимо |
| UI отрендерился (сайдбар и заголовок) | PASS | брендинг есть, элементов навигации: 9, текста: 2264 символов |
| get_config: конфигурация | PASS | installDir=D:\Servers\Valheim\server, port=2456, world=Tankograd, preset=normal |
| get_paths: вычисленные пути | PASS | config=C:\Users\user\AppData\Roaming\com.valheim.servermanager\config.json; server=D:\Servers\Valheim\server |
| get_install_status: SteamCMD и сервер установлены | PASS | размер установки 2.0 ГБ |
| get_logs: кольцевой буфер логов | PASS | 2 строк, последняя: Конфигурация: C:\Users\user\AppData\Roaming\com.valheim.servermanager\config.j |
| list_worlds: миры найдены | PASS | E2EWorld (142.8 КБ), Tankograd (1.2 МБ) |
| get_player_lists: списки игроков читаются | PASS | admins=12, banned=0, permitted=0 |
| get_known_players: игроки из логов и истории мира | PASS | 5 игроков (5 с именем, 4 админов): Игрок1/76561198000000001, Игрок2/76561198000000003, Игрок3/76561198000000004, Игрок4/76561198000000002, Игрок5/— |
| get_mod_status: статус BepInEx/Server Devcommands | PASS | BepInEx=5.4.2360, Server_devcommands=1.116.0, плагинов: 2 |
| diagnose_network: порты и брандмауэр | PASS | 2456/udp:closed, 2457/udp:closed, 2458/udp:closed; firewallOk=true; IP: 192.168.1.100 |
| list_backups: каталог бэкапов читается | PASS | valheim-backup-20261108-135720-before-exit.zip (453.3 КБ), valheim-backup-20261108-135046-before-update.zip (466.0 Б) |
| create_backup + delete_backup: zip-архив создаётся и удаляется | PASS | valheim-backup-20261108-173545-e2e.zip, 2.3 МБ, миры: E2EWorld, Tankograd |
| save_config: тестовая конфигурация для e2e | PASS | world=E2EWorld, port=2456, saveInterval=60 |
| start_server: сервер запускается (фаза running) | PASS | phase=running, pid=10280, version=1.0.21, готов за 14 с |
| логи сервера содержат маркеры загрузки мира и готовности | PASS | 212 строк лога с маркерами версии/загрузки мира/готовности |
| stop_server: корректная остановка с сохранением мира | PASS | phase=stopped за 3 с, мир сохранён |
| save_config: исходная конфигурация восстановлена | PASS | world=Tankograd, port=2456, name=Valheim Tankograd |

**Итог: все проверки пройдены.**
