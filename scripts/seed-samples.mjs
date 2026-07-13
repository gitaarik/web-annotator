#!/usr/bin/env node
/**
 * Seed the bundled sample sessions into the (gitignored) runtime directories so
 * a fresh clone has data to explore.
 *
 * Each fixture lives in `samples/<name>/` as `session.json` + `shots/*.webp`.
 * This copies the session JSON to `data/sessions/<id>.json` and its shots to
 * `static/screenshots/<id>/` — the exact paths the app reads from. The session
 * JSON already references `/screenshots/<id>/<file>.webp`, so nothing is rewritten.
 *
 * Idempotent: a session that already exists is left untouched, so it never
 * clobbers your own recordings. Runs automatically before `pnpm dev`; run it by
 * hand any time with `pnpm seed`.
 */
import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samplesDir = path.join(root, 'samples');

if (!existsSync(samplesDir)) {
	console.log('[seed] no samples/ directory — nothing to seed');
	process.exit(0);
}

let seeded = 0;
let skipped = 0;

for (const name of readdirSync(samplesDir)) {
	try {
		const dir = path.join(samplesDir, name);
		const sessionFile = path.join(dir, 'session.json');
		if (!existsSync(sessionFile)) continue;

		const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
		const id = session.id;
		if (!id) {
			console.warn(`[seed] ${name}: session.json has no id — skipping`);
			continue;
		}

		const destSession = path.join(root, 'data', 'sessions', `${id}.json`);
		if (existsSync(destSession)) {
			skipped++;
			continue; // already present — never overwrite user data
		}

		// Copy the shots into static/screenshots/<id>/.
		const shotsDir = path.join(dir, 'shots');
		const destShotsDir = path.join(root, 'static', 'screenshots', id);
		mkdirSync(destShotsDir, { recursive: true });
		if (existsSync(shotsDir)) {
			for (const shot of readdirSync(shotsDir)) {
				copyFileSync(path.join(shotsDir, shot), path.join(destShotsDir, shot));
			}
		}

		// Copy the session JSON last, so a session only appears once its shots exist.
		mkdirSync(path.dirname(destSession), { recursive: true });
		copyFileSync(sessionFile, destSession);
		seeded++;
		console.log(`[seed] + ${name} (${id})`);
	} catch (err) {
		// One malformed fixture shouldn't block the others (or `pnpm dev`).
		console.warn(`[seed] ${name}: failed — ${err.message}`);
	}
}

console.log(`[seed] done — ${seeded} seeded, ${skipped} already present`);
