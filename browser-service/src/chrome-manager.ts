/**
 * Chrome lifecycle management.
 *
 * Launches Chrome with CDP enabled and anti-detection flags,
 * manages the process lifecycle, and tracks PID for window management.
 *
 * Extracted and adapted from sjs-ops desktop app.
 */

import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';

export interface ChromeSession {
	/** Chrome's CDP WebSocket URL */
	cdpWsUrl: string;
	/** Chrome's /json/version response */
	versionInfo: Record<string, unknown>;
	/** The Chrome process */
	process: ChildProcess;
	/** Chrome process ID */
	pid: number;
	/** CDP port */
	port: number;
	/** Kill Chrome gracefully */
	kill: () => Promise<void>;
}

/**
 * Find Chrome binary on the system.
 * Checks CHROME_PATH env var first, then searches common locations.
 */
export function findChromePath(): string | null {
	// Check environment variable first (useful for Docker)
	const envPath = process.env.CHROME_PATH;
	if (envPath && fs.existsSync(envPath)) {
		return envPath;
	}

	const platform = os.platform();
	const candidates: string[] = [];

	if (platform === 'darwin') {
		candidates.push(
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Chromium.app/Contents/MacOS/Chromium',
			'/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
		);
	} else if (platform === 'win32') {
		const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
		const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
		const localAppData = process.env['LOCALAPPDATA'] || '';
		candidates.push(
			path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
			path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
			path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe')
		);
	} else {
		// Linux
		candidates.push(
			'/usr/bin/google-chrome',
			'/usr/bin/google-chrome-stable',
			'/usr/bin/chromium',
			'/usr/bin/chromium-browser',
			'/snap/bin/chromium'
		);
	}

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
}

/**
 * Get a free port from the OS.
 */
function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			server.close(() => resolve(port));
		});
		server.on('error', reject);
	});
}

/**
 * Fetch Chrome's /json/version endpoint.
 */
function fetchCdpVersion(
	port: number,
	maxRetries = 20,
	retryDelay = 500
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let attempts = 0;

		const attempt = () => {
			attempts++;
			const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
				let data = '';
				res.on('data', (chunk) => (data += chunk));
				res.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch {
						reject(new Error(`Invalid JSON from Chrome /json/version: ${data}`));
					}
				});
			});

			req.on('error', () => {
				if (attempts < maxRetries) {
					if (attempts % 5 === 0)
						console.log(`[Chrome] Waiting for CDP... (attempt ${attempts}/${maxRetries})`);
					setTimeout(attempt, retryDelay);
				} else {
					reject(new Error(`Chrome did not start within ${maxRetries * retryDelay}ms`));
				}
			});

			req.setTimeout(2000, () => {
				req.destroy();
				if (attempts < maxRetries) {
					if (attempts % 5 === 0)
						console.log(`[Chrome] CDP timeout, retrying... (attempt ${attempts}/${maxRetries})`);
					setTimeout(attempt, retryDelay);
				} else {
					reject(new Error(`Chrome /json/version timeout after ${maxRetries} attempts`));
				}
			});
		};

		attempt();
	});
}

/**
 * Check if a process with the given PID is still running.
 */
export function isProcessRunning(pid: number): boolean {
	try {
		// Sending signal 0 doesn't kill the process, just checks if it exists
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Launch Chrome with CDP enabled and anti-detection flags.
 */
export async function launchChrome(options: {
	chromePath?: string;
	headed?: boolean;
	userDataDir?: string;
	startUrl?: string;
}): Promise<ChromeSession> {
	const chromePath = options.chromePath || findChromePath();
	if (!chromePath) {
		throw new Error('Chrome not found. Install Google Chrome or Chromium.');
	}

	const port = await getFreePort();
	// Use a persistent user data dir so Chrome retains cookies, history, and
	// local storage across sessions. A fresh profile each time looks suspicious
	// to anti-bot systems like Cloudflare (zero-history fingerprint).
	const userDataDir =
		options.userDataDir || path.join(os.homedir(), '.browser-service', 'chrome-user-data');

	// Ensure the user data dir and Default profile exist
	const defaultProfileDir = path.join(userDataDir, 'Default');
	fs.mkdirSync(defaultProfileDir, { recursive: true });

	// Set Chrome preferences to suppress restore prompts and password manager.
	const prefsPath = path.join(defaultProfileDir, 'Preferences');
	try {
		let prefs: Record<string, unknown> = {};
		try {
			prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
		} catch {
			/* no existing prefs */
		}
		prefs.credentials_enable_service = false;
		prefs.profile = {
			...((prefs.profile as Record<string, unknown>) || {}),
			password_manager_enabled: false,
			exit_type: 'Normal',
			exited_cleanly: true
		};
		prefs.session = { restore_on_startup: 1 };
		fs.writeFileSync(prefsPath, JSON.stringify(prefs));
	} catch (err) {
		console.error(
			`[Chrome] Failed to write preferences: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	// Remove stale lock files left by previous Chrome crashes/kills
	for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
		const lockPath = path.join(userDataDir, lockFile);
		try {
			fs.unlinkSync(lockPath);
		} catch {
			/* doesn't exist */
		}
	}

	// Clear session restore data (tabs) but keep cookies/login state
	for (const sessionDir of ['Default/Sessions', 'Default/Session Storage']) {
		const dirPath = path.join(userDataDir, sessionDir);
		if (fs.existsSync(dirPath)) {
			fs.rmSync(dirPath, { recursive: true, force: true });
			fs.mkdirSync(dirPath, { recursive: true });
		}
	}

	const args = [
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${userDataDir}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-default-apps',
		'--disable-extensions',
		'--disable-sync',
		// Prevent timer/renderer throttling for background tabs
		'--disable-background-timer-throttling',
		'--disable-renderer-backgrounding',
		'--disable-backgrounding-occluded-windows',
		'--disable-ipc-flooding-protection',
		'--disable-features=CalculateNativeWinOcclusion',
		// Note: We use CDP script injection for navigator.webdriver stealth
		// instead of --disable-blink-features=AutomationControlled (which shows a warning banner)
		// WebRTC leak prevention
		'--webrtc-ip-handling-policy=disable_non_proxied_udp',
		'--enforce-webrtc-ip-permission-check',
		// Window size
		'--window-size=1280,800'
	];

	// Docker/container-specific flags
	if (process.env.CHROME_NO_SANDBOX === 'true' || process.env.CONTAINER === 'true') {
		args.push('--no-sandbox', '--disable-dev-shm-usage');
	}

	if (options.headed === false) {
		args.push('--headless=new');
	}

	// Add start URL if provided
	if (options.startUrl) {
		args.push(options.startUrl);
	}

	console.log(`[Chrome] Launching: ${chromePath}`);
	console.log(`[Chrome] CDP port: ${port}`);
	console.log(`[Chrome] User data dir: ${userDataDir}`);

	const chromeProcess = spawn(chromePath, args, {
		stdio: 'pipe',
		detached: false
	});

	if (!chromeProcess.pid) {
		throw new Error('Failed to get Chrome process ID');
	}

	const pid = chromeProcess.pid;
	console.log(`[Chrome] PID: ${pid}`);

	chromeProcess.on('error', (err) => {
		console.error(`[Chrome] Process error: ${err.message}`);
	});

	chromeProcess.on('exit', (code) => {
		console.log(`[Chrome] Process exited with code ${code}`);
	});

	// Wait for Chrome to start and expose CDP
	console.log('[Chrome] Waiting for CDP endpoint...');
	const versionInfo = await fetchCdpVersion(port);
	const cdpWsUrl = versionInfo.webSocketDebuggerUrl as string;
	console.log(`[Chrome] Ready: ${versionInfo.Browser}`);
	console.log(`[Chrome] CDP WebSocket: ${cdpWsUrl}`);

	return {
		cdpWsUrl,
		versionInfo,
		process: chromeProcess,
		pid,
		port,
		async kill() {
			console.log('[Chrome] Stopping...');
			if (!chromeProcess.killed) {
				chromeProcess.kill('SIGTERM');
				// Wait up to 5s for graceful shutdown
				await new Promise<void>((resolve) => {
					const timeout = setTimeout(() => {
						if (!chromeProcess.killed) {
							chromeProcess.kill('SIGKILL');
						}
						resolve();
					}, 5000);
					chromeProcess.on('exit', () => {
						clearTimeout(timeout);
						resolve();
					});
				});
			}
			console.log('[Chrome] Stopped');
		}
	};
}
