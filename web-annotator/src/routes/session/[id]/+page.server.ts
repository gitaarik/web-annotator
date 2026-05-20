import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSession } from '$lib/server/storage';
import { browserConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ params }) => {
	const session = await getSession(params.id);

	if (!session) {
		throw error(404, 'Session not found');
	}

	return {
		session,
		viewport: browserConfig.viewport
	};
};
