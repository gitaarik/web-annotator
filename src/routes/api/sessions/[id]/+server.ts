import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, deleteSession, updateSession } from '$lib/server/storage';
import { createTab, getViewport, refreshScreenshot } from '$lib/server/browser';
import { notFound, badRequest, browserErrorResponse } from '$lib/server/api-utils';

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
		// Recreate tabs from session state
		// For now, just recreate the active tab with the session's URL
		// TODO: Support recreating all open tabs and replaying to their state
		const openTabs = session.tabs?.filter((t) => !t.closedAt) ?? [];
		const activeTab = openTabs.find((t) => t.id === session.activeTabId) ?? openTabs[0];

		// Create a new browser tab for the active tab
		// Pass session.id as browserSessionId so page refresh reconnects to same Chrome.
		// On reconnect createTab attaches to the live page without re-navigating.
		const { tabId, isNew, replayPosition } = await createTab(
			activeTab?.url ?? session.url,
			session.id
		);
		const screenshotPath = await refreshScreenshot(tabId, session.id);
		const viewport = getViewport();

		return json({
			session,
			screenshotPath,
			viewport,
			tabId,
			// Whether Chrome was freshly launched (true) or reconnected (false).
			// On reconnect the frontend restores the persisted playhead instead of
			// resetting history to the start.
			isNew,
			replayPosition,
			// Note: The browser tabId won't match the stored tabId
			// The frontend should use the returned tabId for subsequent operations
			tabs: session.tabs
		});
	} catch (error) {
		return browserErrorResponse(error, 'Failed to resume session');
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	let body: { prompt?: unknown };
	try {
		body = await request.json();
	} catch {
		return badRequest('Invalid JSON');
	}

	if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
		return badRequest('A non-empty prompt is required');
	}

	const session = await updateSession(params.id, { prompt: body.prompt.trim() });

	if (!session) {
		return notFound('Session not found');
	}

	return json({ session });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const deleted = await deleteSession(params.id);

	if (!deleted) {
		return notFound('Session not found');
	}

	return json({ success: true });
};
