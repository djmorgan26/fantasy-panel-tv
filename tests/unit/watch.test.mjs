import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerFor, watchQuery, watchList, pinned } from '../../web/js/watch.js';

const game = (o) => ({
  id: o.id || '1', state: 'pre', start: '2026-11-15T18:00Z', home: 'ATL', away: 'KC',
  homeName: 'Falcons', awayName: 'Chiefs', homeFull: 'Atlanta Falcons', awayFull: 'Kansas City Chiefs',
  networks: ['CBS'], ...o,
});

test('broadcast TV goes to YouTube TV, streaming-only games to their app', () => {
  assert.equal(providerFor(game({ networks: ['CBS'] })), 'youtubetv');
  assert.equal(providerFor(game({ networks: ['ESPN', 'ABC'] })), 'youtubetv');
  assert.equal(providerFor(game({ networks: ['Prime Video'] })), 'prime');
  assert.equal(providerFor(game({ networks: ['Netflix'] })), 'netflix');
  assert.equal(providerFor(game({ networks: ['YouTube'] })), 'youtube');
  assert.equal(providerFor(game({ networks: ['Peacock'] })), 'peacock');
  assert.equal(providerFor(game({ networks: ['NBC', 'Peacock'] })), 'youtubetv', 'NBC simulcast stays on live TV');
  assert.equal(providerFor(game({ networks: [] })), 'youtubetv');
});

test('config can pick another live TV app, but only a known one', () => {
  assert.equal(providerFor(game({ networks: ['Fox'] }), { tv: 'paramount' }), 'paramount');
  assert.equal(providerFor(game({ networks: ['Fox'] }), { tv: 'https://evil.example' }), 'youtubetv');
  assert.equal(providerFor(game({ networks: ['Fox'] }), null), 'youtubetv', 'no watch settings at all');
});

test('search text matches how each app titles games', () => {
  assert.equal(watchQuery(game({}), 'youtubetv'), 'Kansas City Chiefs at Atlanta Falcons');
  assert.equal(watchQuery(game({}), 'prime'), 'Chiefs vs. Falcons');
});

const nflOf = (list) => {
  const games = {};
  for (const g of list) games[g.home] = games[g.away] = g;
  return { list, games };
};
const p = (key, team) => ({ key, short: key, team });

test('your games first, live before upcoming, finished games left out', () => {
  const a = game({ id: 'a', home: 'ATL', away: 'KC', state: 'pre', start: '2026-11-15T18:00Z' });
  const b = game({ id: 'b', home: 'GB', away: 'MIN', state: 'in', start: '2026-11-15T18:00Z' });
  const c = game({ id: 'c', home: 'DAL', away: 'SF', state: 'in' });
  const d = game({ id: 'd', home: 'NYG', away: 'WSH', state: 'post' });
  const matchups = [{ slots: [{ me: p('Mahomes', 'KC'), opp: p('Jefferson', 'MIN') }, { me: p('Love', 'GB'), opp: null }] }];
  const rows = watchList(nflOf([a, b, c, d]), matchups);
  assert.deepEqual(rows.map((r) => r.game.id), ['b', 'a', 'c']);
  assert.deepEqual(rows[0].mine, ['Love']);
  assert.deepEqual(rows[0].theirs, ['Jefferson']);
  assert.equal(rows[0].provider, 'youtubetv');
});

test('a player in two leagues is listed once per game', () => {
  const a = game({ id: 'a' });
  const m = { slots: [{ me: p('Mahomes', 'KC') }] };
  const rows = watchList(nflOf([a]), [m, m]);
  assert.deepEqual(rows[0].mine, ['Mahomes']);
});

test('pinning shows one league, and a stale pin falls back to all', () => {
  const ms = [{ key: 'sleeper:1' }, { key: 'espn:2' }];
  assert.equal(pinned(ms, 'all').length, 2);
  assert.deepEqual(pinned(ms, 'espn:2'), [{ key: 'espn:2' }]);
  assert.equal(pinned(ms, 'espn:999').length, 2);
});
