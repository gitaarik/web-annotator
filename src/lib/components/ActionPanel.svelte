<script lang="ts">
	type ActionKind = 'click' | 'hover' | 'scroll' | 'type' | 'wait' | 'stop' | 'dismiss';

	interface Props {
		selectedAction: ActionKind | null;
		scrollDirection: 'up' | 'down';
		typeText: string;
		onactionchange: (action: ActionKind) => void;
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

		<label class:selected={selectedAction === 'dismiss'} class:dismiss={true}>
			<input
				type="radio"
				name="action"
				value="dismiss"
				checked={selectedAction === 'dismiss'}
				onchange={() => onactionchange('dismiss')}
			/>
			<span class="action-icon">&#10006;</span>
			Dismiss popup
			<span class="action-hint">Close a cookie/consent/notification popup — not recorded as a step</span>
		</label>
	</div>
</div>

<style>
	.action-panel {
		padding: 1rem;
		background: var(--color-bg-tertiary);
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
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.cancel-edit-btn:hover {
		background: var(--color-border);
		color: var(--color-text-secondary);
		border-color: var(--color-border-hover);
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
		background: var(--color-bg-white);
		border: 2px solid var(--color-border);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
	}

	label:hover {
		border-color: var(--color-border-hover);
	}

	label.selected {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
	}

	/* Dismiss is set apart — it's an incidental cleanup, not a task step. */
	label.dismiss {
		border-style: dashed;
	}

	label.dismiss.selected {
		border-color: var(--color-warning, #f59e0b);
		background: var(--color-warning-bg, #fef3c7);
	}

	.action-icon {
		font-size: 1.2rem;
	}

	.action-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
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
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		border: 2px solid var(--color-border);
		border-radius: 6px;
		font-size: 0.9rem;
		font-family: inherit;
		background: var(--color-bg-white);
		color: var(--color-text-primary);
	}

	.type-input input:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	input[type='radio'] {
		accent-color: var(--color-primary);
	}
</style>
