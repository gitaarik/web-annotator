<script lang="ts">
	import type { Action } from '$lib/types';

	type HoverInfo =
		| { type: 'click'; coordinates: { x: number; y: number } }
		| { type: 'scroll'; direction: 'up' | 'down' }
		| { type: 'type'; text: string }
		| null;

	interface Props {
		actions: Action[];
		replayedUpTo?: number;
		onReplay?: (index: number) => void;
		replayLoading?: boolean;
		onDelete?: (index: number) => void;
		deleteLoading?: boolean;
		onHoverAction?: (info: HoverInfo) => void;
	}

	let {
		actions,
		replayedUpTo = -1,
		onReplay,
		replayLoading = false,
		onDelete,
		deleteLoading = false,
		onHoverAction
	}: Props = $props();

	function formatAction(action: Action): string {
		switch (action.type) {
			case 'click':
				return `Click (${action.coordinates?.x}, ${action.coordinates?.y})`;
			case 'scroll':
				return `Scroll ${action.direction}`;
			case 'type':
				return `Type "${action.text}"`;
			case 'wait':
				return 'Wait';
			case 'stop':
				return 'Stop';
			default:
				return 'Unknown';
		}
	}

	function canReplay(index: number): boolean {
		return onReplay !== undefined && index === replayedUpTo + 1 && !replayLoading;
	}

	function isReplayed(index: number): boolean {
		return index <= replayedUpTo;
	}

	function isNextPlayable(index: number): boolean {
		return onReplay !== undefined && index === replayedUpTo + 1;
	}

	function handleMouseEnter(action: Action, index: number) {
		if (!onHoverAction || !isNextPlayable(index)) return;

		if (action.type === 'click' && action.coordinates) {
			onHoverAction({ type: 'click', coordinates: action.coordinates });
		} else if (action.type === 'scroll' && action.direction) {
			onHoverAction({ type: 'scroll', direction: action.direction });
		} else if (action.type === 'type' && action.text) {
			onHoverAction({ type: 'type', text: action.text });
		}
	}

	function handleMouseLeave() {
		if (onHoverAction) {
			onHoverAction(null);
		}
	}
</script>

<div class="session-history">
	<div class="history-header">
		<span class="history-title">History ({actions.length})</span>
	</div>

	<div class="actions-list">
		{#each actions as action, index}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="action-item"
				class:replayed={isReplayed(index)}
				class:next-playable={isNextPlayable(index)}
				onmouseenter={() => handleMouseEnter(action, index)}
				onmouseleave={handleMouseLeave}
			>
				<div class="action-top">
					<span class="action-number">#{index + 1}</span>
					<div class="action-buttons">
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
						{#if onDelete && index === actions.length - 1}
							<button
								class="delete-action-btn"
								onclick={() => onDelete(index)}
								disabled={deleteLoading}
								title="Delete this action"
							>
								×
							</button>
						{/if}
					</div>
				</div>
				<div class="action-type">{formatAction(action)}</div>
				<div class="action-explanation">{action.explanation}</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.session-history {
		background: #f9f9f9;
		border-radius: 8px;
		padding: 0.75rem;
	}

	.history-header {
		margin-bottom: 0.5rem;
	}

	.history-title {
		font-weight: 600;
		font-size: 0.9rem;
		color: #333;
	}

	.actions-list {
		display: flex;
		flex-direction: row;
		gap: 0.5rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
	}

	.action-item {
		flex-shrink: 0;
		width: 180px;
		padding: 0.5rem;
		background: white;
		border-radius: 6px;
		border-top: 3px solid #0066cc;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.action-item.replayed {
		border-top-color: #059669;
		background: #f0fdf4;
	}

	.action-item.next-playable {
		border-top-color: #f59e0b;
		box-shadow: 0 0 0 2px #fef3c7;
	}

	.action-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.action-number {
		font-weight: bold;
		color: #666;
		font-size: 0.75rem;
	}

	.action-buttons {
		display: flex;
		gap: 0.25rem;
	}

	.action-type {
		font-weight: 600;
		font-size: 0.8rem;
		color: #333;
	}

	.action-explanation {
		font-size: 0.75rem;
		color: #555;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.replay-action-btn {
		padding: 0.15rem 0.4rem;
		font-size: 0.7rem;
		background: #059669;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		min-width: 24px;
	}

	.replay-action-btn:hover:not(:disabled) {
		background: #047857;
	}

	.replay-action-btn:disabled {
		background: #ccc;
		cursor: not-allowed;
	}

	.delete-action-btn {
		padding: 0.15rem 0.4rem;
		font-size: 0.8rem;
		background: #dc2626;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		min-width: 24px;
		font-weight: bold;
	}

	.delete-action-btn:hover:not(:disabled) {
		background: #b91c1c;
	}

	.delete-action-btn:disabled {
		background: #ccc;
		cursor: not-allowed;
	}
</style>
