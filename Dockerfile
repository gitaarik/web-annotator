# web-annotator dev image
# SvelteKit app for recording and annotating browser sessions.
# Runs `vite dev` with the host's source bind-mounted for hot reload
# (see the `web` service in docker-compose.yml).

FROM node:22-bookworm-slim

# Create non-root user
RUN useradd -m -s /bin/bash webapp

WORKDIR /app

# Install dependencies first for better layer caching.
# No lockfile is committed, and npm workspaces needs the workspace
# package.json present to resolve, so copy it before installing.
COPY package.json ./
COPY browser-service/package.json ./browser-service/
RUN npm install

# Copy source. In dev this is overridden by bind mounts (see compose),
# but keeps the image runnable on its own.
COPY . .

# Sessions are written here; create it before the bind mount so it exists.
RUN mkdir -p /app/data/sessions && chown -R webapp:webapp /app

USER webapp

ENV HOST=0.0.0.0
ENV PORT=5173

EXPOSE 5173

# Dev server. Connects to the browser-service container via BROWSER_SERVICE_URL
# (set in docker-compose.yml).
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
