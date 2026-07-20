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
#    echo '@reboot /home/dynomatic/opencode/projects/token-dashboard/scripts/autostart.sh'; \
#    echo '*/10 * * * * /home/dynomatic/opencode/projects/token-dashboard/scripts/autostart.sh') | crontab -

# node lives under nvm, which cron doesn't source — hardcode its bin dir.
PATH=/home/dynomatic/.nvm/versions/node/v24.14.0/bin:/usr/local/bin:/usr/bin:/bin
ROOT=/home/dynomatic/opencode/projects/token-dashboard
PORT=5199
LOG=/tmp/token-dashboard.log
WATCH_PID=/tmp/token-dashboard-watch.pid

# Ingest watcher (rewrites tokens.json when Claude/opencode/Codex logs change;
# the dashboard polls it). No port to probe, so liveness is a pidfile check.
if ! kill -0 "$(cat "$WATCH_PID" 2>/dev/null)" 2>/dev/null; then
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
