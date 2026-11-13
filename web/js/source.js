// Where the panel and the menu get their data: your settings (from the TV
// app, or a local file in development) and a live loader for both platforms.
import { loadNfl } from './nfl.js';
import { loadSleeper } from './sleeper.js';
import { loadEspn } from './espn.js';

export async function loadConfig(params) {
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

export function liveSource(cfg) {
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

// The panel hands its latest data to the TV app so the menu can open with
// it instantly instead of waiting on the network. Sets do not survive JSON.
export function packSnapshot(nfl, matchups) {
  return JSON.stringify({ at: Date.now(), nfl: { ...nfl, bye: [...(nfl.bye || [])] }, matchups });
}

export function unpackSnapshot(raw, maxAgeMs = 10 * 60 * 1000) {
  try {
    const s = JSON.parse(raw);
    if (!s?.nfl || !Array.isArray(s.matchups) || Date.now() - s.at > maxAgeMs) return null;
    s.nfl.bye = new Set(s.nfl.bye || []);
    return s;
  } catch {
    return null;
  }
}
