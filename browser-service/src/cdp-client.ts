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
 * Per-attempt timeout for screenshots. Shorter than the default 30s `send`
 * timeout so a wedged renderer (page JS blocking the main thread) surfaces in
 * seconds instead of ~90s (3 x 30s).
 */
const SCREENSHOT_TIMEOUT_MS = 8000;

/**
 * Overall deadline for waiting on `document.readyState` to reach 'complete'
 * after a navigation. Bounds the polling loop so a page that never finishes
 * loading (or a renderer that can't answer on reconnect) can't hang the
 * request forever.
 */
const NAVIGATE_LOAD_TIMEOUT_MS = 30000;

/**
 * Timeout for opening the page WebSocket. Without this a stale page target that
 * accepts the socket but never fires 'open'/'error' would leave connect()
 * pending forever, hanging every request that waits on it (and the UI on
 * "Initializing browser..."). 10s is generous for a local Chrome.
 */
const CONNECT_TIMEOUT_MS = 10000;

/**
 * Thrown when the renderer's main thread is blocked (e.g. the page's own
 * JavaScript is stuck in a synchronous wait), so it can't produce a frame or
 * answer CDP. Callers can distinguish this from transient failures and prompt
 * the user to reload rather than retrying pointlessly.
 */
export class RendererUnresponsiveError extends Error {
	readonly code = 'RENDERER_UNRESPONSIVE';
	constructor(message = 'Page is unresponsive (renderer main thread blocked)') {
		super(message);
		this.name = 'RendererUnresponsiveError';
	}
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

			// Fail fast if the socket never opens, so callers can't hang forever.
			let settled = false;
			const connectTimer = setTimeout(() => {
				if (settled) return;
				settled = true;
				this.ws?.terminate();
				this.ws = null;
				this.pageWsUrl = null;
				reject(new Error('CDP connect timeout'));
			}, CONNECT_TIMEOUT_MS);

			this.ws.on('open', () => {
				if (settled) return;
				settled = true;
				clearTimeout(connectTimer);
				console.log('[CDP] Connected to page');
				// Enable Page events so we receive (and can dismiss) JavaScript
				// dialogs. An unhandled dialog blocks the renderer's main thread,
				// which stalls screenshots and every other CDP call.
				this.send('Page.enable').catch(() => {});
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
					} else if (msg.method) {
						this.handleEvent(msg.method, msg.params);
					}
				} catch {
					// Ignore parse errors
				}
			});

			this.ws.on('error', (err) => {
				console.error('[CDP] WebSocket error:', err.message);
				this.rejectAllPending(new Error(`WebSocket error: ${err.message}`));
				if (settled) return;
				settled = true;
				clearTimeout(connectTimer);
				reject(err);
			});

			this.ws.on('close', () => {
				console.log('[CDP] Connection closed');
				this.rejectAllPending(new Error('WebSocket connection closed'));
				this.ws = null;
				this.pageWsUrl = null;
				// If the socket closed before it ever opened, fail the connect.
				if (settled) return;
				settled = true;
				clearTimeout(connectTimer);
				reject(new Error('WebSocket closed before open'));
			});
		});
	}

	/**
	 * Handle unsolicited CDP events (messages without an id).
	 */
	private handleEvent(method: string, params?: Record<string, unknown>): void {
		if (method === 'Page.javascriptDialogOpening') {
			// A JavaScript dialog (alert/confirm/prompt/beforeunload) blocks the
			// renderer's main thread until dismissed. Auto-handle it so it can't
			// freeze the page: proceed through beforeunload prompts (the user was
			// navigating), and dismiss everything else without taking affirmative
			// action.
			const type = params?.type as string | undefined;
			const accept = type === 'beforeunload';
			console.log(`[CDP] Auto-handling JS dialog (type=${type}, accept=${accept})`);
			this.send('Page.handleJavaScriptDialog', { accept }).catch(() => {});
		}
	}

	/**
	 * Reject all pending requests (called on connection close/error).
	 */
	private rejectAllPending(error: Error): void {
		for (const [id, pending] of this.pendingRequests) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
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
	 * @param method CDP method name
	 * @param params Method parameters
	 * @param timeout Timeout in ms (default: 30000)
	 */
	async send(
		method: string,
		params: Record<string, unknown> = {},
		timeout = 30000
	): Promise<unknown> {
		await this.ensureConnected();

		const id = ++this.messageId;
		const message = JSON.stringify({ id, method, params });

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });

			// Timeout
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`CDP timeout: ${method}`));
				}
			}, timeout);

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

			// Hide automation-related properties from window (Chrome DevTools Protocol markers)
			const cdcProps = Object.keys(window).filter(k => k.startsWith('cdc_') || k.startsWith('$cdc_'));
			cdcProps.forEach(prop => { try { delete window[prop]; } catch(e) {} });

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
			const pluginData = [
				{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
				{ name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
				{ name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 }
			];
			const pluginArray = Object.create(PluginArray.prototype);
			pluginData.forEach((p, i) => {
				const plugin = Object.create(Plugin.prototype);
				Object.defineProperties(plugin, {
					name: { value: p.name, enumerable: true },
					filename: { value: p.filename, enumerable: true },
					description: { value: p.description, enumerable: true },
					length: { value: p.length, enumerable: true }
				});
				pluginArray[i] = plugin;
				pluginArray[p.name] = plugin;
			});
			Object.defineProperty(pluginArray, 'length', { value: pluginData.length });
			Object.defineProperty(navigator, 'plugins', { get: () => pluginArray, configurable: true });

			// Fix mimeTypes
			const mimeTypeData = [
				{ type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf' },
				{ type: 'text/pdf', description: 'Portable Document Format', suffixes: 'pdf' }
			];
			const mimeTypeArray = Object.create(MimeTypeArray.prototype);
			mimeTypeData.forEach((m, i) => {
				const mimeType = Object.create(MimeType.prototype);
				Object.defineProperties(mimeType, {
					type: { value: m.type, enumerable: true },
					description: { value: m.description, enumerable: true },
					suffixes: { value: m.suffixes, enumerable: true },
					enabledPlugin: { value: pluginArray[0], enumerable: true }
				});
				mimeTypeArray[i] = mimeType;
				mimeTypeArray[m.type] = mimeType;
			});
			Object.defineProperty(mimeTypeArray, 'length', { value: mimeTypeData.length });
			Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypeArray, configurable: true });

			// Fix languages
			Object.defineProperty(navigator, 'languages', {
				get: () => ['en-US', 'en'],
				configurable: true
			});

			// Hardware concurrency (realistic value)
			Object.defineProperty(navigator, 'hardwareConcurrency', {
				get: () => 8,
				configurable: true
			});

			// Device memory (realistic value)
			Object.defineProperty(navigator, 'deviceMemory', {
				get: () => 8,
				configurable: true
			});

			// Fix chrome object (missing in some automation setups)
			if (!window.chrome) {
				window.chrome = {};
			}
			if (!window.chrome.runtime) {
				window.chrome.runtime = {
					connect: () => {},
					sendMessage: () => {},
					onMessage: { addListener: () => {}, removeListener: () => {} },
					onConnect: { addListener: () => {}, removeListener: () => {} },
					id: undefined
				};
			}

			// WebGL vendor/renderer - make consistent with real Chrome on Linux
			const getParameterProto = WebGLRenderingContext.prototype.getParameter;
			WebGLRenderingContext.prototype.getParameter = function(param) {
				if (param === 37445) return 'Google Inc. (NVIDIA)'; // UNMASKED_VENDOR_WEBGL
				if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)'; // UNMASKED_RENDERER_WEBGL
				return getParameterProto.call(this, param);
			};
			const getParameter2Proto = WebGL2RenderingContext.prototype.getParameter;
			WebGL2RenderingContext.prototype.getParameter = function(param) {
				if (param === 37445) return 'Google Inc. (NVIDIA)';
				if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
				return getParameter2Proto.call(this, param);
			};

			// Prevent detection via toString
			const originalToString = Function.prototype.toString;
			Function.prototype.toString = function() {
				if (this === navigator.permissions.query) {
					return 'function query() { [native code] }';
				}
				return originalToString.call(this);
			};

			// Fix connection type (automation often missing)
			if (navigator.connection) {
				Object.defineProperty(navigator.connection, 'rtt', { get: () => 50, configurable: true });
			}

			// Notification permission consistency
			Object.defineProperty(Notification, 'permission', {
				get: () => 'default',
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
		// Poll readyState until 'complete', but bound the wait with an overall
		// deadline. Some pages (streaming, long-polling, or a wedged renderer on
		// reconnect) never reach 'complete'; without a deadline this loop would
		// retry forever and the HTTP request would hang indefinitely, leaving the
		// UI stuck on "Initializing browser...". A page that hasn't finished is
		// still usable and screenshottable, so we resolve rather than reject.
		const deadline = Date.now() + NAVIGATE_LOAD_TIMEOUT_MS;
		await new Promise<void>((resolve) => {
			const checkLoad = async () => {
				if (Date.now() >= deadline) {
					console.log('[CDP] Navigate load wait timed out; proceeding anyway');
					resolve();
					return;
				}
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
	 * Includes retry logic for transient failures (e.g., connection issues).
	 */
	async screenshot(options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<string> {
		const maxRetries = 3;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const result = (await this.send(
					'Page.captureScreenshot',
					{
						format: options?.format || 'png',
						quality: options?.quality
					},
					SCREENSHOT_TIMEOUT_MS
				)) as { data: string };
				return result.data;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				console.log(
					`[CDP] Screenshot attempt ${attempt}/${maxRetries} failed: ${lastError.message}`
				);
				if (attempt < maxRetries) {
					// A capture timeout usually means the renderer can't produce a frame.
					// If its main thread is wedged (page JS blocking it), retrying won't
					// help — bail immediately with a clear, actionable error.
					if (!(await this.isRendererResponsive())) {
						throw new RendererUnresponsiveError();
					}
					// Otherwise the failure may be transient (e.g. reconnect) — retry.
					await new Promise((resolve) => setTimeout(resolve, 300));
				}
			}
		}

		throw lastError || new Error('Screenshot failed after retries');
	}

	/**
	 * Lightweight liveness probe: evaluates a trivial expression to check whether
	 * the renderer's main thread is servicing requests. Returns false if it times
	 * out — i.e. the page's JavaScript has the main thread blocked.
	 */
	async isRendererResponsive(timeoutMs = 3000): Promise<boolean> {
		try {
			await this.send('Runtime.evaluate', { expression: '1', returnByValue: true }, timeoutMs);
			return true;
		} catch {
			return false;
		}
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
	 * Move mouse to coordinates (CDP method).
	 * Triggers hover effects on elements.
	 */
	async cdpMove(x: number, y: number): Promise<void> {
		await this.send('Input.dispatchMouseEvent', {
			type: 'mouseMoved',
			x,
			y
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
