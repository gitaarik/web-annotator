<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ScreenshotViewer from '$lib/components/ScreenshotViewer.svelte';
	import ActionPanel from '$lib/components/ActionPanel.svelte';
	import ExplanationInput from '$lib/components/ExplanationInput.svelte';
	import SessionHistory from '$lib/components/SessionHistory.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import { type Action, type HoverInfo, type Tab, formatAction } from '$lib/types';
	import { apiRequest, getErrorMessage, ApiError } from '$lib/api';

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
	let deletingIndex = $state<number | null>(null);
	let refreshLoading = $state(false);
	let tabLoading = $state(false);
	let navigatingIndex = $state<number | null>(null);

	let error = $state<string | null>(null);
	// Set when the browser renderer is wedged (blocked main thread). Shows a
	// reload prompt instead of silently retrying screenshots forever.
	let browserUnresponsive = $state(false);
	let replayedUpTo = $state(-1);
	// Gate playhead persistence until the initial position is restored on mount.
	let positionSynced = $state(false);
	let hoverInfo = $state<HoverInfo>(null);
	let editingActionIndex = $state<number | null>(null);
	let manualEditMode = $state(false);
	let pollingInterval = $state<ReturnType<typeof setTimeout> | null>(null);
	// Sequential polling guard: only one screenshot capture is ever in flight, so
	// slow captures can't stack into a thundering herd on the CDP connection.
	let pollingActive = false;

	// Visual loading state (can be hidden while action still processing)
	let showLoadingIndicator = $state(false);
	let hideIndicatorTimeout = $state<ReturnType<typeof setTimeout> | null>(null);
	let lateUpdate = $state(false);
	// Ensures the "Updated" flash fires only once per polling cycle. Screenshot
	// paths are timestamped (always unique), so without this guard every 300ms
	// poll would re-arm the flash and make it flicker.
	let lateUpdateShown = $state(false);

	// Action queue for when user starts next action before previous completes
	let pendingAction = $state<(() => Promise<void>) | null>(null);
	let queuedReplayIndex = $state<number | null>(null);

	// Preview of action being executed (shown in history with loading state)
	let pendingActionPreview = $state<{
		type: string;
		explanation: string;
		coordinates?: { x: number; y: number };
		direction?: 'up' | 'down';
		text?: string;
	} | null>(null);

	// Cache-busting version for screenshot URLs (incremented when screenshots update)
	let screenshotVersion = $state(Date.now());

	// Add cache-busting query param to screenshot URLs
	function versionedSrc(src: string): string;
	function versionedSrc(src: string | null): string | null;
	function versionedSrc(src: string | null): string | null {
		if (!src) return null;
		const separator = src.includes('?') ? '&' : '?';
		return `${src}${separator}v=${screenshotVersion}`;
	}

	// Route a caught error: a wedged renderer shows the reload prompt; anything
	// else is a normal error message.
	function reportError(e: unknown) {
		if (e instanceof ApiError && e.code === 'RENDERER_UNRESPONSIVE') {
			browserUnresponsive = true;
		} else {
			error = getErrorMessage(e);
		}
	}

	// Recover a wedged renderer by reloading the page: reconnect re-attaches, and
	// if the live page is still unhealthy the reconnect fallback reloads it.
	function recoverBrowser() {
		window.location.reload();
	}

	async function pollScreenshot() {
		if (!session.id || !tabId) return;
		try {
			const response = await fetch(`/api/sessions/${session.id}/refresh`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tabId })
			});
			const data = await response.json();
			if (response.status === 503 && data?.code === 'RENDERER_UNRESPONSIVE') {
				// Renderer is wedged — stop polling and prompt a reload.
				browserUnresponsive = true;
				stopScreenshotPolling();
				return;
			}
			if (data.screenshotPath) {
				const previousPath = screenshotPath;
				screenshotPath = data.screenshotPath;

				// Update cache-busting version when screenshot changes
				screenshotVersion = Date.now();

				// If the spinner already hid but a screenshot lands late, flash "Updated"
				// once per cycle (paths are always unique, so guard against re-firing).
				if (
					!showLoadingIndicator &&
					actionLoading &&
					!lateUpdateShown &&
					previousPath !== data.screenshotPath
				) {
					lateUpdateShown = true;
					lateUpdate = true;
					setTimeout(() => (lateUpdate = false), 800);
				}
			}
		} catch {
			// Ignore polling errors
		}
	}

	// One poll iteration, then schedules the next only after this one finishes —
	// never overlapping, so captures can't pile up on the CDP connection.
	async function pollTick() {
		if (!pollingActive) return;
		await pollScreenshot();
		if (!pollingActive) return;
		pollingInterval = setTimeout(pollTick, 300);
	}

	function startScreenshotPolling() {
		if (pollingActive) return;
		pollingActive = true;
		showLoadingIndicator = true;
		lateUpdateShown = false;

		// Hide indicator after 1 second (polling continues in background)
		// But keep showing if there's a queued action
		hideIndicatorTimeout = setTimeout(() => {
			if (pendingAction === null) {
				showLoadingIndicator = false;
			}
		}, 1000);

		pollTick();
	}

	function stopScreenshotPolling() {
		pollingActive = false;
		if (pollingInterval) {
			clearTimeout(pollingInterval);
			pollingInterval = null;
		}
		if (hideIndicatorTimeout) {
			clearTimeout(hideIndicatorTimeout);
			hideIndicatorTimeout = null;
		}
		showLoadingIndicator = false;
	}

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

		return () => {
			clearInterval(pollInterval);
			stopScreenshotPolling();
		};
	});

	// Persist the playhead to the Chrome session whenever it moves, so a page
	// reload reconnects at the same position. Gated on positionSynced so the
	// initial default (-1) doesn't overwrite the restored value during mount.
	$effect(() => {
		const position = replayedUpTo;
		if (!positionSynced || !session.id || !tabId) return;
		fetch(`/api/sessions/${session.id}/position`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tabId, position })
		}).catch(() => {
			// Best-effort; a failed sync just means reload falls back to this position
		});
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
				isNew: boolean;
				replayPosition: number;
			}>(`/api/sessions/${session.id}`, { method: 'POST' });

			tabId = response.tabId;
			tabs = response.tabs ?? response.session.tabs ?? [];
			screenshotPath = response.screenshotPath;
			viewport = response.viewport;
			actions = response.session.actions;

			// On reconnect, restore the playhead persisted with the Chrome session so
			// history continues where it left off. A freshly launched Chrome starts
			// at the beginning (-1).
			replayedUpTo = response.isNew ? -1 : response.replayPosition;
		} catch (e) {
			reportError(e);
		} finally {
			browserLoading = false;
			// Enable playhead persistence only after the initial value is restored,
			// so the sync effect can't clobber the stored position with the default.
			positionSynced = true;
		}
	}

	async function handleReplayAction(index: number) {
		if (!session.id || !tabId || index < 0 || index >= actions.length) return;

		// If replay already running, queue this one
		if (replayLoading) {
			queuedReplayIndex = index;
			pendingAction = () => runReplayAction(index);
			// Show loading indicator while queued
			showLoadingIndicator = true;
			return;
		}

		await runReplayAction(index);
	}

	async function runReplayAction(index: number) {
		replayLoading = true;
		error = null;
		queuedReplayIndex = null; // Clear queued state as we're now running

		// Optimistically update replayedUpTo so next button is enabled for queuing
		const previousReplayedUpTo = replayedUpTo;
		replayedUpTo = index;

		startScreenshotPolling();

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
			tabId = response.tabId;

			if (response.session) {
				actions = response.session.actions;
			}
		} catch (e) {
			// Revert on failure
			replayedUpTo = previousReplayedUpTo;
			reportError(e);
		} finally {
			stopScreenshotPolling();
			replayLoading = false;

			// Run pending action if queued
			if (pendingAction) {
				const nextAction = pendingAction;
				pendingAction = null;
				await nextAction();
			}
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

		deletingIndex = index;
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
			deletingIndex = null;
		}
	}

	async function handleNavigateTo(index: number, url: string) {
		if (!session.id || !tabId || !url) return;

		navigatingIndex = index;
		error = null;

		// Clear any edit state first to prevent auto-populating the form
		manualEditMode = false;
		editingActionIndex = null;
		selectedAction = null;
		explanation = '';
		clickCoordinates = null;
		typeText = '';

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				currentUrl?: string;
				viewport: { width: number; height: number };
				tabId: string;
			}>(`/api/sessions/${session.id}/navigate`, {
				method: 'POST',
				body: { tabId, url }
			});

			screenshotPath = response.screenshotPath;
			currentUrl = response.currentUrl ?? null;
			viewport = response.viewport;
			tabId = response.tabId;

			// Set replayedUpTo to index since we navigated to where this action ended
			replayedUpTo = index;
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			navigatingIndex = null;
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
			const startIndex = editingActionIndex;

			// Reset manual edit mode before replaying
			manualEditMode = false;
			editingActionIndex = null;
			selectedAction = null;
			explanation = '';
			clickCoordinates = null;
			typeText = '';

			// Replay only the edited action
			await handleReplayAction(startIndex);
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

		// Capture current values for the action
		const actionParams = {
			sessionId: session.id,
			tabId,
			actionType: selectedAction,
			explanation,
			coordinates: clickCoordinates,
			direction: scrollDirection,
			text: typeText
		};

		// Clear form immediately so user can prepare next action
		const wasStopAction = selectedAction === 'stop';
		selectedAction = null;
		explanation = '';
		clickCoordinates = null;
		typeText = '';

		// If action already running, queue this one
		if (actionLoading) {
			pendingAction = () => runAction(actionParams, wasStopAction);
			// Show loading indicator while queued
			showLoadingIndicator = true;
			return;
		}

		await runAction(actionParams, wasStopAction);
	}

	async function runAction(
		params: {
			sessionId: string;
			tabId: string | null;
			actionType: string;
			explanation: string;
			coordinates: { x: number; y: number } | null;
			direction: 'up' | 'down';
			text: string;
		},
		isStopAction: boolean
	) {
		actionLoading = true;
		error = null;

		// Show preview in history while executing
		pendingActionPreview = {
			type: params.actionType,
			explanation: params.explanation,
			coordinates: params.coordinates ?? undefined,
			direction: params.direction,
			text: params.text || undefined
		};

		startScreenshotPolling();

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
				body: params
			});

			screenshotPath = response.screenshotPath;
			currentUrl = response.currentUrl ?? null;
			actions = response.session.actions;
			isCompleted = response.completed;
			tabId = response.tabId;
			if (response.session.tabs) {
				tabs = response.session.tabs;
			}

			// The browser is now at the state after this just-recorded action, so
			// advance the playhead to the new frontier. Keeps replayedUpTo in sync
			// with the actual browser position (it's the persisted value a reload
			// restores) — otherwise recording leaves it stale and a refresh shows
			// the wrong step under a live last-step screenshot.
			replayedUpTo = actions.length - 1;

			// Ensure form is cleared after successful action
			selectedAction = null;
			explanation = '';
			clickCoordinates = null;
			typeText = '';
		} catch (e) {
			reportError(e);
		} finally {
			stopScreenshotPolling();
			actionLoading = false;
			pendingActionPreview = null;

			// Run pending action if queued
			if (pendingAction) {
				const nextAction = pendingAction;
				pendingAction = null;
				await nextAction();
			}
		}
	}

	function goHome() {
		goto('/');
	}

	// Check if we're in replay edit mode (replaying a session with upcoming actions)
	// Only active when user has explicitly replayed (replayedUpTo >= 0) and there are more actions
	let nextActionIndex = $derived(
		replayedUpTo >= 0 && replayedUpTo < actions.length - 1 ? replayedUpTo + 1 : null
	);

	// Edit mode is active only when user explicitly clicks Edit on an action
	let isEditMode = $derived(manualEditMode);

	// Adding new action mode - not editing any existing action
	let isAddingNew = $derived(!isEditMode && !actionLoading && !replayLoading);

	function handleAddNew() {
		// Clear any edit state and prepare for adding a new action
		manualEditMode = false;
		editingActionIndex = null;
		replayedUpTo = -1; // Exit replay mode to enable "add new" mode
		selectedAction = null;
		explanation = '';
		clickCoordinates = null;
		typeText = '';
		error = null;
	}

	function handleActivate(index: number) {
		// Force-activate a history position to recover from stuck states
		// Set to index - 1 so the selected action becomes the next playable one
		replayedUpTo = index - 1;
		// Clear any loading states that might be stuck
		actionLoading = false;
		replayLoading = false;
		pendingAction = null;
		pendingActionPreview = null;
		stopScreenshotPolling();
		// Clear edit state
		manualEditMode = false;
		editingActionIndex = null;
		selectedAction = null;
		explanation = '';
		clickCoordinates = null;
		typeText = '';
		error = null;
	}

	// Clear form when exiting manual edit mode
	$effect(() => {
		if (!manualEditMode && editingActionIndex !== null) {
			editingActionIndex = null;
			selectedAction = null;
			explanation = '';
			clickCoordinates = null;
			typeText = '';
		}
	});

	let canExecute = $derived(
		selectedAction !== null &&
			explanation.trim() !== '' &&
			((selectedAction !== 'click' && selectedAction !== 'hover') || clickCoordinates !== null) &&
			(selectedAction !== 'type' || typeText.trim() !== '')
	);

	// Only disable buttons if there's already a pending action queued (allow one queue)
	let isLoading = $derived(actionLoading || tabLoading || pendingAction !== null);

	// When editing, show the action's screenshot; otherwise show current browser state
	let displayScreenshot = $derived(
		manualEditMode && editingActionIndex !== null
			? actions[editingActionIndex]?.screenshotPath ?? screenshotPath
			: screenshotPath
	);

	// Effective hoverInfo: show current editing state when editing, otherwise use history hover
	let effectiveHoverInfo = $derived.by((): HoverInfo => {
		// When editing a click/hover action with coordinates, show those
		if ((selectedAction === 'click' || selectedAction === 'hover') && clickCoordinates) {
			return { type: selectedAction, coordinates: clickCoordinates };
		}
		// When editing a scroll action, show that
		if (selectedAction === 'scroll') {
			return { type: 'scroll', direction: scrollDirection };
		}
		// When editing a type action with text, show that
		if (selectedAction === 'type' && typeText) {
			return { type: 'type', text: typeText };
		}
		// Otherwise use the hover from history
		return hoverInfo;
	});
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
				<SessionHistory {actions} {viewport} currentScreenshot={screenshotPath} {currentUrl} onDelete={handleDeleteAction} {deletingIndex} {screenshotVersion} />
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
							loadingIndex={replayLoading ? replayedUpTo : null}
							queuedIndex={queuedReplayIndex}
							onDelete={handleDeleteAction}
							{deletingIndex}
							onHoverAction={(info) => (hoverInfo = info)}
							editingIndex={editingActionIndex}
							onSelectForEdit={handleSelectForEdit}
							{isAddingNew}
							onAddNew={handleAddNew}
							onNavigateTo={handleNavigateTo}
							{navigatingIndex}
							{pendingActionPreview}
							onActivate={handleActivate}
							{screenshotVersion}
						/>
						{#snippet failed()}
							<div class="error">Failed to render session history. Please refresh the page.</div>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}

			<div class="main-content">
				<div class="screenshot-section">
					{#if browserUnresponsive}
						<div class="screenshot-placeholder">
							<div class="unresponsive-content">
								<p class="unresponsive-title">Browser became unresponsive</p>
								<p class="unresponsive-text">
									A dialog or script froze the page. Reload to recover the session.
								</p>
								<button class="reload-btn" onclick={recoverBrowser}>Reload</button>
							</div>
						</div>
					{:else if browserLoading}
						<div class="screenshot-placeholder">
							<div class="loading-content">
								<span class="spinner"></span>
								<span>Initializing browser...</span>
							</div>
						</div>
					{:else if displayScreenshot}
						<div class="screenshot-wrapper" class:editing-mode={manualEditMode} class:action-running={showLoadingIndicator}>
							{#if manualEditMode && editingActionIndex !== null}
								<div class="editing-banner">
									Editing Action #{editingActionIndex}
								</div>
							{/if}
							<svelte:boundary onerror={(e) => error = `Screenshot error: ${getErrorMessage(e)}`}>
								<ScreenshotViewer
									src={versionedSrc(displayScreenshot)}
									{viewport}
									onclick={handleClick}
									clickEnabled={selectedAction === 'click' || selectedAction === 'hover'}
									hoverInfo={effectiveHoverInfo}
								/>
								{#snippet failed()}
									<div class="screenshot-placeholder">
										<p>Failed to load screenshot</p>
									</div>
								{/snippet}
							</svelte:boundary>
							{#if showLoadingIndicator}
								<div class="action-loading-overlay"></div>
								<div class="action-loading-indicator">
									<span class="spinner-small"></span>
									<span>Running action...</span>
								</div>
							{:else if lateUpdate}
								<div class="late-update-indicator">
									Updated
								</div>
							{:else if pendingAction}
								<div class="action-loading-indicator queued">
									<span>Next action queued...</span>
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

	.screenshot-wrapper.action-running {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		border-radius: 6px;
		animation: pulse-border 1.5s ease-in-out infinite;
	}

	@keyframes pulse-border {
		0%, 100% {
			outline-color: var(--color-primary);
			outline-offset: 2px;
		}
		50% {
			outline-color: color-mix(in srgb, var(--color-primary) 50%, transparent);
			outline-offset: 4px;
		}
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

	.action-loading-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.15);
		border-radius: 4px;
		z-index: 9;
		pointer-events: none;
	}

	.action-loading-indicator {
		position: absolute;
		top: var(--space-md);
		right: var(--space-md);
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		background: var(--color-primary);
		color: white;
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
		font-size: 0.85rem;
		font-weight: 500;
		z-index: 10;
	}

	.spinner-small {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.action-loading-indicator.queued {
		background: var(--color-text-muted);
	}

	.late-update-indicator {
		position: absolute;
		top: var(--space-md);
		right: var(--space-md);
		background: var(--color-success, #22c55e);
		color: white;
		padding: var(--space-xs) var(--space-md);
		border-radius: var(--radius-md);
		font-size: 0.8rem;
		font-weight: 500;
		z-index: 10;
		animation: fade-in-out 0.8s ease-out forwards;
	}

	@keyframes fade-in-out {
		0% {
			opacity: 0;
			transform: translateY(-4px);
		}
		20% {
			opacity: 1;
			transform: translateY(0);
		}
		80% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
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

	.unresponsive-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-sm);
		text-align: center;
		padding: var(--space-lg);
		max-width: 32rem;
	}

	.unresponsive-title {
		margin: 0;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.unresponsive-text {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.reload-btn {
		margin-top: var(--space-sm);
		padding: var(--space-xs) var(--space-lg);
		background: var(--color-primary);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		cursor: pointer;
	}

	.reload-btn:hover {
		background: var(--color-primary-hover, var(--color-primary));
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
