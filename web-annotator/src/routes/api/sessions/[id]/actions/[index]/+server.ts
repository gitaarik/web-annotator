import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteAction, updateAction } from '$lib/server/storage';
import { badRequest, notFound } from '$lib/server/api-utils';

export const DELETE: RequestHandler = async ({ params }) => {
	const actionIndex = parseInt(params.index, 10);

	if (isNaN(actionIndex)) {
		return badRequest('Invalid action index');
	}

	const session = await deleteAction(params.id, actionIndex);

	if (!session) {
		return notFound('Session or action not found');
	}

	return json({ session });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const actionIndex = parseInt(params.index, 10);

	if (isNaN(actionIndex)) {
		return badRequest('Invalid action index');
	}

	const action = await request.json();

	if (!action || typeof action !== 'object') {
		return badRequest('Action data is required');
	}

	const session = await updateAction(params.id, actionIndex, action);

	if (!session) {
		return notFound('Session or action not found');
	}

	return json({ session });
};
