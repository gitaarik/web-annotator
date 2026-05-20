/**
 * Browser automation configuration.
 * These can be overridden via environment variables.
 */

function getEnvNumber(key: string, defaultValue: number): number {
	const value = process.env[key];
	if (value) {
		const parsed = parseInt(value, 10);
		if (!isNaN(parsed)) {
			return parsed;
		}
	}
	return defaultValue;
}

export const browserConfig = {
	/** Browser viewport dimensions */
	viewport: {
		width: getEnvNumber('BROWSER_VIEWPORT_WIDTH', 1280),
		height: getEnvNumber('BROWSER_VIEWPORT_HEIGHT', 800)
	},

	/** Amount to scroll on scroll actions (in pixels) */
	scrollAmount: getEnvNumber('BROWSER_SCROLL_AMOUNT', 400),

	/** Time with no DOM mutations to consider the page stable (ms) */
	domStableTimeout: getEnvNumber('BROWSER_DOM_STABLE_TIMEOUT', 750),

	/** Maximum time to wait for page stability (ms) */
	maxWaitTimeout: getEnvNumber('BROWSER_MAX_WAIT_TIMEOUT', 15000),

	/** Typing delay between keystrokes (ms) */
	typingDelay: getEnvNumber('BROWSER_TYPING_DELAY', 50),

	/** Navigation timeout (ms) */
	navigationTimeout: getEnvNumber('BROWSER_NAVIGATION_TIMEOUT', 30000),

	/** Network idle timeout (ms) */
	networkIdleTimeout: getEnvNumber('BROWSER_NETWORK_IDLE_TIMEOUT', 5000),

	/** Image loading timeout (ms) */
	imageLoadTimeout: getEnvNumber('BROWSER_IMAGE_LOAD_TIMEOUT', 3000)
} as const;

export type BrowserConfig = typeof browserConfig;
