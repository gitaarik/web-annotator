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
import { CdpClient } from './cdp-client.js';
import { activateBrowserWindow } from './focus.js';
import { osClick, osType, osClearInput } from './os-input.js';

const app: Express = express();
app.use(express.json());

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
		const { url } = req.body || {};
		const { session, isNew } = await getOrCreateSession(req.params.id, { url });

		// Create CDP client for new sessions
		if (isNew) {
			const client = new CdpClient(session.cdpPort, session.cdpWsUrl);
			await client.connect();
			cdpClients.set(session.sessionId, client);
		}

		res.json({
			success: true,
			isNew,
			sessionId: session.sessionId,
			chromePid: session.chromePid,
			cdpPort: session.cdpPort
		});
	} catch (err) {
		console.error('[Server] Launch error:', err);
		res.status(500).json({
			success: false,
			error: err instanceof Error ? err.message : String(err)
		});
	}
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
		res.status(500).json({
			success: false,
			error: err instanceof Error ? err.message : String(err)
		});
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
		res.status(500).json({
			success: false,
			error: err instanceof Error ? err.message : String(err)
		});
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
		res.status(500).json({
			error: err instanceof Error ? err.message : String(err)
		});
	}
});

// =============================================================================
// INPUT ENDPOINTS
// =============================================================================

app.post('/sessions/:id/click', async (req, res) => {
	try {
		const { x, y, button = 'left' } = req.body;
		if (typeof x !== 'number' || typeof y !== 'number') {
			res.status(400).json({ error: 'x and y coordinates required' });
			return;
		}

		const session = getSession(req.params.id);
		if (!session) {
			res.status(404).json({ error: 'Session not found' });
			return;
		}

		const client = await getCdpClient(req.params.id);
		if (!client) {
			res.status(404).json({ error: 'CDP client not found' });
			return;
		}

		// Get window bounds to convert viewport coords to screen coords
		const bounds = await client.getWindowBounds();
		const metrics = await client.getLayoutMetrics();
		const chromeBarHeight = bounds.height - metrics.layoutViewport.clientHeight;

		const screenX = bounds.left + x;
		const screenY = bounds.top + chromeBarHeight + y;

		// Activate window and click
		const focused = await activateBrowserWindow(session.chromePid);
		if (focused) {
			try {
				await osClick(screenX, screenY, button);
				res.json({ success: true, method: 'os-level' });
				return;
			} catch (err) {
				console.log('[Server] OS-level click failed, falling back to CDP:', err);
			}
		}

		// Fallback to CDP
		await client.cdpClick(x, y);
		res.json({ success: true, method: 'cdp' });
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err instanceof Error ? err.message : String(err)
		});
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
		res.status(500).json({
			success: false,
			error: err instanceof Error ? err.message : String(err)
		});
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
		res.status(500).json({
			success: false,
			error: err instanceof Error ? err.message : String(err)
		});
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
		res.status(500).json({
			success: false,
			error: err instanceof Error ? err.message : String(err)
		});
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

		// Return as base64 JSON or binary
		if (req.query.output === 'binary') {
			res.set('Content-Type', `image/${format}`);
			res.send(Buffer.from(data, 'base64'));
		} else {
			res.json({ data, format });
		}
	} catch (err) {
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
