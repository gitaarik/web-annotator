<script lang="ts">
	interface Props {
		value: string;
		oninput: (value: string) => void;
		placeholder?: string;
		label?: string;
		disabled?: boolean;
	}

	let { value, oninput, placeholder = 'Explain why you are taking this action...', label = 'Explanation', disabled = false }: Props = $props();
</script>

<div class="explanation-input" class:disabled>
	<label for="explanation">{label}</label>
	<textarea
		id="explanation"
		{value}
		{placeholder}
		{disabled}
		oninput={(e) => oninput(e.currentTarget.value)}
		rows="3"
	></textarea>
</div>

<style>
	.explanation-input {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	label {
		font-weight: 600;
		font-size: 0.9rem;
	}

	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem;
		border: 2px solid var(--color-border);
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.9rem;
		resize: vertical;
		transition: border-color 0.2s;
		background: var(--color-bg-white);
		color: var(--color-text-primary);
	}

	textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	textarea:disabled {
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		cursor: not-allowed;
	}

	.explanation-input.disabled label {
		color: var(--color-text-muted);
	}
</style>
