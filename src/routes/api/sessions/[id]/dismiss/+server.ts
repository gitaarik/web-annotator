import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { executeDismiss } from '$lib/server/browser';
import { getSession, addDismissal, deleteDismissal } from '$lib/server/storage';
import { badRequest, notFound, browserErrorResponse } from '$lib/server/api-utils';
import type { DismissEvent } from '$lib/types';

function domainOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

/**
 * POST: dismiss a popup/overlay at coordinates. Recorded as a DismissEvent
 * (separate from task actions) so the annotator can clear obstructions without
 * polluting the recorded steps.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	let body: { tabId?: string; coordinates?: { x: number; y: number }; explanation?: string };
	try {
		body = await request.json();
	} catch {
		return badRequest('Invalid JSON');
	}

	const { tabId, coordinates, explanation } = body;
	if (!tabId) return badRequest('tabId is required');
	if (coordinates?.x == null || coordinates?.y == null) {
		return badRequest('coordinates are required');
	}

	const session = await getSession(params.id);
	if (!session) return notFound('Session not found');

	try {
		const dismissIndex = (session.dismissals?.length ?? 0) + 1;
		const result = await executeDismiss(
			tabId,
			coordinates.x,
			coordinates.y,
			params.id,
			dismissIndex
		);

		const dismissal: DismissEvent = {
			id: crypto.randomUUID(),
			tabId,
			coordinates,
			explanation: explanation?.trim() || undefined,
			timestamp: new Date().toISOString(),
			url: result.beforeUrl,
			domain: domainOf(result.beforeUrl),
			locator: result.locator ?? undefined,
			screenshotBefore: result.beforeScreenshot,
			screenshotAfter: result.afterScreenshot
		};

		const updatedSession = await addDismissal(params.id, dismissal);

		return json({
			session: updatedSession,
			screenshotPath: result.afterScreenshot,
			currentUrl: result.afterUrl,
			tabId
		});
	} catch (error) {
		return browserErrorResponse(error, 'Failed to dismiss popup');
	}
};

/**
 * DELETE: remove a recorded dismissal (does not touch the browser).
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
	let body: { dismissalId?: string };
	try {
		body = await request.json();
	} catch {
		return badRequest('Invalid JSON');
	}
	if (!body.dismissalId) return badRequest('dismissalId is required');

	const updatedSession = await deleteDismissal(params.id, body.dismissalId);
	if (!updatedSession) return notFound('Session not found');

	return json({ session: updatedSession });
};
