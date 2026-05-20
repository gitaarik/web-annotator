import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { executeClick, executeScroll, executeType, executeWait, getCurrentUrl } from '$lib/server/browser';
import { addAction, getSession } from '$lib/server/storage';
import type { Action } from '$lib/types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { sessionId, actionType, explanation, coordinates, direction, text } = body;

	if (!sessionId || !actionType || !explanation) {
		return json({ error: 'sessionId, actionType, and explanation are required' }, { status: 400 });
	}

	const session = await getSession(sessionId);
	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	// Screenshot index: 0 is initial, so actions start at 1
	const screenshotIndex = session.actions.length + 1;

	try {
		let screenshotPath: string;

		if (actionType === 'click') {
			if (!coordinates?.x || !coordinates?.y) {
				return json({ error: 'Coordinates required for click action' }, { status: 400 });
			}
			screenshotPath = await executeClick(coordinates.x, coordinates.y, sessionId, screenshotIndex);
		} else if (actionType === 'scroll') {
			if (!direction) {
				return json({ error: 'Direction required for scroll action' }, { status: 400 });
			}
			screenshotPath = await executeScroll(direction, sessionId, screenshotIndex);
		} else if (actionType === 'type') {
			if (!text) {
				return json({ error: 'Text required for type action' }, { status: 400 });
			}
			screenshotPath = await executeType(text, sessionId, screenshotIndex);
		} else if (actionType === 'wait') {
			screenshotPath = await executeWait(sessionId, screenshotIndex);
		} else if (actionType === 'stop') {
			// For stop, use the last screenshot (either from last action or initial)
			const lastAction = session.actions[session.actions.length - 1];
			screenshotPath = lastAction?.screenshotPath ?? session.initialScreenshot;
		} else {
			return json({ error: 'Invalid action type' }, { status: 400 });
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
		const message = error instanceof Error ? error.message : 'Failed to execute action';
		return json({ error: message }, { status: 500 });
	}
};
