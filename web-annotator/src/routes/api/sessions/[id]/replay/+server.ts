import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, updateAction } from '$lib/server/storage';
import { replaySingleAction, getViewport, getCurrentUrl } from '$lib/server/browser';
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
		const screenshotPath = await replaySingleAction(tabId, action, session.id, actionIndex);
		const url = getCurrentUrl(tabId);
		const viewport = getViewport();

		const updatedSession = await updateAction(params.id, actionIndex, {
			screenshotPath,
			url
		});

		return json({ screenshotPath, viewport, actionIndex, session: updatedSession, tabId });
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to replay action'));
	}
};
