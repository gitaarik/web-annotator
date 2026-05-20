import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshScreenshot, getViewport, getCurrentUrl, getActiveTabId } from '$lib/server/browser';
import { badRequest, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';

/**
 * GET: Lightweight endpoint to check current browser URL (for polling)
 */
export const GET: RequestHandler = async () => {
	try {
		const tabId = getActiveTabId();
		if (!tabId) {
			return json({ url: null, tabId: null });
		}
		const url = await getCurrentUrl(tabId);
		return json({ url, tabId });
	} catch {
		return json({ url: null, tabId: null });
	}
};

/**
 * POST: Refresh screenshot and return current state
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const { tabId } = await request.json();

	if (!tabId) {
		return badRequest('tabId is required');
	}

	try {
		const screenshotPath = await refreshScreenshot(tabId, params.id);
		const viewport = getViewport();
		const currentUrl = await getCurrentUrl(tabId);

		return json({ screenshotPath, viewport, tabId, currentUrl });
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to refresh screenshot'));
	}
};
