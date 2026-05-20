import { json } from '@sveltejs/kit';
import { getErrorMessage } from '$lib/utils/error';

// Re-export for convenience (aliased to maintain API compatibility)
export { getErrorMessage as getServerErrorMessage } from '$lib/utils/error';

/**
 * Creates a standardized error response.
 */
export function errorResponse(message: string, status: number = 500) {
	return json({ error: message }, { status });
}

/**
 * Creates a 400 Bad Request response.
 */
export function badRequest(message: string) {
	return errorResponse(message, 400);
}

/**
 * Creates a 404 Not Found response.
 */
export function notFound(message: string = 'Not found') {
	return errorResponse(message, 404);
}

/**
 * Wraps an async handler with standardized error handling.
 */
export async function withErrorHandling<T>(
	operation: () => Promise<T>,
	fallbackMessage: string = 'An error occurred'
): Promise<T | Response> {
	try {
		return await operation();
	} catch (error) {
		return errorResponse(getErrorMessage(error, fallbackMessage));
	}
}
