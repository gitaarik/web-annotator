import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, deleteAction, deleteSession, updateAction } from '$lib/server/storage';
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

export const DELETE: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => ({}));
	const { actionIndex } = body;

	// If actionIndex is provided, delete just that action
	if (typeof actionIndex === 'number') {
		const session = await deleteAction(params.id, actionIndex);

		if (!session) {
			return json({ error: 'Session or action not found' }, { status: 404 });
		}

		return json({ session });
	}

	// Otherwise, delete the entire session
	const deleted = await deleteSession(params.id);

	if (!deleted) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	return json({ success: true });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { actionIndex, action } = await request.json();

	if (typeof actionIndex !== 'number' || !action) {
		return json({ error: 'actionIndex and action are required' }, { status: 400 });
	}

	const session = await updateAction(params.id, actionIndex, action);

	if (!session) {
		return json({ error: 'Session or action not found' }, { status: 404 });
	}

	return json({ session });
};
