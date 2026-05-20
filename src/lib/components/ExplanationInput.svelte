<script lang="ts">
	interface Props {
		value: string;
		oninput: (value: string) => void;
		placeholder?: string;
		label?: string;
	}

	let { value, oninput, placeholder = 'Explain why you are taking this action...', label = 'Explanation' }: Props = $props();
</script>

<div class="explanation-input">
	<label for="explanation">{label}</label>
	<textarea
		id="explanation"
		{value}
		{placeholder}
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
</style>
