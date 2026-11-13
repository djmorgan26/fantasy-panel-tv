# Fantasy Panel for Google TV

Say **"Hey Google, open Fantasy Football"** and a quiet side panel slides in over
whatever you are watching: your live fantasy score, win odds, a slot by slot
lineup against your opponent, your other leagues, and the NFL games that swing
your week the most. Say it again and it slides away.

Watching a tight game and want less on screen? Say **"Hey Google, open Fantasy
Scores"** for a small score card in the corner instead.

Works with **Sleeper** and **ESPN** leagues, any number of them, on any Google TV
or Android TV. Runs entirely in Docker on your computer: nothing to install
except Docker.

![The panel docked over a game](docs/screenshots/tv-live.png)

<table>
  <tr>
    <td><img src="docs/screenshots/panel-closeup.png" width="300" alt="Panel close up"></td>
    <td>
      <b>Your matchup</b>: live score, projected finish and a win probability that
      updates as the clock runs.<br><br>
      <b>Lineup</b>: every starter against his counterpart, with game clock,
      injury tags and projections for players yet to play.<br><br>
      <b>Other leagues</b>: one line each. The panel rotates through them, and jumps
      to a league the moment something happens there.<br><br>
      <b>Games that matter</b>: your projected points still to come in each NFL
      game, minus your opponents', across every league.<br><br>
      <b>Big plays</b>: a card pops in when one of your players (or one of theirs)
      scores big.
    </td>
  </tr>
</table>

<img src="docs/screenshots/tv-scores-card.png" width="640" alt="The compact score card">

## How it works

```
"Hey Google, open Fantasy Football"
        |
        v
ToggleActivity (invisible, closes at once so the game keeps playing)
        |
        v
OverlayService: a non-focusable, non-touchable window docked to the side
        |
        v
WebView running web/ : Sleeper API + ESPN fantasy API + NFL scoreboard
                       refreshed every 20 s while games are live
```

- The panel never takes your remote. Input always goes to the app you are watching.
- Nothing runs while the panel is hidden, and it closes itself when the TV sleeps.
- No server, no account, no tracking. The TV talks straight to Sleeper and ESPN.

## Setup

You need Docker, and a TV with Developer options and Wireless debugging on
(Settings > System > About > tap "Android TV OS build" 7 times, then
Settings > System > Developer options > Wireless debugging).

```sh
make setup                               # creates config.local.json and the privacy hook
# edit config.local.json: Sleeper username, ESPN league + team id, TV address
make tv-pair PAIR=192.168.1.50:37123 CODE=123456   # from "Pair device with pairing code"
make tv-install                          # build, install, send your settings
```

Then say **"Hey Google, open Fantasy Football"**. Or `make tv-open`.

**Closing it:** say the same thing again, or press **Home** on the remote. It also
closes itself when the TV goes to sleep. "Fantasy Scores" while the full panel is
up switches to the small card (and the other way round).

### Config

```json
{
  "sleeper": { "username": "you", "leagueIds": [] },
  "espn": [{ "leagueId": 123456, "teamId": 1, "espn_s2": "", "swid": "" }],
  "panel": { "side": "right", "width": 0.26, "rotateSeconds": 15 },
  "tv": { "host": "192.168.1.50", "port": 5555 }
}
```

- **Sleeper**: just your username. Leave `leagueIds` empty to show every league you are in.
- **ESPN**: league id is in the league URL. Team id is the `teamId` in your team page URL.
  Private leagues also need the `espn_s2` and `SWID` cookies from espn.com in your
  browser. They are stored only on the TV and only ever sent to ESPN.
- **panel.timeZone / panel.locale** (for example `America/New_York`, `en-US`) set how
  kickoff times read. Leave them empty and your computer's are used, which matters
  because many TVs ship with their clock set to GMT.
- **tv.port** is only a fallback. Pairing is permanent, and although the TV picks a
  new port whenever it reboots, `make` finds the current one on your network
  automatically (mDNS, `scripts/find-tv.sh`). You pair once and never again.

`config.local.json` is git-ignored, and `make hooks` installs a pre-commit check
that refuses any commit containing a value from it.

## Voice without Gemini (Siri fallback)

Some Google TVs now route "Hey Google" to Gemini, which may answer
"open Fantasy Football" as a question instead of opening a sideloaded app.
Siri can trigger the panel instead, through your computer:

1. Open the **Shortcuts** app on your Mac and create a shortcut named
   **Fantasy Football**.
2. Add a **Run Shell Script** action:
   `cd ~/fantasy-panel-tv && /usr/bin/make tv-open` (use your clone's path;
   add `MODE=mini` for a second shortcut named **Fantasy Scores**, and `LOCAL=1`
   if you drive the TV with your computer's own adb rather than the container).
3. Say **"Hey Siri, Fantasy Football"** on the Mac, or on an iPhone, Apple Watch
   or HomePod signed in to the same Apple account (they run Mac shortcuts
   while the Mac is awake).

Say it again to close the panel, the same as the TV command.

## Commands

| | |
| --- | --- |
| `make preview` | Live preview at http://localhost:8080/preview.html?demo=1 |
| `make test` | Unit tests |
| `make e2e` | Playwright behaviour tests: scores tick, leagues rotate, big plays pop, proxy locked down |
| `make shots` | Playwright screenshots of the demo at 1920x1080 |
| `make shots-live` | Screenshots with your own leagues, into `.private/` |
| `make apk` | Build `dist/fantasy-panel.apk` |
| `make tv-status` | Is it installed, permitted, showing? |
| `make tv-show` / `tv-hide` / `tv-open` | Control the panel (`MODE=mini` for the score card) |
| `make tv-shot` | Screenshot the TV |
| `make tv-uninstall` | Remove it completely |

Already have adb paired on your computer? Add `LOCAL=1` to any `tv-` target.

## Safety

See [SAFETY.md](SAFETY.md). Short version: the only things this project ever
does to a TV are install this one app, allow it to draw its panel, send it your
settings, show or hide it, and uninstall it. `make tv-uninstall` puts the TV
back exactly as it was.

## Notes

- ESPN's fantasy API is unofficial and can change without notice. Sleeper's is
  official and read only.
- Win probability is a simple normal model: each starter's remaining projection
  with a spread proportional to it. It tracks ESPN's own number within a few points.
- Google may sometimes offer a Play Store search for "Fantasy Football" instead of
  opening the app. Opening it once from the Apps row usually settles it.

MIT licensed. Not affiliated with Google, Sleeper, ESPN or the NFL.
