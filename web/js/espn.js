// ESPN adapter. Public leagues need nothing; private leagues need the
// espn_s2 and SWID cookies, which the Android app sets on the WebView.
import { fetchJson, ESPN_PRO_TEAMS, shortName } from './util.js';
import { gameLabel, playerState } from './nfl.js';
import { buildMatchup } from './model.js';

const BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

// Lineup slot ids, in the order a lineup is usually read top to bottom.
const SLOT_ORDER = [0, 1, 7, 2, 3, 4, 5, 6, 23, 16, 17];
const SLOT_LABEL = {
  0: 'QB', 1: 'TQB', 2: 'RB', 3: 'R/W', 4: 'WR', 5: 'W/T', 6: 'TE', 7: 'SF', 16: 'DEF', 17: 'K', 23: 'FLX',
};
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const BENCH = new Set([20, 21, 24]);

const injuryLabel = (s) =>
  !s || s === 'ACTIVE' || s === 'NORMAL' ? null : s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function espnUrl(season, leagueId, week) {
  const views = ['mMatchupScore', 'mScoreboard', 'mTeam', 'mSettings'].map((v) => `view=${v}`).join('&');
  return `${BASE}/${season}/segments/0/leagues/${leagueId}?${views}&scoringPeriodId=${week}`;
}

export function parseEspn(data, teamId, nfl) {
  const week = data.scoringPeriodId;
  const period = data.status?.currentMatchupPeriod ?? week;
  const m = (data.schedule || []).find(
    (x) => x.matchupPeriodId === period && (x.home?.teamId === teamId || x.away?.teamId === teamId)
  );
  if (!m) return null;
  const meSide = m.home.teamId === teamId ? m.home : m.away;
  const oppSide = m.home.teamId === teamId ? m.away : m.home;

  const toPlayer = (entry) => {
    const pe = entry.playerPoolEntry;
    const p = pe.player;
    const team = ESPN_PRO_TEAMS[p.proTeamId] || null;
    const projStat = (p.stats || []).find((s) => s.statSourceId === 1 && s.scoringPeriodId === week);
    const actual = (p.stats || []).find((s) => s.statSourceId === 0 && s.scoringPeriodId === week);
    const state = playerState(nfl, team);
    return {
      key: `espn:${p.id}`,
      name: p.fullName,
      short: p.defaultPositionId === 16 ? `${team} D/ST` : shortName(p.fullName),
      pos: POS[p.defaultPositionId] || '',
      team,
      pts: Number(actual?.appliedTotal ?? pe.appliedStatTotal ?? 0),
      proj: Number(projStat?.appliedTotal || 0),
      state,
      remaining: nfl.games[team]?.remaining ?? (state === 'bye' ? 0 : 1),
      label: gameLabel(nfl, team),
      injury: injuryLabel(entry.injuryStatus || p.injuryStatus),
    };
  };

  const starters = (side) => {
    const bySlot = new Map();
    for (const e of side.rosterForCurrentScoringPeriod?.entries || []) {
      if (BENCH.has(e.lineupSlotId)) continue;
      if (!bySlot.has(e.lineupSlotId)) bySlot.set(e.lineupSlotId, []);
      bySlot.get(e.lineupSlotId).push(toPlayer(e));
    }
    return bySlot;
  };
  const mine = starters(meSide);
  const theirs = starters(oppSide);
  const counts = data.settings?.rosterSettings?.lineupSlotCounts || {};

  const slots = [];
  for (const id of SLOT_ORDER) {
    const n = Math.max(Number(counts[id] || 0), mine.get(id)?.length || 0, theirs.get(id)?.length || 0);
    for (let i = 0; i < n; i++) {
      slots.push({ pos: SLOT_LABEL[id], me: mine.get(id)?.[i] || null, opp: theirs.get(id)?.[i] || null });
    }
  }

  const teamInfo = (tid) => {
    const t = (data.teams || []).find((x) => x.id === tid) || {};
    const r = t.record?.overall || {};
    return {
      name: t.name || `${t.location || ''} ${t.nickname || ''}`.trim() || `Team ${tid}`,
      record: `${r.wins || 0}-${r.losses || 0}${r.ties ? '-' + r.ties : ''}`,
    };
  };

  return buildMatchup({
    key: `espn:${data.id}`,
    platform: 'ESPN',
    league: data.settings?.name || 'ESPN league',
    me: teamInfo(meSide.teamId),
    opp: teamInfo(oppSide.teamId),
    slots,
  });
}

export async function loadEspn(entries, nfl) {
  const out = [];
  for (const e of entries || []) {
    if (!e?.leagueId || !e?.teamId) continue;
    const season = e.season || nfl.season;
    const data = await fetchJson(espnUrl(season, e.leagueId, nfl.week), {
      credentials: e.espn_s2 ? 'include' : 'omit',
    });
    const m = parseEspn(data, Number(e.teamId), nfl);
    if (m) out.push(m);
  }
  return out;
}
