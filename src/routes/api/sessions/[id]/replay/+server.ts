import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, updateAction } from '$lib/server/storage';
import { replaySingleAction, getViewport } from '$lib/server/browser';
import { badRequest, notFound, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';

export const POST: RequestHandler = async ({ params, request }) => {
	const { actionIndex, tabId } = await request.json();

	if (typeof actionIndex !== 'number') {
		return badRequest('actionIndex is required');
	}

	if (!tabId) {
		return badRequest('tabId is required');
	}

	const session = await getSession(params.id);

	if (!session) {
		return notFound('Session not found');
	}

	if (actionIndex < 0 || actionIndex >= session.actions.length) {
		return badRequest('Invalid action index');
	}

	const action = session.actions[actionIndex];

	try {
		const result = await replaySingleAction(tabId, action, session.id, actionIndex);
		const viewport = getViewport();

		// Update action with screenshots, URLs, and redirects
		const updatedSession = await updateAction(params.id, actionIndex, {
			screenshotPath: result.beforeScreenshot,
			url: result.beforeUrl,
			...(result.afterUrl !== result.beforeUrl && { afterUrl: result.afterUrl }),
			...(result.redirects?.length && { redirects: result.redirects })
		});

		// Return AFTER screenshot for UI display
		return json({
			screenshotPath: result.afterScreenshot,
			currentUrl: result.afterUrl,
			viewport,
			actionIndex,
			session: updatedSession,
			tabId,
			redirects: result.redirects
		});
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to replay action'));
	}
};
