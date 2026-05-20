<script lang="ts">
	import { onMount } from 'svelte';
	import ScreenshotViewer from '$lib/components/ScreenshotViewer.svelte';
	import ActionPanel from '$lib/components/ActionPanel.svelte';
	import ExplanationInput from '$lib/components/ExplanationInput.svelte';
	import SessionHistory from '$lib/components/SessionHistory.svelte';
	import SetupForm from '$lib/components/SetupForm.svelte';
	import SavedSessionsList from '$lib/components/SavedSessionsList.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import { type Action, type SessionSummary, type HoverInfo, type Tab, formatAction } from '$lib/types';
	import { apiRequest, getErrorMessage } from '$lib/api';

	let url = $state('');
	let prompt = $state('');
	let plan = $state('');
	let sessionId = $state<string | null>(null);
	let tabId = $state<string | null>(null);
	let tabs = $state<Tab[]>([]);
	let screenshotPath = $state<string | null>(null);
	let currentUrl = $state<string | null>(null);
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
	let refreshLoading = $state(false);
	let tabLoading = $state(false);
	let hoverInfo = $state<HoverInfo>(null);
	let editingActionIndex = $state<number | null>(null);

	let savedSessions = $state<SessionSummary[]>([]);
	let loadingSessions = $state(true);
	let loadingSessionId = $state<string | null>(null);
	let showNewSessionForm = $state(false);

	function cancelNewSession() {
		showNewSessionForm = false;
		url = '';
		prompt = '';
		plan = '';
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

	async function resumeSession(id: string) {
		loading = true;
		loadingSessionId = id;
		error = null;

		try {
			const data = await apiRequest<{
				session: { id: string; url: string; prompt: string; plan: string; actions: Action[]; tabs?: Tab[]; activeTabId?: string };
				screenshotPath: string;
				viewport: { width: number; height: number };
				tabId: string;
				tabs?: Tab[];
			}>(`/api/sessions/${id}`, { method: 'POST' });

			sessionId = data.session.id;
			tabId = data.tabId;
			tabs = data.tabs ?? data.session.tabs ?? [];
			url = data.session.url;
			prompt = data.session.prompt;
			plan = data.session.plan;
			actions = data.session.actions;
			screenshotPath = data.screenshotPath;
			viewport = data.viewport;
			isCompleted = false;
			replayedUpTo = -1;
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			loading = false;
			loadingSessionId = null;
		}
	}

	async function handleReplayAction(index: number) {
		if (!sessionId || !tabId || index < 0 || index >= actions.length) return;

		replayLoading = true;
		error = null;

		try {
			const data = await apiRequest<{
				screenshotPath: string;
				currentUrl?: string;
				viewport: { width: number; height: number };
				session?: { actions: Action[] };
				tabId: string;
			}>(`/api/sessions/${sessionId}/replay`, {
				method: 'POST',
				body: { actionIndex: index, tabId }
			});

			screenshotPath = data.screenshotPath;
			currentUrl = data.currentUrl ?? null;
			viewport = data.viewport;
			replayedUpTo = index;
			tabId = data.tabId;

			if (data.session) {
				actions = data.session.actions;
			}
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			replayLoading = false;
		}
	}

	async function handleExportSession() {
		if (!sessionId) return;

		try {
			const data = await apiRequest<{ session: unknown }>(`/api/sessions/${sessionId}`);

			const blob = new Blob([JSON.stringify(data.session, null, 2)], { type: 'application/json' });
			const downloadUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = downloadUrl;
			a.download = `session-${sessionId}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(downloadUrl);
		} catch (e) {
			error = getErrorMessage(e);
		}
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

	async function handleRefreshScreenshot() {
		if (!sessionId || !tabId) return;

		refreshLoading = true;
		error = null;

		try {
			const data = await apiRequest<{
				screenshotPath: string;
				viewport: { width: number; height: number };
				tabId: string;
			}>(`/api/sessions/${sessionId}/refresh`, { method: 'POST', body: { tabId } });

			screenshotPath = data.screenshotPath;
			viewport = data.viewport;
			tabId = data.tabId;
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			refreshLoading = false;
		}
	}

	async function handleSwitchTab(newTabId: string) {
		if (!sessionId || !newTabId || newTabId === tabId) return;

		tabLoading = true;
		error = null;

		try {
			const data = await apiRequest<{
				screenshotPath: string;
				session: { actions: Action[]; tabs?: Tab[] };
				completed: boolean;
				tabId: string;
			}>('/api/action', {
				method: 'POST',
				body: {
					sessionId,
					tabId,
					actionType: 'switchTab',
					explanation: `Switch to tab`,
					targetTabId: newTabId
				}
			});

			screenshotPath = data.screenshotPath;
			actions = data.session.actions;
			tabId = data.tabId;
			if (data.session.tabs) {
				tabs = data.session.tabs;
			}
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			tabLoading = false;
		}
	}

	async function handleNewTab() {
		if (!sessionId || !tabId) return;

		const newUrl = window.prompt('Enter URL for new tab:', 'https://');
		if (!newUrl) return;

		tabLoading = true;
		error = null;

		try {
			const data = await apiRequest<{
				screenshotPath: string;
				session: { actions: Action[]; tabs?: Tab[] };
				completed: boolean;
				tabId: string;
				newTabId?: string;
			}>('/api/action', {
				method: 'POST',
				body: {
					sessionId,
					tabId,
					actionType: 'newTab',
					explanation: `Open new tab: ${newUrl}`,
					targetUrl: newUrl
				}
			});

			screenshotPath = data.screenshotPath;
			actions = data.session.actions;
			tabId = data.tabId;
			if (data.session.tabs) {
				tabs = data.session.tabs;
			}
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			tabLoading = false;
		}
	}

	async function handleCloseTab(closeTabId: string) {
		if (!sessionId || !tabId) return;

		const openTabs = tabs.filter((t) => !t.closedAt);
		if (openTabs.length <= 1) {
			error = 'Cannot close the last tab';
			return;
		}

		tabLoading = true;
		error = null;

		try {
			const data = await apiRequest<{
				screenshotPath: string;
				session: { actions: Action[]; tabs?: Tab[] };
				completed: boolean;
				tabId: string;
			}>('/api/action', {
				method: 'POST',
				body: {
					sessionId,
					tabId,
					actionType: 'closeTab',
					explanation: `Close tab`,
					targetTabId: closeTabId
				}
			});

			screenshotPath = data.screenshotPath;
			actions = data.session.actions;
			tabId = data.tabId;
			if (data.session.tabs) {
				tabs = data.session.tabs;
			}
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			tabLoading = false;
		}
	}

	async function handleDeleteAction(index: number) {
		if (!sessionId || index < 0 || index >= actions.length) return;

		const action = actions[index];
		if (!confirm(`Delete action #${index + 1}: ${formatAction(action)}?`)) {
			return;
		}

		deleteLoading = true;
		error = null;

		try {
			const data = await apiRequest<{
				session: { actions: Action[]; finalAnswer?: string };
			}>(`/api/sessions/${sessionId}/actions/${index}`, { method: 'DELETE' });

			actions = data.session.actions;
			isCompleted = !!data.session.finalAnswer;

			if (index <= replayedUpTo) {
				replayedUpTo = index - 1;
			}
		} catch (e) {
			error = getErrorMessage(e);
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
			const data = await apiRequest<{ session: { actions: Action[] } }>(
				`/api/sessions/${sessionId}/actions/${editingActionIndex}`,
				{ method: 'PATCH', body: actionUpdate }
			);

			actions = data.session.actions;
			await handleReplayAction(editingActionIndex);
		} catch (e) {
			error = getErrorMessage(e);
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
			const data = await apiRequest<{
				sessionId: string;
				screenshotPath: string;
				viewport: { width: number; height: number };
				tabId: string;
				tabs: Tab[];
			}>('/api/screenshot', { method: 'POST', body: { url, prompt, plan } });

			sessionId = data.sessionId;
			tabId = data.tabId;
			tabs = data.tabs;
			screenshotPath = data.screenshotPath;
			currentUrl = url; // Initial URL is the current URL
			viewport = data.viewport;
			actions = [];
		} catch (e) {
			error = getErrorMessage(e);
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
		if (!sessionId || !tabId || !selectedAction || !explanation.trim()) {
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
			const data = await apiRequest<{
				screenshotPath: string;
				currentUrl?: string;
				session: { actions: Action[]; tabs?: Tab[] };
				completed: boolean;
				tabId: string;
				newTabId?: string;
			}>('/api/action', {
				method: 'POST',
				body: {
					sessionId,
					tabId,
					actionType: selectedAction,
					explanation,
					coordinates: clickCoordinates,
					direction: scrollDirection,
					text: typeText
				}
			});

			screenshotPath = data.screenshotPath;
			currentUrl = data.currentUrl ?? null;
			actions = data.session.actions;
			isCompleted = data.completed;
			tabId = data.tabId;
			if (data.session.tabs) {
				tabs = data.session.tabs;
			}

			selectedAction = null;
			explanation = '';
			clickCoordinates = null;
			typeText = '';
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			loading = false;
		}
	}

	function resetSession() {
		sessionId = null;
		tabId = null;
		tabs = [];
		screenshotPath = null;
		currentUrl = null;
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
			// Only set selectedAction for supported action types
			const supportedTypes = ['click', 'scroll', 'type', 'wait', 'stop'] as const;
			if (supportedTypes.includes(action.type as typeof supportedTypes[number])) {
				selectedAction = action.type as typeof supportedTypes[number];
			} else {
				selectedAction = null;
			}
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
					{plan}
					{loading}
					onUrlChange={(v) => (url = v)}
					onPromptChange={(v) => (prompt = v)}
					onPlanChange={(v) => (plan = v)}
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
				{loadingSessionId}
				onResume={resumeSession}
				onDelete={handleDeleteSession}
				onImport={handleImportSession}
			/>
		{/if}
	{:else if isCompleted}
		<section class="completed">
			<h2>Annotation Complete</h2>
			<p>Session ID: <code>{sessionId}</code></p>
			<p>Total actions: {actions.length}</p>
			<p>Final answer: {actions[actions.length - 1]?.explanation}</p>

			<SessionHistory {actions} {viewport} currentScreenshot={screenshotPath} {currentUrl} onDelete={handleDeleteAction} {deleteLoading} />

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

			{#if tabs.length > 0}
				<TabBar
					{tabs}
					activeTabId={tabId}
					loading={tabLoading || loading}
					onSwitchTab={handleSwitchTab}
					onNewTab={handleNewTab}
					onCloseTab={handleCloseTab}
				/>
			{/if}

			{#if actions.length > 0 || screenshotPath}
				<div class="history-section">
					<SessionHistory
						{actions}
						{viewport}
						currentScreenshot={screenshotPath}
						{currentUrl}
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
						<div class="screenshot-toolbar">
							{#if clickCoordinates && selectedAction === 'click'}
								<span class="coordinates">Selected: ({clickCoordinates.x}, {clickCoordinates.y})</span>
							{/if}
							<div class="toolbar-buttons">
								<button
									class="toolbar-btn"
									onclick={handleRefreshScreenshot}
									disabled={refreshLoading}
									title="Refresh screenshot"
								>
									{refreshLoading ? '...' : '↻'} Refresh
								</button>
								<button
									class="toolbar-btn"
									onclick={handleExportSession}
									title="Export session as JSON"
								>
									↓ Export
								</button>
							</div>
						</div>
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
							{loading ? 'Running...' : 'Update & Run Action'}
						</button>
					{:else}
						<button class="execute-btn" onclick={executeAction} disabled={loading || !canExecute}>
							{loading ? 'Executing...' : 'Execute Action'}
						</button>
					{/if}
				</div>
			</div>
		</section>
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

	h2 {
		margin: 0 0 var(--space-xl) 0;
		font-size: 1.25rem;
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

	.annotation-interface {
		background: var(--color-bg-white);
		padding: var(--space-2xl);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-card);
	}

	.task-info {
		margin-bottom: var(--space-xl);
		padding-bottom: var(--space-lg);
		border-bottom: 1px solid var(--color-border-light);
	}

	.task-info p {
		margin: var(--space-xs) 0;
	}

	.plan-details {
		margin-top: var(--space-sm);
	}

	.plan-details summary {
		cursor: pointer;
		user-select: none;
	}

	.plan-text {
		margin: var(--space-sm) 0 0 0;
		padding: var(--space-md);
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		white-space: pre-wrap;
	}

	.main-content {
		display: grid;
		grid-template-columns: 1fr 350px;
		gap: var(--space-2xl);
	}

	.screenshot-section {
		overflow: auto;
	}

	.screenshot-toolbar {
		margin-top: var(--space-sm);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-lg);
	}

	.toolbar-buttons {
		display: flex;
		gap: var(--space-sm);
		margin-left: auto;
	}

	.toolbar-btn {
		padding: 0.4rem var(--space-md);
		font-size: 0.85rem;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.2s;
	}

	.toolbar-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		border-color: var(--color-border-hover);
	}

	.toolbar-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.coordinates {
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.controls-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}

	.execute-btn {
		width: 100%;
		padding: var(--space-lg);
		font-size: 1.1rem;
		font-weight: 600;
	}

	.update-btn {
		width: 100%;
		padding: var(--space-lg);
		font-size: 1.1rem;
		font-weight: 600;
		background: var(--color-purple);
	}

	.update-btn:hover:not(:disabled) {
		background: var(--color-purple-hover);
	}

	.history-section {
		margin-bottom: var(--space-xl);
		padding-bottom: var(--space-xl);
		border-bottom: 1px solid var(--color-border-light);
	}

	.completed {
		background: var(--color-bg-white);
		padding: var(--space-2xl);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-card);
	}

	.completed code {
		background: var(--color-bg-tertiary);
		padding: var(--space-xs) var(--space-sm);
		border-radius: var(--radius-sm);
		font-family: monospace;
	}

	.completed button {
		margin-top: var(--space-lg);
	}
</style>
