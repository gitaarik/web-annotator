# web-annotator Docker image
# SvelteKit app for recording and annotating browser sessions

FROM node:22-bookworm-slim

# Create non-root user
RUN useradd -m -s /bin/bash webapp

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./
COPY package-lock.json ./

# Copy browser-service package.json for workspace resolution
COPY browser-service/package.json ./browser-service/

# Install dependencies
RUN npm ci

# Copy source code (excluding browser-service which runs separately)
COPY src ./src
COPY static ./static
COPY svelte.config.js ./
COPY tsconfig.json ./
COPY vite.config.ts ./

# Create data directory for sessions
RUN mkdir -p /app/data/sessions && chown -R webapp:webapp /app

# Switch to non-root user
USER webapp

# Environment variables
ENV HOST=0.0.0.0
ENV PORT=5173
# Connect to browser-service container
ENV BROWSER_SERVICE_URL=http://browser-service:3001

# Expose dev server port
EXPOSE 5173

# Run dev server (use build + preview for production)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
