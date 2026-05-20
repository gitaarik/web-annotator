import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

const VIEWPORT = { width: 1280, height: 800 };
const SCROLL_AMOUNT = 400;

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

export async function navigateAndScreenshot(
	url: string,
	sessionId: string
): Promise<string> {
	const p = await getPage();
	await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

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
	await p.waitForTimeout(500);

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
	await p.waitForTimeout(500);

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
	await p.waitForTimeout(300);

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
