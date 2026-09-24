/**
 * CI-скриншот-тесты ключевых экранов (Этап 14, DoD).
 * Запуск: сервер API+SPA уже поднят (npm run dev:api), затем:
 *   node scripts/screenshots.mjs
 * Требует `npx playwright install chromium` (в CI; в песочнице CDN закрыт —
 * запуск только в GitHub Actions, см. .github/workflows/screenshots.yml).
 *
 * Проверки:
 *  - каждый ключевой экран: .app-layout виден, спиннеры завершились,
 *    консоль без ошибок;
 *  - переключение темы без перезагрузки (data-theme меняется, URL тот же).
 * Артефакт: screenshots/*.png.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:8787';
const OUT = resolve(process.cwd(), 'screenshots');
mkdirSync(OUT, { recursive: true });

const SCREENS = [
  ['overview', '#/overview'],
  ['territories', '#/territories'],
  ['yabloko-position', '#/yabloko-position'],
  ['elections', '#/elections'],
  ['postmortem', '#/postmortem'],
  ['osint', '#/osint'],
  ['media', '#/media'],
  ['decision-lab', '#/decision-lab'],
  ['research', '#/research'],
  ['analyst', '#/analyst'],
  ['sources', '#/sources'],
  ['alerts', '#/alerts'],
  ['settings', '#/settings']
];

const consoleErrors = [];

// Известные шумы headless/GPU-окружения, не отражающие дефекты приложения.
const NOISE = /webgl|context lost|gpu|swiftshader|dbus|GPU stall|favicon/i;

function noteConsoleError(source, text) {
  if (NOISE.test(text)) return;
  const line = `${source}: ${text}`;
  consoleErrors.push(line);
  console.error(`CONSOLE-ERROR ${line}`);
}

async function capture(page, name, hash) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-layout', { timeout: 15000 });
  // Дождаться конца загрузочных скелетонов (или 3с максимум).
  await page
    .waitForSelector('.skeleton', { state: 'detached', timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(450);
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false });
  const title = await page.title();
  if (!title || title.length === 0) throw new Error(`${name}: пустой <title>`);
  console.log(`ok: ${name}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') noteConsoleError(page.url(), msg.text());
  });
  page.on('pageerror', (err) => noteConsoleError(page.url(), `PAGEERROR ${String(err)}`));

  // Тёмная тема (по умолчанию) — все ключевые экраны.
  for (const [name, hash] of SCREENS) {
    await capture(page, `dark-${name}`, hash);
  }

  // Светлая тема: через localStorage до загрузки (без кликов).
  const light = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  light.on('console', (msg) => {
    if (msg.type() === 'error') noteConsoleError(light.url(), msg.text());
  });
  light.on('pageerror', (err) => noteConsoleError(light.url(), `PAGEERROR ${String(err)}`));
  await light.addInitScript(() => localStorage.setItem('yabloko.theme', 'light'));
  await light.goto(`${BASE}/#/overview`, { waitUntil: 'domcontentloaded' });
  await light.waitForSelector(':root[data-theme="light"]', { timeout: 10000 });
  await light.screenshot({ path: resolve(OUT, 'light-overview.png') });
  console.log('ok: light-overview');

  // Переключение темы БЕЗ перезагрузки: тот же JS-контекст, URL не менялся.
  const urlBefore = light.url();
  const navPromises = [];
  light.once('framenavigated', (frame) => {
    if (frame === light.mainFrame()) navPromises.push(light.url());
  });
  await light.getByTitle('Переключить тему (без перезагрузки)').click();
  await light.waitForSelector(':root[data-theme="dark"]', { timeout: 5000 });
  await light.waitForTimeout(200);
  if (light.url() !== urlBefore) throw new Error('Тема переключилась с перезагрузкой страницы');
  await light.screenshot({ path: resolve(OUT, 'light-overview-toggled.png') });
  console.log('ok: theme switch without reload');

  // Command palette: Ctrl+K открывает, ввод фильтрует, Esc закрывает.
  await page.keyboard.press('ControlOrMeta+k');
  await page.waitForSelector('.cmdk', { timeout: 5000 });
  await page.keyboard.type('сравн');
  await page.waitForTimeout(250);
  const items = await page.locator('.cmdk-item').count();
  if (items === 0) throw new Error('Палитра: запрос «сравн» не дал команд');
  await page.screenshot({ path: resolve(OUT, 'dark-command-palette.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.cmdk', { state: 'detached', timeout: 5000 });
  console.log('ok: command palette Ctrl+K');
} finally {
  await browser.close();
}

if (consoleErrors.length > 0) {
  console.error(`Ошибки консоли браузера (${consoleErrors.length}):`);
  for (const e of consoleErrors) console.error(' -', e);
  process.exit(1);
}
console.log(`Скриншоты: ${SCREENS.length + 3} файлов в screenshots/`);
