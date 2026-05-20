import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createTab, refreshScreenshot, getViewport } from '$lib/server/browser';
import { createSession } from '$lib/server/storage';
import { badRequest, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';

export const POST: RequestHandler = async ({ request }) => {
	let body: { url?: string; prompt?: string; plan?: string };
	try {
		body = await request.json();
	} catch {
		return badRequest('Invalid JSON');
	}

	const { url, prompt, plan } = body;

	if (!url || !prompt || !plan) {
		return badRequest('URL, prompt, and plan are required');
	}

	const sessionId = crypto.randomUUID();

	try {
		// Create a new tab and navigate to the URL
		// Pass sessionId so browser-service uses the same Chrome for this session
		const { tabId } = await createTab(url, sessionId);
		// Capture initial screenshot (createTab already navigated and waited for stability)
		const screenshotPath = await refreshScreenshot(tabId, sessionId);
		const session = await createSession(sessionId, url, prompt, plan, screenshotPath, tabId);
		const viewport = getViewport();

		return json({
			sessionId: session.id,
			screenshotPath,
			viewport,
			tabId,
			tabs: session.tabs
		});
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to capture screenshot'));
	}
};
