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

# Handle shutdown gracefully
cleanup() {
    echo "[entrypoint] Shutting down..."
    kill $XVFB_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# Start browser-service server
echo "[entrypoint] Starting browser-service server..."
exec npm start
