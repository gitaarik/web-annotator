import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshScreenshot, getViewport } from '$lib/server/browser';
import { errorResponse, getServerErrorMessage } from '$lib/server/api-utils';

export const POST: RequestHandler = async ({ params }) => {
	try {
		const screenshotPath = await refreshScreenshot(params.id);
		const viewport = getViewport();

		return json({ screenshotPath, viewport });
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to refresh screenshot'));
	}
};
