<script lang="ts">
	import type { Tab } from '$lib/types';

	interface Props {
		tabs: Tab[];
		activeTabId: string | null;
		loading?: boolean;
		onSwitchTab: (tabId: string) => void;
		onNewTab: () => void;
		onCloseTab: (tabId: string) => void;
	}

	let { tabs, activeTabId, loading = false, onSwitchTab, onNewTab, onCloseTab }: Props = $props();

	// Only show open tabs (not closed)
	let openTabs = $derived(tabs.filter((t) => !t.closedAt));

	function getTabLabel(tab: Tab): string {
		if (tab.title) return tab.title;
		try {
			const url = new URL(tab.url);
			return url.hostname + (url.pathname !== '/' ? url.pathname : '');
		} catch {
			return tab.url || 'New Tab';
		}
	}

	function handleCloseTab(e: Event, tabId: string) {
		e.stopPropagation();
		onCloseTab(tabId);
	}
</script>

<div class="tab-bar">
	<div class="tabs-container">
		{#each openTabs as tab (tab.id)}
			<div class="tab" class:active={tab.id === activeTabId} class:disabled={loading}>
				<button
					class="tab-main"
					onclick={() => onSwitchTab(tab.id)}
					disabled={loading}
					title={tab.url}
				>
					<span class="tab-label">{getTabLabel(tab)}</span>
				</button>
				{#if openTabs.length > 1}
					<button
						class="close-btn"
						onclick={(e) => handleCloseTab(e, tab.id)}
						disabled={loading}
						title="Close tab"
					>
						&times;
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<button class="new-tab-btn" onclick={onNewTab} disabled={loading} title="Open new tab">
		+
	</button>
</div>

<style>
	.tab-bar {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		background: var(--color-bg-secondary);
		padding: var(--space-xs);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-md);
		overflow-x: auto;
	}

	.tabs-container {
		display: flex;
		gap: var(--space-xs);
		flex: 1;
		min-width: 0;
		overflow-x: auto;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		max-width: 200px;
		min-width: 100px;
		transition: all 0.15s ease;
	}

	.tab:hover:not(.disabled) {
		background: var(--color-bg-white);
		border-color: var(--color-border-hover);
	}

	.tab.active {
		background: var(--color-bg-white);
		border-color: var(--color-primary);
		color: var(--color-text-primary);
		font-weight: 500;
	}

	.tab.disabled {
		opacity: 0.6;
	}

	.tab-main {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		padding: 0;
		background: none;
		border: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.tab-main:disabled {
		cursor: not-allowed;
	}

	.tab-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		text-align: left;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.close-btn:hover:not(:disabled) {
		background: var(--color-error-bg);
		color: var(--color-error-text);
	}

	.close-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.new-tab-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: 1.25rem;
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.new-tab-btn:hover:not(:disabled) {
		background: var(--color-bg-white);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.new-tab-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
