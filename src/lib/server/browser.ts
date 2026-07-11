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

interface TabInfo {
	sessionId: string;
	url: string;
}

/**
 * Encapsulates browser session state.
 * Currently limited to one session per web-annotator instance.
 */
class BrowserState {
	private activeSessionId: string | null = null;
	private tabs: Map<string, TabInfo> = new Map();
	private activeTabId: string | null = null;
	private viewport: { width: number; height: number } = browserConfig.viewport;
	private mousePosition: { x: number; y: number } | null = null;

	generateTabId(): string {
		return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	getActiveSessionId(): string | null {
		return this.activeSessionId;
	}

	setActiveSessionId(id: string | null): void {
		this.activeSessionId = id;
	}

	getActiveTabId(): string | null {
		return this.activeTabId;
	}

	setActiveTabId(id: string | null): void {
		this.activeTabId = id;
	}

	getTab(tabId: string): TabInfo | undefined {
		return this.tabs.get(tabId);
	}

	setTab(tabId: string, info: TabInfo): void {
		this.tabs.set(tabId, info);
	}

	deleteTab(tabId: string): void {
		this.tabs.delete(tabId);
	}

	listTabIds(): string[] {
		return Array.from(this.tabs.keys());
	}

	getViewport(): { width: number; height: number } {
		return this.viewport;
	}

	setViewport(viewport: { width: number; height: number }): void {
		this.viewport = viewport;
	}

	getMousePosition(): { x: number; y: number } | null {
		return this.mousePosition;
	}

	setMousePosition(x: number, y: number): void {
		this.mousePosition = { x, y };
	}

	clear(): void {
		this.tabs.clear();
		this.activeTabId = null;
		this.activeSessionId = null;
		this.mousePosition = null;
	}

	*tabEntries(): IterableIterator<[string, TabInfo]> {
		yield* this.tabs.entries();
	}
}

// Singleton instance for this server process
const state = new BrowserState();

export const RENDERER_UNRESPONSIVE_CODE = 'RENDERER_UNRESPONSIVE';

/**
 * Thrown when browser-service reports the page's renderer is wedged (a blocked
 * main thread — e.g. an unhandled dialog or a runaway script). Distinct from a
 * generic failure so callers can prompt the user to reload rather than retry.
 */
export class RendererUnresponsiveError extends Error {
	readonly code = RENDERER_UNRESPONSIVE_CODE;
	readonly recoverable = true;
	constructor(message = 'Page is unresponsive (renderer main thread blocked)') {
		super(message);
		this.name = 'RendererUnresponsiveError';
	}
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
		if (data?.code === RENDERER_UNRESPONSIVE_CODE) {
			throw new RendererUnresponsiveError(data.error);
		}
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
		state.setViewport(result.viewport);
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
): Promise<{ tabId: string; url: string; isNew: boolean; replayPosition: number }> {
	// Use provided browserSessionId or generate a new one
	const tabId = state.generateTabId();
	const sessionId = browserSessionId || tabId;

	// Launch or reconnect to Chrome via browser-service
	const launchResult = await browserApi<{
		success: boolean;
		isNew: boolean;
		replayPosition?: number;
	}>('POST', `/sessions/${sessionId}/launch`, { url });
	console.log(`[browser] launch ${sessionId}: isNew=${launchResult.isNew}`);

	let isNew = launchResult.isNew;
	let replayPosition = launchResult.replayPosition ?? -1;
	let currentUrl = url || 'about:blank';

	if (!isNew) {
		// Reconnecting to an existing Chrome. Probe renderer health first (fast):
		// if the page is alive, attach to its live state so the reload continues
		// the session; if it's hard-wedged (can't be rescued by Page.navigate,
		// which also hangs), relaunch Chrome fresh — resetting to a clean browser
		// with the playhead back at the start.
		const healthy = await isRendererHealthy(sessionId);
		console.log(`[browser] reconnect ${sessionId}: renderer healthy=${healthy}`);
		if (healthy) {
			currentUrl = await fetchUrl(sessionId);
			console.log(`[browser] reconnect attach ok: ${currentUrl}`);
		} else {
			console.warn(`[browser] reconnect renderer wedged, force-restarting Chrome`);
			const relaunch = await browserApi<{ isNew: boolean; replayPosition?: number }>(
				'POST',
				`/sessions/${sessionId}/launch`,
				{ url, forceNew: true }
			);
			isNew = true;
			replayPosition = relaunch.replayPosition ?? -1;
			console.log(`[browser] force-restart complete: isNew=${isNew}`);
		}
	}

	if (isNew && url) {
		// Fresh Chrome (first launch or after a force-restart): navigate to the URL.
		const navResult = await browserApi<{ success: boolean; url: string }>(
			'POST',
			`/sessions/${sessionId}/navigate`,
			{ url }
		);
		currentUrl = navResult.url;
		console.log(`[browser] navigated fresh Chrome to ${currentUrl}`);
	}

	// Track locally
	state.setTab(tabId, { sessionId, url: currentUrl });
	state.setActiveTabId(tabId);
	state.setActiveSessionId(sessionId);

	return {
		tabId,
		url: currentUrl,
		isNew,
		replayPosition
	};
}

/**
 * Deliberately restart a session's browser from scratch: tear down the current
 * Chrome (even if healthy) and relaunch a clean one at `url`, then reset the
 * playhead to the start (-1).
 *
 * This is the user-triggered counterpart to createTab's automatic wedge
 * recovery. Recorded steps are untouched — only the live browser and the
 * "current step" marker are reset, so the session can be re-walked from the top.
 */
export async function restartBrowser(
	url: string,
	browserSessionId: string
): Promise<{ tabId: string; url: string; replayPosition: number }> {
	const tabId = state.generateTabId();

	// forceNew tears down the existing Chrome and launches a fresh one, which
	// resets the persisted playhead to -1.
	const relaunch = await browserApi<{ isNew: boolean; replayPosition?: number }>(
		'POST',
		`/sessions/${browserSessionId}/launch`,
		{ url, forceNew: true }
	);

	// Fresh Chrome opens at about:blank; drive it to the session's start URL.
	const navResult = await browserApi<{ success: boolean; url: string }>(
		'POST',
		`/sessions/${browserSessionId}/navigate`,
		{ url }
	);
	const currentUrl = navResult.url;

	state.setTab(tabId, { sessionId: browserSessionId, url: currentUrl });
	state.setActiveTabId(tabId);
	state.setActiveSessionId(browserSessionId);

	return {
		tabId,
		url: currentUrl,
		replayPosition: relaunch.replayPosition ?? -1
	};
}

/**
 * Persist the annotator playhead for a tab's Chrome session. Survives a page
 * reload (reconnect) but resets when Chrome is relaunched.
 */
export async function setReplayPosition(tabId: string, position: number): Promise<void> {
	const browserSessionId = getSessionId(tabId);
	await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/position`, {
		position
	});
}

/**
 * Fast probe of whether a session's renderer main thread is servicing CDP.
 * Returns false on any error (unreachable / wedged) so callers treat it as
 * needing recovery.
 */
export async function isRendererHealthy(browserSessionId: string): Promise<boolean> {
	try {
		const result = await browserApi<{ responsive: boolean }>(
			'GET',
			`/sessions/${browserSessionId}/health`
		);
		return result.responsive === true;
	} catch {
		return false;
	}
}

/**
 * Switches the active tab to the specified tab ID.
 */
export function switchTab(tabId: string): void {
	const tab = state.getTab(tabId);
	if (!tab) {
		throw new Error(`Tab ${tabId} not found`);
	}
	state.setActiveTabId(tabId);
	state.setActiveSessionId(tab.sessionId);
}

/**
 * Closes the specified tab.
 */
export async function closeTab(tabId: string): Promise<void> {
	const tab = state.getTab(tabId);
	if (tab) {
		await browserApi<{ success: boolean }>('POST', `/sessions/${tab.sessionId}/close`);
		state.deleteTab(tabId);
	}
	// Switch to another tab if we closed the active one
	if (state.getActiveTabId() === tabId) {
		const remainingTabs = state.listTabIds();
		if (remainingTabs.length > 0) {
			state.setActiveTabId(remainingTabs[0]);
			state.setActiveSessionId(state.getTab(remainingTabs[0])!.sessionId);
		} else {
			state.setActiveTabId(null);
			state.setActiveSessionId(null);
		}
	}
}

/**
 * Gets the session ID for a tab.
 */
function getSessionId(tabId: string): string {
	const tab = state.getTab(tabId);
	if (!tab) {
		throw new Error(`Tab ${tabId} not found`);
	}
	return tab.sessionId;
}

/**
 * Returns a list of all open tab IDs.
 */
export function listTabs(): string[] {
	return state.listTabIds();
}

/**
 * Returns the currently active tab ID, or null if none.
 */
export function getActiveTabId(): string | null {
	return state.getActiveTabId();
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches the current URL from browser-service.
 */
async function fetchUrl(sessionId: string): Promise<string> {
	return (await browserApi<{ url: string }>('GET', `/sessions/${sessionId}/url`)).url;
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
		const currentUrl = await fetchUrl(sessionId);
		if (currentUrl === lastUrl) {
			break; // URL stable
		}
		lastUrl = currentUrl;
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
	const tab = state.getTab(tabId);
	if (tab) {
		tab.url = await fetchUrl(browserSessionId);
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

interface ExecuteActionOptions {
	tabId: string;
	sessionId: string;
	actionIndex: number;
	screenshotPrefix?: string;
	trackRedirects?: boolean;
	updateLocalUrl?: boolean;
}

/**
 * Generic action executor that handles the common before/after pattern.
 * Captures before screenshot/URL, executes the action, captures after screenshot/URL.
 */
async function executeActionWithTracking(
	options: ExecuteActionOptions,
	action: () => Promise<void>
): Promise<ActionResult> {
	const {
		tabId,
		sessionId,
		actionIndex,
		screenshotPrefix = '',
		trackRedirects = true,
		updateLocalUrl = true
	} = options;

	const browserSessionId = getSessionId(tabId);
	const prefix = screenshotPrefix ? `${screenshotPrefix}-` : '';

	// Capture before state
	const beforeScreenshot = await captureScreenshot(browserSessionId, `${prefix}${actionIndex}-before`);
	const beforeUrl = await fetchUrl(browserSessionId);

	// Execute action with optional redirect tracking
	let redirects: Redirect[] = [];
	if (trackRedirects) {
		redirects = await withRedirectTracking(
			browserSessionId,
			sessionId,
			actionIndex,
			beforeUrl,
			action
		);
	} else {
		await action();
	}

	// Capture after state
	const afterScreenshot = await captureScreenshot(browserSessionId, `${prefix}${actionIndex}-after`);
	const afterUrl = await fetchUrl(browserSessionId);

	// Update local URL tracking if requested
	if (updateLocalUrl) {
		const tab = state.getTab(tabId);
		if (tab) tab.url = afterUrl;
	}

	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
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
		const currentUrl = await fetchUrl(sessionId);

		if (currentUrl !== lastUrl && currentUrl !== beforeUrl) {
			// New URL detected
			if (!redirects.some((r) => r.url === currentUrl)) {
				const screenshotPath = await captureScreenshot(
					sessionId,
					`${actionIndex}-redirect-${redirectCounter++}`
				);
				redirects.push({ url: currentUrl, screenshotPath });
			}
			lastUrl = currentUrl;
		}

		await sleep(200);
	}

	// Wait for final stability
	await waitForStable(sessionId);

	// Remove the final URL from redirects if it will be the afterUrl
	const finalUrl = await fetchUrl(sessionId);
	if (redirects.length > 0 && redirects[redirects.length - 1].url === finalUrl) {
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
	return executeActionWithTracking({ tabId, sessionId, actionIndex }, async () => {
		await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/click`, {
			x,
			y,
			button: 'left'
		});
	});
}

export interface ElementLocator {
	tag?: string;
	text?: string;
	ariaLabel?: string;
	role?: string;
	id?: string;
	classes?: string[];
}

export interface DismissResult extends ActionResult {
	locator: ElementLocator | null;
}

/**
 * Dismiss a popup/overlay by clicking at the given coordinates. Captures the
 * target element's locator *before* clicking it away (so it can be recognized
 * again on the same site), plus before/after screenshots and URL. Same click
 * path as a normal click, but recorded as a dismissal rather than a task action.
 */
export async function executeDismiss(
	tabId: string,
	x: number,
	y: number,
	sessionId: string,
	dismissIndex: number
): Promise<DismissResult> {
	const browserSessionId = getSessionId(tabId);
	let locator: ElementLocator | null = null;
	const result = await executeActionWithTracking(
		{
			tabId,
			sessionId,
			actionIndex: dismissIndex,
			screenshotPrefix: 'dismiss',
			trackRedirects: false,
			updateLocalUrl: false
		},
		async () => {
			// Capture what we're about to dismiss, before it disappears.
			try {
				const res = await browserApi<{ locator: ElementLocator | null }>(
					'POST',
					`/sessions/${browserSessionId}/element-at`,
					{ x, y }
				);
				locator = res.locator;
			} catch {
				// Best-effort — a missing locator shouldn't block the dismissal.
			}
			await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/click`, {
				x,
				y,
				button: 'left'
			});
		}
	);
	return { ...result, locator };
}

export async function executeHover(
	tabId: string,
	x: number,
	y: number,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	return executeActionWithTracking(
		{ tabId, sessionId, actionIndex, trackRedirects: false, updateLocalUrl: false },
		async () => {
			await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/move`, { x, y });
			state.setMousePosition(x, y);
			await sleep(300); // Wait for hover effects
		}
	);
}

export async function executeScroll(
	tabId: string,
	direction: 'up' | 'down',
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	const deltaY = direction === 'down' ? browserConfig.scrollAmount : -browserConfig.scrollAmount;
	const mousePos = state.getMousePosition();

	return executeActionWithTracking({ tabId, sessionId, actionIndex }, async () => {
		await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/scroll`, {
			deltaY,
			...(mousePos && { x: mousePos.x, y: mousePos.y })
		});
	});
}

export async function executeType(
	tabId: string,
	text: string,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	return executeActionWithTracking({ tabId, sessionId, actionIndex }, async () => {
		await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/type`, {
			text,
			charDelayMs: inputConfig.charDelayMs
		});
	});
}

export async function executeWait(
	tabId: string,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const browserSessionId = getSessionId(tabId);
	return executeActionWithTracking(
		{ tabId, sessionId, actionIndex, trackRedirects: false, updateLocalUrl: false },
		async () => {
			await waitForStable(browserSessionId);
		}
	);
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

	return executeActionWithTracking(
		{ tabId, sessionId, actionIndex, screenshotPrefix: 'replay', updateLocalUrl: false },
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
				state.setMousePosition(action.coordinates.x, action.coordinates.y);
				await sleep(300); // Wait for hover effects
			} else if (action.type === 'scroll' && action.direction) {
				const deltaY =
					action.direction === 'down' ? browserConfig.scrollAmount : -browserConfig.scrollAmount;
				const mousePos = state.getMousePosition();
				await browserApi<{ success: boolean }>('POST', `/sessions/${browserSessionId}/scroll`, {
					deltaY,
					...(mousePos && { x: mousePos.x, y: mousePos.y })
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
}

export async function refreshScreenshot(tabId: string, sessionId: string): Promise<string> {
	const browserSessionId = getSessionId(tabId);
	const timestamp = Date.now();
	return captureScreenshot(browserSessionId, `refresh-${timestamp}`);
}

export async function closeBrowser(): Promise<void> {
	// Close all sessions via browser-service
	for (const [, tab] of state.tabEntries()) {
		try {
			await browserApi<{ success: boolean }>('POST', `/sessions/${tab.sessionId}/close`);
		} catch {
			// Ignore errors on close
		}
	}
	state.clear();
}

export function getViewport() {
	return state.getViewport();
}

export async function getCurrentUrl(tabId: string): Promise<string> {
	const browserSessionId = getSessionId(tabId);
	return fetchUrl(browserSessionId);
}
