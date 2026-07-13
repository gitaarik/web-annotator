/**
 * Express HTTP API server for browser-service.
 *
 * Exposes endpoints for session management, navigation,
 * OS-level input, and screenshots.
 */

import express, { type Express } from 'express';
import {
	getOrCreateSession,
	getSession,
	closeSession,
	listSessions,
	closeAllSessions
} from './session-registry.js';
import { CdpClient, RendererUnresponsiveError } from './cdp-client.js';
import { activateBrowserWindow } from './focus.js';
import { osClick, osType, osClearInput } from './os-input.js';

const app: Express = express();
app.use(express.json());

// Request logger: one line per request with status + duration. Invaluable for
// spotting which CDP operation stalls (e.g. a 10s Page.navigate on a wedged
// renderer). Skips the frequent /status healthcheck to keep noise down.
app.use((req, res, next) => {
	if (req.path === '/status') return next();
	const t0 = Date.now();
	res.on('finish', () => {
		console.log(`[HTTP] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - t0}ms)`);
	});
	next();
});

// CDP clients per session
const cdpClients = new Map<string, CdpClient>();

/**
 * Get or create CDP client for a session.
 */
async function getCdpClient(sessionId: string): Promise<CdpClient | null> {
	const session = getSession(sessionId);
	if (!session) return null;

	let client = cdpClients.get(sessionId);
	if (!client) {
		client = new CdpClient(session.cdpPort, session.cdpWsUrl);
		await client.connect();
		cdpClients.set(sessionId, client);
	}
	return client;
}

/**
 * Send an error response. A wedged renderer becomes a recoverable 503 (carrying
 * a code) so the client can prompt a reload instead of treating it as a generic
 * failure; everything else is a 500.
 */
function sendError(res: express.Response, err: unknown): void {
	if (err instanceof RendererUnresponsiveError) {
		res.status(503).json({ error: err.message, code: err.code, recoverable: true });
		return;
	}
	res.status(500).json({
		success: false,
		error: err instanceof Error ? err.message : String(err)
	});
}

// =============================================================================
// STATUS ENDPOINTS
// =============================================================================

app.get('/status', (_req, res) => {
	res.json({
		status: 'ok',
		activeSessions: listSessions().length,
		platform: process.platform
	});
});

app.get('/sessions', (_req, res) => {
	res.json({ sessions: listSessions() });
});

// =============================================================================
// SESSION ENDPOINTS
// =============================================================================

app.get('/sessions/:id', (req, res) => {
	const session = getSession(req.params.id);
	if (!session) {
		res.status(404).json({ error: 'Session not found' });
		return;
	}
	res.json({
		sessionId: session.sessionId,
		chromePid: session.chromePid,
		cdpPort: session.cdpPort,
		createdAt: session.createdAt,
		lastActivity: session.lastActivity
	});
});

app.post('/sessions/:id/launch', async (req, res) => {
	try {
		const { url, forceNew } = req.body || {};

		// forceNew tears down an existing (e.g. hard-wedged, unrecoverable) Chrome
		// so we relaunch a clean one. This is the recovery path when Page.navigate
		// can't rescue a blocked renderer.
		if (forceNew) {
			console.log(`[Session] Force-restarting Chrome for ${req.params.id}`);
			const existingClient = cdpClients.get(req.params.id);
			if (existingClient) {
				existingClient.close();
				cdpClients.delete(req.params.id);
			}
			await closeSession(req.params.id);
		}

		const { session, isNew } = await getOrCreateSession(req.params.id, { url });

		// Create CDP client for new sessions and inject stealth scripts
		if (isNew) {
			const client = new CdpClient(session.cdpPort, session.cdpWsUrl);
			await client.connect();
			await client.injectStealthScripts();
			cdpClients.set(session.sessionId, client);
		}

		res.json({
			success: true,
			isNew,
			sessionId: session.sessionId,
			chromePid: session.chromePid,
			cdpPort: session.cdpPort,
			replayPosition: session.replayPosition
		});
	} catch (err) {
		console.error('[Server] Launch error:', err);
		sendError(res, err);
	}
});

// Persist the annotator playhead alongside the Chrome session so it survives a
// page reload (reconnect) but resets when Chrome is relaunched.
app.post('/sessions/:id/position', (req, res) => {
	const session = getSession(req.params.id);
	if (!session) {
		res.status(404).json({ error: 'Session not found' });
		return;
	}

	const { position } = req.body || {};
	if (typeof position !== 'number' || !Number.isInteger(position)) {
		res.status(400).json({ error: 'Integer position required' });
		return;
	}

	session.replayPosition = position;
	res.json({ success: true, replayPosition: session.replayPosition });
});

app.post('/sessions/:id/close', async (req, res) => {
	try {
		// Clean up CDP client
		const client = cdpClients.get(req.params.id);
		if (client) {
			client.close();
			cdpClients.delete(req.params.id);
		}

		const closed = await closeSession(req.params.id);
		res.json({ success: closed });
	} catch (err) {
		sendError(res, err);
	}
});

// =============================================================================
// NAVIGATION ENDPOINTS
// =============================================================================

app.post('/sessions/:id/navigate', async (req, res) => {
	try {
		const { url } = req.body;
		if (!url) {
			res.status(400).json({ error: 'URL required' });
			return;
		}

		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}

		await client.navigate(url);
		const currentUrl = await client.getUrl();

		res.json({ success: true, url: currentUrl });
	} catch (err) {
		sendError(res, err);
	}
});

// Fast renderer liveness probe (used on reconnect to decide attach vs restart).
// Returns quickly whether the page's main thread is servicing CDP.
app.get('/sessions/:id/health', async (req, res) => {
	try {
		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}
		const responsive = await client.isRendererResponsive();
		res.json({ responsive });
	} catch (err) {
		res.json({ responsive: false, error: err instanceof Error ? err.message : String(err) });
	}
});

app.get('/sessions/:id/url', async (req, res) => {
	try {
		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}

		const url = await client.getUrl();
		res.json({ url });
	} catch (err) {
		sendError(res, err);
	}
});

// =============================================================================
// INPUT ENDPOINTS
// =============================================================================

app.post('/sessions/:id/click', async (req, res) => {
	try {
		const { x, y, button = 'left' } = req.body;
		console.log(`[Click] Session ${req.params.id}: viewport (${x}, ${y})`);

		if (typeof x !== 'number' || typeof y !== 'number') {
			res.status(400).json({ error: 'x and y coordinates required' });
			return;
		}

		const session = getSession(req.params.id);
		if (!session) {
			console.log(`[Click] Session not found: ${req.params.id}`);
			res.status(404).json({ error: 'Session not found' });
			return;
		}
		console.log(`[Click] Found session, Chrome PID: ${session.chromePid}`);

		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'CDP client not found' });
			return;
		}

		// Get precise content viewport position using JavaScript
		// This accounts for infobars and other dynamic Chrome UI elements
		const viewportInfo = await client.getContentViewportInfo();
		console.log(`[Click] Viewport info:`, JSON.stringify(viewportInfo));

		// DPI scale factor from window.devicePixelRatio
		const dpiScale = viewportInfo.devicePixelRatio;
		console.log(`[Click] DPI scale: ${dpiScale}, Chrome bar height: ${viewportInfo.chromeBarHeight}`);

		// Convert CSS viewport coordinates to physical screen coordinates.
		// All values from JavaScript (screenX/Y, dimensions) are in CSS/logical pixels.
		// Scale everything by devicePixelRatio to get physical screen coordinates.
		const leftBorder = Math.floor((viewportInfo.outerWidth - viewportInfo.innerWidth) / 2);
		const screenX = (viewportInfo.screenX + leftBorder + x) * dpiScale;
		const screenY = (viewportInfo.screenY + viewportInfo.chromeBarHeight + y) * dpiScale;
		console.log(`[Click] Screen coords: (${screenX}, ${screenY}) = (${viewportInfo.screenX} + ${leftBorder} + ${x}, ${viewportInfo.screenY} + ${viewportInfo.chromeBarHeight} + ${y}) * ${dpiScale}`);

		// Activate window and click
		console.log(`[Click] Activating window for PID ${session.chromePid}...`);
		const focused = await activateBrowserWindow(session.chromePid);
		console.log(`[Click] Focus result: ${focused}`);

		if (focused) {
			try {
				await osClick(screenX, screenY, button);
				console.log(`[Click] OS-level click succeeded`);
				res.json({ success: true, method: 'os-level' });
				return;
			} catch (err) {
				console.log('[Click] OS-level click failed, falling back to CDP:', err);
			}
		}

		// Fallback to CDP
		console.log(`[Click] Using CDP fallback`);
		await client.cdpClick(x, y);
		res.json({ success: true, method: 'cdp' });
	} catch (err) {
		console.error('[Click] Error:', err);
		sendError(res, err);
	}
});

app.post('/sessions/:id/move', async (req, res) => {
	try {
		const { x, y } = req.body;

		if (typeof x !== 'number' || typeof y !== 'number') {
			res.status(400).json({ error: 'x and y coordinates required' });
			return;
		}

		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}

		await client.cdpMove(x, y);
		res.json({ success: true });
	} catch (err) {
		sendError(res, err);
	}
});

app.post('/sessions/:id/type', async (req, res) => {
	try {
		const { text, charDelayMs = 50 } = req.body;
		if (typeof text !== 'string') {
			res.status(400).json({ error: 'text required' });
			return;
		}

		const session = getSession(req.params.id);
		if (!session) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}

		// Activate window and type
		const focused = await activateBrowserWindow(session.chromePid);
		if (focused) {
			try {
				await osType(text, { charDelayMs, charDelayVariance: 0.4 });
				res.json({ success: true, method: 'os-level' });
				return;
			} catch (err) {
				console.log('[Server] OS-level type failed, falling back to CDP:', err);
			}
		}

		// Fallback to CDP
		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'CDP client not found' });
			return;
		}
		await client.cdpType(text, charDelayMs);
		res.json({ success: true, method: 'cdp' });
	} catch (err) {
		sendError(res, err);
	}
});

app.post('/sessions/:id/clear', async (req, res) => {
	try {
		const session = getSession(req.params.id);
		if (!session) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}

		const focused = await activateBrowserWindow(session.chromePid);
		if (focused) {
			await osClearInput();
			res.json({ success: true });
			return;
		}

		res.status(500).json({ error: 'Could not focus browser window' });
	} catch (err) {
		sendError(res, err);
	}
});

app.post('/sessions/:id/scroll', async (req, res) => {
	try {
		const { deltaX = 0, deltaY = 0, x, y } = req.body;

		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}

		await client.scroll(deltaX, deltaY, x, y);
		res.json({ success: true });
	} catch (err) {
		sendError(res, err);
	}
});

// Screencast (push-based live view) — experimental. Unlike /screenshot polling,
// frames are pushed by Chrome from the compositor without forcing a render pass.
app.post('/sessions/:id/screencast/start', async (req, res) => {
	try {
		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}
		await client.startScreencast({ quality: req.body?.quality, everyNthFrame: req.body?.everyNthFrame });
		res.json({ success: true });
	} catch (err) {
		sendError(res, err);
	}
});

app.post('/sessions/:id/screencast/stop', async (req, res) => {
	try {
		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}
		await client.stopScreencast();
		res.json({ success: true });
	} catch (err) {
		sendError(res, err);
	}
});

app.get('/sessions/:id/screencast/frame', async (req, res) => {
	try {
		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}
		res.json({ data: client.getLastScreencastFrame() });
	} catch (err) {
		sendError(res, err);
	}
});

// Report the real CSS viewport (innerWidth/innerHeight). Lets the app seed its
// coordinate-scaling factor without forcing a screenshot capture — the live
// screencast frame carries no dimensions, so this is the cheap way to learn them
// before the first recorded action runs a capture.
app.get('/sessions/:id/viewport', async (req, res) => {
	try {
		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}
		const viewportInfo = await client.getContentViewportInfo();
		res.json({ viewport: { width: viewportInfo.innerWidth, height: viewportInfo.innerHeight } });
	} catch (err) {
		sendError(res, err);
	}
});

// =============================================================================
// SCREENSHOT ENDPOINT
// =============================================================================

app.get('/sessions/:id/screenshot', async (req, res) => {
	try {
		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}

		const format = (req.query.format as 'png' | 'jpeg') || 'png';
		const quality = req.query.quality ? parseInt(req.query.quality as string, 10) : undefined;

		const data = await client.screenshot({ format, quality });

		// Get actual viewport dimensions (innerWidth/innerHeight = CSS viewport size)
		const viewportInfo = await client.getContentViewportInfo();
		const viewport = {
			width: viewportInfo.innerWidth,
			height: viewportInfo.innerHeight
		};

		// Return as base64 JSON or binary
		if (req.query.output === 'binary') {
			res.set('Content-Type', `image/${format}`);
			res.send(Buffer.from(data, 'base64'));
		} else {
			res.json({ data, format, viewport });
		}
	} catch (err) {
		// A wedged renderer (page JS blocking the main thread) can't produce a
		// frame — surface it distinctly so the client can prompt a reload instead
		// of treating it as a generic capture error.
		if (err instanceof RendererUnresponsiveError) {
			res.status(503).json({
				error: err.message,
				code: err.code,
				recoverable: true
			});
			return;
		}
		res.status(500).json({
			error: err instanceof Error ? err.message : String(err)
		});
	}
});

// =============================================================================
// CLEANUP
// =============================================================================

async function cleanup() {
	console.log('[Server] Shutting down...');
	// Close all CDP clients
	for (const client of cdpClients.values()) {
		client.close();
	}
	cdpClients.clear();
	// Close all Chrome sessions
	await closeAllSessions();
}

export { app, cleanup };
