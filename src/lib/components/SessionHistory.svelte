<script lang="ts">
	import { type Action, type HoverInfo, formatAction, actionToHoverInfo } from '$lib/types';
	import { formatUrlParts, copyToClipboard } from '$lib/utils/url';
	import ScreenshotViewer from './ScreenshotViewer.svelte';

	let copiedUrl: string | null = $state(null);
	let expandedAction: Action | null = $state(null);
	let expandedScreenshotSrc: string | null = $state(null);
	let detailsAction: { index: number; action: Action } | null = $state(null);

	async function copyUrl(url: string) {
		await copyToClipboard(url);
		copiedUrl = url;
		setTimeout(() => {
			if (copiedUrl === url) copiedUrl = null;
		}, 1500);
	}

	interface Props {
		actions: Action[];
		viewport?: { width: number; height: number };
		currentScreenshot?: string | null;
		currentUrl?: string | null;
		replayedUpTo?: number;
		onReplay?: (index: number) => void;
		replayLoading?: boolean;
		onDelete?: (index: number) => void;
		deleteLoading?: boolean;
		onHoverAction?: (info: HoverInfo) => void;
		editingIndex?: number | null;
	}

	let {
		actions,
		viewport = { width: 1280, height: 800 },
		currentScreenshot = null,
		currentUrl = null,
		replayedUpTo = -1,
		onReplay,
		replayLoading = false,
		onDelete,
		deleteLoading = false,
		onHoverAction,
		editingIndex = null
	}: Props = $props();

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
		const info = actionToHoverInfo(action);
		if (info) onHoverAction(info);
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
				class:editing={editingIndex === index}
				onmouseenter={() => handleMouseEnter(action, index)}
				onmouseleave={handleMouseLeave}
			>
				<div class="action-top">
					<span class="action-number">#{index}</span>
				</div>
				{#if action.screenshotPath}
					<button
						class="screenshot-thumbnail"
						style="aspect-ratio: {viewport.width} / {viewport.height};"
						onclick={() => expandedAction = action}
						title="Click to enlarge"
					>
						<img src={action.screenshotPath} alt="Screenshot for action {index}" />
						{#if action.type === 'click' && action.coordinates}
							<div
								class="thumbnail-click-marker"
								style="left: {(action.coordinates.x / viewport.width) * 100}%; top: {(action.coordinates.y / viewport.height) * 100}%;"
							></div>
						{:else if action.type === 'scroll' && action.direction}
							<div class="thumbnail-scroll-marker" class:scroll-up={action.direction === 'up'}>
								{action.direction === 'up' ? '↑' : '↓'}
							</div>
						{:else if action.type === 'type'}
							<div class="thumbnail-type-marker">⌨</div>
						{/if}
					</button>
				{/if}
				<div class="action-type">{formatAction(action)}</div>
				<div class="action-explanation">{action.explanation}</div>
				<div class="action-url-container">
					{#if action.url}
						{@const urlParts = formatUrlParts(action.url)}
						<a class="action-url" href={action.url} target="_blank" rel="noopener noreferrer" title={action.url}>
							<span class="url-line">{urlParts.line1}</span>
							{#if urlParts.line2}
								<span class="url-line">{urlParts.line2}</span>
							{/if}
						</a>
						<button
							class="copy-url-btn"
							onclick={() => copyUrl(action.url)}
							title={copiedUrl === action.url ? 'Copied!' : 'Copy URL'}
						>
							{#if copiedUrl === action.url}
								✓
							{:else}
								⧉
							{/if}
						</button>
					{/if}
				</div>
				{#if action.afterUrl || (action.redirects && action.redirects.length > 0)}
					<button
						class="navigation-badge"
						onclick={() => detailsAction = { index, action }}
						title="View navigation details"
					>
						{#if action.redirects && action.redirects.length > 0}
							{action.redirects.length} redirect{action.redirects.length > 1 ? 's' : ''}
						{:else}
							navigated
						{/if}
					</button>
				{/if}
				{#if onReplay || (onDelete && index === actions.length - 1)}
					<div class="action-buttons">
						{#if onReplay}
							<button
								class="play-action-btn"
								class:loading={replayLoading && index === replayedUpTo + 1}
								onclick={() => onReplay(index)}
								disabled={!canReplay(index)}
								title={isReplayed(index) ? 'Already played' : canReplay(index) ? 'Play action' : 'Play previous actions first'}
							>
								{#if replayLoading && index === replayedUpTo + 1}
									<span class="spinner"></span>
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
								class:loading={deleteLoading}
								onclick={() => onDelete(index)}
								disabled={deleteLoading}
								title="Delete this action"
							>
								{#if deleteLoading}
									<span class="spinner"></span>
								{:else}
									×
								{/if}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if currentScreenshot}
			<div class="action-item current-state">
				<div class="action-top">
					<span class="action-number">Now</span>
				</div>
				<button
					class="screenshot-thumbnail"
					style="aspect-ratio: {viewport.width} / {viewport.height};"
					onclick={() => expandedScreenshotSrc = currentScreenshot}
					title="Click to enlarge"
				>
					<img src={currentScreenshot} alt="Current state" />
				</button>
				<div class="action-type">Current State</div>
				<div class="action-explanation">Waiting for next action...</div>
				<div class="action-url-container">
					{#if currentUrl}
						{@const urlParts = formatUrlParts(currentUrl)}
						<a class="action-url" href={currentUrl} target="_blank" rel="noopener noreferrer" title={currentUrl}>
							<span class="url-line">{urlParts.line1}</span>
							{#if urlParts.line2}
								<span class="url-line">{urlParts.line2}</span>
							{/if}
						</a>
						<button
							class="copy-url-btn"
							onclick={() => copyUrl(currentUrl)}
							title={copiedUrl === currentUrl ? 'Copied!' : 'Copy URL'}
						>
							{#if copiedUrl === currentUrl}
								✓
							{:else}
								⧉
							{/if}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<svelte:window onkeydown={(e) => {
	if (e.key === 'Escape') {
		if (expandedAction) expandedAction = null;
		else if (expandedScreenshotSrc) expandedScreenshotSrc = null;
		else if (detailsAction) detailsAction = null;
	}
}} />

{#if expandedAction?.screenshotPath}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="screenshot-modal" onclick={() => expandedAction = null}>
		<button class="modal-close" onclick={() => expandedAction = null}>×</button>
		<div class="modal-screenshot">
			<ScreenshotViewer
				src={expandedAction.screenshotPath}
				{viewport}
				hoverInfo={actionToHoverInfo(expandedAction)}
			/>
		</div>
	</div>
{/if}

{#if expandedScreenshotSrc}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="screenshot-modal" onclick={() => expandedScreenshotSrc = null}>
		<button class="modal-close" onclick={() => expandedScreenshotSrc = null}>×</button>
		<div class="modal-screenshot">
			<ScreenshotViewer
				src={expandedScreenshotSrc}
				{viewport}
			/>
		</div>
	</div>
{/if}

{#if detailsAction}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="details-modal" onclick={() => detailsAction = null}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="details-modal-content" onclick={(e) => e.stopPropagation()}>
			<button class="modal-close" onclick={() => detailsAction = null}>×</button>
			<h3 class="details-modal-title">
				Action #{detailsAction.index} Details
			</h3>
			<div class="details-action-type">{formatAction(detailsAction.action)}</div>
			<p class="details-explanation">{detailsAction.action.explanation}</p>

			<div class="navigation-flow">
				<!-- Before URL -->
				<div class="flow-item flow-before">
					<div class="flow-label">Before</div>
					<a
						class="flow-url"
						href={detailsAction.action.url}
						target="_blank"
						rel="noopener noreferrer"
						title={detailsAction.action.url}
					>
						{detailsAction.action.url}
					</a>
				</div>

				<!-- Redirects (if any) -->
				{#if detailsAction.action.redirects && detailsAction.action.redirects.length > 0}
					{#each detailsAction.action.redirects as redirect, i}
						<div class="flow-arrow">↓</div>
						<div class="flow-item flow-redirect">
							<div class="flow-label">Redirect {i + 1}</div>
							{#if redirect.screenshotPath}
								<button
									class="flow-screenshot"
									style="aspect-ratio: {viewport.width} / {viewport.height};"
									onclick={() => {
										expandedScreenshotSrc = redirect.screenshotPath!;
										detailsAction = null;
									}}
									title="Click to enlarge"
								>
									<img src={redirect.screenshotPath} alt="Redirect {i + 1}" />
								</button>
							{/if}
							<a
								class="flow-url"
								href={redirect.url}
								target="_blank"
								rel="noopener noreferrer"
								title={redirect.url}
							>
								{redirect.url}
							</a>
						</div>
					{/each}
				{/if}

				<!-- After URL (if different) -->
				{#if detailsAction.action.afterUrl}
					<div class="flow-arrow">↓</div>
					<div class="flow-item flow-after">
						<div class="flow-label">After</div>
						<a
							class="flow-url"
							href={detailsAction.action.afterUrl}
							target="_blank"
							rel="noopener noreferrer"
							title={detailsAction.action.afterUrl}
						>
							{detailsAction.action.afterUrl}
						</a>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

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

	.action-item.editing {
		border-top-color: #8b5cf6;
		box-shadow: 0 0 0 2px #ddd6fe;
	}

	.action-item.current-state {
		border-top-color: #06b6d4;
		background: #ecfeff;
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
		gap: 0.5rem;
		margin-top: auto;
		padding-top: 0.5rem;
	}

	.action-type {
		font-weight: 600;
		font-size: 0.8rem;
		color: #333;
	}

	.action-explanation {
		font-size: 0.75rem;
		line-height: 1.3;
		color: #555;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		height: calc(0.75rem * 1.3 * 3); /* Fixed 3 lines */
	}

	.action-url-container {
		display: flex;
		align-items: flex-start;
		gap: 0.25rem;
		height: calc(0.65rem * 1.3 * 2); /* Fixed 2 lines */
	}

	.action-url {
		flex: 1;
		min-width: 0;
		font-size: 0.65rem;
		color: #888;
		line-height: 1.3;
		text-decoration: none;
		height: 100%;
	}

	.action-url:hover {
		color: #0066cc;
		text-decoration: underline;
	}

	.url-line {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.copy-url-btn {
		flex-shrink: 0;
		padding: 0.1rem 0.2rem;
		font-size: 0.6rem;
		background: #e5e5e5;
		color: #666;
		border: none;
		border-radius: 3px;
		cursor: pointer;
		line-height: 1;
		opacity: 0.6;
		transition: opacity 0.15s;
	}

	.action-item:hover .copy-url-btn {
		opacity: 1;
	}

	.copy-url-btn:hover {
		background: #d5d5d5;
		color: #333;
	}

	.play-action-btn {
		flex: 1;
		padding: 0.4rem 0.5rem;
		font-size: 0.85rem;
		background: #059669;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 28px;
	}

	.play-action-btn:hover:not(:disabled) {
		background: #047857;
	}

	.play-action-btn:disabled {
		background: #ccc;
		cursor: not-allowed;
	}

	.delete-action-btn {
		flex: 1;
		padding: 0.4rem 0.5rem;
		font-size: 0.95rem;
		background: #dc2626;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-weight: bold;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 28px;
	}

	.delete-action-btn:hover:not(:disabled) {
		background: #b91c1c;
	}

	.delete-action-btn:disabled {
		background: #ccc;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.screenshot-thumbnail {
		position: relative;
		width: 100%;
		/* aspect-ratio is set via inline style based on viewport prop */
		padding: 0;
		border: 1px solid #ddd;
		border-radius: 4px;
		overflow: hidden;
		cursor: pointer;
		background: #f5f5f5;
	}

	.screenshot-thumbnail:hover {
		border-color: #0066cc;
	}

	.screenshot-thumbnail img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top left;
	}

	.thumbnail-click-marker {
		position: absolute;
		width: 12px;
		height: 12px;
		border: 2px solid #f59e0b;
		background: rgba(245, 158, 11, 0.3);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.thumbnail-scroll-marker {
		position: absolute;
		bottom: 4px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(245, 158, 11, 0.9);
		color: white;
		font-size: 0.7rem;
		font-weight: bold;
		padding: 2px 6px;
		border-radius: 3px;
		pointer-events: none;
	}

	.thumbnail-scroll-marker.scroll-up {
		bottom: auto;
		top: 4px;
	}

	.thumbnail-type-marker {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: rgba(245, 158, 11, 0.9);
		color: white;
		font-size: 0.8rem;
		padding: 4px 8px;
		border-radius: 3px;
		pointer-events: none;
	}

	.screenshot-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 2rem;
		cursor: pointer;
	}

	.modal-screenshot {
		max-width: 100%;
		max-height: 100%;
		cursor: default;
	}

	.modal-screenshot :global(.screenshot-container) {
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
	}

	.modal-screenshot :global(.screenshot-container img) {
		max-height: 85vh;
		width: auto;
	}

	.modal-close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		width: 40px;
		height: 40px;
		border: none;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.2);
		color: white;
		font-size: 1.5rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
		z-index: 1;
	}

	.modal-close:hover {
		background: rgba(255, 255, 255, 0.3);
	}

	/* Navigation badge */
	.navigation-badge {
		padding: 0.2rem 0.4rem;
		font-size: 0.65rem;
		background: #fef3c7;
		color: #92400e;
		border: 1px solid #f59e0b;
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.navigation-badge:hover {
		background: #fde68a;
	}

	/* Details modal */
	.details-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.75);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 2rem;
		cursor: pointer;
	}

	.details-modal-content {
		position: relative;
		background: white;
		border-radius: 8px;
		padding: 1.5rem;
		max-width: 600px;
		max-height: 80vh;
		overflow-y: auto;
		cursor: default;
	}

	.details-modal-content .modal-close {
		background: #e5e5e5;
		color: #333;
	}

	.details-modal-content .modal-close:hover {
		background: #d5d5d5;
	}

	.details-modal-title {
		margin: 0 0 0.5rem;
		font-size: 1rem;
		color: #333;
	}

	.details-action-type {
		font-weight: 600;
		font-size: 0.9rem;
		color: #0066cc;
		margin-bottom: 0.25rem;
	}

	.details-explanation {
		font-size: 0.85rem;
		color: #555;
		margin: 0 0 1rem;
		line-height: 1.4;
	}

	/* Navigation flow */
	.navigation-flow {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.flow-arrow {
		text-align: center;
		color: #999;
		font-size: 1rem;
	}

	.flow-item {
		padding: 0.75rem;
		border-radius: 6px;
		border-left: 3px solid #ccc;
		background: #f9f9f9;
	}

	.flow-before {
		border-left-color: #0066cc;
	}

	.flow-redirect {
		border-left-color: #f59e0b;
	}

	.flow-after {
		border-left-color: #059669;
	}

	.flow-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		color: #666;
		margin-bottom: 0.25rem;
	}

	.flow-url {
		font-size: 0.8rem;
		color: #0066cc;
		text-decoration: none;
		word-break: break-all;
		display: block;
	}

	.flow-url:hover {
		text-decoration: underline;
	}

	.flow-screenshot {
		width: 200px;
		/* aspect-ratio is set via inline style based on viewport prop */
		padding: 0;
		margin-bottom: 0.5rem;
		border: 1px solid #ddd;
		border-radius: 4px;
		overflow: hidden;
		cursor: pointer;
		background: #f5f5f5;
	}

	.flow-screenshot:hover {
		border-color: #0066cc;
	}

	.flow-screenshot img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top left;
	}
</style>
