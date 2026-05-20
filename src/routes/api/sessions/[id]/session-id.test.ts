import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, DELETE } from './+server';
import * as storage from '$lib/server/storage';
import * as browser from '$lib/server/browser';
import type { AnnotationSession } from '$lib/types';

vi.mock('$lib/server/storage');
vi.mock('$lib/server/browser');

const mockSession: AnnotationSession = {
	id: 'session-1',
	url: 'https://example.com',
	prompt: 'Test prompt',
	plan: 'Test plan',
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
			params: { id: 'session-1' }
		} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.session).toEqual(mockSession);
		expect(data.viewport).toEqual({ width: 1280, height: 800 });
	});

	it('returns 404 when session not found', async () => {
		vi.mocked(storage.getSession).mockResolvedValue(null);

		const response = await GET({
			params: { id: 'non-existent' }
		} as Parameters<typeof GET>[0]);
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
