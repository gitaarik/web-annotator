import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

const VIEWPORT = { width: 1280, height: 800 };
const SCROLL_AMOUNT = 400;
const DOM_STABLE_TIMEOUT = 750; // Time with no mutations to consider DOM stable (increased from 500)
const MAX_WAIT_TIMEOUT = 15000; // Max time to wait for page stability

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
	const startTime = Date.now();
	const remainingTime = () => Math.max(0, MAX_WAIT_TIMEOUT - (Date.now() - startTime));

	// 1. Wait for load event
	try {
		await p.waitForLoadState('load', { timeout: remainingTime() });
	} catch {
		// Timeout is ok - continue
	}

	// 2. Wait for network idle (no requests for 500ms)
	// This catches AJAX/fetch requests that fire after load
	try {
		await p.waitForLoadState('networkidle', { timeout: Math.min(5000, remainingTime()) });
	} catch {
		// Timeout is ok - some pages have persistent connections
	}

	// 3. Wait for fonts and images, plus DOM stability
	try {
		await p.evaluate(
			([stableTime, maxTime]) => {
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

					// Check if we've exceeded max wait time
					const checkMaxTime = () => {
						if (Date.now() - startTime > maxTime) {
							finish();
							return true;
						}
						return false;
					};

					const observer = new MutationObserver(() => {
						clearTimeout(timeoutId);
						if (checkMaxTime()) return;

						timeoutId = setTimeout(finish, stableTime);
					});

					observer.observe(document.body, {
						childList: true,
						subtree: true,
						attributes: true,
						characterData: true
					});

					// Wait for fonts to load
					const fontsReady = document.fonts?.ready || Promise.resolve();

					// Wait for visible images to load
					const imagesReady = new Promise<void>((imgResolve) => {
						const images = Array.from(document.querySelectorAll('img'))
							.filter((img) => {
								const rect = img.getBoundingClientRect();
								return rect.top < window.innerHeight && rect.bottom > 0;
							})
							.filter((img) => !img.complete);

						if (images.length === 0) {
							imgResolve();
							return;
						}

						let loadedCount = 0;
						const checkDone = () => {
							loadedCount++;
							if (loadedCount >= images.length) imgResolve();
						};

						images.forEach((img) => {
							img.addEventListener('load', checkDone, { once: true });
							img.addEventListener('error', checkDone, { once: true });
						});

						// Don't wait forever for images
						setTimeout(imgResolve, 3000);
					});

					// Combine all checks
					Promise.all([fontsReady, imagesReady]).then(() => {
						if (checkMaxTime()) return;
						// After fonts/images, still wait for DOM stability
						timeoutId = setTimeout(finish, stableTime);
					});

					// Initial timeout in case there are no mutations
					timeoutId = setTimeout(finish, stableTime);

					// Absolute max timeout
					setTimeout(finish, maxTime);
				});
			},
			[DOM_STABLE_TIMEOUT, remainingTime()] as const
		);
	} catch {
		// If evaluate fails, just continue
	}

	// 4. Wait a couple of animation frames to let any final paints settle
	try {
		await p.evaluate(() => {
			return new Promise<void>((resolve) => {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						resolve();
					});
				});
			});
		});
	} catch {
		// Continue if this fails
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

export async function refreshScreenshot(sessionId: string): Promise<string> {
	const p = await getPage();

	const screenshotPath = path.join(
		process.cwd(),
		'static',
		'screenshots',
		sessionId,
		`refresh-${Date.now()}.png`
	);
	await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
	await p.screenshot({ path: screenshotPath, fullPage: false });

	return `/screenshots/${sessionId}/refresh-${Date.now()}.png`;
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
