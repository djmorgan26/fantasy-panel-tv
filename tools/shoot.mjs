// Playwright screenshots of the panel at real TV resolution.
//   Demo shots (safe to publish)  -> docs/screenshots/
//   Live shots of your leagues    -> .private/shots/   (only with SHOOT_LIVE=1)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

// Playwright lives in a container volume (/deps), not in this repo.
const { chromium } = createRequire(`${process.env.DEPS || '/deps'}/`)('playwright');

const BASE = process.env.BASE_URL || 'http://web:8080';
const live = process.env.SHOOT_LIVE === '1';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  timezoneId: process.env.TZ || 'America/New_York',
  locale: 'en-US',
});

async function shot(url, path, { wait = 2500, clip } = {}) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
  await page.screenshot({ path, clip });
  await page.close();
  console.log(`${errors.length ? 'WARN' : 'ok  '} ${path}${errors.length ? '  ' + errors.join(' | ') : ''}`);
  return errors;
}

const panelClip = { x: 1920 - Math.round(1920 * 0.26), y: 0, width: Math.round(1920 * 0.26), height: 1080 };
let problems = [];

if (process.env.BRAND === '1') {
  const res = 'android/app/src/main/res';
  for (const [kind, out] of [['banner', `${res}/drawable-xhdpi/banner.png`], ['icon', `${res}/drawable-nodpi/icon.png`]]) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/brand.html?kind=${kind}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.locator('#art').screenshot({ path: out, omitBackground: true });
    await page.close();
    console.log(`ok   ${out}`);
  }
} else if (!live) {
  await mkdir('docs/screenshots', { recursive: true });
  problems.push(...(await shot('/preview.html?demo=1&minute=34', 'docs/screenshots/tv-live.png')));
  problems.push(...(await shot('/preview.html?demo=1&minute=34&toast=1', 'docs/screenshots/tv-big-play.png', { wait: 1500 })));
  problems.push(...(await shot('/preview.html?demo=1&minute=-200', 'docs/screenshots/tv-pregame.png')));
  problems.push(...(await shot('/preview.html?demo=1&minute=40', 'docs/screenshots/panel-closeup.png', { clip: panelClip })));
} else {
  await mkdir('.private/shots', { recursive: true });
  problems.push(...(await shot('/preview.html?config=local', '.private/shots/tv-real.png', { wait: 9000 })));
  problems.push(...(await shot('/preview.html?config=local', '.private/shots/panel-real.png', { wait: 9000, clip: panelClip })));
}

await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} page error(s)`);
  process.exit(1);
}
