import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/storage';
import { restartBrowser, getViewport, refreshScreenshot } from '$lib/server/browser';
import { notFound, badRequest, browserErrorResponse } from '$lib/server/api-utils';

// Deliberate restart: relaunch Chrome clean at the session's original start URL
// and reset the playhead to the start. Recorded steps are preserved — only the
// live browser and the "current step" marker are reset, so the operator can
// re-walk the session from the top. This is the user-triggered counterpart to
// the automatic wedge recovery in the resume (POST /api/sessions/[id]) path.
export const POST: RequestHandler = async ({ params }) => {
	const session = await getSession(params.id);

	if (!session) {
		return notFound('Session not found');
	}

	if (session.finalAnswer) {
		return badRequest('Session is already completed');
	}

	try {
		const { tabId, url, replayPosition } = await restartBrowser(session.url, session.id);
		const screenshotPath = await refreshScreenshot(tabId, session.id);
		const viewport = getViewport();

		return json({
			session,
			screenshotPath,
			viewport,
			tabId,
			currentUrl: url,
			replayPosition,
			tabs: session.tabs
		});
	} catch (error) {
		return browserErrorResponse(error, 'Failed to restart session');
	}
};
