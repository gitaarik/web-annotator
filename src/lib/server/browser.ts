/**
 * Browser automation via browser-service HTTP API.
 *
 * This module interfaces with browser-service for Chrome management,
 * OS-level input, and screenshots. Sessions are persisted in browser-service
 * so page refreshes reconnect to the same Chrome instance.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { browserConfig, inputConfig } from './config';
import type { Redirect } from '$lib/types';

// browser-service API URL
const BROWSER_SERVICE_URL = process.env.BROWSER_SERVICE_URL || 'http://127.0.0.1:3001';

// Track active session for this web-annotator instance
let activeSessionId: string | null = null;

// Tab management: currently simplified to one tab per session
// The tabId maps to the session in browser-service
const tabs: Map<string, { sessionId: string; url: string }> = new Map();
let activeTabId: string | null = null;

// Track actual viewport from browser-service (updated on each screenshot)
let currentViewport: { width: number; height: number } = browserConfig.viewport;

function generateTabId(): string {
	return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Call browser-service API.
 */
async function browserApi<T>(
	method: 'GET' | 'POST',
	path: string,
	body?: Record<string, unknown>
): Promise<T> {
	const url = `${BROWSER_SERVICE_URL}${path}`;
	const options: RequestInit = {
		method,
		headers: { 'Content-Type': 'application/json' }
	};
	if (body) {
		options.body = JSON.stringify(body);
	}

	const res = await fetch(url, options);
	const data = await res.json();

	if (!res.ok) {
		throw new Error(data.error || `browser-service error: ${res.status}`);
	}

	return data as T;
}

/**
 * Save a base64 screenshot to the static directory.
 */
async function saveScreenshot(
	base64Data: string,
	sessionId: string,
	filename: string
): Promise<string> {
	const screenshotDir = path.join(process.cwd(), 'static', 'screenshots', sessionId);
	await fs.mkdir(screenshotDir, { recursive: true });
	const screenshotPath = path.join(screenshotDir, `${filename}.png`);
	await fs.writeFile(screenshotPath, Buffer.from(base64Data, 'base64'));
	return `/screenshots/${sessionId}/${filename}.png`;
}

/**
 * Captures a screenshot via browser-service and saves it locally.
 * Also updates the current viewport from the browser.
 */
async function captureScreenshot(sessionId: string, filename: string): Promise<string> {
	const result = await browserApi<{
		data: string;
		viewport?: { width: number; height: number };
	}>('GET', `/sessions/${sessionId}/screenshot`);

	// Update viewport if returned by browser-service
	if (result.viewport) {
		currentViewport = result.viewport;
	}

	return saveScreenshot(result.data, sessionId, filename);
}

/**
 * Creates a new tab, optionally navigating to a URL.
 * This launches or reconnects to Chrome in browser-service.
 *
 * @param url - URL to navigate to
 * @param browserSessionId - Optional stable session ID for reconnection.
 *   If provided, browser-service will reconnect to existing Chrome if still running.
 */
export async function createTab(
	url?: string,
	browserSessionId?: string
): Promise<{ tabId: string; url: string }> {
	// Use provided browserSessionId or generate a new one
	const tabId = generateTabId();
	const sessionId = browserSessionId || tabId;

	// Launch or reconnect to Chrome via browser-service
	const launchResult = await browserApi<{ success: boolean; isNew: boolean }>(
		'POST',
		`/sessions/${sessionId}/launch`,
		{ url }
	);

	// Navigate if URL provided (skip if Chrome was just launched with the URL)
	let currentUrl = url || 'about:blank';
	if (url && !launchResult.isNew) {
		const navResult = await browserApi<{ success: boolean; url: string }>(
			'POST',
			`/sessions/${sessionId}/navigate`,
			{ url }
		);
		currentUrl = navResult.url;
	} else if (url && launchResult.isNew) {
		// Chrome was launched with URL, get actual URL (may have redirected)
		const urlResult = await browserApi<{ url: string }>('GET', `/sessions/${sessionId}/url`);
		currentUrl = urlResult.url;
	}

	// Track locally
	tabs.set(tabId, { sessionId, url: currentUrl });
	activeTabId = tabId;
	activeSessionId = sessionId;

	return { tabId, url: currentUrl };
}

/**
 * Switches the active tab to the specified tab ID.
 */
export function switchTab(tabId: string): void {
	if (!tabs.has(tabId)) {
		throw new Error(`Tab ${tabId} not found`);
	}
	activeTabId = tabId;
	activeSessionId = tabs.get(tabId)!.sessionId;
}

/**
 * Closes the specified tab.
 */
export async function closeTab(tabId: string): Promise<void> {
	const tab = tabs.get(tabId);
	if (tab) {
		await browserApi<{ success: boolean }>('POST', `/sessions/${tab.sessionId}/close`);
		tabs.delete(tabId);
	}
	// Switch to another tab if we closed the active one
	if (activeTabId === tabId) {
		const remainingTabs = Array.from(tabs.keys());
		if (remainingTabs.length > 0) {
			activeTabId = remainingTabs[0];
			activeSessionId = tabs.get(activeTabId)!.sessionId;
		} else {
			activeTabId = null;
			activeSessionId = null;
		}
	}
}

/**
 * Gets the session ID for a tab.
 */
function getSessionId(tabId: string): string {
	const tab = tabs.get(tabId);
	if (!tab) {
		throw new Error(`Tab ${tabId} not found`);
	}
	return tab.sessionId;
}

/**
 * Returns a list of all open tab IDs.
 */
export function listTabs(): string[] {
	return Array.from(tabs.keys());
}

/**
 * Returns the currently active tab ID, or null if none.
 */
export function getActiveTabId(): string | null {
	return activeTabId;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for page to stabilize by polling URL and checking for changes.
 * This is a simplified version since browser-service handles most stability checks.
 */
async function waitForStable(sessionId: string): Promise<void> {
	// Simple stability check: wait a bit, then verify no immediate redirects
	await sleep(browserConfig.domStableTimeout);

	// Post-action monitoring for delayed redirects
	const startTime = Date.now();
	let lastUrl = '';

	while (Date.now() - startTime < browserConfig.postActionMonitorTimeout) {
		const result = await browserApi<{ url: string }>('GET', `/sessions/${sessionId}/url`);
		if (result.url === lastUrl) {
			break; // URL stable
		}
		lastUrl = result.url;
		await sleep(500);
	}
}

export async function navigateAndScreenshot(
	tabId: string,
	url: string,
	sessionId: string
): Promise<string> {
	const browserSessionId = getSessionId(tabId);

	await browserApi<{ success: boolean; url: string }>(
		'POST',
		`/sessions/${browserSessionId}/navigate`,
		{ url }
	);
	await waitForStable(browserSessionId);

	// Update local URL tracking
	const tab = tabs.get(tabId);
	if (tab) {
		const urlResult = await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`);
		tab.url = urlResult.url;
	}

	return captureScreenshot(browserSessionId, '0');
}

export interface ActionResult {
	beforeScreenshot: string;
	afterScreenshot: string;
	beforeUrl: string;
	afterUrl: string;
	redirects: Redirect[];
}

/**
 * Track redirects during an action by monitoring URL changes.
 */
async function withRedirectTracking(
	sessionId: string,
	screenshotSessionId: string,
	actionIndex: number,
	beforeUrl: string,
	action: () => Promise<void>
): Promise<Redirect[]> {
	const redirects: Redirect[] = [];
	let redirectCounter = 0;

	await action();
	await sleep(500); // Let navigation start

	// Monitor for redirects
	const startTime = Date.now();
	let lastUrl = beforeUrl;

	while (Date.now() - startTime < browserConfig.postActionMonitorTimeout) {
		const result = await browserApi<{ url: string }>('GET', `/sessions/${sessionId}/url`);

		if (result.url !== lastUrl && result.url !== beforeUrl) {
			// New URL detected
			if (!redirects.some((r) => r.url === result.url)) {
				const screenshotPath = await captureScreenshot(
					sessionId,
					`${actionIndex}-redirect-${redirectCounter++}`
				);
				redirects.push({ url: result.url, screenshotPath });
			}
			lastUrl = result.url;
		}

		await sleep(200);
	}

	// Wait for final stability
	await waitForStable(sessionId);

	// Remove the final URL from redirects if it will be the afterUrl
	const finalResult = await browserApi<{ url: string }>('GET', `/sessions/${sessionId}/url`);
	if (redirects.length > 0 && redirects[redirects.length - 1].url === finalResult.url) {
		redirects.pop();
	}

	return redirects;
}

export async function executeClick(
	tabId: string,
	x: number,
	y: number,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	const beforeScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-before`);
	const beforeUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	const redirects = await withRedirectTracking(
		browserSessionId,
		sessionId,
		actionIndex,
		beforeUrl,
		async () => {
			await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/click`, {
				x,
				y,
				button: 'left'
			});
		}
	);

	const afterScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-after`);
	const afterUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	// Update local URL tracking
	const tab = tabs.get(tabId);
	if (tab) tab.url = afterUrl;

	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
}

export async function executeHover(
	tabId: string,
	x: number,
	y: number,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	const beforeScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-before`);
	const beforeUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	// Move mouse to position without clicking
	await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/move`, {
		x,
		y
	});

	// Wait briefly for any hover effects to appear
	await sleep(300);

	const afterScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-after`);
	const afterUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects: [] };
}

export async function executeScroll(
	tabId: string,
	direction: 'up' | 'down',
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	const beforeScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-before`);
	const beforeUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	const deltaY = direction === 'down' ? browserConfig.scrollAmount : -browserConfig.scrollAmount;

	const redirects = await withRedirectTracking(
		browserSessionId,
		sessionId,
		actionIndex,
		beforeUrl,
		async () => {
			await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/scroll`, {
				deltaY
			});
		}
	);

	const afterScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-after`);
	const afterUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
}

export async function executeType(
	tabId: string,
	text: string,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	const beforeScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-before`);
	const beforeUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	const redirects = await withRedirectTracking(
		browserSessionId,
		sessionId,
		actionIndex,
		beforeUrl,
		async () => {
			await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/type`, {
				text,
				charDelayMs: inputConfig.charDelayMs
			});
		}
	);

	const afterScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-after`);
	const afterUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
}

export async function executeWait(
	tabId: string,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	const beforeScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-before`);
	const beforeUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	// Wait action: just wait for stability
	await waitForStable(browserSessionId);

	const afterScreenshot = await captureScreenshot(browserSessionId, `${actionIndex}-after`);
	const afterUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects: [] };
}

export async function replaySingleAction(
	tabId: string,
	action: {
		type: string;
		coordinates?: { x: number; y: number };
		direction?: 'up' | 'down';
		text?: string;
	},
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);

	// Capture BEFORE state
	const beforeScreenshot = await captureScreenshot(
		browserSessionId,
		`replay-${actionIndex}-before`
	);
	const beforeUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	// Execute the action with redirect tracking
	const redirects = await withRedirectTracking(
		browserSessionId,
		sessionId,
		actionIndex,
		beforeUrl,
		async () => {
			if (action.type === 'click' && action.coordinates) {
				await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/click`, {
					x: action.coordinates.x,
					y: action.coordinates.y,
					button: 'left'
				});
			} else if (action.type === 'hover' && action.coordinates) {
				await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/move`, {
					x: action.coordinates.x,
					y: action.coordinates.y
				});
				await sleep(300); // Wait for hover effects
			} else if (action.type === 'scroll' && action.direction) {
				const deltaY =
					action.direction === 'down'
						? browserConfig.scrollAmount
						: -browserConfig.scrollAmount;
				await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/scroll`, {
					deltaY
				});
			} else if (action.type === 'type' && action.text) {
				await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/type`, {
					text: action.text,
					charDelayMs: inputConfig.charDelayMs
				});
			}
			// For 'wait' and 'stop' actions, just wait for page stability
		}
	);

	// Capture AFTER state
	const afterScreenshot = await captureScreenshot(browserSessionId, `replay-${actionIndex}-after`);
	const afterUrl = (await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`))
		.url;

	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
}

export async function refreshScreenshot(tabId: string, sessionId: string): Promise<string> {
	const browserSessionId = getSessionId(tabId);
	const timestamp = Date.now();
	return captureScreenshot(browserSessionId, `refresh-${timestamp}`);
}

export async function closeBrowser(): Promise<void> {
	// Close all sessions via browser-service
	for (const tab of tabs.values()) {
		try {
			await browserApi<{ success: boolean }>('POST', `/sessions/${tab.sessionId}/close`);
		} catch {
			// Ignore errors on close
		}
	}
	tabs.clear();
	activeTabId = null;
	activeSessionId = null;
}

export function getViewport() {
	return currentViewport;
}

export async function getCurrentUrl(tabId: string): Promise<string> {
	const browserSessionId = getSessionId(tabId);
	const result = await browserApi<{ url: string }>('GET', `/sessions/${browserSessionId}/url`);
	return result.url;
}

// Legacy sync version for backward compatibility
export function getCurrentUrlSync(tabId: string): string {
	const tab = tabs.get(tabId);
	return tab?.url || 'about:blank';
}
