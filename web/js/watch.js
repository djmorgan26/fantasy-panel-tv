// "Watch this game": which games matter to you, and which app to open for
// each. The TV app turns { provider, query } into a search link for that app
// (only the providers listed here; the page can never open anything else).

export const PROVIDERS = {
  youtubetv: { name: 'YouTube TV' },
  prime: { name: 'Prime Video' },
  netflix: { name: 'Netflix' },
  youtube: { name: 'YouTube' },
  peacock: { name: 'Peacock' },
  paramount: { name: 'Paramount+' },
};

// Streaming-only broadcasts go to their own app. Everything on regular TV
// (CBS, FOX, NBC, ABC, ESPN, NFL Network) goes to your live TV app, which is
// YouTube TV unless config.watch.tv says otherwise.
export function providerFor(game, watchCfg) {
  const nets = (game.networks || []).map((n) => n.toLowerCase());
  const has = (re) => nets.some((n) => re.test(n));
  const tv = PROVIDERS[watchCfg?.tv] ? watchCfg.tv : 'youtubetv';
  const onTv = has(/^(cbs|fox|nbc|abc|espn|espn2|nfl ?network|nfln)$/);
  if (has(/prime/)) return 'prime';
  if (has(/netflix/)) return 'netflix';
  if (has(/^youtube$/) && !onTv) return 'youtube';
  if (has(/peacock/) && !onTv) return 'peacock';
  return tv;
}

// The search text each app lists games under. YouTube TV titles games
// "Houston Texans at Cleveland Browns" (that exact wording puts the game
// first, under "On now & upcoming"); Prime Video "Commanders vs. Giants".
export function watchQuery(game, provider) {
  const away = game.awayFull || game.away;
  const home = game.homeFull || game.home;
  if (provider === 'prime') return `${game.awayName || away} vs. ${game.homeName || home}`;
  if (provider === 'netflix' || provider === 'peacock' || provider === 'paramount') return `${away} ${home}`;
  return `${away} at ${home}`;
}

const liveish = (g) => g.state === 'in' || g.state === 'half';

// Every game that is live or still to come, with your starters (and the
// players you are up against) in each. Games with your players come first,
// live before upcoming, then by kickoff.
export function watchList(nfl, matchups, watchCfg) {
  if (!nfl?.list) return [];
  const rows = new Map();
  for (const g of nfl.list) {
    if (g.state === 'post') continue;
    rows.set(g.id, { game: g, mine: new Map(), theirs: new Map() });
  }
  for (const m of matchups || []) {
    for (const s of m.slots || []) {
      for (const [side, p] of [['mine', s.me], ['theirs', s.opp]]) {
        if (!p?.team) continue;
        const g = nfl.games?.[p.team];
        const row = g && rows.get(g.id);
        if (row) row[side].set(p.key || p.name, p.short || p.name);
      }
    }
  }
  return [...rows.values()]
    .map((r) => {
      const provider = providerFor(r.game, watchCfg);
      return {
        game: r.game,
        mine: [...r.mine.values()],
        theirs: [...r.theirs.values()],
        provider,
        providerName: PROVIDERS[provider].name,
        query: watchQuery(r.game, provider),
      };
    })
    .sort(
      (a, b) =>
        (b.mine.length > 0) - (a.mine.length > 0) ||
        liveish(b.game) - liveish(a.game) ||
        String(a.game.start).localeCompare(String(b.game.start)) ||
        b.mine.length - a.mine.length
    );
}

// Which matchups the panel shows: all of them (rotating), or the one you
// pinned from the menu. A pin that no longer matches anything shows all.
export function pinned(matchups, focus) {
  if (!focus || focus === 'all') return matchups;
  const hit = (matchups || []).filter((m) => m.key === focus);
  return hit.length ? hit : matchups;
}
