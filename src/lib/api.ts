/**
 * API request utility for standardized fetch patterns
 */

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
		this.name = 'ApiError';
	}
}

interface ApiRequestOptions<T> {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	body?: unknown;
	onSuccess?: (data: T) => void;
}

/**
 * Makes an API request with standardized error handling.
 * Returns the JSON response data or throws an ApiError.
 */
export async function apiRequest<T>(
	url: string,
	options: ApiRequestOptions<T> = {}
): Promise<T> {
	const { method = 'GET', body } = options;

	const fetchOptions: RequestInit = {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined
	};

	const response = await fetch(url, fetchOptions);
	const data = await response.json();

	if (!response.ok) {
		throw new ApiError(data.error || `Request failed with status ${response.status}`, response.status);
	}

	return data as T;
}

/**
 * Extracts an error message from an unknown error.
 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return 'An error occurred';
}
