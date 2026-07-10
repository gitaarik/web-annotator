import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setReplayPosition } from '$lib/server/browser';
import { badRequest, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';

/**
 * POST: Persist the annotator playhead (replayedUpTo) for the session's Chrome
 * instance. Survives a page reload (reconnect) but resets when Chrome restarts.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { tabId, position } = await request.json();

	if (!tabId) {
		return badRequest('tabId is required');
	}
	if (typeof position !== 'number' || !Number.isInteger(position)) {
		return badRequest('Integer position is required');
	}

	try {
		await setReplayPosition(tabId, position);
		return json({ success: true });
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to persist playhead'));
	}
};
