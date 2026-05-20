/**
 * Chrome DevTools Protocol (CDP) client.
 *
 * Provides methods for navigation, screenshots, and page interaction
 * via direct CDP WebSocket communication.
 */

import WebSocket from 'ws';
import http from 'http';

interface CdpMessage {
	id: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code: number; message: string };
}

/**
 * CDP client for a single Chrome session.
 */
export class CdpClient {
	private ws: WebSocket | null = null;
	private messageId = 0;
	private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private pageWsUrl: string | null = null;

	constructor(
		public readonly cdpPort: number,
		public readonly browserWsUrl: string
	) {}

	/**
	 * Get the WebSocket URL for the first page target.
	 */
	async getPageWsUrl(): Promise<string> {
		if (this.pageWsUrl) return this.pageWsUrl;

		const targets = await this.fetchTargets();
		const page = targets.find((t) => t.type === 'page');
		if (!page) {
			throw new Error('No page target found');
		}
		this.pageWsUrl = page.webSocketDebuggerUrl;
		return this.pageWsUrl;
	}

	/**
	 * Fetch list of targets from Chrome.
	 */
	private fetchTargets(): Promise<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl: string }>> {
		return new Promise((resolve, reject) => {
			const req = http.get(`http://127.0.0.1:${this.cdpPort}/json`, (res) => {
				let data = '';
				res.on('data', (chunk) => (data += chunk));
				res.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch {
						reject(new Error('Invalid JSON from /json'));
					}
				});
			});
			req.on('error', reject);
			req.setTimeout(5000, () => {
				req.destroy();
				reject(new Error('Timeout fetching targets'));
			});
		});
	}

	/**
	 * Connect to the page WebSocket.
	 */
	async connect(): Promise<void> {
		const wsUrl = await this.getPageWsUrl();

		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(wsUrl);

			this.ws.on('open', () => {
				console.log('[CDP] Connected to page');
				resolve();
			});

			this.ws.on('message', (data) => {
				try {
					const msg: CdpMessage = JSON.parse(data.toString());
					if (msg.id !== undefined) {
						const pending = this.pendingRequests.get(msg.id);
						if (pending) {
							this.pendingRequests.delete(msg.id);
							if (msg.error) {
								pending.reject(new Error(`CDP error: ${msg.error.message}`));
							} else {
								pending.resolve(msg.result);
							}
						}
					}
				} catch {
					// Ignore parse errors
				}
			});

			this.ws.on('error', (err) => {
				console.error('[CDP] WebSocket error:', err.message);
				reject(err);
			});

			this.ws.on('close', () => {
				console.log('[CDP] Connection closed');
				this.ws = null;
				this.pageWsUrl = null;
			});
		});
	}

	/**
	 * Ensure we're connected to the page.
	 */
	private async ensureConnected(): Promise<void> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			await this.connect();
		}
	}

	/**
	 * Send a CDP command and wait for response.
	 */
	async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
		await this.ensureConnected();

		const id = ++this.messageId;
		const message = JSON.stringify({ id, method, params });

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`CDP timeout: ${method}`));
				}
			}, 30000);

			this.ws!.send(message);
		});
	}

	/**
	 * Inject stealth scripts to prevent bot detection.
	 * Must be called before navigating to any page.
	 * Uses Page.addScriptToEvaluateOnNewDocument so scripts run before any page JS.
	 */
	async injectStealthScripts(): Promise<void> {
		// This script runs before any page JavaScript
		const stealthScript = `
			// Hide navigator.webdriver
			Object.defineProperty(navigator, 'webdriver', {
				get: () => undefined,
				configurable: true
			});

			// Hide automation-related properties from window
			delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
			delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
			delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

			// Fix permissions API to not reveal automation
			const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
			if (originalQuery) {
				window.navigator.permissions.query = (parameters) => {
					if (parameters.name === 'notifications') {
						return Promise.resolve({ state: Notification.permission, onchange: null });
					}
					return originalQuery(parameters);
				};
			}

			// Fix plugins to look more realistic (headless Chrome has empty plugins)
			Object.defineProperty(navigator, 'plugins', {
				get: () => [
					{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
					{ name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
					{ name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
				],
				configurable: true
			});

			// Fix languages
			Object.defineProperty(navigator, 'languages', {
				get: () => ['en-US', 'en'],
				configurable: true
			});
		`;

		await this.send('Page.addScriptToEvaluateOnNewDocument', { source: stealthScript });
		console.log('[CDP] Stealth scripts injected');
	}

	/**
	 * Navigate to a URL.
	 */
	async navigate(url: string): Promise<void> {
		await this.send('Page.navigate', { url });
		// Wait for load event
		await this.send('Page.enable');
		await new Promise<void>((resolve) => {
			const checkLoad = async () => {
				try {
					const result = await this.send('Runtime.evaluate', {
						expression: 'document.readyState',
						returnByValue: true
					}) as { result?: { value?: string } };

					if (result?.result?.value === 'complete') {
						resolve();
					} else {
						setTimeout(checkLoad, 100);
					}
				} catch {
					setTimeout(checkLoad, 100);
				}
			};
			checkLoad();
		});
	}

	/**
	 * Get current URL.
	 */
	async getUrl(): Promise<string> {
		const result = await this.send('Runtime.evaluate', {
			expression: 'window.location.href',
			returnByValue: true
		}) as { result?: { value?: string } };
		return result?.result?.value || '';
	}

	/**
	 * Capture a screenshot.
	 * Returns base64-encoded PNG data.
	 */
	async screenshot(options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<string> {
		const result = await this.send('Page.captureScreenshot', {
			format: options?.format || 'png',
			quality: options?.quality
		}) as { data: string };
		return result.data;
	}

	/**
	 * Get viewport/window metrics.
	 */
	async getLayoutMetrics(): Promise<{
		contentSize: { width: number; height: number };
		layoutViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
		cssLayoutViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
	}> {
		const result = await this.send('Page.getLayoutMetrics');
		return result as {
			contentSize: { width: number; height: number };
			layoutViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
			cssLayoutViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
		};
	}

	/**
	 * Get browser window bounds.
	 */
	async getWindowBounds(): Promise<{
		left: number;
		top: number;
		width: number;
		height: number;
		windowState: string;
	}> {
		// First get the window ID
		const windowResult = await this.send('Browser.getWindowForTarget') as {
			windowId: number;
			bounds: { left: number; top: number; width: number; height: number; windowState: string };
		};
		return windowResult.bounds;
	}

	/**
	 * Get precise content viewport position using JavaScript.
	 * This accounts for infobars and other dynamic Chrome UI elements.
	 */
	async getContentViewportInfo(): Promise<{
		screenX: number;
		screenY: number;
		outerWidth: number;
		outerHeight: number;
		innerWidth: number;
		innerHeight: number;
		devicePixelRatio: number;
		chromeBarHeight: number;
		contentTop: number;
		contentLeft: number;
	}> {
		const result = await this.send('Runtime.evaluate', {
			expression: `({
				screenX: window.screenX,
				screenY: window.screenY,
				outerWidth: window.outerWidth,
				outerHeight: window.outerHeight,
				innerWidth: window.innerWidth,
				innerHeight: window.innerHeight,
				devicePixelRatio: window.devicePixelRatio
			})`,
			returnByValue: true
		}) as { result?: { value?: {
			screenX: number;
			screenY: number;
			outerWidth: number;
			outerHeight: number;
			innerWidth: number;
			innerHeight: number;
			devicePixelRatio: number;
		} } };

		const info = result?.result?.value;
		if (!info) {
			throw new Error('Failed to get viewport info from page');
		}

		// Chrome bar height includes tabs, address bar, bookmarks bar, and any infobars
		const chromeBarHeight = info.outerHeight - info.innerHeight;
		// Content area starts at screenY + chromeBarHeight
		const contentTop = info.screenY + chromeBarHeight;
		// Left border (usually minimal)
		const leftBorder = Math.floor((info.outerWidth - info.innerWidth) / 2);
		const contentLeft = info.screenX + leftBorder;

		return {
			...info,
			chromeBarHeight,
			contentTop,
			contentLeft
		};
	}

	/**
	 * Scroll the page.
	 */
	async scroll(deltaX: number, deltaY: number, x?: number, y?: number): Promise<void> {
		const metrics = await this.getLayoutMetrics();
		const scrollX = x ?? metrics.layoutViewport.clientWidth / 2;
		const scrollY = y ?? metrics.layoutViewport.clientHeight / 2;

		await this.send('Input.dispatchMouseEvent', {
			type: 'mouseWheel',
			x: scrollX,
			y: scrollY,
			deltaX,
			deltaY
		});
	}

	/**
	 * Click at coordinates (CDP method, not OS-level).
	 * Use this as fallback when OS-level click fails.
	 */
	async cdpClick(x: number, y: number): Promise<void> {
		await this.send('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			x,
			y,
			button: 'left',
			clickCount: 1
		});
		await this.send('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			x,
			y,
			button: 'left',
			clickCount: 1
		});
	}

	/**
	 * Type text (CDP method, not OS-level).
	 * Use this as fallback when OS-level typing fails.
	 */
	async cdpType(text: string, delay = 50): Promise<void> {
		for (const char of text) {
			await this.send('Input.dispatchKeyEvent', {
				type: 'keyDown',
				text: char,
				key: char,
				code: ''
			});
			await this.send('Input.dispatchKeyEvent', {
				type: 'keyUp',
				key: char,
				code: ''
			});
			if (delay > 0) {
				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}

	/**
	 * Close the CDP connection.
	 */
	close(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.pageWsUrl = null;
		this.pendingRequests.clear();
	}
}
