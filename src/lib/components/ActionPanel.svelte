<script lang="ts">
	type ActionKind = 'click' | 'hover' | 'scroll' | 'type' | 'stop' | 'dismiss';

	interface Props {
		selectedAction: ActionKind | null;
		scrollDirection: 'up' | 'down';
		typeText: string;
		onactionchange: (action: ActionKind) => void;
		onscrolldirectionchange: (direction: 'up' | 'down') => void;
		ontextchange: (text: string) => void;
		isEditing?: boolean;
		onCancelEdit?: () => void;
		disabled?: boolean;
	}

	let { selectedAction, scrollDirection, typeText, onactionchange, onscrolldirectionchange, ontextchange, isEditing = false, onCancelEdit, disabled = false }: Props = $props();

	const actions: { kind: ActionKind; icon: string; label: string; hint: string }[] = [
		{ kind: 'click', icon: '\u{1F5B1}', label: 'Click', hint: 'Click on the screenshot to select coordinates' },
		{ kind: 'hover', icon: '\u{1F446}', label: 'Hover', hint: 'Move mouse to coordinates without clicking' },
		{ kind: 'scroll', icon: '↕', label: 'Scroll', hint: 'Scroll the page up or down' },
		{ kind: 'type', icon: '⌨', label: 'Type', hint: 'Type text into the focused element' },
		{ kind: 'stop', icon: '■', label: 'Stop', hint: 'Finish annotation and provide final answer' }
	];
</script>

<div class="action-panel" class:disabled>
	<div class="panel-header">
		<h3>Select Action</h3>
		{#if isEditing && onCancelEdit}
			<button class="cancel-edit-btn" onclick={onCancelEdit}>
				Cancel Edit
			</button>
		{/if}
	</div>

	<div class="action-list" role="radiogroup" aria-label="Select action">
		{#each actions as action (action.kind)}
			<label class="action-row" class:selected={selectedAction === action.kind}>
				<input
					type="radio"
					name="action"
					value={action.kind}
					checked={selectedAction === action.kind}
					{disabled}
					onchange={() => onactionchange(action.kind)}
				/>
				<span class="action-icon">{action.icon}</span>
				<span class="action-label">{action.label}</span>
				<span class="action-hint">{action.hint}</span>
			</label>

			{#if action.kind === 'scroll' && selectedAction === 'scroll'}
				<div class="action-extra scroll-direction">
					<label class:selected={scrollDirection === 'up'}>
						<input
							type="radio"
							name="direction"
							value="up"
							checked={scrollDirection === 'up'}
							{disabled}
							onchange={() => onscrolldirectionchange('up')}
						/>
						Up
					</label>
					<label class:selected={scrollDirection === 'down'}>
						<input
							type="radio"
							name="direction"
							value="down"
							checked={scrollDirection === 'down'}
							{disabled}
							onchange={() => onscrolldirectionchange('down')}
						/>
						Down
					</label>
				</div>
			{/if}

			{#if action.kind === 'type' && selectedAction === 'type'}
				<div class="action-extra type-input">
					<input
						type="text"
						placeholder="Text to type..."
						value={typeText}
						{disabled}
						oninput={(e) => ontextchange(e.currentTarget.value)}
					/>
				</div>
			{/if}
		{/each}

		<label class="action-row dismiss" class:selected={selectedAction === 'dismiss'}>
			<input
				type="radio"
				name="action"
				value="dismiss"
				checked={selectedAction === 'dismiss'}
				{disabled}
				onchange={() => onactionchange('dismiss')}
			/>
			<span class="action-icon">&#10006;</span>
			<span class="action-label">Dismiss popup</span>
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

	/* While a step is running/saving, the whole picker is inert and dimmed so it's
	   clear you can't change the action mid-flight. */
	.action-panel.disabled {
		opacity: 0.55;
	}

	.action-panel.disabled .action-row {
		cursor: not-allowed;
	}

	.action-panel.disabled .action-row:hover {
		background: none;
	}

	.action-panel.disabled .action-row.selected {
		background: var(--color-primary-light);
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
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

	/* Single collapsed-border list: rows share edges, container owns the outer border. */
	.action-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
		background: var(--color-bg-white);
	}

	.action-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.65rem;
		border-top: 1px solid var(--color-border);
		cursor: pointer;
		transition: background 0.15s;
	}

	.action-row:first-child {
		border-top: none;
	}

	.action-row:hover {
		background: var(--color-bg-tertiary);
	}

	.action-row.selected {
		background: var(--color-primary-light);
		box-shadow: inset 3px 0 0 var(--color-primary);
	}

	/* Dismiss is set apart — it's an incidental cleanup, not a task step. */
	.action-row.dismiss {
		border-top-style: dashed;
		color: var(--color-text-muted);
	}

	.action-row.dismiss.selected {
		background: var(--color-warning-bg, #fef3c7);
		box-shadow: inset 3px 0 0 var(--color-warning, #f59e0b);
	}

	.action-icon {
		font-size: 1.1rem;
		width: 1.4rem;
		text-align: center;
		flex-shrink: 0;
	}

	.action-label {
		font-size: 0.9rem;
		font-weight: 500;
	}

	.action-hint {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		margin-left: auto;
		text-align: right;
		line-height: 1.2;
	}

	/* Contextual sub-inputs render as inset strips inside the list. */
	.action-extra {
		padding: 0.5rem 0.65rem 0.5rem 2rem;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-tertiary);
	}

	.scroll-direction {
		display: flex;
		gap: 0.75rem;
	}

	.scroll-direction label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.scroll-direction label.selected {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
	}

	.type-input input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
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
		flex-shrink: 0;
	}

	.action-row input[type='radio'] {
		margin: 0;
	}
</style>
