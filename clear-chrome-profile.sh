#!/bin/bash
# Clear the Chrome profile used by browser-service
# This gives a fresh start, which may help with bot detection

set -e

# Check if Docker container is running
if docker ps 2>/dev/null | grep -q browser-service; then
    echo "Stopping browser-service container..."
    docker compose -f "$(dirname "$0")/docker-compose.yml" down

    echo "Removing Docker volume: chrome-data..."
    docker volume rm web-annotator_chrome-data 2>/dev/null || true

    echo "Restarting browser-service..."
    docker compose -f "$(dirname "$0")/docker-compose.yml" up -d

    echo "Done. Chrome profile cleared and container restarted."
else
    # Local (non-Docker) setup
    PROFILE_DIR="$HOME/.browser-service/chrome-user-data"

    if [ -d "$PROFILE_DIR" ]; then
        echo "Removing Chrome profile at: $PROFILE_DIR"
        rm -rf "$PROFILE_DIR"
        echo "Done. Chrome profile cleared."
        echo "Note: You may need to restart browser-service for changes to take effect."
    else
        echo "No profile found at: $PROFILE_DIR"
        echo "And no Docker container running."
    fi
fi
