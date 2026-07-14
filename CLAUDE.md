# Web Annotator

A SvelteKit app for recording and annotating browser sessions using Playwright.

## Commands

```bash
npm run dev       # Start dev server
npm test          # Run tests in watch mode
npm run test:run  # Run tests once
npm run check     # Type check
```

## Structure

- `src/lib/components/` - Svelte components
- `src/lib/server/` - Server-only code (storage, browser control, config)
- `src/lib/types.ts` - Shared types (Action, AnnotationSession, Tab)
- `src/routes/api/` - API endpoints
- `src/routes/session/[id]/` - Session viewer page
- `browser-service/` - Standalone browser-control service (Chrome + OS-level input via HTTP API); the app talks to it over `BROWSER_SERVICE_URL`
- `samples/` - Bundled example sessions (`<name>/session.json` + `shots/*.webp`); `scripts/seed-samples.mjs` copies them into the runtime dirs, and `predev`/`npm run seed` run it (idempotent)
- `data/sessions/` - Session JSON files (gitignored)

## Key Concepts

- **Session**: A recorded browser interaction with a URL, prompt, plan, and list of actions
- **Action**: A user action (click, scroll, type, wait, stop, newTab, switchTab, closeTab) with screenshot and explanation
- **Tab**: Browser tabs within a session, tracked with open/closed state

## Tech Stack

- Svelte 5 with runes (`$state`, `$derived`, `$effect`)
- SvelteKit for routing and API
- Playwright for browser automation
- Vitest for testing (tests colocated as `*.test.ts`)

## Patterns

- API routes return `{ success: true, data }` or `{ success: false, error }`
- Screenshots are stored as image files under `static/screenshots/<id>/` and referenced by path in the session JSON. Export inlines them as base64 data URLs (`?inline=true`) so the file is portable; import decodes them back to files (see `src/lib/server/screenshots.ts`)
- Tests use vitest with `vi.mock()` for mocking modules
