import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { v4 as uuidv4 } from 'uuid';
import { navigateAndScreenshot, getViewport } from '$lib/server/browser';
import { createSession } from '$lib/server/storage';
import { badRequest, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';

export const POST: RequestHandler = async ({ request }) => {
	const { url, prompt, plan } = await request.json();

	if (!url || !prompt || !plan) {
		return badRequest('URL, prompt, and plan are required');
	}

	const sessionId = uuidv4();

	try {
		const screenshotPath = await navigateAndScreenshot(url, sessionId);
		const session = await createSession(sessionId, url, prompt, plan, screenshotPath);
		const viewport = getViewport();

		return json({ sessionId: session.id, screenshotPath, viewport });
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to capture screenshot'));
	}
};
