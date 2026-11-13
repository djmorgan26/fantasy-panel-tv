// Panel main loop: load config, refresh on a live-aware cadence, render,
// rotate the lineup view, and pop toasts for big plays.
import { swingGames, scoringEvents } from './model.js';
import { loadConfig, liveSource, packSnapshot } from './source.js';
import { pinned } from './watch.js';
import { createDemo } from './demo.js';
import { setClock } from './util.js';
import {
  renderHeader, renderMatchups, renderLineup, renderSwing, renderFoot, renderMessage, showToast, renderMini,
} from './render.js';

// The TV app sizes the mini card's window to fit its content.
function reportHeight() {
  requestAnimationFrame(() => {
    const h = Math.ceil(document.getElementById('panel').getBoundingClientRect().height);
    try {
      window.FFNative?.setContentHeight?.(h);
    } catch {
      /* not in the TV app */
    }
  });
}

const params = new URLSearchParams(location.search);
const SEC = 1000;

const state = {
  matchups: null,
  nfl: null,
  rotateIndex: 0,
  focusUntil: 0,
  rotateMs: 15 * SEC,
  // 'all' rotates through every league; a matchup key pins that one.
  focus: 'all',
};

function readFocus() {
  try {
    const f = window.FFNative?.getFocus?.();
    if (f) return f;
  } catch {
    /* not in the TV app */
  }
  return params.get('focus') || 'all';
}

// What the panel shows right now: every league, or just the pinned one.
const shownMatchups = () => pinned(state.matchups || [], state.focus);

// The menu calls this (through the TV app) when you pick a team to show.
window.ffFocus = () => {
  state.focus = readFocus();
  state.rotateIndex = 0;
  state.focusUntil = 0;
  console.info(`focus: ${state.focus}`);
  draw();
};

function nextDelay(nfl, demo) {
  if (demo) return 4 * SEC;
  if (nfl?.anyLive) return 20 * SEC;
  const next = nfl?.nextKickoff ? new Date(nfl.nextKickoff).getTime() - Date.now() : Infinity;
  if (next < 20 * 60 * SEC) return 60 * SEC;
  return 5 * 60 * SEC;
}

const MINI = params.get('mode') === 'mini';

function draw() {
  const ms = shownMatchups();
  if (!ms.length) return;
  if (MINI) {
    renderMini(ms);
    document.body.classList.toggle('pinned', state.focus !== 'all' && ms.length === 1 && state.matchups.length > 1);
    reportHeight();
    return;
  }
  const i = state.rotateIndex % ms.length;
  renderMatchups(ms, ms[i].key);
  renderLineup(ms[i], i, ms.length);
  renderSwing(swingGames(ms, state.nfl));
  document.body.classList.toggle('pinned', state.focus !== 'all' && ms.length === 1 && state.matchups.length > 1);
}

async function tick(source, demo) {
  let delay = 30 * SEC;
  try {
    const { nfl, matchups, errors } = await source.load();
    const visible = new Set(pinned(matchups, state.focus).map((m) => m.key));
    const events = scoringEvents(state.matchups, matchups).filter((e) => visible.has(e.matchupKey));
    state.nfl = nfl;
    state.matchups = matchups;
    renderHeader(nfl, matchups);
    if (!matchups.length) {
      renderMessage(
        errors.length ? 'Can’t reach your leagues' : 'No matchups this week',
        errors.length ? 'Retrying shortly.' : 'Check back when the next week starts.'
      );
      if (MINI) reportHeight();
    } else {
      // Jump to the league where something just happened.
      if (events.length) {
        const idx = shownMatchups().findIndex((m) => m.key === events[0].matchupKey);
        if (idx >= 0) {
          state.rotateIndex = idx;
          state.focusUntil = Date.now() + state.rotateMs * 2;
        }
      }
      draw();
      if (!MINI) events.slice(0, 3).forEach((e, k) => setTimeout(() => showToast(e), k * 600));
    }
    renderFoot(new Date(), errors);
    if (!demo || params.has('publish')) {
      try {
        window.FFNative?.publish?.(packSnapshot(nfl, matchups));
      } catch {
        /* not in the TV app */
      }
    }
    delay = nextDelay(nfl, demo);
    console.info(
      `refresh ok: ${matchups.length} matchup(s) [${matchups.map((m) => `${m.league} ${m.me.score.toFixed(1)}-${m.opp.score.toFixed(1)} ${Math.round(m.winProb * 100)}%`).join('; ')}] live=${!!nfl.anyLive} next=${Math.round(delay / 1000)}s errors=${errors.join(',') || 'none'}`
    );
  } catch (e) {
    console.error(e);
    renderFoot(null, ['Offline · retrying']);
    if (!state.matchups) renderMessage('Connecting', 'Waiting for the network.');
  }
  setTimeout(() => tick(source, demo), delay);
}

function rotate() {
  setInterval(() => {
    const n = shownMatchups().length;
    if (n < 2 || Date.now() < state.focusUntil) return;
    state.rotateIndex = (state.rotateIndex + 1) % n;
    draw();
  }, state.rotateMs);
}

async function main() {
  if (MINI) document.body.classList.add('card');
  if (params.get('side') === 'left') document.body.classList.add('left');
  if (params.get('solid')) document.body.classList.add('solid');
  const demo = params.has('demo');
  const cfg = demo ? null : await loadConfig(params);
  state.focus = readFocus();
  if (cfg?.panel?.side === 'left') document.body.classList.add('left');
  setClock(params.get('locale') || cfg?.panel?.locale, params.get('tz') || cfg?.panel?.timeZone);
  if (cfg?.panel?.rotateSeconds) state.rotateMs = Math.max(5, cfg.panel.rotateSeconds) * SEC;
  if (!demo && !cfg) {
    renderHeader(null, null);
    document.getElementById('status').innerHTML = '<span class="dot"></span><span>Setup</span>';
    renderMessage(
      'Almost there',
      'Send your league settings to the TV with <code>make tv-config</code>, then open Fantasy Football again.'
    );
    return;
  }
  const source = demo
    ? createDemo({ startMinute: Number(params.get('minute') || 34), speed: Number(params.get('speed') || 4) })
    : liveSource(cfg);
  if (params.get('rotate')) state.rotateMs = Number(params.get('rotate')) * SEC;
  await tick(source, demo);
  rotate();
  if (params.has('toast') && state.matchups?.[0]) {
    const m = state.matchups[0];
    const p = m.slots.find((s) => s.me?.state === 'in')?.me || m.slots[0].me;
    showToast({ side: 'me', player: p, delta: 6.8, league: m.league });
  }
}

main();
