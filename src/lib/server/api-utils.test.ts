import { describe, it, expect } from 'vitest';
import { errorResponse, badRequest, notFound, getServerErrorMessage, withErrorHandling } from './api-utils';

describe('errorResponse', () => {
	it('creates a JSON response with error message and status', async () => {
		const response = errorResponse('Something went wrong', 500);
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body).toEqual({ error: 'Something went wrong' });
	});

	it('defaults to status 500 when not specified', async () => {
		const response = errorResponse('Internal error');

		expect(response.status).toBe(500);
	});

	it('supports custom status codes', async () => {
		const response = errorResponse('Unauthorized', 401);

		expect(response.status).toBe(401);
	});
});

describe('badRequest', () => {
	it('creates a 400 error response', async () => {
		const response = badRequest('Invalid input');
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ error: 'Invalid input' });
	});
});

describe('notFound', () => {
	it('creates a 404 error response with custom message', async () => {
		const response = notFound('User not found');
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body).toEqual({ error: 'User not found' });
	});

	it('uses default message when not specified', async () => {
		const response = notFound();
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body).toEqual({ error: 'Not found' });
	});
});

describe('getServerErrorMessage', () => {
	it('extracts message from Error instance', () => {
		const error = new Error('Database connection failed');
		expect(getServerErrorMessage(error)).toBe('Database connection failed');
	});

	it('returns fallback for non-Error values', () => {
		expect(getServerErrorMessage('string')).toBe('An error occurred');
		expect(getServerErrorMessage(null)).toBe('An error occurred');
		expect(getServerErrorMessage(undefined)).toBe('An error occurred');
	});

	it('uses custom fallback message', () => {
		expect(getServerErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
		expect(getServerErrorMessage({}, 'Unknown error')).toBe('Unknown error');
	});
});

describe('withErrorHandling', () => {
	it('returns the result of successful operation', async () => {
		const result = await withErrorHandling(async () => ({ data: 'success' }));
		expect(result).toEqual({ data: 'success' });
	});

	it('returns error response when operation throws Error', async () => {
		const result = await withErrorHandling(async () => {
			throw new Error('Operation failed');
		});

		expect(result).toBeInstanceOf(Response);
		const body = await (result as Response).json();
		expect(body).toEqual({ error: 'Operation failed' });
	});

	it('uses fallback message for non-Error exceptions', async () => {
		const result = await withErrorHandling(
			async () => {
				throw 'string error';
			},
			'Something went wrong'
		);

		expect(result).toBeInstanceOf(Response);
		const body = await (result as Response).json();
		expect(body).toEqual({ error: 'Something went wrong' });
	});

	it('uses default fallback message', async () => {
		const result = await withErrorHandling(async () => {
			throw null;
		});

		expect(result).toBeInstanceOf(Response);
		const body = await (result as Response).json();
		expect(body).toEqual({ error: 'An error occurred' });
	});
});
