<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import SetupForm from '$lib/components/SetupForm.svelte';
	import SavedSessionsList from '$lib/components/SavedSessionsList.svelte';
	import { type SessionSummary } from '$lib/types';
	import { apiRequest, getErrorMessage } from '$lib/api';

	let url = $state('');
	let prompt = $state('');

	let loading = $state(false);
	let error = $state<string | null>(null);

	let savedSessions = $state<SessionSummary[]>([]);
	let loadingSessions = $state(true);
	let showNewSessionForm = $state(false);

	function cancelNewSession() {
		showNewSessionForm = false;
		url = '';
		prompt = '';
		error = null;
	}

	onMount(() => {
		fetchSavedSessions();
	});

	async function fetchSavedSessions() {
		try {
			savedSessions = await apiRequest<SessionSummary[]>('/api/sessions');
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
			await apiRequest(`/api/sessions/${session.id}`, { method: 'DELETE', body: {} });
			savedSessions = savedSessions.filter((s) => s.id !== session.id);
		} catch (e) {
			error = getErrorMessage(e);
		}
	}

	function openSession(id: string) {
		goto(`/session/${id}`);
	}

	async function handleImportSession(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		loading = true;
		error = null;

		try {
			const text = await file.text();
			const sessionData = JSON.parse(text);

			const data = await apiRequest<{ summary: SessionSummary }>('/api/sessions', {
				method: 'POST',
				body: sessionData
			});

			savedSessions = [data.summary, ...savedSessions];
			input.value = '';
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			loading = false;
		}
	}

	async function startSession() {
		if (!url || !prompt) {
			error = 'Please enter URL and prompt';
			return;
		}

		loading = true;
		error = null;

		try {
			const data = await apiRequest<{
				sessionId: string;
			}>('/api/sessions/create', { method: 'POST', body: { url, prompt } });

			// Navigate to the new session page
			goto(`/session/${data.sessionId}`);
		} catch (e) {
			error = getErrorMessage(e);
			loading = false;
		}
	}
</script>

<main>
	<h1>Web Browser Annotation Tool</h1>

	{#if error}
		<div class="error">{error}</div>
	{/if}

	<div class="home-header">
		{#if !showNewSessionForm}
			<button class="new-session-btn" onclick={() => (showNewSessionForm = true)}>
				+ New Session
			</button>
		{/if}
	</div>

	{#if showNewSessionForm}
		<div class="new-session-form-wrapper">
			<SetupForm
				{url}
				{prompt}
				{loading}
				onUrlChange={(v) => (url = v)}
				onPromptChange={(v) => (prompt = v)}
				onSubmit={startSession}
			/>
			<button class="cancel-btn" onclick={cancelNewSession} disabled={loading}>
				Cancel
			</button>
		</div>
	{/if}

	{#if !loadingSessions}
		<SavedSessionsList
			sessions={savedSessions}
			{loading}
			loadingSessionId={null}
			onResume={openSession}
			onDelete={handleDeleteSession}
			onImport={handleImportSession}
		/>
	{/if}
</main>

<style>
	main {
		max-width: 1400px;
		margin: 0 auto;
		padding: var(--space-2xl);
	}

	h1 {
		margin: 0 0 var(--space-2xl) 0;
		color: var(--color-text-primary);
	}

	.error {
		background: var(--color-error-bg);
		color: var(--color-error-text);
		padding: var(--space-lg);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-lg);
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

	.home-header {
		display: flex;
		justify-content: flex-end;
		margin-bottom: var(--space-lg);
	}

	.new-session-btn {
		padding: var(--space-md) var(--space-xl);
		font-size: 1rem;
		font-weight: 600;
	}

	.new-session-form-wrapper {
		margin-bottom: var(--space-2xl);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-md);
	}

	.cancel-btn {
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		padding: var(--space-sm) var(--space-lg);
		font-size: 0.9rem;
	}

	.cancel-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		border-color: var(--color-border-hover);
	}
</style>
