// Sleeper adapter. Uses only Sleeper's public read-only API: no login, no token.
import { fetchJson, normTeam, shortName, cacheGet, cacheSet } from './util.js';
import { gameLabel, playerState } from './nfl.js';
import { buildMatchup } from './model.js';

const API = 'https://api.sleeper.app/v1';
const PROJ = 'https://api.sleeper.app/projections/nfl';
const MIN = 60 * 1000;

const SLOT_LABEL = {
  FLEX: 'FLX', SUPER_FLEX: 'SF', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', WRRBTE_FLEX: 'FLX', DEF: 'DEF',
};
const BENCH = new Set(['BN', 'IR', 'TAXI']);

let projCache = { key: null, at: 0, data: null };

// One projections call covers every position and also carries player names,
// which saves downloading Sleeper's 5 MB player database on a TV.
async function loadProjections(season, week) {
  const key = `${season}-${week}`;
  if (projCache.key === key && Date.now() - projCache.at < 20 * MIN) return projCache.data;
  const pos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `position[]=${p}`).join('&');
  const rows = await fetchJson(`${PROJ}/${season}/${week}?season_type=regular&${pos}`, {
    timeoutMs: 20000,
  });
  const data = {};
  for (const r of rows) {
    const pl = r.player || {};
    data[r.player_id] = {
      stats: r.stats || {},
      name:
        pl.position === 'DEF'
          ? `${pl.last_name || r.player_id} D/ST`
          : `${pl.first_name || ''} ${pl.last_name || ''}`.trim(),
      pos: pl.position,
      team: normTeam(r.team || pl.team),
      injury: pl.injury_status || null,
    };
  }
  projCache = { key, at: Date.now(), data };
  return data;
}

// Fallback for starters with no projection row (usually players ruled out).
async function loadMissingNames(ids) {
  const names = cacheGet('sl_names', 24 * 60 * MIN) || {};
  const missing = ids.filter((id) => !names[id]);
  if (missing.length) {
    const all = await fetchJson(`${API}/players/nfl`, { timeoutMs: 30000 });
    for (const id of ids) {
      const p = all[id];
      if (p) names[id] = { name: p.full_name || `${p.first_name} ${p.last_name}`, pos: p.position, team: normTeam(p.team), injury: p.injury_status || null };
    }
    cacheSet('sl_names', names);
  }
  return names;
}

export function projectFromStats(stats, scoring) {
  let pts = 0;
  for (const k in stats) {
    const w = scoring[k];
    if (w) pts += stats[k] * w;
  }
  return pts;
}

async function resolveUserId(username) {
  const cached = cacheGet(`sl_user_${username}`, 7 * 24 * 60 * MIN);
  if (cached) return cached;
  const u = await fetchJson(`${API}/user/${encodeURIComponent(username)}`);
  if (!u?.user_id) throw new Error(`Sleeper user "${username}" not found`);
  cacheSet(`sl_user_${username}`, u.user_id);
  return u.user_id;
}

const leagueMeta = new Map(); // league_id -> { league, users, at }

export async function loadSleeper(cfg, nfl) {
  if (!cfg?.username) return [];
  const season = nfl.season;
  const week = nfl.week;
  const userId = await resolveUserId(cfg.username);
  let leagueIds = cfg.leagueIds?.length ? cfg.leagueIds : null;
  if (!leagueIds) {
    const leagues = await fetchJson(`${API}/user/${userId}/leagues/nfl/${season}`);
    leagueIds = leagues.filter((l) => l.status !== 'pre_draft').map((l) => l.league_id);
  }
  const proj = await loadProjections(season, week);

  const out = [];
  for (const id of leagueIds) {
    let meta = leagueMeta.get(id);
    if (!meta || Date.now() - meta.at > 30 * MIN) {
      const [league, users] = await Promise.all([
        fetchJson(`${API}/league/${id}`),
        fetchJson(`${API}/league/${id}/users`),
      ]);
      meta = { league, users, at: Date.now() };
      leagueMeta.set(id, meta);
    }
    const [rosters, matchups] = await Promise.all([
      fetchJson(`${API}/league/${id}/rosters`),
      fetchJson(`${API}/league/${id}/matchups/${week}`),
    ]);
    const mine = rosters.find((r) => r.owner_id === userId || (r.co_owners || []).includes(userId));
    if (!mine) continue;
    const myM = matchups.find((m) => m.roster_id === mine.roster_id);
    if (!myM || myM.matchup_id == null) continue;
    const oppM = matchups.find((m) => m.matchup_id === myM.matchup_id && m.roster_id !== mine.roster_id);
    const oppRoster = oppM && rosters.find((r) => r.roster_id === oppM.roster_id);

    const scoring = meta.league.scoring_settings || {};
    const starterIds = [...(myM.starters || []), ...(oppM?.starters || [])].filter((x) => x && x !== '0');
    const needNames = starterIds.filter((pid) => !proj[pid] && isNaN(Number(pid)) === false);
    const extra = needNames.length ? await loadMissingNames(needNames).catch(() => ({})) : {};

    const toPlayer = (pid, pts) => {
      if (!pid || pid === '0') return null;
      const pr = proj[pid] || extra[pid] || {};
      const team = pr.team || (isNaN(Number(pid)) ? normTeam(pid) : null);
      const name = pr.name || (isNaN(Number(pid)) ? `${pid} D/ST` : 'Unknown player');
      const state = playerState(nfl, team);
      return {
        key: `sl:${pid}`,
        name,
        short: /D\/ST$/.test(name) ? `${team || pid} D/ST` : shortName(name),
        pos: pr.pos || (isNaN(Number(pid)) ? 'DEF' : ''),
        team,
        pts: Number(pts || 0),
        proj: pr.stats ? projectFromStats(pr.stats, scoring) : 0,
        state,
        remaining: nfl.games[team]?.remaining ?? (state === 'bye' ? 0 : 1),
        label: gameLabel(nfl, team),
        injury: pr.injury && pr.injury !== 'Active' ? pr.injury : null,
      };
    };

    const positions = (meta.league.roster_positions || []).filter((p) => !BENCH.has(p));
    const slots = positions.map((pos, i) => ({
      pos: SLOT_LABEL[pos] || pos,
      me: toPlayer(myM.starters?.[i], myM.starters_points?.[i]),
      opp: oppM ? toPlayer(oppM.starters?.[i], oppM.starters_points?.[i]) : null,
    }));

    const teamInfo = (roster) => {
      const u = meta.users.find((x) => x.user_id === roster?.owner_id);
      const s = roster?.settings || {};
      return {
        name: u?.metadata?.team_name || u?.display_name || 'Opponent',
        record: `${s.wins || 0}-${s.losses || 0}${s.ties ? '-' + s.ties : ''}`,
      };
    };

    out.push(
      buildMatchup({
        key: `sleeper:${id}`,
        platform: 'Sleeper',
        league: (meta.league.name || 'Sleeper league').trim(),
        me: teamInfo(mine),
        opp: teamInfo(oppRoster),
        slots,
      })
    );
  }
  return out;
}
