// Behavioural checks of the panel in a real browser, against the demo feed.
// Runs in the Playwright container: make e2e
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { chromium } = createRequire(`${process.env.DEPS || '/deps'}/`)('playwright');
const BASE = process.env.BASE_URL || 'http://web:8080';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 480, height: 1038 }, locale: 'en-US' });
let failed = 0;

async function check(name, fn) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await fn(page);
    assert.deepEqual(errors, [], 'no page errors');
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
}

const num = (s) => Number(String(s).replace(/[^\d.]/g, ''));

await check('renders a full lineup for the focused league', async (p) => {
  await p.goto(`${BASE}/index.html?demo=1`);
  await p.waitForSelector('.slot');
  assert.equal(await p.textContent('#week'), 'Week 10');
  assert.equal(await p.locator('.lineup-page:last-child .slot').count(), 9);
  assert.match(await p.textContent('#status'), /Live/);
  assert.equal(await p.locator('.mini').count(), 1, 'other league collapsed to one row');
});

await check('scores tick while games are live', async (p) => {
  await p.goto(`${BASE}/index.html?demo=1&speed=0.25`);
  await p.waitForSelector('.mu-score');
  const total = async () => (await p.locator('.mu-score, .mini-score span[data-num]').allTextContents()).reduce((a, t) => a + num(t), 0);
  const before = await total();
  await p.waitForFunction((b) => {
    const t = [...document.querySelectorAll('.mu-score, .mini-score span[data-num]')].reduce((a, e) => a + Number(e.dataset.val), 0);
    return t > b + 0.5;
  }, before, { timeout: 30000 });
});

await check('rotates to the next league', async (p) => {
  await p.goto(`${BASE}/index.html?demo=1&rotate=2`);
  await p.waitForSelector('.mu-league');
  const first = await p.textContent('.mu-league');
  await p.waitForFunction((f) => document.querySelector('.mu-league')?.textContent !== f, first, { timeout: 8000 });
});

await check('pops a big-play card when someone scores', async (p) => {
  await p.goto(`${BASE}/index.html?demo=1&speed=0.1`);
  await p.waitForSelector('.toast', { timeout: 45000 });
  assert.match(await p.textContent('.toast-delta'), /^\+\d/);
});

await check('pregame shows projections, not zeros', async (p) => {
  await p.goto(`${BASE}/index.html?demo=1&minute=-200`);
  await p.waitForSelector('.mu-score.proj');
  assert.match(await p.textContent('.mu-meta'), /Projected/);
  assert.ok(num(await p.textContent('.mu-score')) > 50);
});

await check('score card mode shows only one row per league', async (p) => {
  await p.goto(`${BASE}/index.html?demo=1&mode=mini`);
  await p.waitForSelector('.mini');
  assert.equal(await p.locator('.mini').count(), 2);
  assert.equal(await p.locator('.slot').count(), 0);
  assert.ok(await p.evaluate(() => document.body.classList.contains('card')));
});

await check('menu opens on your first live game and moves with the remote', async (p) => {
  await p.goto(`${BASE}/menu.html?demo=1&minute=34`);
  await p.waitForFunction(() => document.querySelectorAll('.item').length > 5);
  const first = p.locator('.item.focus');
  assert.match(await first.textContent(), /KC .*BUF/, 'live game with your players first');
  assert.match(await first.textContent(), /YouTube TV/);
  const firstId = await first.getAttribute('data-id');
  await p.keyboard.press('ArrowDown');
  assert.notEqual(await p.locator('.item.focus').getAttribute('data-id'), firstId);
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('ArrowUp');
  assert.match(await p.locator('.item.focus').textContent(), /KC .*BUF/, 'stops at the top');
  await p.keyboard.press('ArrowRight');
  assert.match(await p.locator('.item.focus').textContent(), /All leagues/, 'Right jumps to the next section');
  await p.keyboard.press('ArrowLeft');
  assert.match(await p.locator('.item.focus').textContent(), /KC .*BUF/, 'Left jumps back');
});

await check('selecting a game asks the TV to open it in the right app', async (p) => {
  await p.goto(`${BASE}/menu.html?demo=1&minute=34`);
  await p.waitForFunction(() => document.querySelectorAll('.item').length > 5);
  await p.keyboard.press('Enter');
  let calls = await p.evaluate(() => window.__menuCalls);
  assert.deepEqual(calls[0], ['watch', 'youtubetv', 'Kansas City Chiefs at Buffalo Bills']);
  // The Thursday-style streaming game goes to Prime Video instead.
  const prime = p.locator('.item', { hasText: 'Prime Video' }).first();
  await prime.click();
  calls = await p.evaluate(() => window.__menuCalls);
  assert.deepEqual(calls.at(-1), ['watch', 'prime', 'Vikings vs. Rams']);
});

await check('a streaming app that is not installed says so instead of failing', async (p) => {
  await p.goto(`${BASE}/menu.html?demo=1&minute=34&missing=youtubetv`);
  await p.waitForFunction(() => document.querySelectorAll('.item').length > 5);
  await p.keyboard.press('Enter');
  assert.deepEqual(await p.evaluate(() => window.__menuCalls), []);
  assert.match(await p.textContent('#note'), /isn.t installed/);
});

await check('pinning a league from the menu, and back to all', async (p) => {
  await p.goto(`${BASE}/menu.html?demo=1&minute=34`);
  await p.waitForFunction(() => document.querySelectorAll('.item').length > 5);
  await p.locator('.item', { hasText: 'Office League' }).click();
  assert.deepEqual((await p.evaluate(() => window.__menuCalls)).at(-1), ['setFocus', 'demo:espn']);
  assert.ok(await p.locator('.item.on', { hasText: 'Office League' }).count());
  assert.equal(await p.locator('.item.on', { hasText: 'All leagues' }).count(), 0);
  await p.locator('.item', { hasText: 'All leagues' }).click();
  assert.deepEqual((await p.evaluate(() => window.__menuCalls)).at(-1), ['setFocus', 'all']);
});

await check('hide panel closes the panel and the menu', async (p) => {
  await p.goto(`${BASE}/menu.html?demo=1&minute=34`);
  await p.waitForFunction(() => document.querySelectorAll('.item').length > 5);
  await p.locator('.item', { hasText: 'Hide panel' }).click();
  assert.deepEqual((await p.evaluate(() => window.__menuCalls)).slice(-2), [['setMode', 'hide'], ['close']]);
});

await check('a pinned panel shows only that league and does not rotate', async (p) => {
  await p.goto(`${BASE}/index.html?demo=1&focus=demo:espn&rotate=1`);
  await p.waitForSelector('.mu-league');
  assert.equal(await p.textContent('.mu-league'), 'Office League');
  assert.equal(await p.locator('.mini').count(), 0, 'no other league rows');
  assert.ok(await p.evaluate(() => document.body.classList.contains('pinned')));
  await p.waitForTimeout(2500);
  assert.equal(await p.textContent('.mu-league'), 'Office League');
});

await check('without settings it explains the next step', async (p) => {
  await p.goto(`${BASE}/index.html`);
  await p.waitForSelector('.message');
  assert.match(await p.textContent('.message'), /tv-config/);
});

await check('the data proxy only reaches Sleeper and ESPN', async (p) => {
  const bad = await p.request.get(`${BASE}/proxy?u=${encodeURIComponent('https://example.com/')}`);
  assert.equal(bad.status(), 403);
  const http = await p.request.get(`${BASE}/proxy?u=${encodeURIComponent('http://api.sleeper.app/v1/state/nfl')}`);
  assert.equal(http.status(), 403);
});

await check('private config is not served unless explicitly allowed', async (p) => {
  const r = await p.request.get(`${BASE}/config.local.json`);
  assert.equal(r.status(), 404);
});

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
