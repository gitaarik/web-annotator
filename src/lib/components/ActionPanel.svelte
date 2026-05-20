<script lang="ts">
	interface Props {
		selectedAction: 'click' | 'hover' | 'scroll' | 'type' | 'wait' | 'stop' | null;
		scrollDirection: 'up' | 'down';
		typeText: string;
		onactionchange: (action: 'click' | 'hover' | 'scroll' | 'type' | 'wait' | 'stop') => void;
		onscrolldirectionchange: (direction: 'up' | 'down') => void;
		ontextchange: (text: string) => void;
		isEditing?: boolean;
		onCancelEdit?: () => void;
	}

	let { selectedAction, scrollDirection, typeText, onactionchange, onscrolldirectionchange, ontextchange, isEditing = false, onCancelEdit }: Props = $props();
</script>

<div class="action-panel">
	<div class="panel-header">
		<h3>Select Action</h3>
		{#if isEditing && onCancelEdit}
			<button class="cancel-edit-btn" onclick={onCancelEdit}>
				Cancel Edit
			</button>
		{/if}
	</div>

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

		<label class:selected={selectedAction === 'hover'}>
			<input
				type="radio"
				name="action"
				value="hover"
				checked={selectedAction === 'hover'}
				onchange={() => onactionchange('hover')}
			/>
			<span class="action-icon">&#128070;</span>
			Hover
			<span class="action-hint">Move mouse to coordinates without clicking</span>
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

		<label class:selected={selectedAction === 'type'}>
			<input
				type="radio"
				name="action"
				value="type"
				checked={selectedAction === 'type'}
				onchange={() => onactionchange('type')}
			/>
			<span class="action-icon">&#9000;</span>
			Type
			<span class="action-hint">Type text into the focused element</span>
		</label>

		{#if selectedAction === 'type'}
			<div class="type-input">
				<input
					type="text"
					placeholder="Text to type..."
					value={typeText}
					oninput={(e) => ontextchange(e.currentTarget.value)}
				/>
			</div>
		{/if}

		<label class:selected={selectedAction === 'wait'}>
			<input
				type="radio"
				name="action"
				value="wait"
				checked={selectedAction === 'wait'}
				onchange={() => onactionchange('wait')}
			/>
			<span class="action-icon">&#9203;</span>
			Wait
			<span class="action-hint">Wait for page to finish loading</span>
		</label>

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

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	h3 {
		margin: 0;
		font-size: 1rem;
	}

	.cancel-edit-btn {
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
		background: #e5e5e5;
		color: #666;
		border: 1px solid #ccc;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.cancel-edit-btn:hover {
		background: #d5d5d5;
		color: #333;
		border-color: #999;
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

	.type-input {
		padding-left: 2rem;
	}

	.type-input input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 2px solid #ddd;
		border-radius: 6px;
		font-size: 0.9rem;
		font-family: inherit;
	}

	.type-input input:focus {
		outline: none;
		border-color: #0066cc;
	}

	input[type='radio'] {
		accent-color: #0066cc;
	}
</style>
