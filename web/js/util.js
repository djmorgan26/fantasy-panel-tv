// Small shared helpers. No dependencies, so the panel runs the same in a
// desktop browser, in Playwright, and inside the Android TV WebView.

// Data hosts the panel may read. Requests go through the host app's same
// origin proxy (the TV app natively, or tools/serve.mjs in development), so
// browser CORS rules never apply and nothing else can be fetched.
export const DATA_HOSTS = ['api.sleeper.app', 'lm-api-reads.fantasy.espn.com', 'site.api.espn.com'];

// `filter` becomes ESPN's x-fantasy-filter header, the only header the proxy forwards.
export const proxied = (url, filter) =>
  typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
    ? `proxy?u=${encodeURIComponent(url)}${filter ? `&f=${encodeURIComponent(JSON.stringify(filter))}` : ''}`
    : url;

export async function fetchJson(url, opts = {}) {
  try {
    return await fetchOnce(url, opts);
  } catch (e) {
    // One quiet retry: ESPN's edge hands out the odd 502.
    await new Promise((r) => setTimeout(r, 1500));
    return fetchOnce(url, opts);
  }
}

async function fetchOnce(url, { timeoutMs = 12000, filter } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const direct = !/^https?:$/.test(globalThis.location?.protocol || '');
    const res = await fetch(proxied(url, filter), {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: direct && filter ? { 'x-fantasy-filter': JSON.stringify(filter) } : undefined,
    });
    if (!res.ok) throw new Error(`${res.status} ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ESPN fantasy proTeamId -> team abbreviation used on the NFL scoreboard.
export const ESPN_PRO_TEAMS = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

// Sleeper and ESPN disagree on a few abbreviations. Normalise to ESPN's.
const ABBR_ALIASES = { WAS: 'WSH', JAC: 'JAX', LA: 'LAR', OAK: 'LV', SD: 'LAC' };
export const normTeam = (abbr) => (abbr ? ABBR_ALIASES[abbr] || abbr : null);

export function shortName(full) {
  if (!full) return '';
  if (/D\/ST$/.test(full)) return full;
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const suffix = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i.test(parts[parts.length - 1]) ? parts.pop() : '';
  const last = parts.slice(1).join(' ');
  return `${parts[0][0]}. ${last}${suffix ? ' ' + suffix : ''}`;
}

// Time display. The TV's own clock can be set to the wrong zone (GMT is a
// common default), so the panel uses panel.timeZone / panel.locale from your
// config, filled in from your computer when settings are sent.
let LOCALE;
let TIME_ZONE;
export function setClock(locale, timeZone) {
  LOCALE = locale || undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    TIME_ZONE = timeZone || undefined;
  } catch {
    TIME_ZONE = undefined;
  }
}
const opts = (o) => (TIME_ZONE ? { ...o, timeZone: TIME_ZONE } : o);
export const fmtTime = (d) => new Date(d).toLocaleTimeString(LOCALE, opts({ hour: 'numeric', minute: '2-digit' }));
export const fmtDay = (d) => new Date(d).toLocaleDateString(LOCALE, opts({ weekday: 'short' }));
export const fmtDayTime = (d) => `${fmtDay(d)} ${fmtTime(d)}`;

export const round1 = (n) => Math.round((n || 0) * 10) / 10;
export const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toFixed(1);

export function cacheGet(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, v } = JSON.parse(raw);
    return Date.now() - at < maxAgeMs ? v : null;
  } catch {
    return null;
  }
}

export function cacheSet(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), v }));
  } catch {
    /* storage full or blocked: run without the cache */
  }
}
