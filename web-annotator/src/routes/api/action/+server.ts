import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { executeClick, executeScroll, executeType, executeWait, getCurrentUrl } from '$lib/server/browser';
import { addAction, getSession } from '$lib/server/storage';
import { badRequest, notFound, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';
import type { Action } from '$lib/types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { sessionId, actionType, explanation, coordinates, direction, text } = body;

	if (!sessionId || !actionType || !explanation) {
		return badRequest('sessionId, actionType, and explanation are required');
	}

	const session = await getSession(sessionId);
	if (!session) {
		return notFound('Session not found');
	}

	// Screenshot index: 0 is initial, so actions start at 1
	const screenshotIndex = session.actions.length + 1;

	try {
		let screenshotPath: string;

		if (actionType === 'click') {
			if (!coordinates?.x || !coordinates?.y) {
				return badRequest('Coordinates required for click action');
			}
			screenshotPath = await executeClick(coordinates.x, coordinates.y, sessionId, screenshotIndex);
		} else if (actionType === 'scroll') {
			if (!direction) {
				return badRequest('Direction required for scroll action');
			}
			screenshotPath = await executeScroll(direction, sessionId, screenshotIndex);
		} else if (actionType === 'type') {
			if (!text) {
				return badRequest('Text required for type action');
			}
			screenshotPath = await executeType(text, sessionId, screenshotIndex);
		} else if (actionType === 'wait') {
			screenshotPath = await executeWait(sessionId, screenshotIndex);
		} else if (actionType === 'stop') {
			const lastAction = session.actions[session.actions.length - 1];
			screenshotPath = lastAction?.screenshotPath ?? session.initialScreenshot;
		} else {
			return badRequest('Invalid action type');
		}

		const url = await getCurrentUrl();

		const action: Action = {
			type: actionType,
			explanation,
			timestamp: new Date().toISOString(),
			screenshotPath,
			url,
			...(actionType === 'click' && { coordinates }),
			...(actionType === 'scroll' && { direction }),
			...(actionType === 'type' && { text })
		};

		const updatedSession = await addAction(sessionId, action);

		return json({
			session: updatedSession,
			screenshotPath,
			completed: actionType === 'stop'
		});
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to execute action'));
	}
};
