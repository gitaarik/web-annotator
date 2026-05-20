import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSessions } from '$lib/server/storage';

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
