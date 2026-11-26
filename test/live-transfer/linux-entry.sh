#!/bin/sh
set -eu
mkdir -p "$HOME"
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp -ac >/tmp/haia-xvfb.log 2>&1 &
export DISPLAY=:99
sleep 1
exec dbus-run-session -- /opt/haia-runtime/node_modules/.bin/electron "$@"
