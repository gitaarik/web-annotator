import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshScreenshot, getViewport } from '$lib/server/browser';
import { badRequest, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';

export const POST: RequestHandler = async ({ params, request }) => {
	const { tabId } = await request.json();

	if (!tabId) {
		return badRequest('tabId is required');
	}

	try {
		const screenshotPath = await refreshScreenshot(tabId, params.id);
		const viewport = getViewport();

		return json({ screenshotPath, viewport, tabId });
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to refresh screenshot'));
	}
};
