<script lang="ts">
	import type { HoverInfo } from '$lib/types';

	interface Props {
		src: string;
		viewport: { width: number; height: number };
		onclick?: (x: number, y: number) => void;
		clickEnabled?: boolean;
		hoverInfo?: HoverInfo;
	}

	let { src, viewport, onclick, clickEnabled = false, hoverInfo = null }: Props = $props();

	let imageElement: HTMLImageElement | undefined = $state();
	let clickPosition: { x: number; y: number } | null = $state(null);
	let layoutVersion = $state(0);

	// Clear click position when screenshot changes
	$effect(() => {
		src;
		clickPosition = null;
	});

	function handleClick(event: MouseEvent) {
		if (!clickEnabled || !imageElement || !onclick) return;

		const rect = imageElement.getBoundingClientRect();
		const scaleX = viewport.width / rect.width;
		const scaleY = viewport.height / rect.height;

		const x = Math.round((event.clientX - rect.left) * scaleX);
		const y = Math.round((event.clientY - rect.top) * scaleY);

		clickPosition = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		onclick(x, y);
	}

	function handleImageLoad() {
		layoutVersion++;
	}

	// Convert viewport coordinates to display coordinates for click/hover highlight
	let clickHighlightPosition = $derived.by(() => {
		// Include layoutVersion in dependencies to trigger recalculation when image loads or resizes
		void layoutVersion;
		if (!hoverInfo || (hoverInfo.type !== 'click' && hoverInfo.type !== 'hover') || !imageElement) return null;
		const rect = imageElement.getBoundingClientRect();
		if (rect.width === 0) return null;
		const scaleX = rect.width / viewport.width;
		const scaleY = rect.height / viewport.height;
		return {
			x: hoverInfo.coordinates.x * scaleX,
			y: hoverInfo.coordinates.y * scaleY
		};
	});

	let scrollDirection = $derived(
		hoverInfo?.type === 'scroll' ? hoverInfo.direction : null
	);

	let typeText = $derived(
		hoverInfo?.type === 'type' ? hoverInfo.text : null
	);
</script>

<svelte:window onresize={() => layoutVersion++} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="screenshot-container"
	class:clickable={clickEnabled}
	onclick={handleClick}
	onkeydown={(e) => e.key === 'Enter' && handleClick(e as unknown as MouseEvent)}
	role={clickEnabled ? 'button' : undefined}
	tabindex={clickEnabled ? 0 : undefined}
>
	<img
		bind:this={imageElement}
		{src}
		alt="Webpage screenshot"
		onload={handleImageLoad}
	/>
	{#if clickPosition && clickEnabled}
		<div
			class="click-marker"
			style="left: {clickPosition.x}px; top: {clickPosition.y}px;"
		></div>
	{/if}
	{#if clickHighlightPosition}
		<div
			class="highlight-marker"
			style="left: {clickHighlightPosition.x}px; top: {clickHighlightPosition.y}px;"
		></div>
	{/if}
	{#if scrollDirection}
		<div class="scroll-indicator" class:scroll-up={scrollDirection === 'up'} class:scroll-down={scrollDirection === 'down'}>
			<span class="scroll-arrow">{scrollDirection === 'up' ? '↑' : '↓'}</span>
			<span class="scroll-label">Scroll {scrollDirection}</span>
		</div>
	{/if}
	{#if typeText}
		<div class="type-indicator">
			<span class="type-icon">⌨</span>
			<span class="type-text">"{typeText}"</span>
		</div>
	{/if}
</div>

<style>
	.screenshot-container {
		position: relative;
		display: inline-block;
		border: 2px solid var(--color-border-dark);
		border-radius: 4px;
		overflow: hidden;
	}

	img {
		display: block;
		max-width: 100%;
		height: auto;
	}

	.screenshot-container.clickable {
		cursor: crosshair;
	}

	.click-marker {
		position: absolute;
		width: 20px;
		height: 20px;
		border: 3px solid var(--color-danger);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		animation: pulse 0.5s ease-out;
	}

	@keyframes pulse {
		0% {
			transform: translate(-50%, -50%) scale(0.5);
			opacity: 1;
		}
		100% {
			transform: translate(-50%, -50%) scale(1.5);
			opacity: 0.5;
		}
	}

	.highlight-marker {
		position: absolute;
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-warning);
		background: color-mix(in srgb, var(--color-warning) 20%, transparent);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		animation: highlight-pulse 1s ease-in-out infinite;
	}

	@keyframes highlight-pulse {
		0%, 100% {
			transform: translate(-50%, -50%) scale(1);
			opacity: 1;
		}
		50% {
			transform: translate(-50%, -50%) scale(1.2);
			opacity: 0.7;
		}
	}

	.scroll-indicator {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.75rem 1.5rem;
		background: var(--color-warning);
		color: white;
		border-radius: 8px;
		pointer-events: none;
		animation: scroll-bounce 0.6s ease-in-out infinite;
	}

	.scroll-indicator.scroll-up {
		top: 20px;
	}

	.scroll-indicator.scroll-down {
		bottom: 20px;
	}

	.scroll-arrow {
		font-size: 1.5rem;
		font-weight: bold;
	}

	.scroll-label {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	@keyframes scroll-bounce {
		0%, 100% {
			transform: translateX(-50%) translateY(0);
		}
		50% {
			transform: translateX(-50%) translateY(-5px);
		}
	}

	.scroll-indicator.scroll-down {
		animation-name: scroll-bounce-down;
	}

	@keyframes scroll-bounce-down {
		0%, 100% {
			transform: translateX(-50%) translateY(0);
		}
		50% {
			transform: translateX(-50%) translateY(5px);
		}
	}

	.type-indicator {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		background: var(--color-warning);
		color: white;
		border-radius: 8px;
		pointer-events: none;
		animation: type-pulse 0.8s ease-in-out infinite;
		max-width: 80%;
	}

	.type-icon {
		font-size: 1.25rem;
	}

	.type-text {
		font-size: 0.9rem;
		font-weight: 500;
		font-family: monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@keyframes type-pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}
</style>
