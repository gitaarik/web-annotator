import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, apiRequest, getErrorMessage } from './api';

describe('ApiError', () => {
	it('creates an error with message and status', () => {
		const error = new ApiError('Not found', 404);
		expect(error.message).toBe('Not found');
		expect(error.status).toBe(404);
		expect(error.name).toBe('ApiError');
	});

	it('is an instance of Error', () => {
		const error = new ApiError('Server error', 500);
		expect(error).toBeInstanceOf(Error);
	});
});

describe('getErrorMessage', () => {
	it('extracts message from Error instance', () => {
		const error = new Error('Something went wrong');
		expect(getErrorMessage(error)).toBe('Something went wrong');
	});

	it('extracts message from ApiError instance', () => {
		const error = new ApiError('API failed', 500);
		expect(getErrorMessage(error)).toBe('API failed');
	});

	it('returns default message for non-Error values', () => {
		expect(getErrorMessage('string error')).toBe('An error occurred');
		expect(getErrorMessage(123)).toBe('An error occurred');
		expect(getErrorMessage(null)).toBe('An error occurred');
		expect(getErrorMessage(undefined)).toBe('An error occurred');
		expect(getErrorMessage({ custom: 'error' })).toBe('An error occurred');
	});
});

describe('apiRequest', () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', mockFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		mockFetch.mockReset();
	});

	const jsonHeaders = { get: (name: string) => name === 'content-type' ? 'application/json' : null };

	it('makes a GET request by default', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			headers: jsonHeaders,
			json: () => Promise.resolve({ data: 'test' })
		});

		const result = await apiRequest('/api/test');

		expect(mockFetch).toHaveBeenCalledWith('/api/test', {
			method: 'GET',
			headers: undefined,
			body: undefined
		});
		expect(result).toEqual({ data: 'test' });
	});

	it('makes a POST request with JSON body', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			headers: jsonHeaders,
			json: () => Promise.resolve({ id: 1 })
		});

		const result = await apiRequest('/api/create', {
			method: 'POST',
			body: { name: 'test' }
		});

		expect(mockFetch).toHaveBeenCalledWith('/api/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'test' })
		});
		expect(result).toEqual({ id: 1 });
	});

	it('throws ApiError on non-ok response with error message', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			headers: jsonHeaders,
			json: () => Promise.resolve({ error: 'Resource not found' })
		});

		try {
			await apiRequest('/api/missing');
			expect.fail('Should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			expect((error as ApiError).message).toBe('Resource not found');
			expect((error as ApiError).status).toBe(404);
		}
	});

	it('throws ApiError with default message when no error in response', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			headers: jsonHeaders,
			json: () => Promise.resolve({})
		});

		await expect(apiRequest('/api/broken')).rejects.toMatchObject({
			message: 'Request failed with status 500',
			status: 500
		});
	});

	it('supports PATCH method', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			headers: jsonHeaders,
			json: () => Promise.resolve({ updated: true })
		});

		await apiRequest('/api/update', {
			method: 'PATCH',
			body: { field: 'value' }
		});

		expect(mockFetch).toHaveBeenCalledWith('/api/update', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ field: 'value' })
		});
	});

	it('supports DELETE method', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			headers: jsonHeaders,
			json: () => Promise.resolve({ deleted: true })
		});

		await apiRequest('/api/delete/1', { method: 'DELETE' });

		expect(mockFetch).toHaveBeenCalledWith('/api/delete/1', {
			method: 'DELETE',
			headers: undefined,
			body: undefined
		});
	});

	it('throws ApiError when server returns non-JSON response', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			headers: { get: () => 'text/html' },
			text: () => Promise.resolve('<!DOCTYPE html><html>Error page</html>')
		});

		await expect(apiRequest('/api/broken')).rejects.toMatchObject({
			message: 'Server error: 500 Internal Server Error',
			status: 500
		});
	});
});
