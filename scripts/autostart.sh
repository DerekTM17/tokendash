#!/bin/sh
# Keep the token dashboard always running: ingest watcher + Vite server.
#
# Idempotent and safe to run repeatedly: used from a cron @reboot line (start
# on boot) and a periodic watchdog line (self-heal after a crash), same
# pattern as ledger's autostart.sh. systemd-user is unavailable under this
# WSL setup, so cron is the persistence mechanism.
#
# Install (once):
#   (crontab -l 2>/dev/null; \
#    echo "@reboot $PWD/scripts/autostart.sh"; \
#    echo "*/10 * * * * $PWD/scripts/autostart.sh") | crontab -

# Resolve the checkout from this script's own location, so a clone anywhere
# works without editing the file.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

# cron does not source a login shell, so a node installed by nvm is NOT on PATH
# here — `command -v node` finds nothing under cron even though it works in a
# terminal. Fall back to the highest nvm-managed version, and let anyone with a
# different layout skip the guessing entirely via TOKENDASH_NODE_BIN.
NODE_BIN=${TOKENDASH_NODE_BIN:-}
if [ -z "$NODE_BIN" ]; then
    NODE_BIN=$(command -v node 2>/dev/null | xargs -r dirname)
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN/node" ]; then
    NODE_BIN=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
fi
PATH=${NODE_BIN:-/usr/bin}:/usr/local/bin:/usr/bin:/bin
export PATH

if ! command -v node >/dev/null 2>&1; then
    echo "$(date -Is) no node on PATH — set TOKENDASH_NODE_BIN" >>"${LOG:-/tmp/token-dashboard.log}"
    exit 1
fi
PORT=5199
LOG=/tmp/token-dashboard.log
WATCH_PID=/tmp/token-dashboard-watch.pid

# Ingest watcher (rewrites tokens.json when Claude/opencode/Codex logs change;
# the dashboard polls it). No port to probe, so liveness is a pidfile check.
#
# Liveness is not enough: node caches modules at import, so a watcher started
# before an ingest edit keeps running the OLD code and silently overwrites
# tokens.json with stale numbers. (This is exactly how a corrected model price
# stayed invisible for days.) Recycle whenever any ingest source file is newer
# than the pidfile, which is touched at each (re)start.
RESTART=0
if ! kill -0 "$(cat "$WATCH_PID" 2>/dev/null)" 2>/dev/null; then
    RESTART=1
elif [ -n "$(find "$ROOT/packages/ingest/src" -type f -newer "$WATCH_PID" -print -quit 2>/dev/null)" ]; then
    echo "$(date -Is) ingest source changed — recycling watcher" >>"$LOG"
    kill "$(cat "$WATCH_PID" 2>/dev/null)" 2>/dev/null
    RESTART=1
fi

if [ "$RESTART" = 1 ]; then
    cd "$ROOT" || exit 1
    nohup node packages/ingest/src/index.js --watch >>"$LOG" 2>&1 &
    echo $! >"$WATCH_PID"
fi

# Dashboard server. HTTP liveness check (not pgrep) so a hung process
# self-heals on the next watchdog run.
if curl -fs -o /dev/null --max-time 3 "http://localhost:${PORT}/" 2>/dev/null; then
    exit 0
fi

cd "$ROOT/packages/dashboard" || exit 1
nohup npx vite --host 0.0.0.0 --port "$PORT" --strictPort >>"$LOG" 2>&1 &
