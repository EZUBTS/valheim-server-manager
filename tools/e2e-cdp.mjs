/**
 * End-to-end проверка собранного десктоп-приложения Valheim Server Manager.
 *
 * Скрипт общается с WebView2-окном приложения по Chrome DevTools Protocol
 * (CDP) и вызывает настоящие Tauri-команды через `window.__TAURI_INTERNALS__`,
 * то есть проверяет ровно тот же IPC-путь, что использует React-фронтенд.
 *
 * Требования:
 *   - приложение запущено с `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`;
 *   - Node.js >= 22 (встроенные fetch и WebSocket).
 *
 * Запуск:
 *   node tools/e2e-cdp.mjs [--port 9333] [--with-server] [--report ../docs/E2E-REPORT.md]
 *
 * `--with-server` дополнительно запускает реальный сервер, ждёт фазу `running`,
 * останавливает его и проверяет, что мир сохранён и процесс завершился.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const CDP_PORT = Number(argValue('--port', '9333'));
const WITH_SERVER = args.includes('--with-server');
const INSTALL_MODS = args.includes('--install-mods');
const REPORT_PATH = argValue('--report', path.join(process.cwd(), 'docs', 'E2E-REPORT.md'));

const results = [];
let failures = 0;

function record(name, status, details = '') {
  results.push({ name, status, details });
  if (status === 'FAIL') {
    failures += 1;
  }
  const icon = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`[${icon}] ${name}${details ? ` — ${details}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCdp(deadlineMs = 90_000) {
  const startedAt = Date.now();
  let lastError = 'endpoint недоступен';
  while (Date.now() - startedAt < deadlineMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) {
          return page;
        }
        lastError = 'нет page-таргета';
      }
    } catch (error) {
      lastError = String(error);
    }
    await sleep(500);
  }
  throw new Error(`CDP не поднялся на порту ${CDP_PORT}: ${lastError}`);
}

/** Минимальный CDP-клиент поверх встроенного WebSocket. */
class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const request = this.pending.get(message.id);
      if (request) {
        this.pending.delete(message.id);
        if (message.error) {
          request.reject(new Error(JSON.stringify(message.error)));
        } else {
          request.resolve(message.result);
        }
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true });
    });
    return new CdpClient(ws);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: 120_000,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `JS exception: ${result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)}`,
      );
    }
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function check(client, name, fn) {
  try {
    const details = await fn();
    record(name, 'PASS', details ?? '');
    return details;
  } catch (error) {
    record(name, 'FAIL', String(error?.message ?? error));
    return undefined;
  }
}

function invoke(client, command, commandArgs) {
  const argsLiteral = JSON.stringify(commandArgs ?? null);
  return client.evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${argsLiteral})`,
  );
}

function statePhase(state) {
  return state?.phase ?? 'unknown';
}

async function waitForPhase(client, phases, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await invoke(client, 'get_server_state');
    if (phases.includes(statePhase(last))) {
      return last;
    }
    await sleep(1000);
  }
  throw new Error(`не дождались фаз ${phases.join('/')} за ${timeoutMs} мс, сейчас: ${statePhase(last)}`);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return '—';
  }
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

async function main() {
  console.log(`Ждём CDP на 127.0.0.1:${CDP_PORT} ...`);
  const target = await waitForCdp();
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  console.log(`Подключились: ${target.title} (${target.url})`);

  let appInfoSummary = 'неизвестно';
  let configSummary = 'не прочитана';
  let pathsSummary = 'не прочитаны';
  await check(client, 'app_info: приложение отвечает по IPC', async () => {
    const info = await invoke(client, 'app_info');
    appInfoSummary = `${info.name} v${info.version}`;
    return `${info.name} v${info.version}, Tauri ${info.tauriVersion}, ${info.os}/${info.arch}`;
  });

  await check(client, 'окно приложения создано и активно', async () => {
    const visible = await client.evaluate(
      'document.visibilityState === "visible" && document.readyState === "complete"',
    );
    if (!visible) {
      throw new Error('страница не готова/не видима');
    }
    return 'document ready, видимо';
  });

  await check(client, 'UI отрендерился (сайдбар и заголовок)', async () => {
    const summary = await client.evaluate(`(() => {
      const text = document.body.innerText;
      return {
        hasBrand: text.includes('VALHEIM') || text.includes('Valheim'),
        navItems: document.querySelectorAll('nav a, nav button').length,
        bodyLength: text.length,
      };
    })()`);
    if (!summary.hasBrand) {
      throw new Error('в UI нет брендинга Valheim');
    }
    return `брендинг есть, элементов навигации: ${summary.navItems}, текста: ${summary.bodyLength} символов`;
  });

  await check(client, 'get_config: конфигурация', async () => {
    const value = await invoke(client, 'get_config');
    configSummary = `installDir=${value.installDir}, port=${value.server.port}, world=${value.server.world}, preset=${value.server.preset}`;
    return configSummary;
  });

  await check(client, 'get_paths: вычисленные пути', async () => {
    const value = await invoke(client, 'get_paths');
    pathsSummary = `config=${value.configFile}; server=${value.installDir}`;
    return pathsSummary;
  });

  await check(client, 'get_install_status: SteamCMD и сервер установлены', async () => {
    const status = await invoke(client, 'get_install_status');
    if (!status.steamcmdInstalled) {
      throw new Error(`SteamCMD не найден: ${status.steamcmdPath}`);
    }
    if (!status.serverInstalled) {
      throw new Error(`сервер не найден: ${status.serverExePath}`);
    }
    return `размер установки ${formatBytes(status.installSizeBytes)}`;
  });

  await check(client, 'get_logs: кольцевой буфер логов', async () => {
    const logs = await invoke(client, 'get_logs', { limit: 50, source: null, sinceSeq: null });
    if (!Array.isArray(logs) || logs.length === 0) {
      throw new Error('буфер логов пуст');
    }
    return `${logs.length} строк, последняя: ${(logs.at(-1)?.line ?? '').slice(0, 80)}`;
  });

  await check(client, 'list_worlds: миры найдены', async () => {
    const worlds = await invoke(client, 'list_worlds');
    return worlds.length === 0
      ? 'миров нет (сервер ещё не запускался)'
      : worlds.map((world) => `${world.name} (${formatBytes(world.sizeBytes)})`).join(', ');
  });

  await check(client, 'get_player_lists: списки игроков читаются', async () => {
    const lists = await invoke(client, 'get_player_lists');
    return `admins=${lists.admins.length}, banned=${lists.banned.length}, permitted=${lists.permitted.length}`;
  });

  await check(client, 'get_known_players: игроки из логов и истории мира', async () => {
    const players = await invoke(client, 'get_known_players');
    if (!Array.isArray(players)) {
      throw new Error('команда вернула не массив');
    }
    const named = players.filter((player) => player.name).length;
    const admin = players.filter((player) => player.isAdmin).length;
    return `${players.length} игроков (${named} с именем, ${admin} админов): ${players
      .slice(0, 5)
      .map((player) => `${player.name ?? '—'}/${player.steamId64 ?? '—'}`)
      .join(', ')}`;
  });

  const initialModStatus = await check(client, 'get_mod_status: статус BepInEx/Server Devcommands', async () => {
    const status = await invoke(client, 'get_mod_status');
    return `BepInEx=${status.bepinexInstalled ? status.bepinexVersion ?? 'да' : 'нет'}, Server_devcommands=${
      status.serverDevcommandsInstalled ? status.serverDevcommandsVersion ?? 'да' : 'нет'
    }, плагинов: ${status.plugins.length}`;
  });

  if (INSTALL_MODS && !initialModStatus?.serverDevcommandsInstalled) {
    await check(client, 'install_server_mods: установка серверных модов с Thunderstore', async () => {
      const serverState = await invoke(client, 'get_server_state');
      if (['starting', 'running', 'stopping'].includes(statePhase(serverState))) {
        throw new Error('сервер должен быть остановлен для установки модов');
      }
      const startedAt = Date.now();
      const result = await invoke(client, 'install_server_mods');
      if (!result.bepinexInstalled || !result.serverDevcommandsInstalled) {
        throw new Error(`моды не установились: ${JSON.stringify(result)}`);
      }
      await sleep(500);
      const after = await invoke(client, 'get_mod_status');
      if (!after.bepinexInstalled || !after.serverDevcommandsInstalled) {
        throw new Error('get_mod_status после установки не видит моды');
      }
      return `BepInEx=${after.bepinexVersion ?? 'да'}, Server_devcommands=${
        after.serverDevcommandsVersion ?? 'да'
      } за ${Math.round((Date.now() - startedAt) / 1000)} с`;
    });
  }

  await check(client, 'diagnose_network: порты и брандмауэр', async () => {
    const diagnosis = await invoke(client, 'diagnose_network');
    const ports = diagnosis.ports
      .map((port) => `${port.port}/${port.protocol}:${port.state}`)
      .join(', ');
    return `${ports}; firewallOk=${diagnosis.firewallOk}; IP: ${diagnosis.localIps.join(', ')}`;
  });

  await check(client, 'list_backups: каталог бэкапов читается', async () => {
    const backups = await invoke(client, 'list_backups');
    return backups.length === 0
      ? 'бэкапов нет'
      : backups.map((backup) => `${backup.name} (${formatBytes(backup.sizeBytes)})`).join(', ');
  });

  await check(client, 'create_backup + delete_backup: zip-архив создаётся и удаляется', async () => {
    const created = await invoke(client, 'create_backup', { label: 'e2e' });
    const afterCreate = await invoke(client, 'list_backups');
    if (!afterCreate.some((backup) => backup.name === created.name)) {
      throw new Error(`бэкап ${created.name} не появился в списке`);
    }
    await invoke(client, 'delete_backup', { name: created.name });
    const afterDelete = await invoke(client, 'list_backups');
    if (afterDelete.some((backup) => backup.name === created.name)) {
      throw new Error(`бэкап ${created.name} не удалился`);
    }
    return `${created.name}, ${formatBytes(created.sizeBytes)}, миры: ${created.worlds.join(', ') || '—'}`;
  });

  let originalConfig = null;

  if (WITH_SERVER) {
    await check(client, 'save_config: тестовая конфигурация для e2e', async () => {
      originalConfig = await invoke(client, 'get_config');
      const testConfig = structuredClone(originalConfig);
      testConfig.server.name = 'Valheim E2E';
      testConfig.server.world = 'E2EWorld';
      testConfig.server.password = 'e2e-test-pass';
      testConfig.server.port = 2456;
      testConfig.server.isPublic = false;
      testConfig.server.crossplay = false;
      testConfig.server.saveIntervalSec = 60;
      const saved = await invoke(client, 'save_config', { config: testConfig });
      return `world=${saved.server.world}, port=${saved.server.port}, saveInterval=${saved.server.saveIntervalSec}`;
    });

    await check(client, 'start_server: сервер запускается (фаза running)', async () => {
      const initial = await invoke(client, 'get_server_state');
      if (['starting', 'running', 'stopping'].includes(statePhase(initial))) {
        throw new Error(`сервер уже в фазе ${statePhase(initial)} — e2e требует остановленного сервера`);
      }
      const startedAt = Date.now();
      await invoke(client, 'start_server');
      const running = await waitForPhase(client, ['running'], 240_000);
      return `phase=${running.phase}, pid=${running.pid}, version=${running.version ?? '—'}, готов за ${Math.round((Date.now() - startedAt) / 1000)} с`;
    });

    await check(client, 'логи сервера содержат маркеры загрузки мира и готовности', async () => {
      const logs = await invoke(client, 'get_logs', { limit: 400, source: 'server', sinceSeq: null });
      const text = logs.map((line) => line.line).join('\n');
      const missing = [];
      if (!text.includes('Valheim version:')) {
        missing.push('Valheim version:');
      }
      // Версия 1.0.21 для существующего мира пишет `ZNet.LoadWorld: ...`,
      // для нового — `Load world: ...`; принимаем оба варианта.
      if (!text.includes('LoadWorld:') && !text.includes('Load world:')) {
        missing.push('ZNet.LoadWorld:/Load world:');
      }
      // В обычном режиме готовность даёт `Opened Steam server`,
      // в crossplay — `Opened PlayFab server` (или `Loading: Done...`).
      if (
        !text.includes('Opened Steam server') &&
        !text.includes('Opened PlayFab server') &&
        !text.includes('Loading: Done. Total seconds sinze ZNet start:')
      ) {
        missing.push('маркер готовности (Opened Steam/PlayFab server)');
      }
      if (missing.length > 0) {
        throw new Error(`в логах нет маркеров: ${missing.join(', ')}`);
      }
      return `${logs.length} строк лога с маркерами версии/загрузки мира/готовности`;
    });

    await check(client, 'stop_server: корректная остановка с сохранением мира', async () => {
      const startedAt = Date.now();
      await invoke(client, 'stop_server', { force: false });
      const stopped = await waitForPhase(client, ['stopped', 'error'], 90_000);
      const logs = await invoke(client, 'get_logs', { limit: 500, source: 'server', sinceSeq: null });
      const text = logs.map((line) => line.line).join('\n');
      if (!text.includes('World save (')) {
        throw new Error('в логе нет сохранения мира после остановки');
      }
      if (statePhase(stopped) !== 'stopped') {
        throw new Error(`сервер в неожиданной фазе ${statePhase(stopped)}: ${stopped.lastError ?? ''}`);
      }
      return `phase=stopped за ${Math.round((Date.now() - startedAt) / 1000)} с, мир сохранён`;
    });
  }

  if (originalConfig) {
    await check(client, 'save_config: исходная конфигурация восстановлена', async () => {
      const restored = await invoke(client, 'save_config', { config: originalConfig });
      return `world=${restored.server.world}, port=${restored.server.port}, name=${restored.server.name}`;
    });
  }

  const reportLines = [
    '# E2E-отчёт: Valheim Server Manager',
    '',
    `- Дата: ${new Date().toISOString()}`,
    `- Приложение: ${appInfoSummary}`,
    `- Конфигурация: ${configSummary}`,
    `- Пути: ${pathsSummary}`,
    `- Режим с запуском сервера: ${WITH_SERVER ? 'да' : 'нет'}`,
    '',
    '| Проверка | Статус | Детали |',
    '| --- | --- | --- |',
    ...results.map((result) => `| ${result.name} | ${result.status} | ${result.details.replaceAll('|', '\\|')} |`),
    '',
    failures === 0 ? '**Итог: все проверки пройдены.**' : `**Итог: провалено проверок — ${failures}.**`,
    '',
  ];

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, reportLines.join('\n'), 'utf8');
  console.log(`Отчёт: ${REPORT_PATH}`);

  client.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('E2E провален:', error);
  process.exit(1);
});
