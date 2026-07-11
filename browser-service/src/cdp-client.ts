/**
 * Chrome DevTools Protocol (CDP) client.
 *
 * Provides methods for navigation, screenshots, and page interaction
 * via direct CDP WebSocket communication.
 */

import WebSocket from 'ws';
import http from 'http';
import { matchVendor, domainOf, summarizeCpuProfile, type CpuProfile } from './wedge-forensics.js';

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
 * Default per-command timeout. A wedged renderer (blocked main thread) makes
 * every CDP call — input, evaluate, screenshot — hang until this fires, so it's
 * kept short: an interactive op that hasn't answered in 10s isn't coming back.
 */
const DEFAULT_SEND_TIMEOUT_MS = 10000;

/**
 * How long a detected wedge short-circuits further renderer ops. Once one call
 * times out we assume the main thread is blocked and fail the rest of the
 * action instantly (instead of waiting the full timeout on each), until this
 * window passes and we probe again.
 */
const RENDERER_WEDGE_TTL_MS = 2000;

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
	// Timestamp (ms) until which the renderer is assumed wedged; renderer ops
	// short-circuit while this is in the future. 0 = healthy.
	private wedgedUntil = 0;
	// Timestamp (ms) when the current wedge was first detected; 0 = not wedged.
	// Purely for measurement: on recovery we log how long the main thread stayed
	// blocked, so we can tell transient stalls from true hard wedges.
	private wedgedSince = 0;
	// Current top-level document URL, kept current from browser-process
	// navigation events (Page.frameNavigated / navigatedWithinDocument) and
	// seeded from the frame tree on connect. Reading it never touches the
	// renderer's JS thread, so a wedged page can't make getUrl() hang.
	private currentUrl = '';
	// Id of the main frame; used to ignore sub-frame navigation events.
	private mainFrameId: string | null = null;

	// --- Wedge forensics (opt-in via WEDGE_FORENSICS=1) ---
	// When enabled, we track request origins + flag anti-bot vendors and keep a
	// rolling CPU profile, so that on the next wedge we can log a report of what
	// the page was doing to the main thread. All of this is off by default.
	private readonly forensicsEnabled = process.env.WEDGE_FORENSICS === '1';
	private loadedDomains = new Map<string, number>();
	private detectedVendors = new Set<string>();
	private lastProfileSummary: string | null = null;
	private profileTimer: ReturnType<typeof setInterval> | null = null;
	private profilingActive = false;

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
				// Seed the URL cache from the browser process. On reconnect to an
				// already-loaded page no navigation event fires, so without this the
				// cache would stay empty until the next navigation.
				this.seedUrlFromFrameTree().catch(() => {});
				if (this.forensicsEnabled) this.startForensics().catch(() => {});
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
		if (this.forensicsEnabled && method === 'Network.requestWillBeSent') {
			const url = (params?.request as { url?: string } | undefined)?.url;
			if (url) {
				const domain = domainOf(url);
				if (domain) this.loadedDomains.set(domain, (this.loadedDomains.get(domain) ?? 0) + 1);
				const vendor = matchVendor(url);
				if (vendor && !this.detectedVendors.has(vendor)) {
					this.detectedVendors.add(vendor);
					console.warn(`[CDP][forensics] anti-bot vendor seen: ${vendor}  (${url.slice(0, 120)})`);
				}
			}
			return;
		}

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
			return;
		}

		if (method === 'Page.frameNavigated') {
			// Cross-document navigations (full loads, redirects), sourced from the
			// browser process. The main frame has no parentId; ignore sub-frames.
			const frame = params?.frame as
				| { id?: string; parentId?: string; url?: string }
				| undefined;
			if (frame && !frame.parentId) {
				if (frame.id) this.mainFrameId = frame.id;
				if (frame.url) this.currentUrl = frame.url;
			}
			return;
		}

		if (method === 'Page.navigatedWithinDocument') {
			// Same-document navigations (SPA pushState/replaceState, #fragment
			// changes) don't emit frameNavigated, so capture them here.
			const url = params?.url as string | undefined;
			const frameId = params?.frameId as string | undefined;
			if (url && (this.mainFrameId === null || frameId === this.mainFrameId)) {
				this.currentUrl = url;
			}
			return;
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
	 * Run a renderer-dependent operation behind a circuit breaker. If the
	 * renderer was just seen wedged, fail instantly instead of waiting the full
	 * timeout again; if this op times out, trip the breaker and surface it as a
	 * RendererUnresponsiveError (recoverable) rather than a generic CDP timeout.
	 */
	private async rendererOp<T>(fn: () => Promise<T>): Promise<T> {
		if (Date.now() < this.wedgedUntil) {
			console.log('[CDP] renderer op short-circuited (breaker open)');
			throw new RendererUnresponsiveError();
		}
		try {
			const result = await fn();
			this.wedgedUntil = 0; // a successful op means the renderer is alive
			this.noteRendererAlive();
			return result;
		} catch (err) {
			// A command timeout on a renderer op means the main thread is blocked.
			if (err instanceof Error && err.message.startsWith('CDP timeout')) {
				console.warn(`[CDP] renderer wedged (${err.message}); breaker open for ${RENDERER_WEDGE_TTL_MS}ms`);
				this.wedgedUntil = Date.now() + RENDERER_WEDGE_TTL_MS;
				this.markWedged('renderer op');
				throw new RendererUnresponsiveError();
			}
			throw err;
		}
	}

	/**
	 * Record the start of a wedge (only the first detection sticks), so we can
	 * measure how long the main thread stays blocked. Pairs with noteRendererAlive.
	 */
	private markWedged(source: string): void {
		if (this.wedgedSince === 0) {
			this.wedgedSince = Date.now();
			console.warn(`[CDP] renderer wedged (${source}) — main thread blocked; measuring recovery`);
			if (this.forensicsEnabled) this.dumpForensics(source);
		}
	}

	/**
	 * Mark the renderer alive again. If it was wedged, log how long the block
	 * lasted — this is the data for tuning the grace window (transient vs hard).
	 */
	private noteRendererAlive(): void {
		if (this.wedgedSince !== 0) {
			console.warn(`[CDP] renderer recovered after ${Date.now() - this.wedgedSince}ms`);
			this.wedgedSince = 0;
		}
	}

	/**
	 * Enable request-origin tracking (Network) and a rolling CPU profile so a
	 * later wedge can be explained. Best-effort — any failure just means less
	 * forensic data, never a broken session.
	 */
	private async startForensics(): Promise<void> {
		console.warn('[CDP][forensics] enabled — tracking request origins + rolling CPU profile');
		try {
			await this.send('Network.enable');
		} catch {
			// no request-origin data; vendor detection will be empty
		}
		try {
			await this.send('Profiler.enable');
			await this.send('Profiler.setSamplingInterval', { interval: 1000 }); // microseconds → 1ms
			await this.send('Profiler.start');
			this.profilingActive = true;
		} catch {
			this.profilingActive = false;
		}
		// Roll the profile every few seconds so we keep a snapshot of the *ramp*
		// even when a later hard wedge blocks Profiler.stop entirely.
		this.profileTimer = setInterval(() => {
			this.rollProfile().catch(() => {});
		}, 4000);
	}

	/** Capture-and-restart the CPU profile, keeping the latest healthy snapshot. */
	private async rollProfile(): Promise<void> {
		// Skip while (possibly) wedged: a stop() would just block. Keep the last
		// good snapshot, which is exactly the pre-wedge window we want.
		if (!this.profilingActive || this.wedgedSince !== 0 || Date.now() < this.wedgedUntil) return;
		try {
			const res = (await this.send('Profiler.stop', {}, 2000)) as { profile?: CpuProfile };
			this.lastProfileSummary = summarizeCpuProfile(res?.profile);
			await this.send('Profiler.start');
		} catch {
			// stop timed out or errored — try to keep profiling for next window.
			try {
				await this.send('Profiler.start');
			} catch {
				this.profilingActive = false;
			}
		}
	}

	/** Log what the page was doing to the main thread when the wedge was detected. */
	private dumpForensics(source: string): void {
		const vendors = this.detectedVendors.size ? [...this.detectedVendors].join(', ') : 'none detected';
		const topDomains =
			[...this.loadedDomains.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 12)
				.map(([d, n]) => `${d}(${n})`)
				.join(', ') || 'none';
		const ramp = this.lastProfileSummary
			? this.lastProfileSummary.replace(/\n/g, '\n      ')
			: 'no profile captured';
		console.warn(
			`\n[CDP][forensics] ===== WEDGE (${source}) =====\n` +
				`  url: ${this.currentUrl}\n` +
				`  anti-bot vendors: ${vendors}\n` +
				`  top request origins: ${topDomains}\n` +
				`  CPU (rolling snapshot from ≤4s before the wedge):\n      ${ramp}\n` +
				`[CDP][forensics] ============================`
		);
		// Best-effort snapshot of the wedge moment itself. On a hard wedge this
		// stop() can't be serviced (the thread is blocked) — that failure is
		// itself the signal, so we log it either way.
		this.captureLiveProfile().catch(() => {});
	}

	private async captureLiveProfile(): Promise<void> {
		if (!this.profilingActive) return;
		try {
			const res = (await this.send('Profiler.stop', {}, 2500)) as { profile?: CpuProfile };
			const summary = summarizeCpuProfile(res?.profile).replace(/\n/g, '\n      ');
			console.warn(`[CDP][forensics] live profile at wedge:\n      ${summary}`);
			await this.send('Profiler.start'); // resume for the next episode
		} catch {
			console.warn(
				'[CDP][forensics] live profile unavailable — Profiler.stop blocked (confirms hard wedge)'
			);
		}
	}

	/**
	 * Send a CDP command and wait for response.
	 * @param method CDP method name
	 * @param params Method parameters
	 * @param timeout Timeout in ms (default: DEFAULT_SEND_TIMEOUT_MS)
	 */
	async send(
		method: string,
		params: Record<string, unknown> = {},
		timeout = DEFAULT_SEND_TIMEOUT_MS
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
		// A navigation discards the current (possibly wedged) document, so give the
		// renderer a clean slate — clear the circuit breaker.
		this.wedgedUntil = 0;
		const t0 = Date.now();
		console.log(`[CDP] navigate -> ${url.slice(0, 80)}`);
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
		console.log(`[CDP] navigate done in ${Date.now() - t0}ms`);
	}

	/**
	 * Get the current top-level URL.
	 *
	 * Served from a cache kept current by browser-process navigation events and
	 * seeded from the frame tree — it never runs anything in the renderer, so a
	 * wedged page (blocked JS main thread) can't make this hang. This is the hot
	 * path: it's read before/after every action and by the frontend's URL poll.
	 */
	async getUrl(): Promise<string> {
		if (!this.currentUrl) {
			// Not seeded yet (e.g. just reconnected to a loaded page). Pull it from
			// the browser process once; safe even if the renderer is wedged.
			await this.seedUrlFromFrameTree();
		}
		return this.currentUrl;
	}

	/**
	 * Seed the cached URL from the browser process via Page.getFrameTree, which
	 * is served without touching the renderer's main thread.
	 */
	private async seedUrlFromFrameTree(): Promise<void> {
		try {
			const result = (await this.send('Page.getFrameTree')) as {
				frameTree?: { frame?: { id?: string; url?: string } };
			};
			const frame = result?.frameTree?.frame;
			if (frame?.id) this.mainFrameId = frame.id;
			if (frame?.url) this.currentUrl = frame.url;
		} catch {
			// Best-effort; navigation events will populate the cache otherwise.
		}
	}

	/**
	 * Capture a screenshot.
	 * Returns base64-encoded PNG data.
	 * Includes retry logic for transient failures (e.g., connection issues).
	 */
	async screenshot(options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<string> {
		// Circuit breaker: if the renderer was just seen wedged, don't burn the
		// full timeout again — fail fast with the recoverable error.
		if (Date.now() < this.wedgedUntil) {
			throw new RendererUnresponsiveError();
		}

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
				this.wedgedUntil = 0; // a successful capture means the renderer is alive
				this.noteRendererAlive();
				return result.data;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				console.log(
					`[CDP] Screenshot attempt ${attempt}/${maxRetries} failed: ${lastError.message}`
				);
				if (attempt < maxRetries) {
					// A capture timeout usually means the renderer can't produce a frame.
					// If its main thread is wedged (page JS blocking it), retrying won't
					// help — trip the breaker and bail with a clear, actionable error.
					if (!(await this.isRendererResponsive())) {
						this.wedgedUntil = Date.now() + RENDERER_WEDGE_TTL_MS;
						this.markWedged('screenshot');
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
			this.noteRendererAlive();
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
		return this.rendererOp(() => this.getContentViewportInfoRaw());
	}

	private async getContentViewportInfoRaw(): Promise<{
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
	 * Describe the element at the given viewport (CSS px) coordinates. Used to
	 * capture a robust-ish locator for a dismissed popup before it's clicked away.
	 * Returns null if nothing is there.
	 */
	async describeElementAt(x: number, y: number): Promise<{
		tag?: string;
		text?: string;
		ariaLabel?: string;
		role?: string;
		id?: string;
		classes?: string[];
	} | null> {
		return this.rendererOp(async () => {
			const expr = `(() => {
				const el = document.elementFromPoint(${x}, ${y});
				if (!el) return null;
				const attr = (n) => el.getAttribute(n) || undefined;
				const cls = typeof el.className === 'string'
					? el.className.split(/\\s+/).filter(Boolean).slice(0, 8)
					: undefined;
				return {
					tag: el.tagName ? el.tagName.toLowerCase() : undefined,
					text: ((el.innerText || el.textContent || '').trim().slice(0, 100)) || undefined,
					ariaLabel: attr('aria-label'),
					role: attr('role'),
					id: el.id || undefined,
					classes: cls && cls.length ? cls : undefined
				};
			})()`;
			const result = (await this.send('Runtime.evaluate', {
				expression: expr,
				returnByValue: true
			})) as { result?: { value?: Record<string, unknown> | null } };
			return (result?.result?.value as {
				tag?: string;
				text?: string;
				ariaLabel?: string;
				role?: string;
				id?: string;
				classes?: string[];
			} | null) ?? null;
		});
	}

	/**
	 * Scroll the page.
	 */
	async scroll(deltaX: number, deltaY: number, x?: number, y?: number): Promise<void> {
		return this.rendererOp(async () => {
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
		});
	}

	/**
	 * Move mouse to coordinates (CDP method).
	 * Triggers hover effects on elements.
	 */
	async cdpMove(x: number, y: number): Promise<void> {
		return this.rendererOp(async () => {
			await this.send('Input.dispatchMouseEvent', {
				type: 'mouseMoved',
				x,
				y
			});
		});
	}

	/**
	 * Click at coordinates (CDP method, not OS-level).
	 * Use this as fallback when OS-level click fails.
	 */
	async cdpClick(x: number, y: number): Promise<void> {
		return this.rendererOp(async () => {
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
		});
	}

	/**
	 * Type text (CDP method, not OS-level).
	 * Use this as fallback when OS-level typing fails.
	 */
	async cdpType(text: string, delay = 50): Promise<void> {
		// Wrap the whole loop: on a wedged renderer the first keystroke times out
		// and trips the breaker, so we abort instead of waiting the full timeout on
		// every remaining character.
		return this.rendererOp(async () => {
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
		});
	}

	/**
	 * Close the CDP connection.
	 */
	close(): void {
		if (this.profileTimer) {
			clearInterval(this.profileTimer);
			this.profileTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.pageWsUrl = null;
		this.pendingRequests.clear();
	}
}
