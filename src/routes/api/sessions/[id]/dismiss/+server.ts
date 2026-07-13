import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { executeDismiss } from '$lib/server/browser';
import { getSession } from '$lib/server/storage';
import { badRequest, notFound, browserErrorResponse } from '$lib/server/api-utils';

/**
 * POST: dismiss a popup/overlay by clicking at the given coordinates. Clears the
 * obstruction in the live browser so recording can continue — it is not recorded
 * as a task step and leaves no trace in the session.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	let body: { tabId?: string; coordinates?: { x: number; y: number } };
	try {
		body = await request.json();
	} catch {
		return badRequest('Invalid JSON');
	}

	const { tabId, coordinates } = body;
	if (!tabId) return badRequest('tabId is required');
	if (coordinates?.x == null || coordinates?.y == null) {
		return badRequest('coordinates are required');
	}

	const session = await getSession(params.id);
	if (!session) return notFound('Session not found');

	try {
		const result = await executeDismiss(tabId, coordinates.x, coordinates.y, params.id, Date.now());

		return json({
			screenshotPath: result.afterScreenshot,
			currentUrl: result.afterUrl,
			tabId
		});
	} catch (error) {
		return browserErrorResponse(error, 'Failed to dismiss popup');
	}
};
