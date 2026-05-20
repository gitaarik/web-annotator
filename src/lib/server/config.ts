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
	imageLoadTimeout: getEnvNumber('BROWSER_IMAGE_LOAD_TIMEOUT', 3000),

	/** Post-action monitoring for delayed redirects (ms) */
	postActionMonitorTimeout: getEnvNumber('BROWSER_POST_ACTION_MONITOR_TIMEOUT', 3000)
} as const;

export type BrowserConfig = typeof browserConfig;

/**
 * OS-level input configuration.
 * When enabled, uses real OS events (xdotool/osascript/SendKeys) instead of CDP.
 */
export const inputConfig = {
	/** Enable OS-level input (USE_OS_INPUT=false to disable, default: true) */
	useOsInput: process.env.USE_OS_INPUT !== 'false',

	/** Base delay between keystrokes in ms */
	charDelayMs: getEnvNumber('CHAR_DELAY_MS', 50),

	/** Variance factor for typing delays (0.4 = ±40%) */
	charDelayVariance: 0.4,

	/** Mouse movement config */
	mouse: {
		minSteps: 15,
		maxSteps: 30,
		tremorAmount: 2
	}
} as const;

export type InputConfig = typeof inputConfig;
