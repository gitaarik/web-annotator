<script lang="ts">
	interface Props {
		url: string;
		prompt: string;
		loading: boolean;
		onUrlChange: (value: string) => void;
		onPromptChange: (value: string) => void;
		onSubmit: () => void;
	}

	let {
		url,
		prompt,
		loading,
		onUrlChange,
		onPromptChange,
		onSubmit
	}: Props = $props();
</script>

<section class="setup-form">
	<h2>Start New Annotation Session</h2>

	<div class="form-group">
		<label for="url">URL</label>
		<input
			id="url"
			type="url"
			value={url}
			oninput={(e) => onUrlChange(e.currentTarget.value)}
			placeholder="https://example.com"
			disabled={loading}
		/>
	</div>

	<div class="form-group">
		<label for="prompt">Task Prompt</label>
		<textarea
			id="prompt"
			value={prompt}
			oninput={(e) => onPromptChange(e.currentTarget.value)}
			placeholder="What task should be accomplished on this webpage?"
			rows="3"
			disabled={loading}
		></textarea>
	</div>

	<button onclick={onSubmit} disabled={loading || !url || !prompt}>
		{loading ? 'Loading...' : 'Start Session'}
	</button>
</section>

<style>
	.setup-form {
		max-width: 600px;
		background: var(--color-bg-white);
		padding: var(--space-2xl);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-card);
	}

	h2 {
		margin: 0 0 var(--space-xl) 0;
		font-size: 1.25rem;
	}

	.form-group {
		margin-bottom: var(--space-xl);
	}

	.form-group label {
		display: block;
		margin-bottom: var(--space-sm);
		font-weight: 600;
	}

	.form-group input,
	.form-group textarea {
		width: 100%;
		padding: var(--space-md);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 1rem;
		font-family: inherit;
		box-sizing: border-box;
	}

	.form-group input:focus,
	.form-group textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	button {
		background: var(--color-primary);
		color: white;
		border: none;
		padding: var(--space-md) var(--space-xl);
		border-radius: var(--radius-md);
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	button:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}

	button:disabled {
		background: var(--color-disabled);
		cursor: not-allowed;
	}
</style>
