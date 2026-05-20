/**
 * browser-service - Browser control component for web-annotator.
 *
 * Launches Chrome with anti-detection flags, provides OS-level input,
 * and exposes an HTTP API for browser automation.
 */

import { app, cleanup } from './server.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '127.0.0.1';

const server = app.listen(PORT, HOST, () => {
	console.log(`
╔═══════════════════════════════════════════════════╗
║                  browser-service                    ║
║         Browser Control Component v0.1.0          ║
╠═══════════════════════════════════════════════════╣
║  Server running at http://${HOST}:${PORT}           ║
║                                                   ║
║  Endpoints:                                       ║
║    GET  /status                                   ║
║    GET  /sessions                                 ║
║    GET  /sessions/:id                             ║
║    POST /sessions/:id/launch                      ║
║    POST /sessions/:id/navigate                    ║
║    POST /sessions/:id/click                       ║
║    POST /sessions/:id/type                        ║
║    POST /sessions/:id/scroll                      ║
║    GET  /sessions/:id/screenshot                  ║
║    POST /sessions/:id/close                       ║
╚═══════════════════════════════════════════════════╝
`);
});

// Graceful shutdown
async function shutdown(signal: string) {
	console.log(`\n[Server] Received ${signal}, shutting down...`);
	server.close(async () => {
		await cleanup();
		console.log('[Server] Goodbye!');
		process.exit(0);
	});

	// Force exit after 10 seconds
	setTimeout(() => {
		console.error('[Server] Forced shutdown after timeout');
		process.exit(1);
	}, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
