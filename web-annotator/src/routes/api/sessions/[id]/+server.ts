import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/storage';
import { navigateAndScreenshot, getViewport } from '$lib/server/browser';

export const GET: RequestHandler = async ({ params }) => {
	const session = await getSession(params.id);

	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	return json({ session, viewport: getViewport() });
};

export const POST: RequestHandler = async ({ params }) => {
	// Resume session: navigate to URL and return fresh screenshot + session data
	const session = await getSession(params.id);

	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	if (session.finalAnswer) {
		return json({ error: 'Session is already completed' }, { status: 400 });
	}

	try {
		// Navigate to URL to restore browser state
		const screenshotPath = await navigateAndScreenshot(session.url, session.id);
		const viewport = getViewport();

		return json({
			session,
			screenshotPath,
			viewport
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to resume session';
		return json({ error: message }, { status: 500 });
	}
};
