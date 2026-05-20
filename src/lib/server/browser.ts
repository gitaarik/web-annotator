import { chromium, type Browser, type BrowserContext, type Page, type Frame } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import { browserConfig } from './config';
import type { Redirect } from '$lib/types';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

// Tab management: map of tabId -> Page
const pages: Map<string, Page> = new Map();
let activeTabId: string | null = null;

function generateTabId(): string {
	return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Captures a screenshot and saves it to the static screenshots directory.
 * Returns the public URL path to the screenshot.
 */
async function captureScreenshot(
	p: Page,
	sessionId: string,
	filename: string
): Promise<string> {
	const screenshotDir = path.join(process.cwd(), 'static', 'screenshots', sessionId);
	await fs.mkdir(screenshotDir, { recursive: true });
	const screenshotPath = path.join(screenshotDir, `${filename}.png`);
	await p.screenshot({ path: screenshotPath, fullPage: false });
	return `/screenshots/${sessionId}/${filename}.png`;
}

async function getBrowser(): Promise<Browser> {
	if (!browser) {
		browser = await chromium.launch({ headless: true });
	}
	return browser;
}

async function getContext(): Promise<BrowserContext> {
	if (!context) {
		const b = await getBrowser();
		context = await b.newContext({ viewport: browserConfig.viewport });
	}
	return context;
}

/**
 * Creates a new tab, optionally navigating to a URL.
 * Returns the new tab's ID.
 */
export async function createTab(url?: string): Promise<{ tabId: string; url: string }> {
	const ctx = await getContext();
	const page = await ctx.newPage();
	const tabId = generateTabId();

	pages.set(tabId, page);
	activeTabId = tabId;

	if (url) {
		await page.goto(url, { waitUntil: 'load', timeout: browserConfig.navigationTimeout });
		await waitForPageStable(page);
	}

	return { tabId, url: page.url() };
}

/**
 * Switches the active tab to the specified tab ID.
 */
export function switchTab(tabId: string): void {
	if (!pages.has(tabId)) {
		throw new Error(`Tab ${tabId} not found`);
	}
	activeTabId = tabId;
}

/**
 * Closes the specified tab.
 */
export async function closeTab(tabId: string): Promise<void> {
	const page = pages.get(tabId);
	if (page) {
		await page.close();
		pages.delete(tabId);
	}
	// Switch to another tab if we closed the active one
	if (activeTabId === tabId) {
		const remainingTabs = Array.from(pages.keys());
		activeTabId = remainingTabs.length > 0 ? remainingTabs[0] : null;
	}
}

/**
 * Gets a specific page by tab ID.
 */
export function getPage(tabId: string): Page {
	const page = pages.get(tabId);
	if (!page) {
		throw new Error(`Tab ${tabId} not found`);
	}
	return page;
}

/**
 * Gets the currently active page.
 */
export function getActivePage(): Page {
	if (!activeTabId || !pages.has(activeTabId)) {
		throw new Error('No active tab');
	}
	return pages.get(activeTabId)!;
}

/**
 * Returns a list of all open tab IDs.
 */
export function listTabs(): string[] {
	return Array.from(pages.keys());
}

/**
 * Returns the currently active tab ID, or null if none.
 */
export function getActiveTabId(): string | null {
	return activeTabId;
}

/**
 * Waits for the page load event with a timeout.
 */
async function waitForLoad(p: Page, timeout: number): Promise<void> {
	try {
		await p.waitForLoadState('load', { timeout });
	} catch {
		// Timeout is acceptable - continue
	}
}

/**
 * Waits for network to become idle (no requests for 500ms).
 */
async function waitForNetworkIdle(p: Page, timeout: number): Promise<void> {
	try {
		await p.waitForLoadState('networkidle', { timeout });
	} catch {
		// Timeout is acceptable - some pages have persistent connections
	}
}

/**
 * Browser-side script that waits for DOM stability, fonts, and visible images.
 * This runs inside the browser context via page.evaluate().
 */
function createDomStabilityScript() {
	return ([stableTime, maxTime, imageTimeout]: readonly [number, number, number]) => {
		return new Promise<void>((resolve) => {
			const startTime = Date.now();
			let timeoutId: ReturnType<typeof setTimeout>;
			let resolved = false;

			const finish = () => {
				if (resolved) return;
				resolved = true;
				observer.disconnect();
				clearTimeout(timeoutId);
				resolve();
			};

			const isTimedOut = () => Date.now() - startTime > maxTime;

			const observer = new MutationObserver(() => {
				clearTimeout(timeoutId);
				if (isTimedOut()) {
					finish();
					return;
				}
				timeoutId = setTimeout(finish, stableTime);
			});

			observer.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				characterData: true
			});

			const fontsReady = document.fonts?.ready || Promise.resolve();

			const imagesReady = new Promise<void>((imgResolve) => {
				const visibleImages = Array.from(document.querySelectorAll('img'))
					.filter((img) => {
						const rect = img.getBoundingClientRect();
						return rect.top < window.innerHeight && rect.bottom > 0;
					})
					.filter((img) => !img.complete);

				if (visibleImages.length === 0) {
					imgResolve();
					return;
				}

				let loadedCount = 0;
				const onImageLoaded = () => {
					loadedCount++;
					if (loadedCount >= visibleImages.length) imgResolve();
				};

				visibleImages.forEach((img) => {
					img.addEventListener('load', onImageLoaded, { once: true });
					img.addEventListener('error', onImageLoaded, { once: true });
				});

				setTimeout(imgResolve, imageTimeout);
			});

			Promise.all([fontsReady, imagesReady]).then(() => {
				if (isTimedOut()) {
					finish();
					return;
				}
				timeoutId = setTimeout(finish, stableTime);
			});

			timeoutId = setTimeout(finish, stableTime);
			setTimeout(finish, maxTime);
		});
	};
}

/**
 * Waits for two animation frames to let final paints settle.
 */
async function waitForAnimationFrames(p: Page): Promise<void> {
	try {
		await p.evaluate(() => {
			return new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			});
		});
	} catch {
		// Continue if this fails
	}
}

/**
 * Waits for the page to become stable by checking:
 * 1. Load event
 * 2. Network idle state
 * 3. DOM stability (no mutations for a period)
 * 4. Fonts and visible images loaded
 * 5. Animation frames settled
 */
async function waitForPageStable(p: Page): Promise<void> {
	const startTime = Date.now();
	const remainingTime = () => Math.max(0, browserConfig.maxWaitTimeout - (Date.now() - startTime));

	await waitForLoad(p, remainingTime());
	await waitForNetworkIdle(p, Math.min(browserConfig.networkIdleTimeout, remainingTime()));

	try {
		const domScript = createDomStabilityScript();
		await p.evaluate(domScript, [
			browserConfig.domStableTimeout,
			remainingTime(),
			browserConfig.imageLoadTimeout
		] as const);
	} catch {
		// If evaluate fails, continue
	}

	await waitForAnimationFrames(p);
}

export async function navigateAndScreenshot(
	tabId: string,
	url: string,
	sessionId: string
): Promise<string> {
	const p = getPage(tabId);
	await p.goto(url, { waitUntil: 'load', timeout: browserConfig.navigationTimeout });
	await waitForPageStable(p);
	return captureScreenshot(p, sessionId, '0');
}

export interface ActionResult {
	beforeScreenshot: string;
	afterScreenshot: string;
	beforeUrl: string;
	afterUrl: string;
	redirects: Redirect[];
}

/**
 * Tracks navigation redirects during action execution.
 * Captures screenshots for pages that actually load (not instant HTTP redirects).
 */
async function withRedirectTracking(
	page: Page,
	sessionId: string,
	actionIndex: number,
	beforeUrl: string,
	action: () => Promise<void>
): Promise<Redirect[]> {
	const redirects: Redirect[] = [];
	let redirectCounter = 0;

	// Track each navigation
	const onFrameNavigated = (frame: Frame) => {
		if (frame !== page.mainFrame()) return;
		const url = frame.url();
		// Skip if same as before URL or last tracked redirect
		if (url === beforeUrl) return;
		if (redirects.length > 0 && url === redirects[redirects.length - 1].url) return;
		// Skip about:blank and similar
		if (url.startsWith('about:') || url.startsWith('chrome:')) return;
		redirects.push({ url });
	};

	// Capture screenshot when page actually loads
	const onLoad = async () => {
		const url = page.url();
		// Find the redirect entry for this URL and add screenshot
		const redirect = redirects.find((r) => r.url === url && !r.screenshotPath);
		if (redirect) {
			try {
				redirect.screenshotPath = await captureScreenshot(
					page,
					sessionId,
					`${actionIndex}-redirect-${redirectCounter++}`
				);
			} catch {
				// Screenshot failed, continue without it
			}
		}
	};

	page.on('framenavigated', onFrameNavigated);
	page.on('load', onLoad);

	try {
		await action();
		await waitForPageStable(page);
	} finally {
		page.off('framenavigated', onFrameNavigated);
		page.off('load', onLoad);
	}

	// Remove the final URL from redirects if it matches afterUrl
	// (it will be shown as the action's result, not a redirect)
	const afterUrl = page.url();
	if (redirects.length > 0 && redirects[redirects.length - 1].url === afterUrl) {
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
	const p = getPage(tabId);
	const beforeScreenshot = await captureScreenshot(p, sessionId, `${actionIndex}-before`);
	const beforeUrl = p.url();

	const redirects = await withRedirectTracking(p, sessionId, actionIndex, beforeUrl, async () => {
		await p.mouse.click(x, y);
	});

	const afterScreenshot = await captureScreenshot(p, sessionId, `${actionIndex}-after`);
	const afterUrl = p.url();
	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
}

export async function executeScroll(
	tabId: string,
	direction: 'up' | 'down',
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const p = getPage(tabId);
	const beforeScreenshot = await captureScreenshot(p, sessionId, `${actionIndex}-before`);
	const beforeUrl = p.url();
	const scrollY = direction === 'down' ? browserConfig.scrollAmount : -browserConfig.scrollAmount;

	const redirects = await withRedirectTracking(p, sessionId, actionIndex, beforeUrl, async () => {
		await p.mouse.wheel(0, scrollY);
	});

	const afterScreenshot = await captureScreenshot(p, sessionId, `${actionIndex}-after`);
	const afterUrl = p.url();
	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
}

export async function executeType(
	tabId: string,
	text: string,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const p = getPage(tabId);
	const beforeScreenshot = await captureScreenshot(p, sessionId, `${actionIndex}-before`);
	const beforeUrl = p.url();

	const redirects = await withRedirectTracking(p, sessionId, actionIndex, beforeUrl, async () => {
		await p.keyboard.type(text, { delay: browserConfig.typingDelay });
	});

	const afterScreenshot = await captureScreenshot(p, sessionId, `${actionIndex}-after`);
	const afterUrl = p.url();
	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
}

export async function executeWait(
	tabId: string,
	sessionId: string,
	actionIndex: number
): Promise<ActionResult> {
	const p = getPage(tabId);
	const beforeScreenshot = await captureScreenshot(p, sessionId, `${actionIndex}-before`);
	const beforeUrl = p.url();

	const redirects = await withRedirectTracking(p, sessionId, actionIndex, beforeUrl, async () => {
		// Wait action: no immediate action, just wait for stability
	});

	const afterScreenshot = await captureScreenshot(p, sessionId, `${actionIndex}-after`);
	const afterUrl = p.url();
	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
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
	const p = getPage(tabId);

	// Capture BEFORE state
	const beforeScreenshot = await captureScreenshot(p, sessionId, `replay-${actionIndex}-before`);
	const beforeUrl = p.url();

	// Execute the action with redirect tracking
	const redirects = await withRedirectTracking(
		p,
		sessionId,
		actionIndex,
		beforeUrl,
		async () => {
			if (action.type === 'click' && action.coordinates) {
				await p.mouse.click(action.coordinates.x, action.coordinates.y);
			} else if (action.type === 'scroll' && action.direction) {
				const scrollY =
					action.direction === 'down' ? browserConfig.scrollAmount : -browserConfig.scrollAmount;
				await p.mouse.wheel(0, scrollY);
			} else if (action.type === 'type' && action.text) {
				await p.keyboard.type(action.text, { delay: browserConfig.typingDelay });
			}
			// For 'wait' and 'stop' actions, just wait for page stability
		}
	);

	// Capture AFTER state
	const afterScreenshot = await captureScreenshot(p, sessionId, `replay-${actionIndex}-after`);
	const afterUrl = p.url();

	return { beforeScreenshot, afterScreenshot, beforeUrl, afterUrl, redirects };
}

export async function refreshScreenshot(tabId: string, sessionId: string): Promise<string> {
	const p = getPage(tabId);
	const timestamp = Date.now();
	return captureScreenshot(p, sessionId, `refresh-${timestamp}`);
}

export async function closeBrowser(): Promise<void> {
	// Close all pages
	for (const page of pages.values()) {
		await page.close();
	}
	pages.clear();
	activeTabId = null;

	// Close context and browser
	if (context) {
		await context.close();
		context = null;
	}
	if (browser) {
		await browser.close();
		browser = null;
	}
}

export function getViewport() {
	return browserConfig.viewport;
}

export function getCurrentUrl(tabId: string): string {
	const p = getPage(tabId);
	return p.url();
}
