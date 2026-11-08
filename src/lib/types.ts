/**
 * Строгий контракт между Rust-ядром и React-фронтендом.
 *
 * Файл — единственный источник истины для типов IPC: Rust-структуры
 * сериализуются в JSON с `#[serde(rename_all = "camelCase")]`, поэтому поля
 * здесь повторяют их один в один. При изменении контракта обновляйте также
 * `docs/ARCHITECTURE.md` и соответствующие структуры в `src-tauri/src/`.
 */

/** Метаданные приложения, которые возвращает команда `app_info`. */
export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  os: string;
  arch: string;
  debug: boolean;
}

/** Базовый тип ошибки, которую сериализует Rust-ядро. */
export interface IpcErrorPayload {
  code?: string;
  message: string;
}

// --- Конфигурация ---------------------------------------------------------

/** Пресеты сложности мира (`-preset`). */
export type WorldPreset =
  'normal' | 'casual' | 'easy' | 'hard' | 'hardcore' | 'immersive' | 'hammer' | 'custom';

/** Модификаторы сложности (`-modifier`), активны при `preset: 'custom'`. */
export interface WorldModifiers {
  combat: 'veryeasy' | 'easy' | 'normal' | 'hard' | 'veryhard';
  deathPenalty: 'casual' | 'veryeasy' | 'easy' | 'normal' | 'hard' | 'hardcore';
  resources: 'muchless' | 'less' | 'normal' | 'more' | 'muchmore';
  raids: 'none' | 'muchless' | 'less' | 'normal' | 'more' | 'muchmore';
  portals: 'casual' | 'easy' | 'normal' | 'hard' | 'veryhard';
}

/** Ключи мира, включаемые флагом `-setkey` (серверные читы мира). */
export type WorldSetKey = 'nobuildcost' | 'playerevents' | 'passivemobs' | 'nomap';

/** Настройки выделенного сервера Valheim. */
export interface ServerSettings {
  /** `-name`: имя сервера в списке (1–53 символа, не содержит пароль). */
  name: string;
  /** `-world`: имя мира (1–20 символов; файлы мира — каталог `<savedir>/worlds_local/<world>/` в 1.0). */
  world: string;
  /** `-port`: основной UDP-порт; следующие два порта используются автоматически. */
  port: number;
  /** `-password`: 5–20 символов, не может входить в имя сервера. */
  password: string;
  /** `-public 1|0`: публиковать сервер в общем списке Steam. */
  isPublic: boolean;
  /** `-crossplay`: включить кроссплатформенную игру (PlayFab). */
  crossplay: boolean;
  /** `-preset`: пресет сложности мира. */
  preset: WorldPreset;
  /** Дополнительные `-modifier`-флаги для пресета `custom`. */
  modifiers: WorldModifiers;
  /** `-setkey`: серверные читы мира (nobuildcost, passivemobs, ...). */
  setKeys: WorldSetKey[];
  /** `-saveinterval`: интервал автосохранения в секундах, минимум 60 (по умолчанию 300 в менеджере). */
  saveIntervalSec: number | null;
  /** Дополнительные аргументы командной строки (для продвинутых пользователей). */
  extraArgs: string[];
}

/** Полная конфигурация приложения (файл `config.json` в каталоге конфигов). */
export interface AppConfig {
  schemaVersion: number;
  /** Каталог с файлами выделенного сервера (там лежит `valheim_server.exe`). */
  installDir: string;
  /** Каталог SteamCMD (там лежит `steamcmd.exe`). */
  steamcmdDir: string;
  /** Каталог для zip-архивов резервных копий. */
  backupsDir: string;
  /** Сколько последних резервных копий хранить (старые удаляются). */
  keepBackups: number;
  /** Делать резервную копию перед обновлением сервера. */
  autoBackupBeforeUpdate: boolean;
  /** Делать резервную копию перед остановкой сервера. */
  autoBackupBeforeStop: boolean;
  server: ServerSettings;
}

// --- Состояние установки и сервера ---------------------------------------

/** Состояние установки SteamCMD и файлов сервера. */
export interface InstallStatus {
  steamcmdInstalled: boolean;
  serverInstalled: boolean;
  steamcmdPath: string;
  serverExePath: string;
  installDir: string;
  /** Размер каталога установки в байтах (0, если сервер не установлен). */
  installSizeBytes: number;
}

/** Фаза жизненного цикла процесса сервера. */
export type ServerPhase = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/** Текущее состояние процесса выделенного сервера. */
export interface ServerState {
  phase: ServerPhase;
  pid: number | null;
  /** Время запуска, epoch ms. */
  startedAt: number | null;
  /** Время работы в секундах. */
  uptimeSec: number | null;
  world: string | null;
  port: number | null;
  /** Версия сервера, вычитанная из лога после запуска. */
  version: string | null;
  /** Код приглашения для crossplay (6 цифр), если сервер его зарегистрировал. */
  joinCode: string | null;
  /** Количество игроков в сети (null — неизвестно). */
  playersOnline: number | null;
  lastExitCode: number | null;
  lastError: string | null;
}

/** Источник строки лога. */
export type LogSource = 'server' | 'steamcmd' | 'app';

/** Уровень строки лога. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Одна строка лога, которую фронтенд получает из кольцевого буфера и событий. */
export interface LogLine {
  /** Монотонный идентификатор строки (для дедупликации и докачки). */
  seq: number;
  /** Время, epoch ms. */
  ts: number;
  source: LogSource;
  level: LogLevel;
  line: string;
}

/** Прогресс скачивания/обновления (событие `server-install-progress`). */
export interface InstallProgress {
  phase: 'idle' | 'downloading' | 'extracting' | 'updating' | 'verifying' | 'done' | 'error';
  message: string;
  /** Процент 0–100, если известен. */
  percent: number | null;
}

// --- Миры, игроки, бэкапы ------------------------------------------------

/** Мир, найденный в каталоге `worlds_local`. */
export interface WorldInfo {
  name: string;
  /** Суммарный размер файлов мира в байтах. */
  sizeBytes: number;
  /** Время последнего изменения, epoch ms. */
  modifiedAt: number;
  /** true, если мир выбран в конфигурации. */
  isActive: boolean;
}

/** Тип списка игроков. */
export type PlayerListKind = 'admins' | 'banned' | 'permitted';

/**
 * Запись в списке игроков.
 *
 * В Valheim 1.0 ID имеют вид `[Platform]_[UserID]`: Steam — `V_<SteamID64>`,
 * Xbox/Game Pass — `X_<ID>`, у других платформ свои префиксы. Старый формат —
 * голый SteamID64 (`7656…`) — менеджер тоже принимает и сохраняет как ввёл
 * пользователь.
 */
export interface PlayerListEntry {
  id: string;
  name: string | null;
}

/** Содержимое всех списков игроков. */
export interface PlayerLists {
  admins: PlayerListEntry[];
  banned: PlayerListEntry[];
  permitted: PlayerListEntry[];
}

/** Источник, из которого менеджер узнал игрока. */
export type KnownPlayerSource = 'history' | 'live' | 'list';

/**
 * Игрок, замеченный менеджером в логах сервера или в списках доступа.
 *
 * Используется на странице «Админ»: можно скопировать ID, добавить в
 * adminlist и сгенерировать команды kick/ban. Списки применяются после
 * перезапуска сервера.
 */
export interface KnownPlayer {
  name: string | null;
  /** SteamID64, если удалось определить (из `Steam_<id>`/`V_<id>`/`X_<id>`). */
  steamId64: string | null;
  /** Идентификатор платформы из лога как есть: `Steam_...`, `playfab/...`. */
  platformId: string | null;
  isAdmin: boolean;
  /** Время последней активности, epoch ms. */
  lastSeenAt: number;
  source: KnownPlayerSource;
}

/** Резервная копия мира. */
export interface BackupInfo {
  /** Имя файла архива (используется как идентификатор). */
  name: string;
  sizeBytes: number;
  /** Время создания, epoch ms. */
  createdAt: number;
  /** Какие миры попали в архив. */
  worlds: string[];
}

// --- Моды (BepInEx) ------------------------------------------------------

/**
 * Состояние серверных модов для включения читов (BepInEx + Server Devcommands).
 *
 * Vanilla dedicated-сервер отключает `devcommands`, поэтому god/fly/spawn/item
 * работают только на сервере с BepInEx. Менеджер устанавливает серверную часть
 * сам; клиентскую часть игроки ставят отдельно (Thunderstore/r2modman).
 */
export interface ModStatus {
  /** Установлен ли загрузчик BepInEx в каталог сервера. */
  bepinexInstalled: boolean;
  /** Версия BepInEx, если определена. */
  bepinexVersion: string | null;
  /** Установлен ли мод Server_devcommands (включает devcommands на сервере). */
  serverDevcommandsInstalled: boolean;
  /** Версия Server_devcommands, если определена. */
  serverDevcommandsVersion: string | null;
  /** Имена найденных плагинов в `BepInEx/plugins`. */
  plugins: string[];
  /** Каталог установки сервера, в котором лежит BepInEx. */
  installDir: string;
}

// --- Сеть и диагностика ---------------------------------------------------

/** Проверка одного порта. */
export interface PortCheck {
  port: number;
  protocol: 'udp' | 'tcp';
  state: 'listening' | 'closed' | 'unknown';
}

/** Правило брандмауэра Windows, относящееся к серверу. */
export interface FirewallRuleInfo {
  name: string;
  enabled: boolean;
  ports: string;
  direction: 'in' | 'out' | 'unknown';
}

/** Результат диагностики сети и брандмауэра. */
export interface NetworkDiagnosis {
  /** Основной порт сервера из конфигурации. */
  mainPort: number;
  /** Диапазон из трёх используемых UDP-портов: [mainPort, mainPort + 2]. */
  portRange: [number, number];
  ports: PortCheck[];
  firewallRules: FirewallRuleInfo[];
  /** true, если найдено включённое входящее правило для всех трёх портов. */
  firewallOk: boolean;
  /** Локальные IPv4-адреса машины. */
  localIps: string[];
  generatedAt: number;
  /** Готовые подсказки для пользователя. */
  hints: string[];
}

// --- Служебные типы -------------------------------------------------------

/** Каталоги, которые умеет открывать команда `open_path`. */
export type OpenTarget =
  | 'installDir'
  | 'steamcmdDir'
  | 'backupsDir'
  | 'logsDir'
  | 'saveDir'
  | 'worldsDir'
  | 'configFile'
  | 'bepinexDir';

/** Вычисленные пути приложения (для страницы настроек и диагностики). */
export interface ResolvedPaths {
  configFile: string;
  logsDir: string;
  dataDir: string;
  installDir: string;
  steamcmdDir: string;
  backupsDir: string;
  saveDir: string;
  worldsDir: string;
}
