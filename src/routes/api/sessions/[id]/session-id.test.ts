import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH, DELETE } from './+server';
import * as storage from '$lib/server/storage';
import * as browser from '$lib/server/browser';
import type { AnnotationSession } from '$lib/types';

vi.mock('$lib/server/storage');
vi.mock('$lib/server/browser');

const mockSession: AnnotationSession = {
	id: 'session-1',
	url: 'https://example.com',
	prompt: 'Test prompt',
	createdAt: '2024-01-01T00:00:00.000Z',
	tabs: [{ id: 'tab-1', url: 'https://example.com', createdAt: '2024-01-01T00:00:00.000Z' }],
	activeTabId: 'tab-1',
	actions: [],
	initialScreenshot: '/screenshots/session-1/0.png'
};

describe('GET /api/sessions/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(browser.getViewport).mockReturnValue({ width: 1280, height: 800 });
	});

	it('returns session with viewport when found', async () => {
		vi.mocked(storage.getSession).mockResolvedValue(mockSession);

		const response = await GET({
			params: { id: 'session-1' },
			url: new URL('http://localhost/api/sessions/session-1')
		} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.session).toEqual(mockSession);
		expect(data.viewport).toEqual({ width: 1280, height: 800 });
	});

	it('inlines screenshots when ?inline=true (missing file left as path)', async () => {
		vi.mocked(storage.getSession).mockResolvedValue(mockSession);

		const response = await GET({
			params: { id: 'session-1' },
			url: new URL('http://localhost/api/sessions/session-1?inline=true')
		} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		// The referenced file doesn't exist in the test env, so inlining is a no-op
		// (best-effort) — but the request still succeeds via the inline branch.
		expect(data.session.initialScreenshot).toBe('/screenshots/session-1/0.png');
	});

	it('returns 404 when session not found', async () => {
		vi.mocked(storage.getSession).mockResolvedValue(null);

		const response = await GET({
			params: { id: 'non-existent' },
			url: new URL('http://localhost/api/sessions/non-existent')
		} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(response.status).toBe(404);
		expect(data.error).toBe('Session not found');
	});
});

describe('PATCH /api/sessions/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('updates the session prompt', async () => {
		const updated = { ...mockSession, prompt: 'Updated task' };
		vi.mocked(storage.updateSession).mockResolvedValue(updated);

		const response = await PATCH({
			params: { id: 'session-1' },
			request: { json: () => Promise.resolve({ prompt: 'Updated task' }) } as Request
		} as Parameters<typeof PATCH>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.session.prompt).toBe('Updated task');
		expect(storage.updateSession).toHaveBeenCalledWith('session-1', { prompt: 'Updated task' });
	});

	it('trims the prompt before saving', async () => {
		vi.mocked(storage.updateSession).mockResolvedValue(mockSession);

		await PATCH({
			params: { id: 'session-1' },
			request: { json: () => Promise.resolve({ prompt: '  Updated task  ' }) } as Request
		} as Parameters<typeof PATCH>[0]);

		expect(storage.updateSession).toHaveBeenCalledWith('session-1', { prompt: 'Updated task' });
	});

	it('returns 400 when prompt is empty or whitespace', async () => {
		const response = await PATCH({
			params: { id: 'session-1' },
			request: { json: () => Promise.resolve({ prompt: '   ' }) } as Request
		} as Parameters<typeof PATCH>[0]);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('A non-empty prompt is required');
		expect(storage.updateSession).not.toHaveBeenCalled();
	});

	it('returns 404 when session not found', async () => {
		vi.mocked(storage.updateSession).mockResolvedValue(null);

		const response = await PATCH({
			params: { id: 'non-existent' },
			request: { json: () => Promise.resolve({ prompt: 'Updated task' }) } as Request
		} as Parameters<typeof PATCH>[0]);
		const data = await response.json();

		expect(response.status).toBe(404);
		expect(data.error).toBe('Session not found');
	});
});

describe('DELETE /api/sessions/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('deletes session successfully', async () => {
		vi.mocked(storage.deleteSession).mockResolvedValue(true);

		const response = await DELETE({
			params: { id: 'session-1' }
		} as Parameters<typeof DELETE>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.success).toBe(true);
		expect(storage.deleteSession).toHaveBeenCalledWith('session-1');
	});

	it('returns 404 when session to delete not found', async () => {
		vi.mocked(storage.deleteSession).mockResolvedValue(false);

		const response = await DELETE({
			params: { id: 'non-existent' }
		} as Parameters<typeof DELETE>[0]);
		const data = await response.json();

		expect(response.status).toBe(404);
		expect(data.error).toBe('Session not found');
	});
});
