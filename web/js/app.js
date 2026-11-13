// Panel main loop: load config, refresh on a live-aware cadence, render,
// rotate the lineup view, and pop toasts for big plays.
import { loadNfl } from './nfl.js';
import { loadSleeper } from './sleeper.js';
import { loadEspn } from './espn.js';
import { swingGames, scoringEvents } from './model.js';
import { createDemo } from './demo.js';
import {
  renderHeader, renderMatchups, renderLineup, renderSwing, renderFoot, renderMessage, showToast,
} from './render.js';

const params = new URLSearchParams(location.search);
const SEC = 1000;

async function loadConfig() {
  // 1. Inside the TV app, config comes from the native bridge.
  try {
    const raw = window.FFNative?.getConfig?.();
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('native config unreadable', e);
  }
  // 2. A local dev server may serve the private config file.
  if (params.get('config') === 'local') {
    try {
      const res = await fetch('config.local.json', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {
      /* fall through */
    }
  }
  return null;
}

function liveSource(cfg) {
  return {
    async load() {
      const nfl = await loadNfl();
      const errors = [];
      const results = await Promise.allSettled([loadSleeper(cfg.sleeper, nfl), loadEspn(cfg.espn, nfl)]);
      const matchups = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') matchups.push(...r.value);
        else errors.push(`${i === 0 ? 'Sleeper' : 'ESPN'} unavailable`);
      });
      return { nfl, matchups, errors };
    },
  };
}

const state = {
  matchups: null,
  nfl: null,
  rotateIndex: 0,
  focusUntil: 0,
  rotateMs: 15 * SEC,
};

function nextDelay(nfl, demo) {
  if (demo) return 4 * SEC;
  if (nfl?.anyLive) return 20 * SEC;
  const next = nfl?.nextKickoff ? new Date(nfl.nextKickoff).getTime() - Date.now() : Infinity;
  if (next < 20 * 60 * SEC) return 60 * SEC;
  return 5 * 60 * SEC;
}

function draw() {
  const ms = state.matchups || [];
  if (!ms.length) return;
  const i = state.rotateIndex % ms.length;
  renderMatchups(ms, ms[i].key);
  renderLineup(ms[i], i, ms.length);
  renderSwing(swingGames(ms, state.nfl));
}

async function tick(source, demo) {
  let delay = 30 * SEC;
  try {
    const { nfl, matchups, errors } = await source.load();
    const events = scoringEvents(state.matchups, matchups);
    state.nfl = nfl;
    state.matchups = matchups;
    renderHeader(nfl, matchups);
    if (!matchups.length) {
      renderMessage(
        errors.length ? 'Can’t reach your leagues' : 'No matchups this week',
        errors.length ? 'Retrying shortly.' : 'Check back when the next week starts.'
      );
    } else {
      // Jump to the league where something just happened.
      if (events.length) {
        const idx = matchups.findIndex((m) => m.key === events[0].matchupKey);
        if (idx >= 0) {
          state.rotateIndex = idx;
          state.focusUntil = Date.now() + state.rotateMs * 2;
        }
      }
      draw();
      events.slice(0, 3).forEach((e, k) => setTimeout(() => showToast(e), k * 600));
    }
    renderFoot(new Date(), errors);
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
    if (!state.matchups || state.matchups.length < 2 || Date.now() < state.focusUntil) return;
    state.rotateIndex = (state.rotateIndex + 1) % state.matchups.length;
    draw();
  }, state.rotateMs);
}

async function main() {
  if (params.get('side') === 'left') document.body.classList.add('left');
  if (params.get('solid')) document.body.classList.add('solid');
  const demo = params.has('demo');
  const cfg = demo ? null : await loadConfig();
  if (cfg?.panel?.side === 'left') document.body.classList.add('left');
  if (cfg?.panel?.rotateSeconds) state.rotateMs = Math.max(5, cfg.panel.rotateSeconds) * SEC;
  if (!demo && !cfg) {
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
