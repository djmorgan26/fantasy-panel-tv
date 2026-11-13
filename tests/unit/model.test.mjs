import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveProjection, summariseTeam, winProbability, buildMatchup, swingGames, scoringEvents } from '../../web/js/model.js';
import { remainingFraction, parseScoreboard, gameLabel } from '../../web/js/nfl.js';
import { parseEspn } from '../../web/js/espn.js';
import { projectFromStats } from '../../web/js/sleeper.js';
import { shortName, normTeam } from '../../web/js/util.js';

const P = (o) => ({ key: o.name, short: o.name, pts: 0, proj: 10, state: 'pre', remaining: 1, ...o });

test('remaining fraction follows the game clock', () => {
  assert.equal(remainingFraction('pre'), 1);
  assert.equal(remainingFraction('post'), 0);
  assert.equal(remainingFraction('half'), 0.5);
  assert.equal(remainingFraction('in', 1, '15:00'), 1);
  assert.equal(remainingFraction('in', 3, '7:30'), 0.375);
  assert.ok(remainingFraction('in', 5, '8:00') < 0.1);
});

test('live projection blends points so far with what is left', () => {
  assert.equal(liveProjection(P({ pts: 0, proj: 20, state: 'pre', remaining: 1 })), 20);
  assert.equal(liveProjection(P({ pts: 8, proj: 20, state: 'in', remaining: 0.5 })), 18);
  assert.equal(liveProjection(P({ pts: 25, proj: 20, state: 'post', remaining: 0 })), 25);
  assert.equal(liveProjection(P({ pts: 0, proj: 20, state: 'bye', remaining: 0 })), 0);
});

test('team summary counts players left and playing', () => {
  const s = summariseTeam([P({ state: 'pre' }), P({ state: 'in', pts: 5, remaining: 0.4 }), P({ state: 'post', pts: 12, remaining: 0 }), null]);
  assert.equal(s.left, 1);
  assert.equal(s.playing, 1);
  assert.equal(s.score, 17);
  assert.ok(s.sd > 0);
});

test('win probability is symmetric and sensible', () => {
  const even = winProbability({ proj: 100, sd: 20 }, { proj: 100, sd: 20 });
  assert.ok(Math.abs(even - 0.5) < 1e-9);
  const ahead = winProbability({ proj: 120, sd: 20 }, { proj: 100, sd: 20 });
  const behind = winProbability({ proj: 100, sd: 20 }, { proj: 120, sd: 20 });
  assert.ok(ahead > 0.7 && ahead < 0.8, `ahead ${ahead}`);
  assert.ok(Math.abs(ahead + behind - 1) < 1e-6);
  assert.equal(winProbability({ proj: 90, sd: 0 }, { proj: 80, sd: 0 }), 1);
});

test('a finished matchup is decided outright', () => {
  const m = buildMatchup({
    key: 'k', platform: 'x', league: 'L', me: { name: 'A' }, opp: { name: 'B' },
    slots: [{ pos: 'QB', me: P({ state: 'post', pts: 20, remaining: 0 }), opp: P({ state: 'post', pts: 10, remaining: 0 }) }],
  });
  assert.equal(m.done, true);
  assert.equal(m.winProb, 1);
});

test('swing games rank your remaining exposure across leagues', () => {
  const nfl = { games: { KC: { id: 'g1', state: 'in' }, BUF: { id: 'g1', state: 'in' }, DET: { id: 'g2', state: 'pre' } } };
  const m = buildMatchup({
    key: 'k', platform: 'x', league: 'L', me: {}, opp: {},
    slots: [
      { pos: 'QB', me: P({ name: 'Mine', team: 'KC', proj: 20, state: 'in', remaining: 0.5 }), opp: P({ name: 'Theirs', team: 'DET', proj: 30 }) },
    ],
  });
  const rows = swingGames([m], nfl);
  assert.equal(rows[0].game.id, 'g1', 'live game first');
  assert.equal(rows[0].impact, 10);
  assert.equal(rows[1].impact, -30);
});

test('scoring events fire on big jumps only', () => {
  const mk = (pts) => [{ key: 'k', league: 'L', slots: [{ me: P({ key: 'a', pts }), opp: null }] }];
  assert.deepEqual(scoringEvents(null, mk(6)), []);
  assert.equal(scoringEvents(mk(2), mk(4)).length, 0);
  const ev = scoringEvents(mk(2), mk(8.4));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].side, 'me');
  assert.ok(Math.abs(ev[0].delta - 6.4) < 1e-9);
});

test('sleeper projections apply the league scoring', () => {
  const stats = { pass_yd: 250, pass_td: 2, rec: 5, rec_yd: 50, adp_dd_ppr: 30 };
  const ppr = { pass_yd: 0.04, pass_td: 4, rec: 1, rec_yd: 0.1 };
  assert.equal(projectFromStats(stats, ppr), 10 + 8 + 5 + 5);
});

test('names and team codes normalise', () => {
  assert.equal(shortName('Amon-Ra St. Brown'), 'A. St. Brown');
  assert.equal(shortName('Harold Fannin Jr.'), 'H. Fannin Jr.');
  assert.equal(shortName('Packers D/ST'), 'Packers D/ST');
  assert.equal(normTeam('WAS'), 'WSH');
  assert.equal(normTeam('KC'), 'KC');
});

const scoreboard = {
  season: { year: 2026, type: 2 },
  week: { number: 10, teamsOnBye: [{ abbreviation: 'CHI' }] },
  events: [
    {
      id: '1', date: '2026-11-15T18:00Z',
      competitions: [{
        status: { period: 3, displayClock: '7:30', type: { state: 'in', name: 'STATUS_IN_PROGRESS' } },
        situation: { possession: '28', isRedZone: true },
        competitors: [
          { id: '28', homeAway: 'home', score: '17', team: { abbreviation: 'WSH' } },
          { id: '19', homeAway: 'away', score: '10', team: { abbreviation: 'NYG' } },
        ],
      }],
    },
  ],
};

test('scoreboard parsing joins teams to games', () => {
  const nfl = parseScoreboard(scoreboard);
  assert.equal(nfl.week, 10);
  assert.equal(nfl.anyLive, true);
  assert.equal(nfl.games.WSH, nfl.games.NYG);
  assert.equal(nfl.games.WSH.possession, 'WSH');
  assert.equal(nfl.games.WSH.remaining, 0.375);
  assert.ok(nfl.bye.has('CHI'));
  assert.equal(gameLabel(nfl, 'NYG'), 'Q3 7:30 @ WSH');
  assert.equal(gameLabel(nfl, 'CHI'), 'Bye');
});

test('espn matchup parsing pairs slots and reads projections', () => {
  const nfl = parseScoreboard(scoreboard);
  const entry = (id, name, pro, pos, slot, actual, proj) => ({
    lineupSlotId: slot, injuryStatus: 'ACTIVE',
    playerPoolEntry: {
      appliedStatTotal: actual,
      player: {
        id, fullName: name, proTeamId: pro, defaultPositionId: pos,
        stats: [
          { statSourceId: 1, scoringPeriodId: 10, appliedTotal: proj },
          { statSourceId: 0, scoringPeriodId: 10, appliedTotal: actual },
        ],
      },
    },
  });
  const data = {
    id: 42, scoringPeriodId: 10, status: { currentMatchupPeriod: 10 },
    settings: { name: 'Test League', rosterSettings: { lineupSlotCounts: { 0: 1, 20: 1 } } },
    teams: [
      { id: 1, name: 'Mine', record: { overall: { wins: 3, losses: 1 } } },
      { id: 2, name: 'Theirs', record: { overall: { wins: 2, losses: 2 } } },
    ],
    schedule: [{
      matchupPeriodId: 10,
      home: { teamId: 1, rosterForCurrentScoringPeriod: { entries: [entry(1, 'Jayden Daniels', 28, 1, 0, 14.2, 22), entry(3, 'Bench Guy', 19, 2, 20, 9, 9)] } },
      away: { teamId: 2, rosterForCurrentScoringPeriod: { entries: [entry(2, 'Jaxson Dart', 19, 1, 0, 8.1, 18)] } },
    }],
  };
  const m = parseEspn(data, 1, nfl);
  assert.equal(m.league, 'Test League');
  assert.equal(m.me.name, 'Mine');
  assert.equal(m.me.record, '3-1');
  assert.equal(m.slots.length, 1, 'bench excluded');
  assert.equal(m.slots[0].me.short, 'J. Daniels');
  assert.equal(m.slots[0].me.team, 'WSH');
  assert.equal(m.slots[0].me.state, 'in');
  assert.equal(m.me.score, 14.2);
  assert.ok(Math.abs(m.me.proj - (14.2 + 22 * 0.375)) < 1e-9);
  assert.ok(m.winProb > 0.5);
});
