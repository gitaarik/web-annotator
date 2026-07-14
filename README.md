# Web Annotator

[![CI](https://github.com/gitaarik/web-annotator/actions/workflows/ci.yml/badge.svg)](https://github.com/gitaarik/web-annotator/actions/workflows/ci.yml)

A tool for recording and annotating browser sessions to produce training data for AI models that navigate the web.

## Quick Start

Bring up both services (browser + app) in Docker:

```bash
docker compose up    # or: npm run docker:up (detached)
```

Then open http://localhost:5173

You can also view the browser directly at http://localhost:6080/vnc.html (noVNC).

### Local development

To run the app on the host (hot reload straight from your editor) with only the
browser service in Docker:

```bash
npm install
npm run docker:browser  # browser service only (docker compose up browser-service)
npm run dev             # app dev server on the host
```

### Sample sessions

The repo ships with a couple of example sessions in `samples/` so a fresh clone
has something to explore. They're seeded into the (gitignored) runtime
directories automatically before `npm run dev`; you can also run it by hand:

```bash
npm run seed
```

Seeding is idempotent — it never overwrites a session you already have, so it's
safe to run any time. To add your own sample, export a session, drop it into
`samples/<name>/` as `session.json` alongside a `shots/` folder of the images it
references, and re-run `npm run seed`.

## What It Does

An annotator enters a URL and a task prompt, then records step-by-step actions showing how to accomplish that task. Each action includes an explanation of what they're doing and why. The result is exportable training data for AI web agents.

## Features

- **Session management**: Create, list, continue, and export sessions
- **Live browser control**: Real Chromium instance via Playwright
- **Actions**: Click, hover, scroll, type, wait, stop, plus tab management (new/switch/close)
- **Visual feedback**: Click/hover markers, scroll indicators, type preview on screenshots
- **Action history**: Step through past actions, see screenshots at each step
- **JSON export**: Full session data with screenshots and action sequences

## Tech Stack

- SvelteKit + Svelte 5 (runes)
- Playwright for browser automation
- Vitest for testing

## Project Structure

- `src/routes/` - Pages (home, session viewer)
- `src/routes/api/` - API endpoints for browser control
- `src/lib/components/` - UI components
- `src/lib/server/` - Server-side browser management
- `samples/` - Bundled example sessions (seeded into place by `npm run seed`)
- `scripts/seed-samples.mjs` - Copies `samples/` into the runtime dirs
- `data/sessions/` - Saved session JSON files (gitignored)
- `static/screenshots/` - Screenshot image files (gitignored)
