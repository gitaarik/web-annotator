/**
 * OS-level input utilities for bot-detection prevention.
 *
 * Uses platform-native tools to generate real keyboard and mouse events:
 * - Linux: xdotool (X11 events via XTest extension)
 * - macOS: osascript (System Events / CoreGraphics)
 * - Windows: PowerShell with SendKeys / SendInput
 *
 * These events are indistinguishable from real user input, unlike CDP events
 * which can be fingerprinted by bot-detection scripts.
 */

import { spawn } from 'child_process';

export interface OsInputConfig {
	/** Base delay between keystrokes in ms (default: 50) */
	charDelayMs: number;
	/** Variance factor for typing delays, e.g. 0.4 = ±40% (default: 0.4) */
	charDelayVariance: number;
}

const defaultConfig: OsInputConfig = {
	charDelayMs: 50,
	charDelayVariance: 0.4
};

/** Spawn a process and resolve when it exits successfully. */
function runProc(cmd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let stderr = '';
		proc.stderr?.on('data', (d) => {
			stderr += d.toString();
		});
		proc.on('error', (err) => reject(err));
		proc.on('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${cmd} exit ${code}: ${stderr.trim()}`));
		});
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// TYPING
// =============================================================================

/**
 * Linux: type each character via xdotool with random delay between chars.
 * Produces real X11 keypress events, indistinguishable from manual input.
 */
async function typeViaXdotool(text: string, config: OsInputConfig): Promise<void> {
	for (const ch of text) {
		await runProc('xdotool', ['type', '--delay', '0', '--', ch]);
		if (config.charDelayMs > 0) {
			const variance = config.charDelayMs * config.charDelayVariance;
			const delay = config.charDelayMs + (Math.random() * 2 - 1) * variance;
			await sleep(Math.max(8, delay));
		}
	}
}

/**
 * macOS: build a single AppleScript that issues keystroke + delay per char.
 */
async function typeViaOsascript(text: string, config: OsInputConfig): Promise<void> {
	const escapeApplescript = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

	const lines: string[] = [];
	for (let i = 0; i < text.length; i++) {
		lines.push(`keystroke "${escapeApplescript(text[i])}"`);
		if (i < text.length - 1 && config.charDelayMs > 0) {
			const variance = config.charDelayMs * config.charDelayVariance;
			const delay = Math.max(8, config.charDelayMs + (Math.random() * 2 - 1) * variance);
			lines.push(`delay ${(delay / 1000).toFixed(3)}`);
		}
	}

	const script = `tell application "System Events"\n${lines.join('\n')}\nend tell`;
	await runProc('osascript', ['-e', script]);
}

/**
 * Windows: build a single PowerShell that calls SendKeys + Start-Sleep per char.
 */
async function typeViaSendKeys(text: string, config: OsInputConfig): Promise<void> {
	const sendKeysSpecial = /[+^~%(){}\[\]]/;
	const stmts: string[] = [];

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const wrapped = sendKeysSpecial.test(ch) ? `{${ch}}` : ch;
		const lit = wrapped.replace(/'/g, "''");
		stmts.push(`[System.Windows.Forms.SendKeys]::SendWait('${lit}')`);
		if (i < text.length - 1 && config.charDelayMs > 0) {
			const variance = config.charDelayMs * config.charDelayVariance;
			const delay = Math.max(8, config.charDelayMs + (Math.random() * 2 - 1) * variance);
			stmts.push(`Start-Sleep -Milliseconds ${Math.floor(delay)}`);
		}
	}

	const script = `Add-Type -AssemblyName System.Windows.Forms; ${stmts.join('; ')}`;
	await runProc('powershell', ['-NoProfile', '-Command', script]);
}

/**
 * Type text using OS-level keyboard events.
 */
export async function osType(text: string, config: Partial<OsInputConfig> = {}): Promise<void> {
	const cfg = { ...defaultConfig, ...config };

	switch (process.platform) {
		case 'linux':
			await typeViaXdotool(text, cfg);
			break;
		case 'darwin':
			await typeViaOsascript(text, cfg);
			break;
		case 'win32':
			await typeViaSendKeys(text, cfg);
			break;
		default:
			throw new Error(`Unsupported platform for OS-level typing: ${process.platform}`);
	}
}

// =============================================================================
// CLICKING
// =============================================================================

/** xdotool button numbers */
const XDOTOOL_BUTTON_MAP: Record<'left' | 'middle' | 'right', number> = {
	left: 1,
	middle: 2,
	right: 3
};

/**
 * Linux: click at screen coordinates via xdotool.
 */
async function clickViaXdotool(
	x: number,
	y: number,
	button: 'left' | 'middle' | 'right' = 'left'
): Promise<void> {
	const buttonNum = XDOTOOL_BUTTON_MAP[button];
	const roundedX = Math.round(x);
	const roundedY = Math.round(y);
	console.log(`[xdotool] Clicking at (${roundedX}, ${roundedY}) button ${buttonNum}`);
	// Move to position and click
	await runProc('xdotool', [
		'mousemove',
		'--sync',
		String(roundedX),
		String(roundedY),
		'click',
		String(buttonNum)
	]);
	console.log(`[xdotool] Click command completed`);
}

/**
 * macOS: click via CoreGraphics.
 */
async function clickViaCgEvent(
	x: number,
	y: number,
	button: 'left' | 'middle' | 'right' = 'left'
): Promise<void> {
	const buttonName = button === 'left' ? 'Left' : button === 'right' ? 'Right' : 'Other';
	const cgButtonConst =
		button === 'left'
			? 'kCGMouseButtonLeft'
			: button === 'right'
				? 'kCGMouseButtonRight'
				: 'kCGMouseButtonCenter';

	const lx = Math.round(x);
	const ly = Math.round(y);

	const script = `
    ObjC.import("CoreGraphics");
    function post(type, x, y, btn) {
      const ev = $.CGEventCreateMouseEvent($(), type, { x: x, y: y }, btn);
      $.CGEventPost($.kCGHIDEventTap, ev);
    }
    post($.kCGEventMouseMoved, ${lx}, ${ly}, $.${cgButtonConst});
    post($.kCGEvent${buttonName}MouseDown, ${lx}, ${ly}, $.${cgButtonConst});
    post($.kCGEvent${buttonName}MouseUp, ${lx}, ${ly}, $.${cgButtonConst});
  `;

	await runProc('osascript', ['-l', 'JavaScript', '-e', script]);
}

/**
 * Windows: click via SetCursorPos + mouse_event.
 */
async function clickViaSendInput(
	x: number,
	y: number,
	button: 'left' | 'middle' | 'right' = 'left'
): Promise<void> {
	const flags: Record<'left' | 'middle' | 'right', { down: number; up: number }> = {
		left: { down: 0x0002, up: 0x0004 },
		middle: { down: 0x0020, up: 0x0040 },
		right: { down: 0x0008, up: 0x0010 }
	};
	const f = flags[button];

	const ps = `
    Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Mouse {
      [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
      [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
    }
"@
    [Mouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
    [Mouse]::mouse_event(${f.down}, 0, 0, 0, [UIntPtr]::Zero)
    [Mouse]::mouse_event(${f.up}, 0, 0, 0, [UIntPtr]::Zero)
  `;

	await runProc('powershell', ['-NoProfile', '-Command', ps]);
}

/**
 * Click at screen coordinates using OS-level mouse events.
 */
export async function osClick(
	x: number,
	y: number,
	button: 'left' | 'middle' | 'right' = 'left'
): Promise<void> {
	switch (process.platform) {
		case 'linux':
			await clickViaXdotool(x, y, button);
			break;
		case 'darwin':
			await clickViaCgEvent(x, y, button);
			break;
		case 'win32':
			await clickViaSendInput(x, y, button);
			break;
		default:
			throw new Error(`Unsupported platform for OS-level click: ${process.platform}`);
	}
}

/**
 * Press Enter via OS-level injection.
 */
export async function osPressEnter(): Promise<void> {
	switch (process.platform) {
		case 'linux':
			await runProc('xdotool', ['key', 'Return']);
			break;
		case 'darwin':
			await runProc('osascript', ['-e', `tell application "System Events" to key code 36`]);
			break;
		case 'win32':
			await runProc('powershell', [
				'-NoProfile',
				'-Command',
				`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('~')`
			]);
			break;
		default:
			throw new Error(`Unsupported platform for OS-level Enter: ${process.platform}`);
	}
}
