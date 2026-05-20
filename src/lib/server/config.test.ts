import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('browserConfig', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('uses default values when no environment variables set', async () => {
		const { browserConfig } = await import('./config');

		expect(browserConfig.viewport.width).toBe(1280);
		expect(browserConfig.viewport.height).toBe(800);
		expect(browserConfig.scrollAmount).toBe(400);
		expect(browserConfig.domStableTimeout).toBe(750);
		expect(browserConfig.maxWaitTimeout).toBe(15000);
		expect(browserConfig.typingDelay).toBe(50);
		expect(browserConfig.navigationTimeout).toBe(30000);
		expect(browserConfig.networkIdleTimeout).toBe(5000);
		expect(browserConfig.imageLoadTimeout).toBe(3000);
	});

	it('reads viewport width from environment variable', async () => {
		process.env.BROWSER_VIEWPORT_WIDTH = '1920';
		const { browserConfig } = await import('./config');

		expect(browserConfig.viewport.width).toBe(1920);
	});

	it('reads viewport height from environment variable', async () => {
		process.env.BROWSER_VIEWPORT_HEIGHT = '1080';
		const { browserConfig } = await import('./config');

		expect(browserConfig.viewport.height).toBe(1080);
	});

	it('reads scroll amount from environment variable', async () => {
		process.env.BROWSER_SCROLL_AMOUNT = '600';
		const { browserConfig } = await import('./config');

		expect(browserConfig.scrollAmount).toBe(600);
	});

	it('reads DOM stable timeout from environment variable', async () => {
		process.env.BROWSER_DOM_STABLE_TIMEOUT = '1000';
		const { browserConfig } = await import('./config');

		expect(browserConfig.domStableTimeout).toBe(1000);
	});

	it('reads max wait timeout from environment variable', async () => {
		process.env.BROWSER_MAX_WAIT_TIMEOUT = '20000';
		const { browserConfig } = await import('./config');

		expect(browserConfig.maxWaitTimeout).toBe(20000);
	});

	it('reads typing delay from environment variable', async () => {
		process.env.BROWSER_TYPING_DELAY = '100';
		const { browserConfig } = await import('./config');

		expect(browserConfig.typingDelay).toBe(100);
	});

	it('reads navigation timeout from environment variable', async () => {
		process.env.BROWSER_NAVIGATION_TIMEOUT = '60000';
		const { browserConfig } = await import('./config');

		expect(browserConfig.navigationTimeout).toBe(60000);
	});

	it('reads network idle timeout from environment variable', async () => {
		process.env.BROWSER_NETWORK_IDLE_TIMEOUT = '10000';
		const { browserConfig } = await import('./config');

		expect(browserConfig.networkIdleTimeout).toBe(10000);
	});

	it('reads image load timeout from environment variable', async () => {
		process.env.BROWSER_IMAGE_LOAD_TIMEOUT = '5000';
		const { browserConfig } = await import('./config');

		expect(browserConfig.imageLoadTimeout).toBe(5000);
	});

	it('ignores invalid (non-numeric) environment values', async () => {
		process.env.BROWSER_VIEWPORT_WIDTH = 'not-a-number';
		process.env.BROWSER_SCROLL_AMOUNT = 'abc';
		const { browserConfig } = await import('./config');

		expect(browserConfig.viewport.width).toBe(1280);
		expect(browserConfig.scrollAmount).toBe(400);
	});

	it('handles empty string environment values', async () => {
		process.env.BROWSER_VIEWPORT_WIDTH = '';
		const { browserConfig } = await import('./config');

		expect(browserConfig.viewport.width).toBe(1280);
	});
});
