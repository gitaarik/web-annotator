import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

const VIEWPORT = { width: 1280, height: 800 };
const SCROLL_AMOUNT = 400;
const DOM_STABLE_TIMEOUT = 500; // Time with no mutations to consider DOM stable
const MAX_WAIT_TIMEOUT = 10000; // Max time to wait for page stability

let browser: Browser | null = null;
let page: Page | null = null;

async function getBrowser(): Promise<Browser> {
	if (!browser) {
		browser = await chromium.launch({ headless: true });
	}
	return browser;
}

async function getPage(): Promise<Page> {
	if (!page || page.isClosed()) {
		const b = await getBrowser();
		const context = await b.newContext({ viewport: VIEWPORT });
		page = await context.newPage();
	}
	return page;
}

async function waitForPageStable(p: Page): Promise<void> {
	try {
		// First ensure the page has fired its load event
		await p.waitForLoadState('load', { timeout: MAX_WAIT_TIMEOUT });
	} catch {
		// Timeout is ok - continue to DOM stability check
	}

	// Then wait for DOM stability - no mutations for DOM_STABLE_TIMEOUT ms
	try {
		await p.evaluate(
			([stableTime, maxTime]) => {
				return new Promise<void>((resolve) => {
					let timeoutId: ReturnType<typeof setTimeout>;
					const startTime = Date.now();

					const observer = new MutationObserver(() => {
						// Reset the timer on each mutation
						clearTimeout(timeoutId);

						// Check if we've exceeded max wait time
						if (Date.now() - startTime > maxTime) {
							observer.disconnect();
							resolve();
							return;
						}

						// Wait for stability period with no mutations
						timeoutId = setTimeout(() => {
							observer.disconnect();
							resolve();
						}, stableTime);
					});

					observer.observe(document.body, {
						childList: true,
						subtree: true,
						attributes: true,
						characterData: true
					});

					// Initial timeout in case there are no mutations at all
					timeoutId = setTimeout(() => {
						observer.disconnect();
						resolve();
					}, stableTime);
				});
			},
			[DOM_STABLE_TIMEOUT, MAX_WAIT_TIMEOUT] as const
		);
	} catch {
		// If evaluate fails, just continue
	}
}

export async function navigateAndScreenshot(
	url: string,
	sessionId: string
): Promise<string> {
	const p = await getPage();
	await p.goto(url, { waitUntil: 'load', timeout: 30000 });
	await waitForPageStable(p);

	const screenshotDir = path.join(process.cwd(), 'static', 'screenshots', sessionId);
	await fs.mkdir(screenshotDir, { recursive: true });

	const screenshotPath = path.join(screenshotDir, '0.png');
	await p.screenshot({ path: screenshotPath, fullPage: false });

	return `/screenshots/${sessionId}/0.png`;
}

export async function executeClick(
	x: number,
	y: number,
	sessionId: string,
	actionIndex: number
): Promise<string> {
	const p = await getPage();
	await p.mouse.click(x, y);
	await waitForPageStable(p);

	const screenshotPath = path.join(
		process.cwd(),
		'static',
		'screenshots',
		sessionId,
		`${actionIndex}.png`
	);
	await p.screenshot({ path: screenshotPath, fullPage: false });

	return `/screenshots/${sessionId}/${actionIndex}.png`;
}

export async function executeScroll(
	direction: 'up' | 'down',
	sessionId: string,
	actionIndex: number
): Promise<string> {
	const p = await getPage();
	const scrollY = direction === 'down' ? SCROLL_AMOUNT : -SCROLL_AMOUNT;
	await p.mouse.wheel(0, scrollY);
	await waitForPageStable(p);

	const screenshotPath = path.join(
		process.cwd(),
		'static',
		'screenshots',
		sessionId,
		`${actionIndex}.png`
	);
	await p.screenshot({ path: screenshotPath, fullPage: false });

	return `/screenshots/${sessionId}/${actionIndex}.png`;
}

export async function executeType(
	text: string,
	sessionId: string,
	actionIndex: number
): Promise<string> {
	const p = await getPage();
	await p.keyboard.type(text, { delay: 50 });
	await waitForPageStable(p);

	const screenshotPath = path.join(
		process.cwd(),
		'static',
		'screenshots',
		sessionId,
		`${actionIndex}.png`
	);
	await p.screenshot({ path: screenshotPath, fullPage: false });

	return `/screenshots/${sessionId}/${actionIndex}.png`;
}

export async function executeWait(
	sessionId: string,
	actionIndex: number
): Promise<string> {
	const p = await getPage();
	await waitForPageStable(p);

	const screenshotPath = path.join(
		process.cwd(),
		'static',
		'screenshots',
		sessionId,
		`${actionIndex}.png`
	);
	await p.screenshot({ path: screenshotPath, fullPage: false });

	return `/screenshots/${sessionId}/${actionIndex}.png`;
}

export async function replaySingleAction(
	action: {
		type: string;
		coordinates?: { x: number; y: number };
		direction?: 'up' | 'down';
		text?: string;
	},
	sessionId: string,
	actionIndex: number
): Promise<string> {
	const p = await getPage();

	if (action.type === 'click' && action.coordinates) {
		await p.mouse.click(action.coordinates.x, action.coordinates.y);
	} else if (action.type === 'scroll' && action.direction) {
		const scrollY = action.direction === 'down' ? SCROLL_AMOUNT : -SCROLL_AMOUNT;
		await p.mouse.wheel(0, scrollY);
	} else if (action.type === 'type' && action.text) {
		await p.keyboard.type(action.text, { delay: 50 });
	}
	// For 'wait' and 'stop' actions, just wait for page stability

	await waitForPageStable(p);

	const screenshotPath = path.join(
		process.cwd(),
		'static',
		'screenshots',
		sessionId,
		`replay-${actionIndex}.png`
	);
	await p.screenshot({ path: screenshotPath, fullPage: false });

	return `/screenshots/${sessionId}/replay-${actionIndex}.png`;
}

export async function closeBrowser(): Promise<void> {
	if (page) {
		await page.close();
		page = null;
	}
	if (browser) {
		await browser.close();
		browser = null;
	}
}

export function getViewport() {
	return VIEWPORT;
}

export async function initBrowser(): Promise<void> {
	await getPage();
	console.log('Browser initialized and ready');
}
