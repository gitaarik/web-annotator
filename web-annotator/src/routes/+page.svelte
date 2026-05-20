<script lang="ts">
	import ScreenshotViewer from '$lib/components/ScreenshotViewer.svelte';
	import ActionPanel from '$lib/components/ActionPanel.svelte';
	import ExplanationInput from '$lib/components/ExplanationInput.svelte';
	import SessionHistory from '$lib/components/SessionHistory.svelte';
	import type { Action } from '$lib/types';

	let url = $state('');
	let prompt = $state('');
	let sessionId = $state<string | null>(null);
	let screenshotPath = $state<string | null>(null);
	let viewport = $state({ width: 1280, height: 800 });
	let actions = $state<Action[]>([]);
	let isCompleted = $state(false);

	let selectedAction = $state<'click' | 'scroll' | 'stop' | null>(null);
	let scrollDirection = $state<'up' | 'down'>('down');
	let explanation = $state('');
	let clickCoordinates = $state<{ x: number; y: number } | null>(null);

	let loading = $state(false);
	let error = $state<string | null>(null);

	async function startSession() {
		if (!url || !prompt) {
			error = 'Please enter both URL and prompt';
			return;
		}

		loading = true;
		error = null;

		try {
			const response = await fetch('/api/screenshot', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url, prompt })
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to start session');
			}

			sessionId = data.sessionId;
			screenshotPath = data.screenshotPath;
			viewport = data.viewport;
			actions = [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			loading = false;
		}
	}

	function handleClick(x: number, y: number) {
		if (selectedAction === 'click') {
			clickCoordinates = { x, y };
		}
	}

	async function executeAction() {
		if (!sessionId || !selectedAction || !explanation.trim()) {
			error = 'Please select an action and provide an explanation';
			return;
		}

		if (selectedAction === 'click' && !clickCoordinates) {
			error = 'Please click on the screenshot to select coordinates';
			return;
		}

		loading = true;
		error = null;

		try {
			const response = await fetch('/api/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId,
					actionType: selectedAction,
					explanation,
					coordinates: clickCoordinates,
					direction: scrollDirection
				})
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to execute action');
			}

			screenshotPath = data.screenshotPath;
			actions = data.session.actions;
			isCompleted = data.completed;

			// Reset form
			selectedAction = null;
			explanation = '';
			clickCoordinates = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			loading = false;
		}
	}

	function resetSession() {
		sessionId = null;
		screenshotPath = null;
		actions = [];
		isCompleted = false;
		url = '';
		prompt = '';
		selectedAction = null;
		explanation = '';
		clickCoordinates = null;
	}

	let canExecute = $derived(
		selectedAction !== null &&
			explanation.trim() !== '' &&
			(selectedAction !== 'click' || clickCoordinates !== null)
	);
</script>

<main>
	<h1>Web Browser Annotation Tool</h1>

	{#if error}
		<div class="error">{error}</div>
	{/if}

	{#if !sessionId}
		<section class="setup-form">
			<h2>Start New Annotation Session</h2>

			<div class="form-group">
				<label for="url">URL</label>
				<input
					id="url"
					type="url"
					bind:value={url}
					placeholder="https://example.com"
					disabled={loading}
				/>
			</div>

			<div class="form-group">
				<label for="prompt">Task Prompt</label>
				<textarea
					id="prompt"
					bind:value={prompt}
					placeholder="What task should be accomplished on this webpage?"
					rows="3"
					disabled={loading}
				></textarea>
			</div>

			<button onclick={startSession} disabled={loading || !url || !prompt}>
				{loading ? 'Loading...' : 'Start Session'}
			</button>
		</section>
	{:else if isCompleted}
		<section class="completed">
			<h2>Annotation Complete</h2>
			<p>Session ID: <code>{sessionId}</code></p>
			<p>Total actions: {actions.length}</p>
			<p>Final answer: {actions[actions.length - 1]?.explanation}</p>

			<SessionHistory {actions} />

			<button onclick={resetSession}>Start New Session</button>
		</section>
	{:else}
		<section class="annotation-interface">
			<div class="task-info">
				<p><strong>URL:</strong> {url}</p>
				<p><strong>Task:</strong> {prompt}</p>
			</div>

			<div class="main-content">
				<div class="screenshot-section">
					{#if screenshotPath}
						<ScreenshotViewer
							src={screenshotPath}
							{viewport}
							onclick={handleClick}
							clickEnabled={selectedAction === 'click'}
						/>
						{#if clickCoordinates && selectedAction === 'click'}
							<p class="coordinates">Selected: ({clickCoordinates.x}, {clickCoordinates.y})</p>
						{/if}
					{/if}
				</div>

				<div class="controls-section">
					<ActionPanel
						{selectedAction}
						{scrollDirection}
						onactionchange={(a) => {
							selectedAction = a;
							clickCoordinates = null;
						}}
						onscrolldirectionchange={(d) => (scrollDirection = d)}
					/>

					<ExplanationInput
						value={explanation}
						oninput={(v) => (explanation = v)}
						label={selectedAction === 'stop' ? 'Final Answer' : 'Explanation'}
						placeholder={selectedAction === 'stop'
							? 'Provide the final answer to the task...'
							: 'Explain why you are taking this action...'}
					/>

					<button class="execute-btn" onclick={executeAction} disabled={loading || !canExecute}>
						{loading ? 'Executing...' : 'Execute Action'}
					</button>

					{#if actions.length > 0}
						<SessionHistory {actions} />
					{/if}
				</div>
			</div>
		</section>
	{/if}
</main>

<style>
	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		margin: 0;
		padding: 0;
		background: #f0f2f5;
	}

	main {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		margin: 0 0 2rem 0;
		color: #1a1a1a;
	}

	h2 {
		margin: 0 0 1.5rem 0;
		font-size: 1.25rem;
	}

	.error {
		background: #fee;
		color: #c00;
		padding: 1rem;
		border-radius: 6px;
		margin-bottom: 1rem;
	}

	.setup-form {
		max-width: 600px;
		background: white;
		padding: 2rem;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	.form-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
	}

	.form-group input,
	.form-group textarea {
		width: 100%;
		padding: 0.75rem;
		border: 2px solid #ddd;
		border-radius: 6px;
		font-size: 1rem;
		font-family: inherit;
		box-sizing: border-box;
	}

	.form-group input:focus,
	.form-group textarea:focus {
		outline: none;
		border-color: #0066cc;
	}

	button {
		background: #0066cc;
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 6px;
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	button:hover:not(:disabled) {
		background: #0052a3;
	}

	button:disabled {
		background: #ccc;
		cursor: not-allowed;
	}

	.annotation-interface {
		background: white;
		padding: 2rem;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.task-info {
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid #eee;
	}

	.task-info p {
		margin: 0.25rem 0;
	}

	.main-content {
		display: grid;
		grid-template-columns: 1fr 350px;
		gap: 2rem;
	}

	.screenshot-section {
		overflow: auto;
	}

	.coordinates {
		margin-top: 0.5rem;
		font-family: monospace;
		color: #666;
	}

	.controls-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.execute-btn {
		width: 100%;
		padding: 1rem;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.completed {
		background: white;
		padding: 2rem;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.completed code {
		background: #f5f5f5;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-family: monospace;
	}

	.completed button {
		margin-top: 1rem;
	}
</style>
