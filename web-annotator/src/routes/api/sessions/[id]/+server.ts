import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, deleteSession } from '$lib/server/storage';
import { navigateAndScreenshot, getViewport } from '$lib/server/browser';
import { notFound, badRequest, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';

export const GET: RequestHandler = async ({ params }) => {
	const session = await getSession(params.id);

	if (!session) {
		return notFound('Session not found');
	}

	return json({ session, viewport: getViewport() });
};

export const POST: RequestHandler = async ({ params }) => {
	const session = await getSession(params.id);

	if (!session) {
		return notFound('Session not found');
	}

	if (session.finalAnswer) {
		return badRequest('Session is already completed');
	}

	try {
		const screenshotPath = await navigateAndScreenshot(session.url, session.id);
		const viewport = getViewport();

		return json({ session, screenshotPath, viewport });
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to resume session'));
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const deleted = await deleteSession(params.id);

	if (!deleted) {
		return notFound('Session not found');
	}

	return json({ success: true });
};
