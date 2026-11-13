#!/bin/sh
# Prints the TV's current wireless-debugging address (ip:port).
#
# Pairing is permanent, but the TV picks a new random port whenever wireless
# debugging restarts (a reboot, a Wi-Fi change). The TV announces that port
# over mDNS as _adb-tls-connect._tcp, so we look it up instead of asking you.
# Runs on the host (containers on macOS cannot see multicast). Tries, in order:
#   1. adb's own mDNS discovery, if adb is installed here
#   2. dns-sd (built into macOS)
#   3. avahi-browse (Linux)
# and falls back to tv.host:tv.port from config.local.json.
CFG=${CONFIG:-config.local.json}
host=""; port=""
if [ -f "$CFG" ] && command -v jq >/dev/null 2>&1; then
  host=$(jq -r '.tv.host // empty' "$CFG"); port=$(jq -r '.tv.port // empty' "$CFG")
fi

found=""
if command -v adb >/dev/null 2>&1; then
  found=$(adb mdns services 2>/dev/null | awk '/_adb-tls-connect/ {print $NF}' | grep -F "${host:-.}" | head -1)
fi

if [ -z "$found" ] && command -v dns-sd >/dev/null 2>&1; then
  tmp=$(mktemp)
  dns-sd -B _adb-tls-connect._tcp local. > "$tmp" 2>/dev/null & pid=$!
  sleep 3; kill "$pid" 2>/dev/null
  for name in $(awk '/Add/ && /_adb-tls-connect/ {print $NF}' "$tmp" | sort -u); do
    dns-sd -L "$name" _adb-tls-connect._tcp local. > "$tmp.l" 2>/dev/null & pid=$!
    sleep 2; kill "$pid" 2>/dev/null
    p=$(sed -n 's/.*can be reached at [^ ]*:\([0-9][0-9]*\).*/\1/p' "$tmp.l" | head -1)
    h=$(sed -n 's/.*can be reached at \([^ :]*\):.*/\1/p' "$tmp.l" | head -1)
    ip=$(dscacheutil -q host -a name "$h" 2>/dev/null | awk '/ip_address/ {print $2; exit}')
    if [ -n "$p" ] && { [ -z "$host" ] || [ "$ip" = "$host" ] || [ -z "$ip" ]; }; then
      found="${ip:-$host}:$p"; break
    fi
  done
  rm -f "$tmp" "$tmp.l"
fi

if [ -z "$found" ] && command -v avahi-browse >/dev/null 2>&1; then
  found=$(avahi-browse -rpt _adb-tls-connect._tcp 2>/dev/null | awk -F';' '$1=="=" && $3=="IPv4" {print $8":"$9}' | grep -F "${host:-.}" | head -1)
fi

if [ -n "$found" ]; then
  echo "$found"
elif [ -n "$host" ]; then
  echo "$host:${port:-5555}"
fi
