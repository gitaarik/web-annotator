/**
 * Wedge forensics helpers (opt-in via WEDGE_FORENSICS=1).
 *
 * Pure functions used by CdpClient to answer "what is wedging this page?":
 *   - matchVendor: flag known anti-bot / fingerprinting vendors by request URL
 *   - domainOf: extract a hostname for request-origin tallying
 *   - summarizeCpuProfile: reduce a V8 CPU profile to its hottest frames
 *
 * The heavy lifting (enabling Network/Profiler, rolling captures, dumping a
 * report on wedge detection) lives in CdpClient; this module stays side-effect
 * free so it's trivial to unit test.
 */

/**
 * Known anti-bot / bot-detection / fingerprinting vendors, matched as
 * case-insensitive substrings of a request URL. This is a debugging signal, not
 * a security control — over-matching is fine, it just prints what it saw.
 */
const ANTI_BOT_VENDORS: { name: string; patterns: string[] }[] = [
	{ name: 'DataDome', patterns: ['datadome', 'datado.me'] },
	{ name: 'PerimeterX/HUMAN', patterns: ['perimeterx', 'px-cdn', 'px-cloud', 'pxchk', 'px-client', 'captcha.px'] },
	{ name: 'Akamai Bot Manager', patterns: ['/akam/', 'akstat', 'ak-bmsc', 'bm-verify', '_bm/'] },
	{ name: 'Cloudflare Challenge', patterns: ['challenges.cloudflare.com', '/cdn-cgi/challenge-platform'] },
	{ name: 'Imperva/Incapsula', patterns: ['incapsula', 'imperva', '_incapsula_'] },
	{ name: 'Kasada', patterns: ['kasada', 'kpsdk'] },
	{ name: 'Arkose/FunCaptcha', patterns: ['arkoselabs', 'funcaptcha'] },
	{ name: 'hCaptcha', patterns: ['hcaptcha.com'] },
	{ name: 'reCAPTCHA', patterns: ['/recaptcha/', 'recaptcha.net'] },
	{ name: 'ThreatMetrix', patterns: ['threatmetrix', 'online-metrix'] },
	{ name: 'Shape/F5', patterns: ['shapesecurity'] },
	{ name: 'Forter', patterns: ['forter.com'] },
	{ name: 'Sift', patterns: ['siftscience', 'sift.com'] },
	{ name: 'Riskified', patterns: ['riskified'] }
];

/** Returns the vendor name if the URL matches a known anti-bot script, else null. */
export function matchVendor(url: string): string | null {
	const u = url.toLowerCase();
	for (const v of ANTI_BOT_VENDORS) {
		if (v.patterns.some((p) => u.includes(p))) return v.name;
	}
	return null;
}

/** Hostname of an http(s) URL; null for data:/blob:/about: and unparseable URLs. */
export function domainOf(url: string): string | null {
	try {
		if (/^(data|blob|about|chrome|javascript):/i.test(url)) return null;
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

interface CpuProfileNode {
	hitCount?: number;
	callFrame?: { functionName?: string; url?: string };
}
export interface CpuProfile {
	nodes?: CpuProfileNode[];
}

/** Trim a script URL to something readable in a log line. */
function shortUrl(url: string): string {
	if (!url) return '(native/internal)';
	if (url.startsWith('data:')) return 'data:' + url.slice(5, 30) + '…';
	try {
		const u = new URL(url);
		const path = u.pathname.length > 40 ? u.pathname.slice(0, 40) + '…' : u.pathname;
		return u.hostname + path;
	} catch {
		return url.length > 60 ? url.slice(0, 60) + '…' : url;
	}
}

/**
 * Reduce a V8 CPU profile to its hottest frames by self-time (sample hit count),
 * as a short multi-line string. Returns a note if the profile has no samples.
 */
export function summarizeCpuProfile(profile: CpuProfile | undefined, topN = 6): string {
	const nodes = profile?.nodes ?? [];
	let total = 0;
	const byFrame = new Map<string, number>();
	for (const n of nodes) {
		const hits = n.hitCount ?? 0;
		if (hits <= 0) continue;
		total += hits;
		const fn = n.callFrame?.functionName || '(anonymous)';
		const url = shortUrl(n.callFrame?.url || '');
		const key = `${fn}  ${url}`;
		byFrame.set(key, (byFrame.get(key) ?? 0) + hits);
	}
	if (total === 0) return 'no samples captured';
	const top = [...byFrame.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
	const lines = top.map(([k, v]) => `${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
	return `${total} samples over ${byFrame.size} frames\n${lines.join('\n')}`;
}
