/**
 * Browser window focus management.
 *
 * Uses PID-based window finding which is more reliable than class-name searching.
 * This ensures we always target the correct Chrome instance.
 */

import { spawn } from 'child_process';

/** Spawn a process and resolve with stdout. */
function runProcCapture(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		proc.stdout?.on('data', (d) => {
			stdout += d.toString();
		});
		proc.stderr?.on('data', (d) => {
			stderr += d.toString();
		});
		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`${cmd} exit ${code}: ${stderr.trim()}`));
		});
	});
}

/**
 * Get window IDs for a Chrome process by PID (Linux).
 * This is more reliable than searching by class name.
 * Filters to only include visible windows with proper names (not popups/DevTools).
 */
async function getWindowIdsByPid(pid: number): Promise<string[]> {
	if (process.platform !== 'linux') return [];

	try {
		const output = await runProcCapture('xdotool', ['search', '--pid', String(pid)]);
		const allIds = output
			.trim()
			.split('\n')
			.filter((id) => id.length > 0);

		// Filter to find the main browser window by checking window properties
		const mainWindows: string[] = [];
		for (const id of allIds) {
			try {
				// Get window name - main Chrome window has the page title
				const name = await runProcCapture('xdotool', ['getwindowname', id]);
				const windowName = name.trim();

				// Skip DevTools, extensions, and small popup windows
				if (
					windowName &&
					!windowName.includes('DevTools') &&
					!windowName.startsWith('chrome-extension://') &&
					windowName !== 'Chrome' // Empty windows often just say "Chrome"
				) {
					// Get window geometry to filter out tiny windows
					try {
						const geometry = await runProcCapture('xdotool', ['getwindowgeometry', id]);
						const sizeMatch = geometry.match(/Geometry: (\d+)x(\d+)/);
						if (sizeMatch) {
							const width = parseInt(sizeMatch[1], 10);
							const height = parseInt(sizeMatch[2], 10);
							// Only include windows with reasonable size (> 200x200)
							if (width > 200 && height > 200) {
								mainWindows.push(id);
							}
						}
					} catch {
						// If we can't get geometry, still include it
						mainWindows.push(id);
					}
				}
			} catch {
				// Skip windows we can't inspect
			}
		}

		console.log(`[Focus] Filtered ${allIds.length} windows to ${mainWindows.length} main windows`);
		return mainWindows.length > 0 ? mainWindows : allIds;
	} catch {
		return [];
	}
}

/**
 * Check if any of the given window IDs is currently focused (Linux).
 */
async function isWindowFocusedLinux(windowIds: string[]): Promise<boolean> {
	if (process.platform !== 'linux' || windowIds.length === 0) return false;

	try {
		const active = (await runProcCapture('xdotool', ['getactivewindow'])).trim();
		return windowIds.includes(active);
	} catch {
		return false;
	}
}

/**
 * Activate (focus) a Chrome window on Linux using wmctrl.
 * wmctrl is more reliable than xdotool for window activation.
 */
async function activateWindowLinux(windowIds: string[]): Promise<boolean> {
	if (process.platform !== 'linux' || windowIds.length === 0) return false;

	// Convert decimal window ID to hex for wmctrl
	const hexId = '0x' + parseInt(windowIds[0], 10).toString(16).padStart(8, '0');

	try {
		// Try wmctrl first (more reliable for focus switching)
		await runProcCapture('wmctrl', ['-ia', hexId]);
		// Brief delay for window manager to process
		await new Promise((r) => setTimeout(r, 50));
		return await isWindowFocusedLinux(windowIds);
	} catch {
		// Fall back to xdotool if wmctrl not available
		try {
			await runProcCapture('xdotool', ['windowactivate', '--sync', windowIds[0]]);
			return await isWindowFocusedLinux(windowIds);
		} catch {
			return false;
		}
	}
}

/**
 * Check if Chrome is focused on macOS.
 */
async function isChromeFocusedMac(): Promise<boolean> {
	if (process.platform !== 'darwin') return false;

	try {
		const script =
			'tell application "System Events" to get name of first application process whose frontmost is true';
		const frontApp = (await runProcCapture('osascript', ['-e', script])).trim().toLowerCase();
		return frontApp.includes('chrome') || frontApp.includes('chromium');
	} catch {
		return false;
	}
}

/**
 * Activate Chrome on macOS.
 */
async function activateChromeMac(): Promise<boolean> {
	if (process.platform !== 'darwin') return false;

	try {
		const script = `tell application "Google Chrome" to activate`;
		await runProcCapture('osascript', ['-e', script]);
		await new Promise((r) => setTimeout(r, 100));
		return await isChromeFocusedMac();
	} catch {
		try {
			const script = `tell application "Chromium" to activate`;
			await runProcCapture('osascript', ['-e', script]);
			await new Promise((r) => setTimeout(r, 100));
			return await isChromeFocusedMac();
		} catch {
			return false;
		}
	}
}

/**
 * Check if Chrome is focused on Windows.
 */
async function isChromeFocusedWindows(): Promise<boolean> {
	if (process.platform !== 'win32') return false;

	try {
		const script = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class FG {
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
      }
"@
      $hwnd = [FG]::GetForegroundWindow()
      $pid = 0
      [void][FG]::GetWindowThreadProcessId($hwnd, [ref]$pid)
      (Get-Process -Id $pid).ProcessName
    `;
		const procName = (await runProcCapture('powershell', ['-NoProfile', '-Command', script]))
			.trim()
			.toLowerCase();
		return procName.includes('chrome') || procName.includes('chromium');
	} catch {
		return false;
	}
}

/**
 * Activate Chrome on Windows.
 */
async function activateChromeWindows(pid: number): Promise<boolean> {
	if (process.platform !== 'win32') return false;

	try {
		const script = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
      }
"@
      $proc = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
      if ($proc) { [Win]::SetForegroundWindow($proc.MainWindowHandle) }
    `;
		await runProcCapture('powershell', ['-NoProfile', '-Command', script]);
		await new Promise((r) => setTimeout(r, 100));
		return await isChromeFocusedWindows();
	} catch {
		return false;
	}
}

// Cache window IDs per PID to avoid repeated xdotool calls
const windowIdCache = new Map<number, { ids: string[]; timestamp: number }>();
const CACHE_TTL_MS = 5000;

/**
 * Get window IDs for a Chrome process (with caching).
 */
async function getCachedWindowIds(pid: number): Promise<string[]> {
	const now = Date.now();
	const cached = windowIdCache.get(pid);

	if (cached && now - cached.timestamp < CACHE_TTL_MS) {
		return cached.ids;
	}

	const ids = await getWindowIdsByPid(pid);
	windowIdCache.set(pid, { ids, timestamp: now });
	return ids;
}

/**
 * Activate (focus) the Chrome window for a given PID.
 * Returns true if successful, false otherwise.
 */
export async function activateBrowserWindow(pid: number): Promise<boolean> {
	switch (process.platform) {
		case 'linux': {
			const windowIds = await getCachedWindowIds(pid);
			console.log(`[Focus] Window IDs for PID ${pid}:`, windowIds);
			if (windowIds.length === 0) {
				console.log(`[Focus] No window IDs found for PID ${pid}`);
				return false;
			}
			const result = await activateWindowLinux(windowIds);
			console.log(`[Focus] Activation result: ${result}`);
			return result;
		}
		case 'darwin':
			return activateChromeMac();
		case 'win32':
			return activateChromeWindows(pid);
		default:
			return false;
	}
}

/**
 * Check if the Chrome window for a given PID is focused.
 */
export async function isBrowserFocused(pid: number): Promise<boolean> {
	switch (process.platform) {
		case 'linux': {
			const windowIds = await getCachedWindowIds(pid);
			return isWindowFocusedLinux(windowIds);
		}
		case 'darwin':
			return isChromeFocusedMac();
		case 'win32':
			return isChromeFocusedWindows();
		default:
			return false;
	}
}

/**
 * Invalidate the window ID cache for a PID.
 * Call this when closing a Chrome instance.
 */
export function invalidateWindowCache(pid: number): void {
	windowIdCache.delete(pid);
}
