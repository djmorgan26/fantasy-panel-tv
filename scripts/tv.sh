#!/bin/sh
# The only door to your TV. Runs inside the `adb` container (make tv-*), or on
# a computer that already has adb, jq and a paired TV (make tv-* LOCAL=1).
#
# Every command here is scoped to this app's package. Nothing changes a TV
# setting, disables an app, or touches another app's data, and
# `tv.sh uninstall` removes every trace (the overlay permission goes with it).
set -eu

PKG=io.github.djmorgan26.fantasypanel
CFG=${CONFIG:-config.local.json}
APK=dist/fantasy-panel.apk

die() { echo "error: $*" >&2; exit 1; }
b64() { base64 | tr -d '\n'; }

target() {
  if [ -n "${TV:-}" ]; then echo "$TV"; return; fi
  [ -f "$CFG" ] || die "no $CFG (copy config.example.json) and no TV=host:port"
  h=$(jq -r '.tv.host // empty' "$CFG"); p=$(jq -r '.tv.port // 5555' "$CFG")
  [ -n "$h" ] || die "set tv.host in $CFG"
  echo "$h:$p"
}

connect() {
  t=$(target)
  adb start-server >/dev/null 2>&1
  out=$(adb connect "$t" 2>&1 || true)
  case "$out" in
    *"connected to"*) ;;
    *) die "cannot reach TV at $t ($out). On the TV open Settings > System > Developer options > Wireless debugging and use the IP:port shown there (TV=ip:port), or pair first with make tv-pair";;
  esac
  ADB="adb -s $t"
}

installed() { $ADB shell pm list packages "$PKG" | tr -d '\r' | grep -qx "package:$PKG"; }

cmd=${1:-help}
[ $# -gt 0 ] && shift
case "$cmd" in
  pair)
    [ $# -eq 2 ] || die "usage: make tv-pair PAIR=ip:port CODE=123456"
    adb pair "$1" "$2"
    ;;
  status)
    connect
    echo "TV:      $($ADB shell getprop ro.product.manufacturer | tr -d '\r') $($ADB shell getprop ro.product.model | tr -d '\r'), Android $($ADB shell getprop ro.build.version.release | tr -d '\r')"
    if installed; then
      v=$($ADB shell dumpsys package "$PKG" | sed -n 's/.*versionName=//p' | head -1 | tr -d '\r')
      op=$($ADB shell appops get "$PKG" SYSTEM_ALERT_WINDOW | sed 's/.*: //; s/;.*//' | tr -d '\r')
      run=$($ADB shell dumpsys activity services "$PKG" | grep -c OverlayService || true)
      echo "App:     installed (v$v)"
      echo "Overlay: $op"
      echo "Panel:   $([ "$run" -gt 0 ] && echo showing || echo hidden)"
    else
      echo "App:     not installed"
    fi
    ;;
  install)
    connect
    [ -f "$APK" ] || die "no $APK yet: make apk"
    $ADB install -r "$APK"
    # The only permission we grant, and only to our own package.
    $ADB shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow
    echo "installed and allowed to draw its panel"
    ;;
  config)
    connect
    installed || die "app not installed: make tv-install"
    [ -f "$CFG" ] || die "no $CFG"
    payload=$(jq -c '{sleeper, espn, panel}' "$CFG" | b64)
    res=$($ADB shell am broadcast -a "$PKG.CONFIG" -n "$PKG/.ControlReceiver" --es b64 "$payload")
    case "$res" in *'data="saved"'*) echo "league settings sent to the TV";; *) die "TV rejected config: $res";; esac
    ;;
  show|hide|toggle|reload)
    connect
    installed || die "app not installed: make tv-install"
    $ADB shell am broadcast -a "$PKG.$(echo "$cmd" | tr a-z A-Z)" -n "$PKG/.ControlReceiver" --es mode "${MODE:-full}" >/dev/null
    echo "$cmd sent${MODE:+ ($MODE)}"
    ;;
  open)
    # Same path as "Hey Google, open Fantasy Football".
    connect
    if [ "${MODE:-full}" = mini ]; then comp="$PKG/.ScoresAlias"; else comp="$PKG/.ToggleActivity"; fi
    $ADB shell am start -n "$comp" >/dev/null
    echo "opened (toggles the panel)"
    ;;
  shot)
    connect
    mkdir -p .private/shots
    f=".private/shots/tv-$(date +%H%M%S).png"
    $ADB exec-out screencap -p > "$f"
    echo "$f"
    ;;
  logs)
    connect
    $ADB logcat -d -s FantasyPanel:V chromium:W AndroidRuntime:E | tail -n "${LINES:-60}"
    ;;
  watch)
    # Stream panel events live (Ctrl-C to stop): handy while testing voice commands.
    connect
    $ADB logcat -T 1 -s FantasyPanel:I
    ;;
  memory)
    connect
    $ADB shell dumpsys meminfo "$PKG" | grep -E "TOTAL PSS|TOTAL RSS" | head -3 || echo "not running"
    ;;
  foreground)
    connect
    $ADB shell dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity" | sed 's/^ *//'
    ;;
  uninstall)
    connect
    if installed; then $ADB uninstall "$PKG"; echo "removed. Nothing else on the TV was changed."; else echo "not installed"; fi
    ;;
  *)
    echo "usage: tv.sh pair|status|install|config|show|hide|toggle|open|reload|shot|logs|watch|memory|foreground|uninstall"
    ;;
esac
