<script lang="ts">
	import { type Action, type HoverInfo, formatAction, actionToHoverInfo } from '$lib/types';
	import { formatUrlParts, copyToClipboard } from '$lib/utils/url';
	import ScreenshotViewer from './ScreenshotViewer.svelte';

	let copiedUrl: string | null = $state(null);
	let expandedAction: Action | null = $state(null);
	let expandedScreenshotSrc: string | null = $state(null);
	let detailsAction: { index: number; action: Action } | null = $state(null);
	let actionsListEl: HTMLDivElement | undefined = $state();
	let prevActionsLength = $state(0);
	let appendScrollReady = $state(false);
	let prevReplayedUpTo = $state(-1);
	let prevHasPending = $state(false);
	// Guard so the playhead-scroll effect doesn't fire on its first run (mount),
	// which would otherwise scroll the history on page load.
	let intentScrollReady = $state(false);

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
		loadingIndex?: number | null;
		queuedIndex?: number | null;
		onDelete?: (index: number) => void;
		deletingIndex?: number | null;
		onHoverAction?: (info: HoverInfo) => void;
		// Which step is open in the right-pane inspector (edit mode). null = add mode.
		selectedIndex?: number | null;
		// Which step is pinned for a read-only preview on the canvas, if any.
		previewIndex?: number | null;
		// Click a card to pin/unpin its read-only preview.
		onSelect?: (index: number) => void;
		// Right pane is in add mode: show the insertion cursor in the strip.
		insertMode?: boolean;
		// Insert a new step at position `index` (0..actions.length). Moves the cursor
		// there and puts the inspector in add mode.
		onInsertAt?: (index: number) => void;
		pendingActionPreview?: {
			type: string;
			explanation: string;
			coordinates?: { x: number; y: number };
			direction?: 'up' | 'down';
			text?: string;
		} | null;
		screenshotVersion?: number;
	}

	let {
		actions,
		viewport = { width: 1280, height: 800 },
		currentScreenshot = null,
		currentUrl = null,
		replayedUpTo = -1,
		loadingIndex = null,
		queuedIndex = null,
		onDelete,
		deletingIndex = null,
		onHoverAction,
		selectedIndex = null,
		previewIndex = null,
		onSelect,
		insertMode = false,
		onInsertAt,
		pendingActionPreview = null,
		screenshotVersion = 0
	}: Props = $props();

	// The insertion cursor sits just after the playhead — that's where a new step
	// lands (matches the server's insertIndex = replayedUpTo + 1). Only shown while
	// the inspector is in add mode.
	let cursorPosition = $derived(replayedUpTo + 1);

	// The configured viewport (config.ts) can differ from the actual captured
	// screenshot size, so the viewport ratio would render the thumbnail box at the
	// wrong shape — tall boxes and misplaced markers. Drive the box from the real
	// image aspect instead, matching the main ScreenshotViewer (which renders at
	// natural size). Measured once from the first loaded thumbnail; until then we
	// fall back to the viewport ratio.
	let displayAspect = $state<number | null>(null);
	function measureAspect(e: Event) {
		if (displayAspect !== null) return;
		const img = e.currentTarget as HTMLImageElement;
		if (img.naturalWidth && img.naturalHeight) {
			displayAspect = img.naturalWidth / img.naturalHeight;
		}
	}
	let thumbAspect = $derived(displayAspect ?? viewport.width / viewport.height);

	// Add cache-busting query param to screenshot URLs
	function versionedSrc(src: string): string;
	function versionedSrc(src: string | null | undefined): string | null;
	function versionedSrc(src: string | null | undefined): string | null {
		if (!src) return null;
		const separator = src.includes('?') ? '&' : '?';
		return `${src}${separator}v=${screenshotVersion}`;
	}

	function isLoading(index: number): boolean {
		return loadingIndex === index;
	}

	function isQueued(index: number): boolean {
		return queuedIndex === index;
	}

	function isReplayed(index: number): boolean {
		return index <= replayedUpTo;
	}

	// The next step the transport would play (the playhead's frontier).
	function isNextPlayable(index: number): boolean {
		return index === replayedUpTo + 1;
	}

	// Check if this action caused navigation (has afterUrl different from url)
	function causedNavigation(index: number): boolean {
		const action = actions[index];
		if (!action?.afterUrl) return false;
		return action.afterUrl !== action.url;
	}

	let isHoveringNextAction = $state(false);
	let hoverCooldown = $state(false);

	function handleMouseEnter(action: Action, index: number) {
		if (!onHoverAction || hoverCooldown) return;
		// Allow hover overlay for the next playable action
		if (index === replayedUpTo + 1) {
			isHoveringNextAction = true;
			const info = actionToHoverInfo(action);
			if (info) onHoverAction(info);
		}
	}

	function handleMouseLeave() {
		if (onHoverAction) {
			isHoveringNextAction = false;
			// If something is loading, show its overlay; otherwise clear
			if (loadingIndex !== null) {
				const loadingAction = actions[loadingIndex];
				if (loadingAction) {
					const info = actionToHoverInfo(loadingAction);
					if (info) onHoverAction(info);
				}
			} else {
				onHoverAction(null);
			}
		}
	}

	// Auto-scroll to the right when new actions are added and user is near the scroll limit
	$effect(() => {
		const currentLength = actions.length;
		const wasAdded = currentLength > prevActionsLength;
		prevActionsLength = currentLength;

		// Skip the first run: the initial list isn't a user-added action, and
		// treating it as one scrolls the history right on page load.
		if (!appendScrollReady) {
			appendScrollReady = true;
			return;
		}

		if (wasAdded && actionsListEl) {
			// Check if user is already near the right edge (within 200px of the end)
			const scrollRight = actionsListEl.scrollWidth - actionsListEl.scrollLeft - actionsListEl.clientWidth;
			const nearEnd = scrollRight < 200;

			if (nearEnd) {
				// Use requestAnimationFrame to ensure DOM has updated
				requestAnimationFrame(() => {
					actionsListEl?.scrollTo({
						left: actionsListEl.scrollWidth,
						behavior: 'smooth'
					});
				});
			}
		}
	});

	// Scroll all the way to the right edge (reveals the "Now" / newest card).
	// Unlike the append effect above, this ignores scroll position — the user
	// just acted, so follow the card they created.
	function scrollToRightEdge() {
		if (!actionsListEl) return;
		requestAnimationFrame(() => {
			actionsListEl?.scrollTo({
				left: actionsListEl.scrollWidth,
				behavior: 'smooth'
			});
		});
	}

	// Scroll just enough to bring a specific action card into view (with a little
	// breathing room), without jumping to the far edge. No-op if it's already visible.
	function revealActionCard(index: number) {
		if (!actionsListEl) return;
		requestAnimationFrame(() => {
			const el = actionsListEl?.querySelector(`[data-action-index="${index}"]`);
			if (!el || !actionsListEl) return;
			const padding = 16;
			const contRect = actionsListEl.getBoundingClientRect();
			const elRect = el.getBoundingClientRect();
			if (elRect.right > contRect.right) {
				actionsListEl.scrollBy({ left: elRect.right - contRect.right + padding, behavior: 'smooth' });
			} else if (elRect.left < contRect.left) {
				actionsListEl.scrollBy({ left: elRect.left - contRect.left - padding, behavior: 'smooth' });
			}
		});
	}

	// Follow the playhead as actions are executed: reveal the next action as you
	// step forward, and only jump fully right at the last step (to show "Now") or
	// while recording a new action. Driven by replayedUpTo and the pending preview.
	$effect(() => {
		const currentReplayed = replayedUpTo;
		const hasPending = pendingActionPreview !== null;
		const pendingAppeared = hasPending && !prevHasPending;
		const replayedChanged = currentReplayed !== prevReplayedUpTo;

		prevReplayedUpTo = currentReplayed;
		prevHasPending = hasPending;

		// Record initial state on the first run without scrolling.
		if (!intentScrollReady) {
			intentScrollReady = true;
			return;
		}

		if (pendingAppeared) {
			// Recording a new action — reveal the pending card at the end.
			scrollToRightEdge();
		} else if (replayedChanged) {
			if (currentReplayed < 0 || currentReplayed >= actions.length - 1) {
				// Add-new mode, or executing the last step: reveal the "Now" card.
				scrollToRightEdge();
			} else {
				// Executed a step with more to come: bring just the next action into view.
				revealActionCard(currentReplayed + 1);
			}
		}
	});

	// Show overlay for loading action automatically, with cooldown to prevent spurious hover
	$effect(() => {
		if (!onHoverAction) return;
		if (loadingIndex !== null) {
			// Start cooldown when loading begins
			hoverCooldown = true;
			isHoveringNextAction = false;
			setTimeout(() => (hoverCooldown = false), 300);

			const loadingAction = actions[loadingIndex];
			if (loadingAction) {
				const info = actionToHoverInfo(loadingAction);
				if (info) onHoverAction(info);
			}
		} else if (!isHoveringNextAction) {
			onHoverAction(null);
		}
	});
</script>

<div class="session-history">
	<div class="history-header">
		<span class="history-title">History ({actions.length})</span>
	</div>

	<div class="actions-list" bind:this={actionsListEl}>
		{#each actions as action, index}
			{#if onInsertAt}
				<button
					class="insert-gap"
					class:cursor={insertMode && cursorPosition === index}
					onclick={() => onInsertAt(index)}
					title="Insert a step here"
					aria-label="Insert a step before #{index}"
				>
					<span class="insert-gap-plus">+</span>
				</button>
			{/if}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="action-item"
				class:selectable={!!onSelect}
				data-action-index={index}
				class:editing={selectedIndex === index}
				class:previewing={previewIndex === index}
				role={onSelect ? 'button' : undefined}
				tabindex={onSelect ? 0 : undefined}
				onclick={() => onSelect?.(index)}
				onkeydown={(e) => {
					if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
						e.preventDefault();
						onSelect(index);
					}
				}}
				onmouseenter={() => handleMouseEnter(action, index)}
				onmouseleave={handleMouseLeave}
			>
				<div class="action-top">
					<span class="action-ident">
						<span
							class="status-dot"
							class:done={isReplayed(index)}
							class:next={isNextPlayable(index)}
							class:editing={selectedIndex === index}
						></span>
						<span class="action-number">#{index}</span>
					</span>
					<span class="action-top-right">
						{#if isLoading(index)}
							<span class="spinner card-spinner"></span>
						{:else if isQueued(index)}
							<span class="card-badge">queued</span>
						{/if}
						{#if onDelete}
							<button
								class="card-delete"
								class:loading={deletingIndex === index}
								onclick={(e) => {
									e.stopPropagation();
									onDelete(index);
								}}
								disabled={deletingIndex !== null}
								title="Delete this step"
								aria-label="Delete step #{index}"
							>
								{#if deletingIndex === index}
									<span class="spinner"></span>
								{:else}
									×
								{/if}
							</button>
						{/if}
					</span>
				</div>
				{#if action.screenshotPath}
					<div
						class="screenshot-thumbnail"
						style="aspect-ratio: {thumbAspect};"
					>
						<img
							src={versionedSrc(action.screenshotPath)}
							alt="Screenshot for action {index}"
							onload={measureAspect}
						/>
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
						<button
							class="enlarge-btn"
							onclick={(e) => {
								e.stopPropagation();
								expandedAction = action;
							}}
							title="Enlarge screenshot"
							aria-label="Enlarge screenshot for step #{index}"
						>⤢</button>
					</div>
				{/if}
				<div class="action-type">{formatAction(action)}</div>
				<div class="action-explanation">{action.explanation}</div>
				<div class="action-url-container">
					{#if action.url}
						{@const urlParts = formatUrlParts(action.url)}
						<a
							class="action-url"
							href={action.url}
							target="_blank"
							rel="noopener noreferrer"
							title={action.url}
							onclick={(e) => e.stopPropagation()}
						>
							<span class="url-line">{urlParts.line1}</span>
							{#if urlParts.line2}
								<span class="url-line">{urlParts.line2}</span>
							{/if}
						</a>
						<button
							class="copy-url-btn"
							onclick={(e) => {
								e.stopPropagation();
								copyUrl(action.url);
							}}
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
						onclick={(e) => {
							e.stopPropagation();
							detailsAction = { index, action };
						}}
						title="View navigation details"
					>
						{#if action.redirects && action.redirects.length > 0}
							{action.redirects.length} redirect{action.redirects.length > 1 ? 's' : ''}
						{:else}
							navigated
						{/if}
					</button>
				{/if}
			</div>
		{/each}

		{#if onInsertAt && actions.length > 0}
			<button
				class="insert-gap"
				class:cursor={insertMode && cursorPosition === actions.length}
				onclick={() => onInsertAt(actions.length)}
				title="Add a step at the end"
				aria-label="Add a step at the end"
			>
				<span class="insert-gap-plus">+</span>
			</button>
		{/if}

		{#if pendingActionPreview}
			<div class="action-item pending-action">
				<div class="action-top">
					<span class="action-number">#{actions.length}</span>
					<span class="spinner"></span>
				</div>
				<div
					class="screenshot-thumbnail pending-thumbnail"
					style="aspect-ratio: {thumbAspect};"
				>
					<span class="pending-icon">...</span>
				</div>
				<div class="action-type">
					{pendingActionPreview.type.charAt(0).toUpperCase() + pendingActionPreview.type.slice(1)}
					{#if pendingActionPreview.coordinates}
						({pendingActionPreview.coordinates.x}, {pendingActionPreview.coordinates.y})
					{:else if pendingActionPreview.direction}
						{pendingActionPreview.direction}
					{:else if pendingActionPreview.text}
						"{pendingActionPreview.text.slice(0, 20)}{pendingActionPreview.text.length > 20 ? '...' : ''}"
					{/if}
				</div>
				<div class="action-explanation">{pendingActionPreview.explanation}</div>
				<div class="action-url-container"></div>
			</div>
		{/if}

		{#if currentScreenshot && !pendingActionPreview}
			{@const addingAtEnd = insertMode && cursorPosition >= actions.length}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="action-item current-state"
				class:adding={addingAtEnd}
				class:selectable={!!onInsertAt}
				role={onInsertAt ? 'button' : undefined}
				tabindex={onInsertAt ? 0 : undefined}
				onclick={() => onInsertAt?.(actions.length)}
				onkeydown={(e) => {
					if (onInsertAt && (e.key === 'Enter' || e.key === ' ')) {
						e.preventDefault();
						onInsertAt(actions.length);
					}
				}}
			>
				<div class="action-top">
					<span class="action-ident">
						<span class="status-dot live"></span>
						<span class="action-number">Now</span>
					</span>
				</div>
				<div
					class="screenshot-thumbnail"
					style="aspect-ratio: {thumbAspect};"
				>
					<img src={versionedSrc(currentScreenshot)} alt="Current state" onload={measureAspect} />
					<button
						class="enlarge-btn"
						onclick={(e) => {
							e.stopPropagation();
							expandedScreenshotSrc = currentScreenshot;
						}}
						title="Enlarge screenshot"
						aria-label="Enlarge current state"
					>⤢</button>
				</div>
				<div class="action-type">Live browser</div>
				<div class="action-explanation">
					{#if addingAtEnd}
						Adding a step here…
					{:else if onInsertAt}
						Current page — click to add a step
					{:else}
						Current page
					{/if}
				</div>
				<div class="action-url-container">
					{#if currentUrl}
						{@const urlParts = formatUrlParts(currentUrl)}
						<a
							class="action-url"
							href={currentUrl}
							target="_blank"
							rel="noopener noreferrer"
							title={currentUrl}
							onclick={(e) => e.stopPropagation()}
						>
							<span class="url-line">{urlParts.line1}</span>
							{#if urlParts.line2}
								<span class="url-line">{urlParts.line2}</span>
							{/if}
						</a>
						<button
							class="copy-url-btn"
							onclick={(e) => {
								e.stopPropagation();
								copyUrl(currentUrl);
							}}
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
				src={versionedSrc(expandedAction.screenshotPath)}
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
				src={versionedSrc(expandedScreenshotSrc)}
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
									style="aspect-ratio: {thumbAspect};"
									onclick={() => {
										expandedScreenshotSrc = redirect.screenshotPath!;
										detailsAction = null;
									}}
									title="Click to enlarge"
								>
									<img src={versionedSrc(redirect.screenshotPath)} alt="Redirect {i + 1}" onload={measureAspect} />
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
		background: var(--color-bg-secondary);
		border-radius: 8px;
		padding: 0.75rem;
	}

	.history-header {
		margin-bottom: 0.5rem;
	}

	.history-title {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--color-text-secondary);
	}

	.actions-list {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 0.5rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
	}

	.action-item {
		flex-shrink: 0;
		/* Card width drives thumbnail size; height follows via the viewport aspect
		   ratio (≈ width × 0.625), so shrinking this keeps the shot's proportions. */
		width: 130px;
		padding: 0.5rem;
		background: var(--color-bg-white);
		border-radius: 6px;
		/* Quiet by default: finished and upcoming steps look the same. Only the
		   current step (the edit target) gets a prominent highlight below, so the
		   strip reads as "here's where you are" rather than a wall of colour. */
		border-top: 3px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.action-item.editing {
		border-top-color: var(--color-purple);
		box-shadow: 0 0 0 2px var(--color-purple-border);
	}

	/* Pinned for a read-only canvas preview — a dashed ring so it reads as "just
	   looking", distinct from the solid editing/playhead highlights. */
	.action-item.previewing {
		outline: 2px dashed var(--color-purple, #7c3aed);
		outline-offset: 1px;
	}

	.action-item.current-state {
		border-top-color: var(--color-cyan);
		background: var(--color-cyan-bg);
	}

	.action-item.pending-action {
		border-top-color: var(--color-primary);
		background: var(--color-primary-bg, #eff6ff);
		animation: pulse-bg 1.5s ease-in-out infinite;
	}

	@keyframes pulse-bg {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	.pending-thumbnail {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 4px;
	}

	.pending-icon {
		font-size: 1.5rem;
		color: var(--color-text-muted);
		animation: pulse-text 1s ease-in-out infinite;
	}

	@keyframes pulse-text {
		0%, 100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	.action-item.current-state.adding {
		border-top-color: var(--color-success);
		box-shadow: 0 0 0 2px var(--color-success-bg);
	}

	.action-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 18px;
	}

	.action-ident {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}

	.action-number {
		font-weight: bold;
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	/* Status dot mirrors the card's border-top state, but reads at a glance even
	   when the card is scrolled tight against its neighbours. */
	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-primary);
		flex-shrink: 0;
	}

	.status-dot.done {
		background: var(--color-success);
	}

	.status-dot.next {
		background: var(--color-warning);
	}

	.status-dot.editing {
		background: var(--color-purple);
	}

	.status-dot.live {
		background: var(--color-cyan);
	}

	.action-top-right {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.card-badge {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--color-warning-text, #92400e);
		background: var(--color-warning-bg, #fef3c7);
		border-radius: 3px;
		padding: 0.05rem 0.25rem;
	}

	.card-spinner {
		border-color: var(--color-border);
		border-top-color: var(--color-primary);
	}

	/* Quick delete — hover-revealed so the lean cards stay uncluttered; the full
	   delete also lives in the inspector's edit mode. */
	.card-delete {
		width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 3px;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s, background 0.15s, color 0.15s;
	}

	.action-item:hover .card-delete,
	.action-item:focus-within .card-delete {
		opacity: 0.7;
	}

	.card-delete:hover:not(:disabled) {
		opacity: 1;
		background: var(--color-danger, #ef4444);
		color: white;
	}

	.card-delete:disabled {
		cursor: not-allowed;
	}

	.action-type {
		font-weight: 600;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}

	.action-explanation {
		font-size: 0.75rem;
		line-height: 1.3;
		color: var(--color-text-muted);
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
		color: var(--color-text-subtle);
		line-height: 1.3;
		text-decoration: none;
		height: 100%;
	}

	.action-url:hover {
		color: var(--color-primary);
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
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
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
		background: var(--color-border);
		color: var(--color-text-secondary);
	}

	/* Clickable card = open in the inspector for editing. */
	.action-item.selectable {
		cursor: pointer;
		transition: box-shadow 0.15s, border-color 0.15s;
	}

	.action-item.selectable:hover {
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
	}

	.action-item.selectable:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	/* Slim seam between cards: click to insert a step there. The "+" and the
	   active-cursor tint only show on hover / when the insertion point is here. */
	.insert-gap {
		align-self: stretch;
		flex-shrink: 0;
		width: 16px;
		min-height: 120px;
		margin: 0 -3px;
		padding: 0;
		border: none;
		background: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: var(--color-primary);
		border-radius: 4px;
		transition: background 0.15s;
		z-index: 1;
	}

	.insert-gap-plus {
		opacity: 0;
		font-size: 1.1rem;
		font-weight: 600;
		line-height: 1;
		pointer-events: none;
		transition: opacity 0.15s;
	}

	.insert-gap:hover .insert-gap-plus {
		opacity: 1;
	}

	.insert-gap:hover {
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
	}

	/* The insertion cursor: where the next added step will land. */
	.insert-gap.cursor {
		background: color-mix(in srgb, var(--color-success) 18%, transparent);
		color: var(--color-success);
	}

	.insert-gap.cursor .insert-gap-plus {
		opacity: 1;
	}

	/* Enlarge affordance over the thumbnail — hover-revealed so it doesn't fight
	   the card's click-to-edit. */
	.enlarge-btn {
		position: absolute;
		top: 3px;
		right: 3px;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.55);
		color: white;
		font-size: 0.8rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.screenshot-thumbnail:hover .enlarge-btn,
	.enlarge-btn:focus-visible {
		opacity: 1;
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
		border: 1px solid var(--color-border);
		border-radius: 4px;
		overflow: hidden;
		cursor: pointer;
		background: var(--color-bg-tertiary);
	}

	.screenshot-thumbnail:hover {
		border-color: var(--color-primary);
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
		border: 2px solid var(--color-warning);
		background: color-mix(in srgb, var(--color-warning) 30%, transparent);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.thumbnail-scroll-marker {
		position: absolute;
		bottom: 4px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-warning);
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
		background: var(--color-warning);
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
		background: var(--color-warning-bg);
		color: var(--color-warning-text, #92400e);
		border: 1px solid var(--color-warning);
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.navigation-badge:hover {
		background: var(--color-warning-hover-bg, #fde68a);
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
		background: var(--color-bg-white);
		border-radius: 8px;
		padding: 1.5rem;
		max-width: 600px;
		max-height: 80vh;
		overflow-y: auto;
		cursor: default;
	}

	.details-modal-content .modal-close {
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
	}

	.details-modal-content .modal-close:hover {
		background: var(--color-border);
	}

	.details-modal-title {
		margin: 0 0 0.5rem;
		font-size: 1rem;
		color: var(--color-text-secondary);
	}

	.details-action-type {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--color-primary);
		margin-bottom: 0.25rem;
	}

	.details-explanation {
		font-size: 0.85rem;
		color: var(--color-text-muted);
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
		color: var(--color-text-subtle);
		font-size: 1rem;
	}

	.flow-item {
		padding: 0.75rem;
		border-radius: 6px;
		border-left: 3px solid var(--color-disabled);
		background: var(--color-bg-secondary);
	}

	.flow-before {
		border-left-color: var(--color-primary);
	}

	.flow-redirect {
		border-left-color: var(--color-warning);
	}

	.flow-after {
		border-left-color: var(--color-success);
	}

	.flow-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--color-text-muted);
		margin-bottom: 0.25rem;
	}

	.flow-url {
		font-size: 0.8rem;
		color: var(--color-primary);
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
		border: 1px solid var(--color-border);
		border-radius: 4px;
		overflow: hidden;
		cursor: pointer;
		background: var(--color-bg-tertiary);
	}

	.flow-screenshot:hover {
		border-color: var(--color-primary);
	}

	.flow-screenshot img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top left;
	}
</style>
