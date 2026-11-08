/**
 * Проверка UI страницы «Админ» в реальном WebView2 (desktop-приложение).
 *
 * Подключается по CDP, открывает раздел «Админ», перебирает все табы,
 * снимает скриншоты в docs/screenshots и проверяет, что:
 *  - сайдбар открывает админку, таб-бар на месте (7 разделов, aria-selected);
 *  - каждый таб догружает контент (не вечный skeleton);
 *  - счётчики в табах отображаются отдельными бейджами;
 *  - нет горизонтального переполнения и «полотна» на всю страницу;
 *  - в WebView нет JS-ошибок.
 *
 * Запуск: node tools/check-admin-ui.mjs [--port 9333]
 * Требует приложение, собранное с src-tauri/tauri.e2e.conf.json.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const CDP_PORT = Number(argValue('--port', '9333'));
const OUT_DIR = path.join(process.cwd(), 'docs', 'screenshots');
const EXPECTED_TABS = ['Обзор', 'Игроки', 'Читы', 'Предметы', 'Мир', 'Моды', 'Справка'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCdp(deadlineMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < deadlineMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (page) {
          return page;
        }
      }
    } catch {
      // ещё не поднялся
    }
    await sleep(400);
  }
  throw new Error('CDP endpoint не появился');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        this.consoleErrors.push(
          (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '),
        );
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(
          message.params?.exceptionDetails?.exception?.description ?? 'unknown exception',
        );
      }
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

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
    });
    return new Cdp(ws);
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
      timeout: 60_000,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails),
      );
    }
    return result.result?.value;
  }

  async screenshot(filePath) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(filePath, Buffer.from(result.data, 'base64'));
  }
}

const results = [];

function record(name, ok, details = '') {
  results.push({ name, ok, details });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${details ? ` — ${details}` : ''}`);
}

/** Оставляет только название раздела: убирает счётчики «(159)» и лишние пробелы. */
function tabLabel(text) {
  return text
    .replace(/\(\s*\d*\s*\)/g, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function openAdminTab(client) {
  // Ждём, пока приложение отрисует сайдбар.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const clicked = await client.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('aside button, nav button, button, a')];
      const admin = buttons.find((el) => el.textContent.trim().startsWith('Админ'));
      if (admin) { admin.click(); return true; }
      return false;
    })()`);
    if (clicked) {
      return true;
    }
    await sleep(300);
  }
  return false;
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const target = await waitForCdp();
  const client = await Cdp.connect(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await sleep(1500);

  const diagnosis = await client.evaluate(`(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const t0 = performance.now();
    await invoke('diagnose_network');
    const first = Math.round(performance.now() - t0);
    const t1 = performance.now();
    await invoke('diagnose_network');
    const second = Math.round(performance.now() - t1);
    return { first, second };
  })()`);
  record(
    'diagnose_network быстрый: <3 c, кэш <0.5 c',
    diagnosis.first < 3000 && diagnosis.second < 500,
    `первый ${diagnosis.first} мс, повтор ${diagnosis.second} мс`,
  );

  const opened = await openAdminTab(client);
  record('открытие раздела «Админ» через сайдбар', opened, opened ? '' : 'кнопка не найдена');
  if (!opened) {
    throw new Error('Не удалось открыть «Админ»');
  }

  // Ждём таб-бар (lazy-чанк админки).
  let tabs = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    tabs = await client.evaluate(
      `[...document.querySelectorAll('[role="tab"]')].map((tab) => ({
         label: tab.textContent.replace(/\\s+/g, ' ').trim(),
         selected: tab.getAttribute('aria-selected'),
         controls: tab.getAttribute('aria-controls'),
       }))`,
    );
    if (
      tabs.length >= EXPECTED_TABS.length &&
      tabs.some((tab) => /\(\d+\)/.test(tab.label))
    ) {
      break;
    }
    await sleep(300);
  }
  const labels = tabs.map((tab) => tabLabel(tab.label));
  record(
    'таб-бар: 7 разделов',
    tabs.length === 7,
    `${tabs.length}: ${labels.join(' | ')}`,
  );
  record(
    'названия разделов соответствуют макету',
    JSON.stringify(labels) === JSON.stringify(EXPECTED_TABS),
    labels.join(' | '),
  );
  record(
    'счётчики отображаются в бейджах (Читы (159), Предметы (449))',
    tabs.some((tab) => /^Читы\s*\(?\d+\)?$/.test(tab.label)) &&
      tabs.some((tab) => /^Предметы\s*\(?\d+\)?$/.test(tab.label)),
    tabs.map((tab) => tab.label).join(' | '),
  );

  const layout = await client.evaluate(`(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      innerWidth: window.innerWidth,
      docScrollWidth: doc.scrollWidth,
    };
  })()`);
  record(
    'нет горизонтального переполнения окна',
    layout.docScrollWidth <= layout.innerWidth + 2,
    `scrollWidth=${layout.docScrollWidth}, innerWidth=${layout.innerWidth}`,
  );
  record(
    'страница не «полотно»: общий скролл ограничен',
    layout.bodyScrollHeight <= layout.bodyClientHeight + 40,
    `body scrollHeight=${layout.bodyScrollHeight}, clientHeight=${layout.bodyClientHeight}`,
  );

  const screens = [];
  for (let index = 0; index < tabs.length; index += 1) {
    const info = await client.evaluate(`(() => {
      const all = [...document.querySelectorAll('[role="tab"]')];
      const tab = all[${index}];
      if (!tab) return { ok: false };
      tab.click();
      return { ok: true, label: tab.textContent.replace(/\\s+/g, ' ').trim() };
    })()`);
    await sleep(500);

    // Ждём догрузку данных вкладки (skeleton → контент), до 12 секунд.
    let state = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      state = await client.evaluate(`(() => {
        const all = [...document.querySelectorAll('[role="tab"]')];
        const active = all.find((tab) => tab.getAttribute('aria-selected') === 'true');
        const panelId = active?.getAttribute('aria-controls');
        const panel = panelId ? document.getElementById(panelId) : null;
        const text = (panel?.innerText ?? document.body.innerText ?? '').trim();
        return {
          activeLabel: active ? active.textContent.replace(/\\s+/g, ' ').trim() : null,
          textLength: text.length,
          text: text.slice(0, 250),
          skeletons: document.querySelectorAll('.animate-pulse').length,
          scrollables: panel
            ? [...panel.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 20).length
            : 0,
        };
      })()`);
      if (state && state.textLength > 40) {
        break;
      }
      await sleep(300);
    }

    const label = tabLabel(info.label);
    const safeName =
      label.toLowerCase().replaceAll(/\s+/g, '-').replaceAll(/[^\p{L}\p{N}-]/gu, '') ||
      `tab-${index + 1}`;
    const file = path.join(OUT_DIR, `admin-tab-${index + 1}-${safeName}.png`);
    await client.screenshot(file);
    screens.push({ label, file, textLength: state?.textLength ?? 0 });

    record(
      `таб «${label}» догружается (не вечный skeleton)`,
      Boolean(state && state.textLength > 40),
      `${state?.textLength ?? 0} символов, скелетонов: ${state?.skeletons ?? '?'}`,
    );
  }

  // Дополнительные скриншоты под-табов «Предметы».
  const itemsTabIndex = EXPECTED_TABS.indexOf('Предметы');
  await client.evaluate(`(() => {
    const all = [...document.querySelectorAll('[role="tab"]')];
    all[${itemsTabIndex}]?.click();
  })()`);
  await sleep(800);
  const subTab = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((el) => el.textContent.trim().startsWith('Существа'));
    if (target) { target.click(); return target.textContent.trim(); }
    return null;
  })()`);
  await sleep(800);
  await client.screenshot(path.join(OUT_DIR, 'admin-items-creatures.png'));
  record('под-таб «Существа» в «Предметах»', Boolean(subTab), subTab ?? 'не найдено');

  await writeFile(
    path.join(OUT_DIR, 'admin-ui-report.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        target: target.url,
        results,
        screens,
      },
      null,
      2,
    ),
    'utf8',
  );

  record(
    'нет JS-ошибок в консоли WebView',
    client.consoleErrors.length === 0,
    client.consoleErrors.slice(0, 3).join(' | '),
  );

  client.ws.close();
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\nСкриншоты: ${OUT_DIR}`);
  console.log(failed === 0 ? 'ИТОГ: все проверки пройдены.' : `ИТОГ: провалено ${failed}.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Проверка UI провалена:', error);
  process.exit(1);
});
