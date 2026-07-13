# Web Annotator

A tool for recording and annotating browser sessions to produce training data for AI models that navigate the web.

## Quick Start

```bash
pnpm install
pnpm docker:browser  # Start the browser service (in one terminal)
pnpm dev             # Start the dev server (in another terminal)
```

Then open http://localhost:5173

You can also view the browser directly at http://localhost:6080/vnc.html (noVNC).

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
- `data/sessions/` - Saved session JSON files (gitignored)
