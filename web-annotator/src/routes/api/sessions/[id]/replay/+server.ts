import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, updateAction } from '$lib/server/storage';
import { replaySingleAction, getViewport, getCurrentUrl } from '$lib/server/browser';

export const POST: RequestHandler = async ({ params, request }) => {
	const { actionIndex } = await request.json();

	if (typeof actionIndex !== 'number') {
		return json({ error: 'actionIndex is required' }, { status: 400 });
	}

	const session = await getSession(params.id);

	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	if (actionIndex < 0 || actionIndex >= session.actions.length) {
		return json({ error: 'Invalid action index' }, { status: 400 });
	}

	const action = session.actions[actionIndex];

	try {
		const screenshotPath = await replaySingleAction(action, session.id, actionIndex);
		const url = await getCurrentUrl();
		const viewport = getViewport();

		// Update the action with fresh screenshot and URL
		const updatedSession = await updateAction(params.id, actionIndex, {
			screenshotPath,
			url
		});

		return json({
			screenshotPath,
			viewport,
			actionIndex,
			session: updatedSession
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to replay action';
		return json({ error: message }, { status: 500 });
	}
};
