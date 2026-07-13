import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AnnotationSession } from '$lib/types';
import { inlineScreenshots, materializeScreenshots } from './screenshots';

const STATIC = path.join(process.cwd(), 'static');
const cleanup: string[] = [];

afterEach(async () => {
	while (cleanup.length) {
		const dir = cleanup.pop()!;
		await fs.rm(dir, { recursive: true, force: true });
	}
});

function sessionWith(paths: { initial: string; action: string }): AnnotationSession {
	return {
		id: 'src',
		url: 'https://example.com',
		prompt: 'demo',
		createdAt: '2026-01-01T00:00:00.000Z',
		tabs: [],
		activeTabId: 't1',
		initialScreenshot: paths.initial,
		actions: [
			{
				type: 'click',
				tabId: 't1',
				explanation: 'x',
				timestamp: '2026-01-01T00:00:00.000Z',
				coordinates: { x: 1, y: 2 },
				screenshotPath: paths.action,
				url: 'https://example.com'
			}
		]
	} as AnnotationSession;
}

describe('screenshots inline/materialize', () => {
	it('round-trips file paths → base64 → files with bytes intact', async () => {
		const srcId = `test-src-${Date.now()}`;
		const srcDir = path.join(STATIC, 'screenshots', srcId);
		cleanup.push(srcDir);
		await fs.mkdir(srcDir, { recursive: true });

		const initialBytes = Buffer.from('initial-image-bytes');
		const actionBytes = Buffer.from('action-image-bytes');
		await fs.writeFile(path.join(srcDir, 'initial.png'), initialBytes);
		await fs.writeFile(path.join(srcDir, 'shot.webp'), actionBytes);

		const session = sessionWith({
			initial: `/screenshots/${srcId}/initial.png`,
			action: `/screenshots/${srcId}/shot.webp`
		});

		// Inline: paths become base64 data URLs with the right mime.
		const inlined = await inlineScreenshots(session);
		expect(inlined.initialScreenshot.startsWith('data:image/png;base64,')).toBe(true);
		expect(inlined.actions[0].screenshotPath!.startsWith('data:image/webp;base64,')).toBe(true);

		// Materialize into a fresh session dir.
		const dstId = `test-dst-${Date.now()}`;
		cleanup.push(path.join(STATIC, 'screenshots', dstId));
		const restored = await materializeScreenshots(inlined, dstId);

		// Paths point at the new session, and the bytes survived the round-trip.
		expect(restored.initialScreenshot).toBe(`/screenshots/${dstId}/initial.png`);
		expect(restored.actions[0].screenshotPath).toBe(`/screenshots/${dstId}/action-0.webp`);
		expect(await fs.readFile(path.join(STATIC, restored.initialScreenshot))).toEqual(initialBytes);
		expect(await fs.readFile(path.join(STATIC, restored.actions[0].screenshotPath!))).toEqual(
			actionBytes
		);
	});

	it('leaves a path untouched when its file is missing (best-effort export)', async () => {
		const session = sessionWith({
			initial: '/screenshots/does-not-exist/initial.png',
			action: '/screenshots/does-not-exist/shot.png'
		});
		const inlined = await inlineScreenshots(session);
		expect(inlined.initialScreenshot).toBe('/screenshots/does-not-exist/initial.png');
	});

	it('materialize leaves non-inline (path) values as-is', async () => {
		const session = sessionWith({
			initial: '/screenshots/legacy/initial.png',
			action: '/screenshots/legacy/shot.png'
		});
		const out = await materializeScreenshots(session, 'unused-id');
		expect(out.initialScreenshot).toBe('/screenshots/legacy/initial.png');
	});
});
