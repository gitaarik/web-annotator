import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSessions, importSession } from '$lib/server/storage';
import { badRequest, errorResponse } from '$lib/server/api-utils';

export const GET: RequestHandler = async () => {
	const sessions = await listSessions();

	const summaries = sessions.map((s) => ({
		id: s.id,
		url: s.url,
		prompt: s.prompt,
		createdAt: s.createdAt,
		actionCount: s.actions.length,
		isCompleted: !!s.finalAnswer
	}));

	return json(summaries);
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const session = await request.json();

		if (!session.url || !session.prompt || !session.actions) {
			return badRequest('Invalid session data');
		}

		const imported = await importSession(session);

		return json({
			session: imported,
			summary: {
				id: imported.id,
				url: imported.url,
				prompt: imported.prompt,
				createdAt: imported.createdAt,
				actionCount: imported.actions.length,
				isCompleted: !!imported.finalAnswer
			}
		});
	} catch {
		return errorResponse('Failed to import session');
	}
};
