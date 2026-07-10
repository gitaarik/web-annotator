#!/bin/bash
set -e

# Clean up stale X11 lock files from previous runs
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true

# Start Xvfb (virtual framebuffer) on display :99
echo "[entrypoint] Starting Xvfb on display :99..."
Xvfb :99 -screen 0 1920x1080x24 -ac &
XVFB_PID=$!

# Wait for Xvfb to be ready
sleep 1

# Verify Xvfb is running
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "[entrypoint] ERROR: Xvfb failed to start"
    exit 1
fi

echo "[entrypoint] Xvfb started (PID: $XVFB_PID)"

# Start x11vnc to expose the virtual display
echo "[entrypoint] Starting x11vnc on display :99..."
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -bg -o /tmp/x11vnc.log
echo "[entrypoint] x11vnc started on port 5900"

# Start noVNC (web-based VNC client)
echo "[entrypoint] Starting noVNC on port 6080..."
/usr/share/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
NOVNC_PID=$!
echo "[entrypoint] noVNC started (PID: $NOVNC_PID) - access at http://localhost:6080/vnc.html"

# Handle shutdown gracefully
cleanup() {
    echo "[entrypoint] Shutting down..."
    kill $NOVNC_PID 2>/dev/null || true
    pkill x11vnc 2>/dev/null || true
    kill $XVFB_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# Start browser-service server.
# SERVER_CMD picks the npm script: "start" (default, tsx) or "dev"
# (tsx watch) for hot reload when the source is bind-mounted (see docker-compose.yml).
echo "[entrypoint] Starting browser-service server (npm run ${SERVER_CMD:-start})..."
exec npm run "${SERVER_CMD:-start}"
