<script lang="ts">
	import type { Action } from '$lib/types';

	interface Props {
		actions: Action[];
		replayedUpTo?: number;
		onReplay?: (index: number) => void;
		replayLoading?: boolean;
	}

	let { actions, replayedUpTo = -1, onReplay, replayLoading = false }: Props = $props();

	function formatAction(action: Action): string {
		switch (action.type) {
			case 'click':
				return `Click at (${action.coordinates?.x}, ${action.coordinates?.y})`;
			case 'scroll':
				return `Scroll ${action.direction}`;
			case 'type':
				return `Type "${action.text}"`;
			case 'wait':
				return 'Wait for page load';
			case 'stop':
				return 'Stop - Task completed';
			default:
				return 'Unknown action';
		}
	}

	function formatTime(timestamp: string): string {
		return new Date(timestamp).toLocaleTimeString();
	}

	function canReplay(index: number): boolean {
		return onReplay !== undefined && index === replayedUpTo + 1 && !replayLoading;
	}

	function isReplayed(index: number): boolean {
		return index <= replayedUpTo;
	}
</script>

<div class="session-history">
	<h3>Action History ({actions.length})</h3>

	<div class="actions-list">
		{#each actions as action, index}
			<div class="action-item" class:replayed={isReplayed(index)}>
				<div class="action-header">
					<span class="action-number">#{index + 1}</span>
					<span class="action-type">{formatAction(action)}</span>
					{#if onReplay}
						<button
							class="replay-action-btn"
							onclick={() => onReplay(index)}
							disabled={!canReplay(index)}
							title={isReplayed(index) ? 'Already replayed' : canReplay(index) ? 'Replay this action' : 'Replay previous actions first'}
						>
							{#if replayLoading && index === replayedUpTo + 1}
								...
							{:else if isReplayed(index)}
								✓
							{:else}
								▶
							{/if}
						</button>
					{/if}
					<span class="action-time">{formatTime(action.timestamp)}</span>
				</div>
				<div class="action-explanation">{action.explanation}</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.session-history {
		padding: 1rem;
		background: #f9f9f9;
		border-radius: 8px;
		max-height: 300px;
		overflow-y: auto;
	}

	h3 {
		margin: 0 0 1rem 0;
		font-size: 1rem;
		position: sticky;
		top: 0;
		background: #f9f9f9;
		padding-bottom: 0.5rem;
	}

	.actions-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.action-item {
		padding: 0.75rem;
		background: white;
		border-radius: 6px;
		border-left: 3px solid #0066cc;
	}

	.action-item.replayed {
		border-left-color: #059669;
		background: #f0fdf4;
	}

	.action-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.action-number {
		font-weight: bold;
		color: #666;
		font-size: 0.8rem;
	}

	.action-type {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.action-time {
		margin-left: auto;
		font-size: 0.75rem;
		color: #999;
	}

	.action-explanation {
		font-size: 0.85rem;
		color: #555;
		padding-left: 1.5rem;
	}

	.replay-action-btn {
		padding: 0.2rem 0.5rem;
		font-size: 0.75rem;
		background: #059669;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		min-width: 28px;
	}

	.replay-action-btn:hover:not(:disabled) {
		background: #047857;
	}

	.replay-action-btn:disabled {
		background: #ccc;
		cursor: not-allowed;
	}
</style>
