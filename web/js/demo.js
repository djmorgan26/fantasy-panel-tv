// A simulated Sunday: fake fantasy teams, real NFL player names, and game
// clocks that keep running so the panel animates exactly as it would live.
// Used for screenshots, the public preview, and tests. No network access.
import { buildMatchup } from './model.js';
import { shortName } from './util.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Kickoff offsets in simulated minutes. One game final, three live, two late.
const GAMES = [
  { home: 'PHI', away: 'DAL', offset: -95 },
  { home: 'BUF', away: 'KC', offset: 0 },
  { home: 'GB', away: 'DET', offset: 6 },
  { home: 'CIN', away: 'BAL', offset: 12 },
  { home: 'SEA', away: 'SF', offset: 75 },
  { home: 'LAR', away: 'MIN', offset: 80 },
];

const LEAGUES = [
  {
    key: 'demo:sleeper',
    platform: 'Sleeper',
    league: 'Sunday Night Crew',
    me: { name: 'Waiver Wire Wizards', record: '7-2' },
    opp: { name: 'Bench Mob', record: '6-3' },
    slots: [
      ['QB', ['Josh Allen', 'BUF', 'QB', 23.4], ['Jalen Hurts', 'PHI', 'QB', 21.8]],
      ['RB', ['Jahmyr Gibbs', 'DET', 'RB', 19.6], ['Derrick Henry', 'BAL', 'RB', 17.2]],
      ['RB', ['Kyren Williams', 'LAR', 'RB', 15.1], ['Josh Jacobs', 'GB', 'RB', 15.8]],
      ['WR', ["Ja'Marr Chase", 'CIN', 'WR', 18.9], ['CeeDee Lamb', 'DAL', 'WR', 17.7]],
      ['WR', ['Amon-Ra St. Brown', 'DET', 'WR', 17.3], ['Puka Nacua', 'LAR', 'WR', 16.2]],
      ['TE', ['George Kittle', 'SF', 'TE', 12.1], ['Travis Kelce', 'KC', 'TE', 11.4]],
      ['FLX', ['Zay Flowers', 'BAL', 'WR', 12.6], ['Justin Jefferson', 'MIN', 'WR', 17.9]],
      ['K', ['Brandon Aubrey', 'DAL', 'K', 9.1], ['Harrison Butker', 'KC', 'K', 8.4]],
      ['DEF', ['Ravens D/ST', 'BAL', 'DEF', 8.0], ['49ers D/ST', 'SF', 'DEF', 7.6]],
    ],
  },
  {
    key: 'demo:espn',
    platform: 'ESPN',
    league: 'Office League',
    me: { name: 'Air Raid', record: '5-4' },
    opp: { name: 'Fourth and Long', record: '5-4' },
    slots: [
      ['QB', ['Lamar Jackson', 'BAL', 'QB', 24.1], ['Patrick Mahomes', 'KC', 'QB', 20.3]],
      ['RB', ['Saquon Barkley', 'PHI', 'RB', 18.4], ['Christian McCaffrey', 'SF', 'RB', 19.0]],
      ['RB', ['Isiah Pacheco', 'KC', 'RB', 11.9], ['James Cook', 'BUF', 'RB', 14.6]],
      ['WR', ['Justin Jefferson', 'MIN', 'WR', 17.9], ['Tee Higgins', 'CIN', 'WR', 13.7]],
      ['WR', ['Jameson Williams', 'DET', 'WR', 12.2], ['Jayden Reed', 'GB', 'WR', 11.8]],
      ['TE', ['Sam LaPorta', 'DET', 'TE', 10.9], ['Mark Andrews', 'BAL', 'TE', 10.2]],
      ['FLX', ['DeVonta Smith', 'PHI', 'WR', 13.1], ['Rashee Rice', 'KC', 'WR', 13.4]],
      ['DEF', ['Bills D/ST', 'BUF', 'DEF', 7.2], ['Lions D/ST', 'DET', 'DEF', 7.9]],
      ['K', ['Jake Elliott', 'PHI', 'K', 8.8], ['Tyler Bass', 'BUF', 'K', 8.3]],
    ],
  },
];

// Scoring plays for one player over a 60 minute game, seeded by name so the
// same player always has the same afternoon.
function scoringPlan(name, proj) {
  let seed = 0;
  for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const r = rng(seed);
  const target = proj * (0.55 + r() * 0.95);
  const plays = [];
  let total = 0;
  while (total < target) {
    const big = r() < 0.22;
    const pts = big ? 6 + Math.round(r() * 30) / 10 : 0.8 + Math.round(r() * 28) / 10;
    plays.push({ at: r() * 60, pts });
    total += pts;
  }
  return plays.sort((a, b) => a.at - b.at);
}

function clockFor(elapsed) {
  const period = Math.min(4, Math.floor(elapsed / 15) + 1);
  const left = Math.max(0, period * 15 - elapsed);
  const m = Math.floor(left);
  const s = Math.floor((left - m) * 60);
  return { period, clock: `${m}:${String(s).padStart(2, '0')}` };
}

export function createDemo({ startMinute = 34, speed = 4 } = {}) {
  const t0 = Date.now();
  const now = () => startMinute + (Date.now() - t0) / 1000 / speed;
  const kickoffBase = Date.now() - startMinute * 60 * 1000 * 1.9;

  function nfl() {
    const sim = now();
    const games = {};
    const list = [];
    for (const [i, g] of GAMES.entries()) {
      const elapsed = sim - g.offset;
      const p = Math.max(0, Math.min(1, elapsed / 60));
      const state = elapsed <= 0 ? 'pre' : p >= 1 ? 'post' : 'in';
      const { period, clock } = clockFor(Math.max(0, Math.min(60, elapsed)));
      const r = rng(i + 7);
      const game = {
        id: `demo${i}`,
        state,
        period: state === 'in' ? period : state === 'post' ? 4 : 0,
        clock: state === 'in' ? clock : '0:00',
        start: new Date(kickoffBase + g.offset * 60 * 1000 * 1.9).toISOString(),
        home: g.home,
        away: g.away,
        homeScore: Math.round(p * (17 + r() * 17)),
        awayScore: Math.round(p * (14 + r() * 17)),
        possession: state === 'in' ? (Math.floor(sim / 3) % 2 ? g.home : g.away) : null,
        redZone: state === 'in' && Math.floor(sim) % 11 === 0,
        remaining: 1 - p,
      };
      games[g.home] = game;
      games[g.away] = game;
      list.push(game);
    }
    return {
      season: 2026,
      week: 10,
      games,
      list,
      bye: new Set(['CHI', 'DEN']),
      anyLive: list.some((g) => g.state === 'in'),
      nextKickoff: list.filter((g) => g.state === 'pre').map((g) => g.start).sort()[0],
    };
  }

  function matchups(n) {
    return LEAGUES.map((L) => {
      const player = ([name, team, pos, proj]) => {
        const g = n.games[team];
        const elapsed = g ? (1 - g.remaining) * 60 : 0;
        const pts = scoringPlan(name, proj)
          .filter((pl) => pl.at <= elapsed)
          .reduce((a, pl) => a + pl.pts, 0);
        const state = g ? g.state : 'bye';
        let label = '';
        if (g) {
          const opp = g.home === team ? `v ${g.away}` : `@ ${g.home}`;
          label =
            state === 'pre'
              ? new Date(g.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
              : state === 'post'
                ? `Final ${opp}`
                : `Q${g.period} ${g.clock} ${opp}`;
        }
        return {
          key: `demo:${name}`,
          name,
          short: pos === 'DEF' ? `${team} D/ST` : shortName(name),
          pos,
          team,
          pts: Math.round(pts * 10) / 10,
          proj,
          state,
          remaining: g ? g.remaining : 0,
          label,
          injury: name === 'Mark Andrews' ? 'Questionable' : null,
        };
      };
      return buildMatchup({
        key: L.key,
        platform: L.platform,
        league: L.league,
        me: L.me,
        opp: L.opp,
        slots: L.slots.map(([pos, a, b]) => ({ pos, me: player(a), opp: player(b) })),
      });
    });
  }

  return {
    async load() {
      const n = nfl();
      return { nfl: n, matchups: matchups(n), errors: [] };
    },
  };
}
