import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import type { Action, AnnotationSession } from '$lib/types';

// In-memory filesystem: readFile serves seeded sessions, writeFile captures what
// addAction persists so we can assert on the resulting action order.
const files = new Map<string, string>();

vi.mock('fs/promises', () => ({
	readFile: vi.fn(async (p: string) => {
		if (files.has(p)) return files.get(p)!;
		throw new Error('ENOENT');
	}),
	writeFile: vi.fn(async (p: string, data: string) => {
		files.set(p, data);
	}),
	mkdir: vi.fn(async () => undefined)
}));

import { addAction } from './storage';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const SESSION_PATH = path.join(process.cwd(), 'data', 'sessions', `${SESSION_ID}.json`);

function makeAction(explanation: string): Action {
	return {
		type: 'click',
		tabId: 'tab-1',
		explanation,
		timestamp: '2026-01-01T00:00:00.000Z',
		screenshotPath: '/screenshots/x.png',
		url: 'https://example.com'
	};
}

function seed(explanations: string[]) {
	const session: AnnotationSession = {
		id: SESSION_ID,
		url: 'https://example.com',
		prompt: 'test',
		createdAt: '2026-01-01T00:00:00.000Z',
		tabs: [],
		activeTabId: 'tab-1',
		actions: explanations.map(makeAction),
		initialScreenshot: '/screenshots/init.png'
	};
	files.set(SESSION_PATH, JSON.stringify(session));
}

function persistedActions(): string[] {
	const raw = files.get(SESSION_PATH)!;
	return (JSON.parse(raw) as AnnotationSession).actions.map((a) => a.explanation);
}

describe('addAction insertIndex', () => {
	beforeEach(() => files.clear());

	it('appends when no insertIndex is given', async () => {
		seed(['a', 'b', 'c']);
		await addAction(SESSION_ID, makeAction('new'));
		expect(persistedActions()).toEqual(['a', 'b', 'c', 'new']);
	});

	it('inserts at a middle index, shifting later steps down', async () => {
		seed(['a', 'b', 'c']);
		await addAction(SESSION_ID, makeAction('new'), 1);
		expect(persistedActions()).toEqual(['a', 'new', 'b', 'c']);
	});

	it('inserts at the start for index 0', async () => {
		seed(['a', 'b']);
		await addAction(SESSION_ID, makeAction('new'), 0);
		expect(persistedActions()).toEqual(['new', 'a', 'b']);
	});

	it('appends when insertIndex is at the end (== length)', async () => {
		seed(['a', 'b']);
		await addAction(SESSION_ID, makeAction('new'), 2);
		expect(persistedActions()).toEqual(['a', 'b', 'new']);
	});

	it('appends when insertIndex is past the end', async () => {
		seed(['a', 'b']);
		await addAction(SESSION_ID, makeAction('new'), 99);
		expect(persistedActions()).toEqual(['a', 'b', 'new']);
	});
});
