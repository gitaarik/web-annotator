/**
 * API request utility for standardized fetch patterns
 */

export { getErrorMessage } from './utils/error';

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

	let data: unknown;
	const contentType = response.headers.get('content-type');
	if (contentType?.includes('application/json')) {
		data = await response.json();
	} else {
		// Server returned non-JSON (likely an error page)
		await response.text(); // consume body
		throw new ApiError(
			`Server error: ${response.status} ${response.statusText}`,
			response.status
		);
	}

	if (!response.ok) {
		const errorData = data as { error?: string };
		throw new ApiError(errorData.error || `Request failed with status ${response.status}`, response.status);
	}

	return data as T;
}
