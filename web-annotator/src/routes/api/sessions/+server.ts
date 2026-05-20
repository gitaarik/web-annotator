import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSessions, importSession } from '$lib/server/storage';

export const GET: RequestHandler = async () => {
	const sessions = await listSessions();

	// Return summary info for each session
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
			return json({ error: 'Invalid session data' }, { status: 400 });
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
		return json({ error: 'Failed to import session' }, { status: 500 });
	}
};
