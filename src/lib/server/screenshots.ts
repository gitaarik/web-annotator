import * as fs from 'fs/promises';
import * as path from 'path';
import type { AnnotationSession } from '$lib/types';

/**
 * Screenshots are stored as image files under `static/screenshots/<id>/` and
 * referenced by path (e.g. `/screenshots/<id>/action-0.webp`) in the session
 * JSON. That keeps sessions small but makes them non-portable: the JSON alone
 * has no pixels.
 *
 * These two helpers make export/import self-contained: `inlineScreenshots`
 * swaps each path for a base64 data URL (for a portable export), and
 * `materializeScreenshots` does the reverse on import — decoding data URLs back
 * to files under the new session's directory.
 */

const STATIC_DIR = path.join(process.cwd(), 'static');

const MIME_BY_EXT: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp'
};

const EXT_BY_MIME: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp'
};

/**
 * Run every screenshot reference on a session (initial, each action, each
 * redirect) through `mapper`, returning a new session with the mapped values.
 * `label` is a stable, human-readable id for the slot, used to name files.
 */
async function mapScreenshots(
	session: AnnotationSession,
	mapper: (value: string, label: string) => Promise<string>
): Promise<AnnotationSession> {
	const s: AnnotationSession = structuredClone(session);

	if (s.initialScreenshot) {
		s.initialScreenshot = await mapper(s.initialScreenshot, 'initial');
	}

	const actions = s.actions ?? [];
	for (let i = 0; i < actions.length; i++) {
		const a = actions[i];
		if (a.screenshotPath) {
			a.screenshotPath = await mapper(a.screenshotPath, `action-${i}`);
		}
		const redirects = a.redirects ?? [];
		for (let j = 0; j < redirects.length; j++) {
			if (redirects[j].screenshotPath) {
				redirects[j].screenshotPath = await mapper(
					redirects[j].screenshotPath as string,
					`action-${i}-redirect-${j}`
				);
			}
		}
	}

	return s;
}

/**
 * Export helper: replace each screenshot file path with a base64 data URL so the
 * session JSON is fully self-contained. A path whose file is missing (or a value
 * that's already inline) is left untouched — best-effort, never throws.
 */
export async function inlineScreenshots(session: AnnotationSession): Promise<AnnotationSession> {
	return mapScreenshots(session, async (value) => {
		if (value.startsWith('data:')) return value; // already inline
		try {
			const buf = await fs.readFile(path.join(STATIC_DIR, value));
			const ext = path.extname(value).slice(1).toLowerCase();
			const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
			return `data:${mime};base64,${buf.toString('base64')}`;
		} catch {
			return value; // missing file — leave the path rather than fail the export
		}
	});
}

/**
 * Import helper: decode each inline base64 data URL to a file under
 * `static/screenshots/<sessionId>/` and replace it with the served path.
 * Non-inline values (a bare path from a legacy/non-portable export) are left
 * as-is.
 */
export async function materializeScreenshots(
	session: AnnotationSession,
	sessionId: string
): Promise<AnnotationSession> {
	const dir = path.join(STATIC_DIR, 'screenshots', sessionId);
	let dirReady = false;

	return mapScreenshots(session, async (value, label) => {
		const match = /^data:(image\/[a-z+]+);base64,(.*)$/is.exec(value);
		if (!match) return value; // a path (or empty) — nothing to decode

		const ext = EXT_BY_MIME[match[1].toLowerCase()] ?? 'png';
		const filename = `${label}.${ext}`;
		if (!dirReady) {
			await fs.mkdir(dir, { recursive: true });
			dirReady = true;
		}
		await fs.writeFile(path.join(dir, filename), Buffer.from(match[2], 'base64'));
		return `/screenshots/${sessionId}/${filename}`;
	});
}
