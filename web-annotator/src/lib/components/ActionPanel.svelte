<script lang="ts">
	interface Props {
		selectedAction: 'click' | 'scroll' | 'stop' | null;
		scrollDirection: 'up' | 'down';
		onactionchange: (action: 'click' | 'scroll' | 'stop') => void;
		onscrolldirectionchange: (direction: 'up' | 'down') => void;
	}

	let { selectedAction, scrollDirection, onactionchange, onscrolldirectionchange }: Props = $props();
</script>

<div class="action-panel">
	<h3>Select Action</h3>

	<div class="action-options">
		<label class:selected={selectedAction === 'click'}>
			<input
				type="radio"
				name="action"
				value="click"
				checked={selectedAction === 'click'}
				onchange={() => onactionchange('click')}
			/>
			<span class="action-icon">&#128433;</span>
			Click
			<span class="action-hint">Click on the screenshot to select coordinates</span>
		</label>

		<label class:selected={selectedAction === 'scroll'}>
			<input
				type="radio"
				name="action"
				value="scroll"
				checked={selectedAction === 'scroll'}
				onchange={() => onactionchange('scroll')}
			/>
			<span class="action-icon">&#8597;</span>
			Scroll
		</label>

		{#if selectedAction === 'scroll'}
			<div class="scroll-direction">
				<label>
					<input
						type="radio"
						name="direction"
						value="up"
						checked={scrollDirection === 'up'}
						onchange={() => onscrolldirectionchange('up')}
					/>
					Up
				</label>
				<label>
					<input
						type="radio"
						name="direction"
						value="down"
						checked={scrollDirection === 'down'}
						onchange={() => onscrolldirectionchange('down')}
					/>
					Down
				</label>
			</div>
		{/if}

		<label class:selected={selectedAction === 'stop'}>
			<input
				type="radio"
				name="action"
				value="stop"
				checked={selectedAction === 'stop'}
				onchange={() => onactionchange('stop')}
			/>
			<span class="action-icon">&#9632;</span>
			Stop
			<span class="action-hint">Finish annotation and provide final answer</span>
		</label>
	</div>
</div>

<style>
	.action-panel {
		padding: 1rem;
		background: #f5f5f5;
		border-radius: 8px;
	}

	h3 {
		margin: 0 0 1rem 0;
		font-size: 1rem;
	}

	.action-options {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: white;
		border: 2px solid #ddd;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
	}

	label:hover {
		border-color: #999;
	}

	label.selected {
		border-color: #0066cc;
		background: #e6f0ff;
	}

	.action-icon {
		font-size: 1.2rem;
	}

	.action-hint {
		font-size: 0.75rem;
		color: #666;
		margin-left: auto;
	}

	.scroll-direction {
		display: flex;
		gap: 1rem;
		padding-left: 2rem;
	}

	.scroll-direction label {
		padding: 0.5rem 1rem;
	}

	input[type='radio'] {
		accent-color: #0066cc;
	}
</style>
