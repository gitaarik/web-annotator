/**
 * Formats a URL into parts for display, handling long URLs gracefully.
 */
export function formatUrlParts(url: string): { line1: string; line2: string | null } {
	const singleLineMax = 40; // URLs up to this length stay on one line (CSS handles overflow)
	const lineLength = 32; // Target length per line when splitting

	if (url.length <= singleLineMax) {
		// Fits on one line (CSS will ellipsis if slightly too long)
		return { line1: url, line2: null };
	}

	if (url.length <= lineLength * 2) {
		// Short enough to show on two lines without ellipsis
		const mid = Math.ceil(url.length / 2);
		return { line1: url.slice(0, mid), line2: url.slice(mid) };
	}

	// Show start with ellipsis, and end with ellipsis prefix
	const partLength = lineLength - 3; // Leave room for "..."

	return {
		line1: url.slice(0, partLength) + '...',
		line2: '...' + url.slice(-partLength)
	};
}

/**
 * Copies text to clipboard with fallback for older browsers.
 * Returns a promise that resolves when copy is complete.
 */
export async function copyToClipboard(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// Fallback for older browsers
		const textarea = document.createElement('textarea');
		textarea.value = text;
		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand('copy');
		document.body.removeChild(textarea);
	}
}
