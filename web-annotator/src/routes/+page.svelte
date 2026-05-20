<script lang="ts">
	import { onMount } from 'svelte';
	import ScreenshotViewer from '$lib/components/ScreenshotViewer.svelte';
	import ActionPanel from '$lib/components/ActionPanel.svelte';
	import ExplanationInput from '$lib/components/ExplanationInput.svelte';
	import SessionHistory from '$lib/components/SessionHistory.svelte';
	import type { Action } from '$lib/types';

	interface SessionSummary {
		id: string;
		url: string;
		prompt: string;
		createdAt: string;
		actionCount: number;
		isCompleted: boolean;
	}

	let url = $state('');
	let prompt = $state('');
	let plan = $state('');
	let sessionId = $state<string | null>(null);
	let screenshotPath = $state<string | null>(null);
	let viewport = $state({ width: 1280, height: 800 });
	let actions = $state<Action[]>([]);
	let isCompleted = $state(false);

	let selectedAction = $state<'click' | 'scroll' | 'type' | 'wait' | 'stop' | null>(null);
	let scrollDirection = $state<'up' | 'down'>('down');
	let typeText = $state('');
	let explanation = $state('');
	let clickCoordinates = $state<{ x: number; y: number } | null>(null);

	let loading = $state(false);
	let error = $state<string | null>(null);
	let replayedUpTo = $state(-1);
	let replayLoading = $state(false);
	let deleteLoading = $state(false);
	type HoverInfo =
		| { type: 'click'; coordinates: { x: number; y: number } }
		| { type: 'scroll'; direction: 'up' | 'down' }
		| { type: 'type'; text: string }
		| null;
	let hoverInfo = $state<HoverInfo>(null);
	let editingActionIndex = $state<number | null>(null);

	let savedSessions = $state<SessionSummary[]>([]);
	let loadingSessions = $state(true);
	let loadingSessionId = $state<string | null>(null);

	onMount(() => {
		fetchSavedSessions();
	});

	async function fetchSavedSessions() {
		try {
			const response = await fetch('/api/sessions');
			if (response.ok) {
				savedSessions = await response.json();
			}
		} catch {
			// Ignore errors fetching sessions
		} finally {
			loadingSessions = false;
		}
	}

	async function handleDeleteSession(session: SessionSummary, event: Event) {
		event.stopPropagation();

		if (!confirm(`Delete session "${session.prompt}"?\n\nThis will permanently delete all ${session.actionCount} actions.`)) {
			return;
		}

		try {
			const response = await fetch(`/api/sessions/${session.id}`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete session');
			}

			savedSessions = savedSessions.filter((s) => s.id !== session.id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		}
	}

	async function resumeSession(id: string) {
		loading = true;
		loadingSessionId = id;
		error = null;

		try {
			const response = await fetch(`/api/sessions/${id}`, { method: 'POST' });
			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to resume session');
			}

			sessionId = data.session.id;
			url = data.session.url;
			prompt = data.session.prompt;
			plan = data.session.plan;
			actions = data.session.actions;
			screenshotPath = data.screenshotPath;
			viewport = data.viewport;
			isCompleted = false;
			replayedUpTo = -1;
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			loading = false;
			loadingSessionId = null;
		}
	}

	async function handleReplayAction(index: number) {
		if (!sessionId || index < 0 || index >= actions.length) return;

		replayLoading = true;
		error = null;

		try {
			const response = await fetch(`/api/sessions/${sessionId}/replay`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ actionIndex: index })
			});
			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to replay action');
			}

			screenshotPath = data.screenshotPath;
			viewport = data.viewport;
			replayedUpTo = index;
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			replayLoading = false;
		}
	}

	async function handleDeleteAction(index: number) {
		if (!sessionId || index < 0 || index >= actions.length) return;

		const action = actions[index];
		const actionDesc = action.type === 'click'
			? `Click at (${action.coordinates?.x}, ${action.coordinates?.y})`
			: action.type === 'scroll'
			? `Scroll ${action.direction}`
			: action.type === 'type'
			? `Type "${action.text}"`
			: action.type === 'wait'
			? 'Wait'
			: 'Stop';

		if (!confirm(`Delete action #${index + 1}: ${actionDesc}?`)) {
			return;
		}

		deleteLoading = true;
		error = null;

		try {
			const response = await fetch(`/api/sessions/${sessionId}`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ actionIndex: index })
			});
			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to delete action');
			}

			actions = data.session.actions;
			isCompleted = !!data.session.finalAnswer;

			// Reset replayedUpTo if we deleted an action at or before the current replay point
			if (index <= replayedUpTo) {
				replayedUpTo = index - 1;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			deleteLoading = false;
		}
	}

	async function updateActionHandler() {
		if (editingActionIndex === null || !sessionId || !selectedAction || !explanation.trim()) {
			return;
		}

		loading = true;
		error = null;

		const actionUpdate: Record<string, unknown> = {
			type: selectedAction,
			explanation
		};

		if (selectedAction === 'click' && clickCoordinates) {
			actionUpdate.coordinates = clickCoordinates;
		} else if (selectedAction === 'scroll') {
			actionUpdate.direction = scrollDirection;
		} else if (selectedAction === 'type') {
			actionUpdate.text = typeText;
		}

		try {
			const response = await fetch(`/api/sessions/${sessionId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					actionIndex: editingActionIndex,
					action: actionUpdate
				})
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.error || 'Failed to update action');
			}

			actions = data.session.actions;
		} catch (e) {
			error = e instanceof Error ? e.message : 'An error occurred';
		} finally {
			loading = false;
		}
	}

	async function startSession() {
		if (!url || !prompt || !plan) {
			error = 'Please enter URL, prompt, and plan';
			return;
		}

		loading = true;
		error = null;

		try {
			const response = await fetch('/api/screenshot', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url, prompt, plan })
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

		if (selectedAction === 'type' && !typeText.trim()) {
			error = 'Please enter text to type';
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
					direction: scrollDirection,
					text: typeText
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
			typeText = '';
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
		plan = '';
		selectedAction = null;
		explanation = '';
		clickCoordinates = null;
		typeText = '';
		replayedUpTo = -1;
		fetchSavedSessions();
	}

	// Check if we're in edit mode (replaying a session with upcoming actions)
	let nextActionIndex = $derived(
		actions.length > 0 && replayedUpTo < actions.length - 1 ? replayedUpTo + 1 : null
	);

	let isEditMode = $derived(nextActionIndex !== null);

	// Auto-populate form with next action when in edit mode
	$effect(() => {
		if (nextActionIndex !== null) {
			const action = actions[nextActionIndex];
			editingActionIndex = nextActionIndex;
			selectedAction = action.type;
			explanation = action.explanation;

			if (action.type === 'click' && action.coordinates) {
				clickCoordinates = action.coordinates;
			} else if (action.type === 'scroll' && action.direction) {
				scrollDirection = action.direction;
			} else if (action.type === 'type' && action.text) {
				typeText = action.text;
			}
		} else {
			// Clear edit mode when no more actions to replay
			if (editingActionIndex !== null) {
				editingActionIndex = null;
				selectedAction = null;
				explanation = '';
				clickCoordinates = null;
				typeText = '';
			}
		}
	});

	let canExecute = $derived(
		selectedAction !== null &&
			explanation.trim() !== '' &&
			(selectedAction !== 'click' || clickCoordinates !== null) &&
			(selectedAction !== 'type' || typeText.trim() !== '')
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

			<div class="form-group">
				<label for="plan">Plan</label>
				<textarea
					id="plan"
					bind:value={plan}
					placeholder="Describe your strategy for completing this task step by step..."
					rows="4"
					disabled={loading}
				></textarea>
			</div>

			<button onclick={startSession} disabled={loading || !url || !prompt || !plan}>
				{loading ? 'Loading...' : 'Start Session'}
			</button>
		</section>

		{#if !loadingSessions && savedSessions.length > 0}
			<section class="saved-sessions">
				<h2>Resume Saved Session</h2>
				<div class="sessions-list">
					{#each savedSessions.filter(s => !s.isCompleted) as session}
						<div class="session-row">
							<button
								class="session-card"
								class:loading={loadingSessionId === session.id}
								onclick={() => resumeSession(session.id)}
								disabled={loading}
							>
								{#if loadingSessionId === session.id}
									<div class="loading-overlay">
										<span class="spinner"></span>
										<span>Loading...</span>
									</div>
								{/if}
								<div class="session-url">{session.url}</div>
								<div class="session-prompt">{session.prompt}</div>
								<div class="session-meta">
									<span>{session.actionCount} actions</span>
									<span>{new Date(session.createdAt).toLocaleDateString()}</span>
								</div>
							</button>
							<button
								class="delete-session-btn"
								onclick={(e) => handleDeleteSession(session, e)}
								disabled={loading}
								title="Delete session"
							>
								×
							</button>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{:else if isCompleted}
		<section class="completed">
			<h2>Annotation Complete</h2>
			<p>Session ID: <code>{sessionId}</code></p>
			<p>Total actions: {actions.length}</p>
			<p>Final answer: {actions[actions.length - 1]?.explanation}</p>

			<SessionHistory {actions} onDelete={handleDeleteAction} {deleteLoading} />

			<button onclick={resetSession}>Start New Session</button>
		</section>
	{:else}
		<section class="annotation-interface">
			<div class="task-info">
				<p><strong>URL:</strong> {url}</p>
				<p><strong>Task:</strong> {prompt}</p>
				<details class="plan-details">
					<summary><strong>Plan</strong></summary>
					<p class="plan-text">{plan}</p>
				</details>
			</div>

			<div class="main-content">
				<div class="screenshot-section">
					{#if screenshotPath}
						<ScreenshotViewer
							src={screenshotPath}
							{viewport}
							onclick={handleClick}
							clickEnabled={selectedAction === 'click'}
							{hoverInfo}
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
						{typeText}
						onactionchange={(a) => {
							selectedAction = a;
							clickCoordinates = null;
						}}
						onscrolldirectionchange={(d) => (scrollDirection = d)}
						ontextchange={(t) => (typeText = t)}
					/>

					<ExplanationInput
						value={explanation}
						oninput={(v) => (explanation = v)}
						label={selectedAction === 'stop' ? 'Final Answer' : 'Explanation'}
						placeholder={selectedAction === 'stop'
							? 'Provide the final answer to the task...'
							: 'Explain why you are taking this action...'}
					/>

					{#if isEditMode}
						<button class="update-btn" onclick={updateActionHandler} disabled={loading || !canExecute}>
							{loading ? 'Updating...' : 'Update Action'}
						</button>
					{:else}
						<button class="execute-btn" onclick={executeAction} disabled={loading || !canExecute}>
							{loading ? 'Executing...' : 'Execute Action'}
						</button>
					{/if}
				</div>
			</div>

			{#if actions.length > 0}
				<div class="history-section">
					<SessionHistory
						{actions}
						{replayedUpTo}
						onReplay={handleReplayAction}
						{replayLoading}
						onDelete={handleDeleteAction}
						{deleteLoading}
						onHoverAction={(info) => (hoverInfo = info)}
						editingIndex={editingActionIndex}
					/>
				</div>
			{/if}
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

	.saved-sessions {
		max-width: 600px;
		margin-top: 2rem;
	}

	.sessions-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.session-row {
		display: flex;
		gap: 0.5rem;
		align-items: stretch;
	}

	.delete-session-btn {
		padding: 0 0.75rem;
		font-size: 1.25rem;
		background: #dc2626;
		color: white;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		font-weight: bold;
		flex-shrink: 0;
	}

	.delete-session-btn:hover:not(:disabled) {
		background: #b91c1c;
	}

	.session-card {
		display: block;
		width: 100%;
		text-align: left;
		background: white;
		color: #1a1a1a;
		padding: 1rem;
		border: 2px solid #ddd;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.session-card:hover:not(:disabled) {
		border-color: #0066cc;
		background: #f8faff;
	}

	.session-card {
		position: relative;
	}

	.session-card.loading {
		border-color: #0066cc;
	}

	.loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: rgba(255, 255, 255, 0.85);
		border-radius: 6px;
		color: #0066cc;
		font-weight: 500;
	}

	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid #e0e0e0;
		border-top-color: #0066cc;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.session-url {
		font-size: 0.85rem;
		color: #666;
		margin-bottom: 0.25rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-prompt {
		font-weight: 500;
		margin-bottom: 0.5rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.session-meta {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		color: #888;
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

	.plan-details {
		margin-top: 0.5rem;
	}

	.plan-details summary {
		cursor: pointer;
		user-select: none;
	}

	.plan-text {
		margin: 0.5rem 0 0 0;
		padding: 0.75rem;
		background: #f5f5f5;
		border-radius: 6px;
		font-size: 0.9rem;
		white-space: pre-wrap;
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

	.update-btn {
		width: 100%;
		padding: 1rem;
		font-size: 1.1rem;
		font-weight: 600;
		background: #8b5cf6;
	}

	.update-btn:hover:not(:disabled) {
		background: #7c3aed;
	}

	.history-section {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid #eee;
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
