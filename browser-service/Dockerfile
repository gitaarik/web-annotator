# browser-service Docker image
# Runs Chrome in headed mode with Xvfb (virtual display)
# so it doesn't interfere with the host desktop

FROM node:22-bookworm-slim

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chromium browser
    chromium \
    # Virtual framebuffer for headed browser without real display
    xvfb \
    # OS-level input injection (keyboard/mouse events)
    xdotool \
    # X11 utilities for window management
    x11-utils \
    # Fonts for proper text rendering
    fonts-liberation \
    fonts-noto-color-emoji \
    # For healthcheck
    curl \
    # Clean up apt cache
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash appuser

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code and entrypoint
COPY . .
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directories and set permissions
RUN mkdir -p /home/appuser/.browser-service && chown -R appuser:appuser /home/appuser /app

# Switch to non-root user
USER appuser

# Set environment variables
ENV DISPLAY=:99
ENV HOST=0.0.0.0
ENV PORT=3001
# Point to Chromium installed via apt
ENV CHROME_PATH=/usr/bin/chromium
# Enable container-specific Chrome flags (--no-sandbox, --disable-dev-shm-usage)
ENV CHROME_NO_SANDBOX=true

# Expose the API port
EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
