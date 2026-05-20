<script lang="ts">
	interface Props {
		src: string;
		viewport: { width: number; height: number };
		onclick?: (x: number, y: number) => void;
		clickEnabled?: boolean;
	}

	let { src, viewport, onclick, clickEnabled = false }: Props = $props();

	let imageElement: HTMLImageElement | undefined = $state();
	let clickPosition: { x: number; y: number } | null = $state(null);

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
</script>

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
	/>
	{#if clickPosition && clickEnabled}
		<div
			class="click-marker"
			style="left: {clickPosition.x}px; top: {clickPosition.y}px;"
		></div>
	{/if}
</div>

<style>
	.screenshot-container {
		position: relative;
		display: inline-block;
		border: 2px solid #333;
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
		border: 3px solid red;
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
</style>
