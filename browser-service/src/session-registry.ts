/**
 * Session registry for managing Chrome instances per session.
 *
 * Each session (from web-annotator) gets its own Chrome instance.
 * Reconnecting to a session returns the existing Chrome if still running.
 */

import path from 'path';
import os from 'os';
import { launchChrome, isProcessRunning, type ChromeSession } from './chrome-manager.js';

export interface SessionState {
	sessionId: string;
	chromePid: number;
	cdpWsUrl: string;
	cdpPort: number;
	createdAt: Date;
	lastActivity: Date;
	chrome: ChromeSession;
	/**
	 * Playhead position (index of the last replayed action) for the annotator UI.
	 * Lives exactly as long as this Chrome instance: reconnecting a page restores
	 * it, but a fresh Chrome (session recreated) starts at -1. This is what makes
	 * the UI's history reset only when the browser actually restarts.
	 */
	replayPosition: number;
}

const sessions = new Map<string, SessionState>();

/**
 * Get or create a Chrome session for the given session ID.
 *
 * If a session already exists and Chrome is still running, returns it.
 * If the session doesn't exist or Chrome died, launches a new Chrome instance.
 */
export async function getOrCreateSession(
	sessionId: string,
	options?: { url?: string }
): Promise<{ session: SessionState; isNew: boolean }> {
	const existing = sessions.get(sessionId);

	if (existing) {
		// Check if Chrome is still running
		if (isProcessRunning(existing.chromePid)) {
			console.log(`[Session] Reconnecting to existing session: ${sessionId} (PID: ${existing.chromePid})`);
			existing.lastActivity = new Date();
			return { session: existing, isNew: false };
		} else {
			// Chrome died, clean up and create new
			console.log(`[Session] Chrome died for session ${sessionId}, creating new instance`);
			sessions.delete(sessionId);
		}
	}

	// Launch new Chrome with per-session user data directory
	console.log(`[Session] Creating new session: ${sessionId}`);
	const userDataDir = path.join(os.homedir(), '.browser-service', 'sessions', sessionId);
	const chrome = await launchChrome({
		headed: true,
		startUrl: options?.url,
		userDataDir
	});

	const session: SessionState = {
		sessionId,
		chromePid: chrome.pid,
		cdpWsUrl: chrome.cdpWsUrl,
		cdpPort: chrome.port,
		createdAt: new Date(),
		lastActivity: new Date(),
		chrome,
		replayPosition: -1
	};

	sessions.set(sessionId, session);
	return { session, isNew: true };
}

/**
 * Get an existing session by ID.
 * Returns null if session doesn't exist or Chrome is no longer running.
 */
export function getSession(sessionId: string): SessionState | null {
	const session = sessions.get(sessionId);
	if (!session) return null;

	// Verify Chrome is still running
	if (!isProcessRunning(session.chromePid)) {
		console.log(`[Session] Chrome died for session ${sessionId}, removing from registry`);
		sessions.delete(sessionId);
		return null;
	}

	session.lastActivity = new Date();
	return session;
}

/**
 * Close and remove a session.
 */
export async function closeSession(sessionId: string): Promise<boolean> {
	const session = sessions.get(sessionId);
	if (!session) return false;

	console.log(`[Session] Closing session: ${sessionId}`);
	await session.chrome.kill();
	sessions.delete(sessionId);
	return true;
}

/**
 * List all active sessions.
 */
export function listSessions(): Array<{
	sessionId: string;
	chromePid: number;
	cdpPort: number;
	createdAt: Date;
	lastActivity: Date;
	isAlive: boolean;
}> {
	const result = [];
	for (const [sessionId, session] of sessions) {
		const isAlive = isProcessRunning(session.chromePid);
		if (!isAlive) {
			// Clean up dead sessions
			sessions.delete(sessionId);
			continue;
		}
		result.push({
			sessionId,
			chromePid: session.chromePid,
			cdpPort: session.cdpPort,
			createdAt: session.createdAt,
			lastActivity: session.lastActivity,
			isAlive
		});
	}
	return result;
}

/**
 * Close all sessions (for cleanup on shutdown).
 */
export async function closeAllSessions(): Promise<void> {
	console.log(`[Session] Closing all sessions (${sessions.size} active)`);
	const closePromises = Array.from(sessions.keys()).map((id) => closeSession(id));
	await Promise.all(closePromises);
}
