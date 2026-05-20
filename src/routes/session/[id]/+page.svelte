<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ScreenshotViewer from '$lib/components/ScreenshotViewer.svelte';
	import ActionPanel from '$lib/components/ActionPanel.svelte';
	import ExplanationInput from '$lib/components/ExplanationInput.svelte';
	import SessionHistory from '$lib/components/SessionHistory.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import { type Action, type HoverInfo, type Tab, formatAction } from '$lib/types';
	import { apiRequest, getErrorMessage } from '$lib/api';

	let { data } = $props();

	// Session data from server (loaded instantly)
	let session = $state(data.session);
	let viewport = $state(data.viewport);

	// Browser state (loaded progressively)
	let tabId = $state<string | null>(null);
	let tabs = $state<Tab[]>(session.tabs ?? []);
	let screenshotPath = $state<string | null>(null);
	let currentUrl = $state<string | null>(null);

	// Action state
	let actions = $state<Action[]>(session.actions ?? []);
	let isCompleted = $state(!!session.finalAnswer);

	// Input state
	let selectedAction = $state<'click' | 'hover' | 'scroll' | 'type' | 'wait' | 'stop' | null>(null);
	let scrollDirection = $state<'up' | 'down'>('down');
	let typeText = $state('');
	let explanation = $state('');
	let clickCoordinates = $state<{ x: number; y: number } | null>(null);

	// Loading states
	let browserLoading = $state(true);
	let actionLoading = $state(false);
	let replayLoading = $state(false);
	let deleteLoading = $state(false);
	let refreshLoading = $state(false);
	let tabLoading = $state(false);

	let error = $state<string | null>(null);
	let replayedUpTo = $state(-1);
	let hoverInfo = $state<HoverInfo>(null);
	let editingActionIndex = $state<number | null>(null);
	let manualEditMode = $state(false);

	onMount(() => {
		if (!isCompleted) {
			initializeBrowser();
		}

		// Poll for browser URL changes every 2 seconds
		const pollInterval = setInterval(async () => {
			if (!session.id || !tabId || browserLoading || actionLoading || replayLoading) return;

			try {
				const response = await fetch(`/api/sessions/${session.id}/refresh`);
				const data = await response.json();

				if (data.url && data.url !== currentUrl) {
					// URL changed, auto-refresh screenshot
					handleRefreshScreenshot();
				}
			} catch {
				// Ignore polling errors
			}
		}, 2000);

		return () => clearInterval(pollInterval);
	});

	async function initializeBrowser() {
		browserLoading = true;
		error = null;

		try {
			const response = await apiRequest<{
				session: { actions: Action[]; tabs?: Tab[] };
				screenshotPath: string;
				viewport: { width: number; height: number };
				tabId: string;
				tabs?: Tab[];
			}>(`/api/sessions/${session.id}`, { method: 'POST' });

			tabId = response.tabId;
			tabs = response.tabs ?? response.session.tabs ?? [];
			screenshotPath = response.screenshotPath;
			viewport = response.viewport;
			actions = response.session.actions;
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			browserLoading = false;
		}
	}

	async function handleReplayAction(index: number) {
		if (!session.id || !tabId || index < 0 || index >= actions.length) return;

		replayLoading = true;
		error = null;

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				currentUrl?: string;
				viewport: { width: number; height: number };
				session?: { actions: Action[] };
				tabId: string;
			}>(`/api/sessions/${session.id}/replay`, {
				method: 'POST',
				body: { actionIndex: index, tabId }
			});

			screenshotPath = response.screenshotPath;
			currentUrl = response.currentUrl ?? null;
			viewport = response.viewport;
			replayedUpTo = index;
			tabId = response.tabId;

			if (response.session) {
				actions = response.session.actions;
			}
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			replayLoading = false;
		}
	}

	async function handleExportSession() {
		try {
			const response = await apiRequest<{ session: unknown }>(`/api/sessions/${session.id}`);

			const blob = new Blob([JSON.stringify(response.session, null, 2)], { type: 'application/json' });
			const downloadUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = downloadUrl;
			a.download = `session-${session.id}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(downloadUrl);
		} catch (e) {
			error = getErrorMessage(e);
		}
	}

	async function handleRefreshScreenshot() {
		if (!session.id || !tabId) return;

		refreshLoading = true;
		error = null;

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				viewport: { width: number; height: number };
				tabId: string;
				currentUrl: string;
			}>(`/api/sessions/${session.id}/refresh`, { method: 'POST', body: { tabId } });

			screenshotPath = response.screenshotPath;
			viewport = response.viewport;
			tabId = response.tabId;
			currentUrl = response.currentUrl;
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			refreshLoading = false;
		}
	}

	async function handleSwitchTab(newTabId: string) {
		if (!session.id || !tabId || newTabId === tabId) return;

		tabLoading = true;
		error = null;

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				session: { actions: Action[]; tabs?: Tab[] };
				completed: boolean;
				tabId: string;
			}>('/api/action', {
				method: 'POST',
				body: {
					sessionId: session.id,
					tabId,
					actionType: 'switchTab',
					explanation: `Switch to tab`,
					targetTabId: newTabId
				}
			});

			screenshotPath = response.screenshotPath;
			actions = response.session.actions;
			tabId = response.tabId;
			if (response.session.tabs) {
				tabs = response.session.tabs;
			}
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			tabLoading = false;
		}
	}

	async function handleNewTab() {
		if (!session.id || !tabId) return;

		const newUrl = window.prompt('Enter URL for new tab:', 'https://');
		if (!newUrl) return;

		tabLoading = true;
		error = null;

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				session: { actions: Action[]; tabs?: Tab[] };
				completed: boolean;
				tabId: string;
				newTabId?: string;
			}>('/api/action', {
				method: 'POST',
				body: {
					sessionId: session.id,
					tabId,
					actionType: 'newTab',
					explanation: `Open new tab: ${newUrl}`,
					targetUrl: newUrl
				}
			});

			screenshotPath = response.screenshotPath;
			actions = response.session.actions;
			tabId = response.tabId;
			if (response.session.tabs) {
				tabs = response.session.tabs;
			}
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			tabLoading = false;
		}
	}

	async function handleCloseTab(closeTabId: string) {
		if (!session.id || !tabId) return;

		const openTabs = tabs.filter((t) => !t.closedAt);
		if (openTabs.length <= 1) {
			error = 'Cannot close the last tab';
			return;
		}

		tabLoading = true;
		error = null;

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				session: { actions: Action[]; tabs?: Tab[] };
				completed: boolean;
				tabId: string;
			}>('/api/action', {
				method: 'POST',
				body: {
					sessionId: session.id,
					tabId,
					actionType: 'closeTab',
					explanation: `Close tab`,
					targetTabId: closeTabId
				}
			});

			screenshotPath = response.screenshotPath;
			actions = response.session.actions;
			tabId = response.tabId;
			if (response.session.tabs) {
				tabs = response.session.tabs;
			}
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			tabLoading = false;
		}
	}

	async function handleDeleteAction(index: number) {
		if (!session.id || index < 0 || index >= actions.length) return;

		const action = actions[index];
		if (!confirm(`Delete action #${index}: ${formatAction(action)}?`)) {
			return;
		}

		deleteLoading = true;
		error = null;

		try {
			const response = await apiRequest<{
				session: { actions: Action[]; finalAnswer?: string };
			}>(`/api/sessions/${session.id}/actions/${index}`, { method: 'DELETE' });

			actions = response.session.actions;
			isCompleted = !!response.session.finalAnswer;

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
		if (editingActionIndex === null || !session.id || !selectedAction || !explanation.trim()) {
			return;
		}

		actionLoading = true;
		error = null;

		const actionUpdate: Record<string, unknown> = {
			type: selectedAction,
			explanation
		};

		if ((selectedAction === 'click' || selectedAction === 'hover') && clickCoordinates) {
			actionUpdate.coordinates = clickCoordinates;
		} else if (selectedAction === 'scroll') {
			actionUpdate.direction = scrollDirection;
		} else if (selectedAction === 'type') {
			actionUpdate.text = typeText;
		}

		try {
			const response = await apiRequest<{ session: { actions: Action[] } }>(
				`/api/sessions/${session.id}/actions/${editingActionIndex}`,
				{ method: 'PATCH', body: actionUpdate }
			);

			actions = response.session.actions;
			const indexToReplay = editingActionIndex;

			// Reset manual edit mode before replaying
			manualEditMode = false;
			editingActionIndex = null;
			selectedAction = null;
			explanation = '';
			clickCoordinates = null;
			typeText = '';

			await handleReplayAction(indexToReplay);
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			actionLoading = false;
		}
	}

	function handleClick(x: number, y: number) {
		if (selectedAction === 'click' || selectedAction === 'hover') {
			clickCoordinates = { x, y };
		}
	}

	function handleSelectForEdit(index: number) {
		const action = actions[index];
		manualEditMode = true;
		editingActionIndex = index;

		// Reset all action-specific fields first
		clickCoordinates = null;
		typeText = '';
		scrollDirection = 'down';

		// Populate based on action type
		const supportedTypes = ['click', 'hover', 'scroll', 'type', 'wait', 'stop'] as const;
		if (supportedTypes.includes(action.type as (typeof supportedTypes)[number])) {
			selectedAction = action.type as (typeof supportedTypes)[number];
		} else {
			selectedAction = null;
		}
		explanation = action.explanation;

		if ((action.type === 'click' || action.type === 'hover') && action.coordinates) {
			clickCoordinates = action.coordinates;
		} else if (action.type === 'scroll' && action.direction) {
			scrollDirection = action.direction;
		} else if (action.type === 'type' && action.text) {
			typeText = action.text;
		}
	}

	function cancelEdit() {
		manualEditMode = false;
		editingActionIndex = null;
		selectedAction = null;
		explanation = '';
		clickCoordinates = null;
		typeText = '';
	}

	async function executeAction() {
		if (!session.id || !tabId || !selectedAction || !explanation.trim()) {
			error = 'Please select an action and provide an explanation';
			return;
		}

		if ((selectedAction === 'click' || selectedAction === 'hover') && !clickCoordinates) {
			error = 'Please click on the screenshot to select coordinates';
			return;
		}

		if (selectedAction === 'type' && !typeText.trim()) {
			error = 'Please enter text to type';
			return;
		}

		actionLoading = true;
		error = null;

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				currentUrl?: string;
				session: { actions: Action[]; tabs?: Tab[] };
				completed: boolean;
				tabId: string;
				newTabId?: string;
			}>('/api/action', {
				method: 'POST',
				body: {
					sessionId: session.id,
					tabId,
					actionType: selectedAction,
					explanation,
					coordinates: clickCoordinates,
					direction: scrollDirection,
					text: typeText
				}
			});

			screenshotPath = response.screenshotPath;
			currentUrl = response.currentUrl ?? null;
			actions = response.session.actions;
			isCompleted = response.completed;
			tabId = response.tabId;
			if (response.session.tabs) {
				tabs = response.session.tabs;
			}

			selectedAction = null;
			explanation = '';
			clickCoordinates = null;
			typeText = '';
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			actionLoading = false;
		}
	}

	function goHome() {
		goto('/');
	}

	// Check if we're in replay edit mode (replaying a session with upcoming actions)
	let nextActionIndex = $derived(
		actions.length > 0 && replayedUpTo < actions.length - 1 ? replayedUpTo + 1 : null
	);

	// Edit mode is active when either replaying or manually editing
	let isEditMode = $derived(nextActionIndex !== null || manualEditMode);

	// Auto-populate form with next action when in replay edit mode (not manual edit)
	$effect(() => {
		// Skip if in manual edit mode - form is already populated
		if (manualEditMode) return;

		if (nextActionIndex !== null) {
			const action = actions[nextActionIndex];
			editingActionIndex = nextActionIndex;

			// Reset all action-specific fields first
			clickCoordinates = null;
			typeText = '';
			scrollDirection = 'down';

			// Then populate based on action type
			const supportedTypes = ['click', 'hover', 'scroll', 'type', 'wait', 'stop'] as const;
			if (supportedTypes.includes(action.type as (typeof supportedTypes)[number])) {
				selectedAction = action.type as (typeof supportedTypes)[number];
			} else {
				selectedAction = null;
			}
			explanation = action.explanation;

			if ((action.type === 'click' || action.type === 'hover') && action.coordinates) {
				clickCoordinates = action.coordinates;
			} else if (action.type === 'scroll' && action.direction) {
				scrollDirection = action.direction;
			} else if (action.type === 'type' && action.text) {
				typeText = action.text;
			}
		} else {
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
			((selectedAction !== 'click' && selectedAction !== 'hover') || clickCoordinates !== null) &&
			(selectedAction !== 'type' || typeText.trim() !== '')
	);

	let isLoading = $derived(actionLoading || tabLoading);

	// When editing, show the action's screenshot; otherwise show current browser state
	let displayScreenshot = $derived(
		manualEditMode && editingActionIndex !== null
			? actions[editingActionIndex]?.screenshotPath ?? screenshotPath
			: screenshotPath
	);
</script>

<main>
	<div class="page-header">
		<button class="back-btn" onclick={goHome}>&larr;</button>
		<span class="page-title">Web Annotator</span>
	</div>

	{#if error}
		<div class="error">{error}</div>
	{/if}

	{#if isCompleted}
		<section class="completed">
			<h2>Annotation Complete</h2>
			<p>Session ID: <code>{session.id}</code></p>
			<p>Total actions: {actions.length}</p>
			<p>Final answer: {actions[actions.length - 1]?.explanation}</p>

			<svelte:boundary onerror={(e) => error = `History error: ${getErrorMessage(e)}`}>
				<SessionHistory {actions} {viewport} currentScreenshot={screenshotPath} {currentUrl} onDelete={handleDeleteAction} {deleteLoading} />
				{#snippet failed()}
					<div class="error">Failed to render session history. Please refresh the page.</div>
				{/snippet}
			</svelte:boundary>

			<button onclick={goHome}>Back to Sessions</button>
		</section>
	{:else}
		<section class="annotation-interface">
			<div class="task-info">
				<p><strong>URL:</strong> {session.url}</p>
				<p><strong>Task:</strong> {session.prompt}</p>
				<details class="plan-details">
					<summary><strong>Plan</strong></summary>
					<p class="plan-text">{session.plan}</p>
				</details>
			</div>

			{#if tabs.length > 0}
				<TabBar
					{tabs}
					activeTabId={tabId}
					loading={tabLoading || actionLoading || browserLoading}
					onSwitchTab={handleSwitchTab}
					onNewTab={handleNewTab}
					onCloseTab={handleCloseTab}
				/>
			{/if}

			{#if actions.length > 0 || screenshotPath}
				<div class="history-section">
					<svelte:boundary onerror={(e) => error = `History error: ${getErrorMessage(e)}`}>
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
							onSelectForEdit={handleSelectForEdit}
						/>
						{#snippet failed()}
							<div class="error">Failed to render session history. Please refresh the page.</div>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}

			<div class="main-content">
				<div class="screenshot-section">
					{#if browserLoading}
						<div class="screenshot-placeholder">
							<div class="loading-content">
								<span class="spinner"></span>
								<span>Initializing browser...</span>
							</div>
						</div>
					{:else if displayScreenshot}
						<div class="screenshot-wrapper" class:editing-mode={manualEditMode}>
							{#if manualEditMode && editingActionIndex !== null}
								<div class="editing-banner">
									Editing Action #{editingActionIndex}
								</div>
							{/if}
							<svelte:boundary onerror={(e) => error = `Screenshot error: ${getErrorMessage(e)}`}>
								<ScreenshotViewer
									src={displayScreenshot}
									{viewport}
									onclick={handleClick}
									clickEnabled={selectedAction === 'click' || selectedAction === 'hover'}
									{hoverInfo}
								/>
								{#snippet failed()}
									<div class="screenshot-placeholder">
										<p>Failed to load screenshot</p>
									</div>
								{/snippet}
							</svelte:boundary>
							{#if replayLoading || actionLoading}
								<div class="screenshot-loading-overlay">
									<div class="loading-content">
										<span class="spinner"></span>
										<span>Playing action...</span>
									</div>
								</div>
							{/if}
						</div>
						<div class="screenshot-toolbar">
							{#if clickCoordinates && (selectedAction === 'click' || selectedAction === 'hover')}
								<span class="coordinates">Selected: ({clickCoordinates.x}, {clickCoordinates.y})</span>
							{/if}
							<div class="toolbar-buttons">
								{#if !manualEditMode}
									<button
										class="toolbar-btn"
										onclick={handleRefreshScreenshot}
										disabled={refreshLoading}
										title="Refresh screenshot"
									>
										{refreshLoading ? '...' : '↻'} Refresh
									</button>
								{/if}
								<button
									class="toolbar-btn"
									onclick={handleExportSession}
									title="Export session as JSON"
								>
									↓ Export
								</button>
							</div>
						</div>
					{:else}
						<div class="screenshot-placeholder">
							<p>No screenshot available</p>
						</div>
					{/if}
				</div>

				<div class="controls-section">
					{#if browserLoading}
						<div class="controls-placeholder">
							<p>Waiting for browser...</p>
						</div>
					{:else}
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
							isEditing={manualEditMode}
							onCancelEdit={cancelEdit}
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
							<button class="update-btn" onclick={updateActionHandler} disabled={isLoading || !canExecute}>
								{isLoading ? 'Running...' : 'Update & Run Action'}
							</button>
						{:else}
							<button class="execute-btn" onclick={executeAction} disabled={isLoading || !canExecute}>
								{isLoading ? 'Executing...' : 'Execute Action'}
							</button>
						{/if}
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
		padding: var(--space-lg);
	}

	.page-header {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
	}

	.back-btn {
		background: none;
		color: var(--color-text-muted);
		border: none;
		padding: var(--space-xs) var(--space-sm);
		font-size: 0.9rem;
	}

	.back-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.page-title {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--color-text-muted);
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

	.annotation-interface {
		display: contents;
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

	.screenshot-wrapper {
		position: relative;
		display: inline-block;
	}

	.screenshot-wrapper.editing-mode {
		outline: 3px solid var(--color-purple);
		border-radius: 6px;
	}

	.editing-banner {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		background: var(--color-purple);
		color: white;
		padding: var(--space-xs) var(--space-sm);
		font-size: 0.85rem;
		font-weight: 600;
		text-align: center;
		z-index: 10;
		border-radius: 4px 4px 0 0;
	}

	.screenshot-loading-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
	}

	.screenshot-loading-overlay .loading-content {
		background: var(--color-bg-primary, #fff);
		padding: var(--space-lg);
		border-radius: var(--radius-lg);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}

	.screenshot-placeholder {
		aspect-ratio: 1280 / 800;
		background: var(--color-bg-tertiary);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.loading-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-md);
		color: var(--color-text-muted);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-spinner-track);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
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

	.controls-placeholder {
		padding: var(--space-2xl);
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-lg);
		text-align: center;
		color: var(--color-text-muted);
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
