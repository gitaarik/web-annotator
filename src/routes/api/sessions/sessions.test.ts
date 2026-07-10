import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import * as storage from '$lib/server/storage';
import type { AnnotationSession } from '$lib/types';

vi.mock('$lib/server/storage');

const mockSession: AnnotationSession = {
	id: 'session-1',
	url: 'https://example.com',
	prompt: 'Test prompt',
	createdAt: '2024-01-01T00:00:00.000Z',
	tabs: [{ id: 'tab-1', url: 'https://example.com', createdAt: '2024-01-01T00:00:00.000Z' }],
	activeTabId: 'tab-1',
	actions: [
		{
			type: 'click',
			tabId: 'tab-1',
			coordinates: { x: 100, y: 200 },
			explanation: 'Clicked button',
			timestamp: '2024-01-01T00:00:01.000Z',
			screenshotPath: '/screenshots/session-1/1.png',
			url: 'https://example.com'
		}
	],
	initialScreenshot: '/screenshots/session-1/0.png'
};

const completedSession: AnnotationSession = {
	...mockSession,
	id: 'session-2',
	finalAnswer: 'Task completed'
};

describe('GET /api/sessions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a list of session summaries', async () => {
		vi.mocked(storage.listSessions).mockResolvedValue([mockSession, completedSession]);

		const response = await GET({} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data).toHaveLength(2);
		expect(data[0]).toEqual({
			id: 'session-1',
			url: 'https://example.com',
			prompt: 'Test prompt',
			createdAt: '2024-01-01T00:00:00.000Z',
			actionCount: 1,
			isCompleted: false
		});
		expect(data[1].isCompleted).toBe(true);
	});

	it('returns empty array when no sessions exist', async () => {
		vi.mocked(storage.listSessions).mockResolvedValue([]);

		const response = await GET({} as Parameters<typeof GET>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data).toEqual([]);
	});
});

describe('POST /api/sessions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('imports a valid session', async () => {
		const importedSession = { ...mockSession, id: 'new-id' };
		vi.mocked(storage.importSession).mockResolvedValue(importedSession);

		const mockRequest = {
			json: () => Promise.resolve(mockSession)
		} as Request;

		const response = await POST({ request: mockRequest } as Parameters<typeof POST>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.session.id).toBe('new-id');
		expect(data.summary.id).toBe('new-id');
		expect(data.summary.actionCount).toBe(1);
	});

	it('returns 400 for session missing URL', async () => {
		const invalidSession = { prompt: 'test', actions: [] };
		const mockRequest = {
			json: () => Promise.resolve(invalidSession)
		} as Request;

		const response = await POST({ request: mockRequest } as Parameters<typeof POST>[0]);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Invalid session data');
	});

	it('returns 400 for session missing prompt', async () => {
		const invalidSession = { url: 'https://test.com', actions: [] };
		const mockRequest = {
			json: () => Promise.resolve(invalidSession)
		} as Request;

		const response = await POST({ request: mockRequest } as Parameters<typeof POST>[0]);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Invalid session data');
	});

	it('returns 400 for session missing actions', async () => {
		const invalidSession = { url: 'https://test.com', prompt: 'test' };
		const mockRequest = {
			json: () => Promise.resolve(invalidSession)
		} as Request;

		const response = await POST({ request: mockRequest } as Parameters<typeof POST>[0]);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Invalid session data');
	});

	it('returns 500 when import fails', async () => {
		vi.mocked(storage.importSession).mockRejectedValue(new Error('Storage error'));

		const mockRequest = {
			json: () => Promise.resolve(mockSession)
		} as Request;

		const response = await POST({ request: mockRequest } as Parameters<typeof POST>[0]);
		const data = await response.json();

		expect(response.status).toBe(500);
		expect(data.error).toBe('Failed to import session');
	});
});
