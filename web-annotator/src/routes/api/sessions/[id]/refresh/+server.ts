import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshScreenshot, getViewport } from '$lib/server/browser';

export const POST: RequestHandler = async ({ params }) => {
	try {
		const screenshotPath = await refreshScreenshot(params.id);
		const viewport = getViewport();

		return json({ screenshotPath, viewport });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to refresh screenshot';
		return json({ error: message }, { status: 500 });
	}
};
