import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { navigateAndScreenshot, getViewport, getCurrentUrl } from '$lib/server/browser';
import { badRequest, browserErrorResponse } from '$lib/server/api-utils';

/**
 * POST: Navigate directly to a URL and return screenshot
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const { tabId, url } = await request.json();

	if (!tabId) {
		return badRequest('tabId is required');
	}

	if (!url) {
		return badRequest('url is required');
	}

	try {
		const screenshotPath = await navigateAndScreenshot(tabId, url, params.id);
		const viewport = getViewport();
		const currentUrl = await getCurrentUrl(tabId);

		return json({ screenshotPath, viewport, tabId, currentUrl });
	} catch (error) {
		return browserErrorResponse(error, 'Failed to navigate');
	}
};
