import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/server/storage';
import { replaySingleAction, getViewport } from '$lib/server/browser';

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
		const viewport = getViewport();

		return json({
			screenshotPath,
			viewport,
			actionIndex
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to replay action';
		return json({ error: message }, { status: 500 });
	}
};
