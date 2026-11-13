#!/bin/sh
# Prints this computer's IANA timezone (tz) or BCP 47 locale (locale), so the
# panel shows kickoff times the way you read them even if the TV's clock is
# set to another zone.
case "${1:-tz}" in
  tz)
    if [ -n "${TZ:-}" ]; then echo "$TZ"; exit 0; fi
    link=$(readlink /etc/localtime 2>/dev/null)
    case "$link" in *zoneinfo/*) echo "${link##*zoneinfo/}"; exit 0;; esac
    [ -f /etc/timezone ] && cat /etc/timezone
    ;;
  locale)
    loc=$(defaults read -g AppleLocale 2>/dev/null)
    [ -n "$loc" ] || loc=${LC_ALL:-${LANG:-}}
    loc=${loc%%.*}
    loc=${loc%%@*}
    echo "$loc" | tr '_' '-'
    ;;
esac
