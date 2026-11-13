// The live NFL slate from ESPN's public scoreboard. Every fantasy player is
// joined to one of these games by team, which tells us whether he is yet to
// play, playing now (and how much of his game is left), or done.
import { fetchJson, normTeam } from './util.js';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

export function remainingFraction(state, period, clock) {
  if (state === 'pre') return 1;
  if (state === 'post') return 0;
  if (state === 'half') return 0.5;
  if (!period) return 1;
  if (period > 4) return 0.04; // overtime: almost nothing left
  const [m, s] = String(clock || '15:00').split(':').map(Number);
  const leftInQuarter = Math.min(15, (m || 0) + (s || 0) / 60);
  return Math.max(0, ((4 - period) * 15 + leftInQuarter) / 60);
}

export function parseScoreboard(sb) {
  const games = {};
  const list = [];
  for (const ev of sb.events || []) {
    const c = ev.competitions?.[0];
    if (!c) continue;
    const st = c.status || ev.status || {};
    const type = st.type || {};
    let state = type.state || 'pre'; // pre | in | post
    if (type.name === 'STATUS_HALFTIME') state = 'half';
    const home = c.competitors.find((x) => x.homeAway === 'home');
    const away = c.competitors.find((x) => x.homeAway === 'away');
    const g = {
      id: ev.id,
      state,
      period: st.period || 0,
      clock: st.displayClock || '',
      detail: type.shortDetail || '',
      start: ev.date,
      home: normTeam(home.team.abbreviation),
      away: normTeam(away.team.abbreviation),
      homeScore: Number(home.score || 0),
      awayScore: Number(away.score || 0),
      possession: normTeam(
        c.competitors.find((x) => x.id === c.situation?.possession)?.team?.abbreviation
      ),
      redZone: !!c.situation?.isRedZone,
    };
    g.remaining = remainingFraction(state, g.period, g.clock);
    games[g.home] = g;
    games[g.away] = g;
    list.push(g);
  }
  const bye = new Set((sb.week?.teamsOnBye || []).map((t) => normTeam(t.abbreviation)));
  return {
    season: sb.season?.year,
    week: sb.week?.number,
    seasonType: sb.season?.type,
    games,
    list,
    bye,
    anyLive: list.some((g) => g.state === 'in' || g.state === 'half'),
    nextKickoff: list
      .filter((g) => g.state === 'pre')
      .map((g) => g.start)
      .sort()[0],
  };
}

export async function loadNfl() {
  return parseScoreboard(await fetchJson(SCOREBOARD));
}

// Short status line for a player's game, from his team's point of view.
export function gameLabel(nfl, team) {
  if (!team) return '';
  const g = nfl.games[team];
  if (!g) return nfl.bye?.has(team) ? 'Bye' : '';
  const opp = g.home === team ? `v ${g.away}` : `@ ${g.home}`;
  if (g.state === 'pre') {
    const d = new Date(g.start);
    const day = d.toLocaleDateString(undefined, { weekday: 'short' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${day} ${time}`;
  }
  if (g.state === 'post') {
    const mine = g.home === team ? g.homeScore : g.awayScore;
    const theirs = g.home === team ? g.awayScore : g.homeScore;
    return `${mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'} ${mine}-${theirs} ${opp}`;
  }
  if (g.state === 'half') return `Half ${opp}`;
  const q = g.period > 4 ? 'OT' : `Q${g.period}`;
  return `${q} ${g.clock} ${opp}`;
}

// True when this player's team has the ball inside the opponent's 20.
export function inRedZone(nfl, team) {
  const g = team && nfl.games[team];
  return !!(g && g.state === 'in' && g.redZone && g.possession === team);
}

export function playerState(nfl, team) {
  const g = team && nfl.games[team];
  if (!g) return nfl.bye?.has(team) ? 'bye' : 'none';
  return g.state === 'half' ? 'in' : g.state;
}
