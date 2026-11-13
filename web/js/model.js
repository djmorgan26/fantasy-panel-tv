// Platform-neutral matchup math. Sleeper and ESPN adapters both produce
// players shaped like:
//   { key, name, short, pos, team, pts, proj, state, remaining, label, injury }
// where `state` is pre | in | post | bye | none and `remaining` is the share of
// that player's game still to be played (1 before kickoff, 0 when final).

// Rough single-game spread of a fantasy player relative to his projection.
// Weekly team totals land around 25 points of standard deviation, which this
// reproduces for a typical nine-man lineup.
const PLAYER_SD_RATIO = 0.62;

export function liveProjection(p) {
  if (p.state === 'bye' || p.state === 'post') return p.pts || 0;
  const rem = p.state === 'none' ? 1 : p.remaining ?? 1;
  return (p.pts || 0) + Math.max(0, p.proj || 0) * rem;
}

export function summariseTeam(starters) {
  let score = 0;
  let proj = 0;
  let variance = 0;
  let left = 0;
  let playing = 0;
  for (const p of starters) {
    if (!p) continue;
    score += p.pts || 0;
    proj += liveProjection(p);
    const rem = p.state === 'post' || p.state === 'bye' ? 0 : p.remaining ?? 1;
    variance += (PLAYER_SD_RATIO * Math.max(0, p.proj || 0) * rem) ** 2;
    if (p.state === 'pre' || p.state === 'none') left += 1;
    if (p.state === 'in') playing += 1;
  }
  return { score, proj, sd: Math.sqrt(variance), left, playing };
}

// Abramowitz and Stegun 7.1.26, accurate to about 1e-7.
function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

export function winProbability(me, opp) {
  const diff = me.proj - opp.proj;
  const sd = Math.sqrt(me.sd ** 2 + opp.sd ** 2);
  if (sd < 0.01) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  return Math.min(0.999, Math.max(0.001, normalCdf(diff / sd)));
}

export function buildMatchup({ key, platform, league, me, opp, slots }) {
  const meStarters = slots.map((s) => s.me);
  const oppStarters = slots.map((s) => s.opp);
  const meSum = summariseTeam(meStarters);
  const oppSum = summariseTeam(oppStarters);
  const done = [...meStarters, ...oppStarters].every(
    (p) => !p || p.state === 'post' || p.state === 'bye'
  );
  const wp = done
    ? meSum.score > oppSum.score
      ? 1
      : meSum.score < oppSum.score
        ? 0
        : 0.5
    : winProbability(meSum, oppSum);
  return {
    key,
    platform,
    league,
    me: { ...me, ...meSum },
    opp: { ...opp, ...oppSum },
    slots,
    winProb: wp,
    done,
  };
}

// Which NFL games swing your weeks the most: your projected points still to
// come in that game, minus your opponents', summed over every league.
export function swingGames(matchups, nfl) {
  const byGame = new Map();
  for (const m of matchups) {
    for (const s of m.slots) {
      for (const [side, p] of [
        [1, s.me],
        [-1, s.opp],
      ]) {
        if (!p || !p.team) continue;
        const g = nfl.games[p.team];
        if (!g || g.state === 'post') continue;
        const rem = Math.max(0, p.proj || 0) * (p.remaining ?? 1);
        if (!byGame.has(g.id)) byGame.set(g.id, { game: g, impact: 0, mine: [], theirs: [] });
        const row = byGame.get(g.id);
        row.impact += side * rem;
        (side > 0 ? row.mine : row.theirs).push(p.short);
      }
    }
  }
  const live = (r) => (r.game.state === 'in' || r.game.state === 'half' ? 1 : 0);
  return [...byGame.values()].sort(
    (a, b) => live(b) - live(a) || Math.abs(b.impact) - Math.abs(a.impact)
  );
}

// Compare two refreshes and report scoring jumps worth a toast.
export function scoringEvents(prev, next, threshold = 3.5) {
  if (!prev) return [];
  const before = new Map();
  for (const m of prev) {
    for (const s of m.slots) {
      if (s.me) before.set(`${m.key}|me|${s.me.key}`, s.me.pts || 0);
      if (s.opp) before.set(`${m.key}|opp|${s.opp.key}`, s.opp.pts || 0);
    }
  }
  const events = [];
  for (const m of next) {
    for (const s of m.slots) {
      for (const [side, p] of [
        ['me', s.me],
        ['opp', s.opp],
      ]) {
        if (!p) continue;
        const was = before.get(`${m.key}|${side}|${p.key}`);
        if (was === undefined) continue;
        const delta = (p.pts || 0) - was;
        if (delta >= threshold) {
          events.push({ side, player: p, delta, league: m.league, matchupKey: m.key });
        }
      }
    }
  }
  return events.sort((a, b) => b.delta - a.delta);
}
