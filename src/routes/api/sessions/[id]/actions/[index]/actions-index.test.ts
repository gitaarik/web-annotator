import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE, PATCH } from './+server';
import * as storage from '$lib/server/storage';
import type { AnnotationSession } from '$lib/types';

vi.mock('$lib/server/storage');

const mockSession: AnnotationSession = {
	id: 'session-1',
	url: 'https://example.com',
	prompt: 'Test prompt',
	plan: 'Test plan',
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

describe('DELETE /api/sessions/[id]/actions/[index]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('deletes action at valid index', async () => {
		const sessionWithoutAction = { ...mockSession, actions: [] };
		vi.mocked(storage.deleteAction).mockResolvedValue(sessionWithoutAction);

		const response = await DELETE({
			params: { id: 'session-1', index: '0' }
		} as Parameters<typeof DELETE>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.session.actions).toHaveLength(0);
		expect(storage.deleteAction).toHaveBeenCalledWith('session-1', 0);
	});

	it('returns 400 for invalid index (non-numeric)', async () => {
		const response = await DELETE({
			params: { id: 'session-1', index: 'invalid' }
		} as Parameters<typeof DELETE>[0]);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Invalid action index');
	});

	it('returns 404 when session or action not found', async () => {
		vi.mocked(storage.deleteAction).mockResolvedValue(null);

		const response = await DELETE({
			params: { id: 'session-1', index: '5' }
		} as Parameters<typeof DELETE>[0]);
		const data = await response.json();

		expect(response.status).toBe(404);
		expect(data.error).toBe('Session or action not found');
	});
});

describe('PATCH /api/sessions/[id]/actions/[index]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('updates action at valid index', async () => {
		const updatedSession = {
			...mockSession,
			actions: [
				{
					...mockSession.actions[0],
					explanation: 'Updated explanation'
				}
			]
		};
		vi.mocked(storage.updateAction).mockResolvedValue(updatedSession);

		const mockRequest = {
			json: () => Promise.resolve({ explanation: 'Updated explanation' })
		} as Request;

		const response = await PATCH({
			params: { id: 'session-1', index: '0' },
			request: mockRequest
		} as Parameters<typeof PATCH>[0]);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.session.actions[0].explanation).toBe('Updated explanation');
		expect(storage.updateAction).toHaveBeenCalledWith('session-1', 0, { explanation: 'Updated explanation' });
	});

	it('returns 400 for invalid index (non-numeric)', async () => {
		const mockRequest = {
			json: () => Promise.resolve({ explanation: 'test' })
		} as Request;

		const response = await PATCH({
			params: { id: 'session-1', index: 'invalid' },
			request: mockRequest
		} as Parameters<typeof PATCH>[0]);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Invalid action index');
	});

	it('returns 400 for null action data', async () => {
		const mockRequest = {
			json: () => Promise.resolve(null)
		} as Request;

		const response = await PATCH({
			params: { id: 'session-1', index: '0' },
			request: mockRequest
		} as Parameters<typeof PATCH>[0]);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Action data is required');
	});

	it('returns 400 for non-object action data', async () => {
		const mockRequest = {
			json: () => Promise.resolve('string-data')
		} as Request;

		const response = await PATCH({
			params: { id: 'session-1', index: '0' },
			request: mockRequest
		} as Parameters<typeof PATCH>[0]);
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Action data is required');
	});

	it('returns 404 when session or action not found', async () => {
		vi.mocked(storage.updateAction).mockResolvedValue(null);

		const mockRequest = {
			json: () => Promise.resolve({ explanation: 'test' })
		} as Request;

		const response = await PATCH({
			params: { id: 'session-1', index: '10' },
			request: mockRequest
		} as Parameters<typeof PATCH>[0]);
		const data = await response.json();

		expect(response.status).toBe(404);
		expect(data.error).toBe('Session or action not found');
	});
});
