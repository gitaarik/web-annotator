import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRendererHealthy } from '$lib/server/browser';

// Lightweight liveness check: is the renderer's main thread servicing CDP right
// now? Used by the frontend's "wait out a stall" loop to poll for recovery
// before escalating to a restart. Cheap (a trivial evaluate on the browser-service
// side) and never touches storage, so it can't hang on a wedged page for long.
export const GET: RequestHandler = async ({ params }) => {
	const responsive = await isRendererHealthy(params.id);
	return json({ responsive });
};
