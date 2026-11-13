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
| `show` / `hide` / `toggle` / `open` | Shows or hides the panel | `hide` |
| `status` / `shot` / `logs` / `memory` | Read only | |
| `uninstall` | Removes the app, its storage and its permission | |

The project never changes a system setting, never disables or uninstalls another
app, and never reads another app's data.

## How the app is contained

- **No input capture.** The panel window is `FLAG_NOT_FOCUSABLE` and
  `FLAG_NOT_TOUCHABLE`: your remote always controls the app you are watching.
- **Nothing in the background.** No boot receiver, no jobs, no alarms. The
  service exists only while the panel is on screen, returns `START_NOT_STICKY`
  so Android never revives it, and closes itself when the TV goes to sleep.
- **Crash isolation.** If the WebView renderer dies or is reclaimed for memory,
  the panel simply closes (`onRenderProcessGone`), and it can never affect the
  app you are watching.
- **Locked control channel.** The receiver that accepts settings and show/hide
  commands requires `android.permission.DUMP`, which only the adb shell and the
  system hold. Other apps on the TV cannot send it anything.
- **Small and light.** About 120 KB installed, about 65 MB of memory while
  showing, refreshing every 20 seconds only while games are live.
- **No backups.** League settings are excluded from cloud backup and device transfer.
- **Lint gate.** Android lint runs on every build and fails it on errors.

## Your data

- Your settings live in `config.local.json` (git-ignored) and on the TV.
- `make hooks` installs a pre-commit check that blocks any commit containing a
  value from that file or from `.private/words.txt`. `make check-private` scans
  everything tracked.
- Screenshots of your real leagues go to `.private/shots/` (git-ignored). The
  committed screenshots use the built-in demo with made up teams.
