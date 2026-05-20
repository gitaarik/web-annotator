import { initBrowser } from '$lib/server/browser';

// Initialize browser eagerly on server startup
initBrowser().catch((err) => {
	console.error('Failed to initialize browser:', err);
});
