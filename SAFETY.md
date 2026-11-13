# Safety: what this project does to your TV

A hard rule for this project: **it must never mess up your TV.** This page lists
everything it can do, and how each piece is contained.

## The complete list of TV actions

All of them live in [`scripts/tv.sh`](scripts/tv.sh), and every one is scoped to
the package `io.github.djmorgan26.fantasypanel`.

| Action | What it changes | Undo |
| --- | --- | --- |
| `install` | Installs this app, then `appops set <this app> SYSTEM_ALERT_WINDOW allow` so it can draw its panel | `make tv-uninstall` |
| `config` | Saves your league settings inside this app's private storage | `make tv-uninstall` |
| `show` / `hide` / `toggle` | Shows or hides the panel | `hide` |
| `open` | Opens the menu, like the Fantasy Football tile | Back on the remote |
| `focus` | Saves which league the panel shows, inside this app's storage | `make tv-focus KEY=all` |
| `status` / `shot` / `logs` / `memory` | Read only | |
| `uninstall` | Removes the app, its storage and its permission | |

The project never changes a system setting, never disables or uninstalls another
app, and never reads another app's data.

## Opening a game in another app

The menu's **Watch** list can open a game in YouTube TV, Prime Video, YouTube,
Netflix, Peacock or Paramount+, only when you select it with the remote. The
page only names the app and the game; the app builds the link itself
(`Watch.java`), for those six apps only, and each link is that app's own search
page (for example `https://tv.youtube.com/search?q=Houston Texans at Cleveland Browns`).
It is the same as typing the game into the app's search box. Nothing is played,
bought or changed in the other app. The manifest's `<queries>` list names those
six packages, so the app can tell whether they are installed and see nothing else.

## How the app is contained

- **No input capture.** The panel window is `FLAG_NOT_FOCUSABLE`: it can never
  take focus, so every remote button goes to the app you are watching. The menu
  is an ordinary screen that has the remote only while it is open; Back, Home or
  picking a game closes it.
- **Nothing in the background.** No boot receiver, no jobs, no alarms. The
  service exists only while the panel is on screen, returns `START_NOT_STICKY`
  so Android never revives it, and closes itself when the TV goes to sleep.
- **Crash isolation.** If the WebView renderer dies or is reclaimed for memory,
  the panel simply closes (`onRenderProcessGone`), and it can never affect the
  app you are watching.
- **Locked control channel.** The receiver that accepts settings and show/hide
  commands requires `android.permission.DUMP`, which only the adb shell and the
  system hold. Other apps on the TV cannot send it anything.
- **Small and light.** About 200 KB installed, about 70 MB of memory while
  showing (menu included), refreshing every 20 seconds only while games are live.
- **No backups.** League settings are excluded from cloud backup and device transfer.
- **Lint gate.** Android lint runs on every build and fails it on errors.

## Your data

- Your settings live in `config.local.json` (git-ignored) and on the TV.
- `make hooks` installs a pre-commit check that blocks any commit containing a
  value from that file or from `.private/words.txt`. `make check-private` scans
  everything tracked.
- Screenshots of your real leagues go to `.private/shots/` (git-ignored). The
  committed screenshots use the built-in demo with made up teams.
