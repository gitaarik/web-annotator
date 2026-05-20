<script lang="ts">
	import { browser } from '$app/environment';

	type Theme = 'light' | 'dark' | 'auto';

	let theme = $state<Theme>('auto');

	const icons: Record<Theme, string> = {
		light: '☀',
		dark: '☾',
		auto: '◐'
	};

	const titles: Record<Theme, string> = {
		light: 'Light mode',
		dark: 'Dark mode',
		auto: 'System preference'
	};

	function getSystemTheme(): 'light' | 'dark' {
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	function applyTheme(t: Theme) {
		const resolved = t === 'auto' ? getSystemTheme() : t;
		document.documentElement.dataset.theme = resolved;
	}

	function cycleTheme() {
		const order: Theme[] = ['light', 'dark', 'auto'];
		const idx = order.indexOf(theme);
		theme = order[(idx + 1) % order.length];
		localStorage.setItem('theme', theme);
		applyTheme(theme);
	}

	if (browser) {
		const stored = localStorage.getItem('theme') as Theme | null;
		if (stored && ['light', 'dark', 'auto'].includes(stored)) {
			theme = stored;
		}
	}

	$effect(() => {
		if (!browser) return;
		applyTheme(theme);
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = () => {
			if (theme === 'auto') applyTheme('auto');
		};
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	});
</script>

<button class="theme-switcher" onclick={cycleTheme} title={titles[theme]}>
	{icons[theme]}
</button>

<style>
	.theme-switcher {
		position: fixed;
		top: 12px;
		right: 12px;
		z-index: 9999;
		width: 32px;
		height: 32px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-white);
		color: var(--color-text-muted);
		font-size: 14px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			background 0.15s,
			border-color 0.15s,
			opacity 0.15s;
		opacity: 0.7;
	}

	.theme-switcher:hover {
		opacity: 1;
		border-color: var(--color-border-hover);
		background: var(--color-bg-secondary);
	}
</style>
