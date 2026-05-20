/**
 * Extracts an error message from an unknown error value.
 * Works in both client and server contexts.
 */
export function getErrorMessage(error: unknown, fallback: string = 'An error occurred'): string {
	if (error instanceof Error) {
		return error.message;
	}
	return fallback;
}
