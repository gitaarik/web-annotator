import { json } from '@sveltejs/kit';

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
 * Extracts an error message from an unknown error.
 */
export function getServerErrorMessage(error: unknown, fallback: string = 'An error occurred'): string {
	if (error instanceof Error) {
		return error.message;
	}
	return fallback;
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
		return errorResponse(getServerErrorMessage(error, fallbackMessage));
	}
}
