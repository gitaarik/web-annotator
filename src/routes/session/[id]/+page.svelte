<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ScreenshotViewer from '$lib/components/ScreenshotViewer.svelte';
	import ActionPanel from '$lib/components/ActionPanel.svelte';
	import ExplanationInput from '$lib/components/ExplanationInput.svelte';
	import SessionHistory from '$lib/components/SessionHistory.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import { type Action, type HoverInfo, type Tab, formatAction, actionToHoverInfo } from '$lib/types';
	import { apiRequest, getErrorMessage, ApiError } from '$lib/api';

	let { data } = $props();

	// Session data from server (loaded instantly)
	// svelte-ignore state_referenced_locally
	let session = $state(data.session);
	// svelte-ignore state_referenced_locally
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
	let selectedAction = $state<
		'click' | 'hover' | 'scroll' | 'type' | 'stop' | 'dismiss' | null
	>(null);
	let scrollDirection = $state<'up' | 'down'>('down');
	let typeText = $state('');
	let explanation = $state('');
	let clickCoordinates = $state<{ x: number; y: number } | null>(null);

	// Loading states
	let browserLoading = $state(true);
	let actionLoading = $state(false);
	let replayLoading = $state(false);
	// Which step is mid-replay, for the timeline spinner. Kept separate from the
	// playhead so the inspector doesn't advance to the next step until the current
	// one has actually run (otherwise the form/overlay jump ahead during submit).
	let runningIndex = $state<number | null>(null);
	let deletingIndex = $state<number | null>(null);
	let refreshLoading = $state(false);
	// Idle auto-refresh toggle: when on, keep pulling the latest pushed screencast
	// frame so in-page changes that don't navigate still reach the canvas.
	let autoRefresh = $state(false);
	let tabLoading = $state(false);
	let navigatingIndex = $state<number | null>(null);

	let error = $state<string | null>(null);
	// Set when the browser renderer is wedged (blocked main thread). Shows a
	// reload prompt instead of silently retrying screenshots forever.
	let browserUnresponsive = $state(false);
	// A wedge is often a transient stall (heavy JS / GC), not a permanent hang.
	// While busy-waiting we poll liveness for a grace window and resume if the
	// page comes back, only falling through to browserUnresponsive if it doesn't.
	let browserBusyWaiting = $state(false);
	let busyWaitElapsed = $state(0);
	// Bumped to cancel/supersede an in-flight wait (manual restart, remount).
	let wedgeWaitToken = 0;
	// Set after a mid-session browser restart (hard wedge / crash) so the UI can
	// explain why the current step jumped back to the start. Dismissible.
	let restartNotice = $state(false);
	let replayedUpTo = $state(-1);
	// Gate playhead persistence until the initial position is restored on mount.
	let positionSynced = $state(false);
	let hoverInfo = $state<HoverInfo>(null);
	// A pinned, read-only look at a recorded step. Purely a canvas overlay: it shows
	// that step's stored screenshot without moving the playhead or retargeting the
	// inspector — the browser stays where it truly is. null = showing live.
	let previewIndex = $state<number | null>(null);
	// The inspector follows the playhead. The "active step" is the next-playable one
	// (replayedUpTo + 1) — the step the browser is positioned right before, so
	// editing/running it is state-correct. When the active step is an existing step
	// the inspector edits it; past the end it composes a new step to append.
	//   selectedStep === N    → edit mode for step N (the active step)
	//   selectedStep === null → add mode (compose a new step at the cursor)
	// `composing` overrides the default "edit the active step" to compose a NEW step
	// at the cursor instead (set by the "+" seams / the Now card).
	let composing = $state(false);
	// Bumped to force the inspector form to re-sync even when the active-step index
	// is unchanged (e.g. deleting the active step shifts a different action into it).
	let formResyncNonce = $state(0);
	// Inline editing of the session's task/prompt (metadata only).
	let editingTask = $state(false);
	let taskDraft = $state('');
	let savingTask = $state(false);
	let pollingInterval = $state<ReturnType<typeof setTimeout> | null>(null);
	// Sequential polling guard: only one screenshot capture is ever in flight, so
	// slow captures can't stack into a thundering herd on the CDP connection.
	let pollingActive = false;
	// After an action's server round-trip resolves we keep polling live frames for
	// a short trailing window before stopping, so paints that land just after the
	// server's settle (lazy images, late XHR, animations) still reach the canvas
	// without a manual refresh. Holds the pending "really stop now" timer.
	let trailingStopTimeout: ReturnType<typeof setTimeout> | null = null;

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
			beginWedgeWait();
		} else {
			error = getErrorMessage(e);
		}
	}

	// How long to tolerate a wedged renderer before offering a restart. Transient
	// stalls clear within a few seconds; observed real wedges (trip.com) are hard
	// and never recover, so a long wait is just dead time before the restart.
	// Tune from the '[CDP] renderer recovered after Xms' logs: if real transients
	// show up above this, raise it; if they're all hard wedges, this can go lower.
	const RENDERER_GRACE_MS = 10000;
	const RENDERER_PROBE_INTERVAL_MS = 2000;

	// Recover a wedged renderer by reloading the page: reconnect re-attaches, and
	// if the live page is still unhealthy the reconnect fallback reloads it.
	function recoverBrowser() {
		wedgeWaitToken++; // cancel any in-flight wait
		window.location.reload();
	}

	// A wedged renderer is usually a transient stall (a big synchronous task, GC),
	// not a permanent hang — so wait it out instead of jumping straight to a
	// restart. Poll liveness for a grace window: if the page comes back we resume
	// exactly where we were (no restart, no lost position); only if it stays dead
	// past the window do we surface the restart prompt.
	async function beginWedgeWait() {
		if (browserBusyWaiting || browserUnresponsive || !session.id) return;
		const token = ++wedgeWaitToken;
		browserBusyWaiting = true;
		busyWaitElapsed = 0;
		stopScreenshotPolling(); // stop firing captures at a blocked thread
		const start = Date.now();

		while (wedgeWaitToken === token) {
			await new Promise((r) => setTimeout(r, RENDERER_PROBE_INTERVAL_MS));
			if (wedgeWaitToken !== token) return; // superseded/cancelled
			busyWaitElapsed = Math.round((Date.now() - start) / 1000);

			let responsive = false;
			try {
				const res = await fetch(`/api/sessions/${session.id}/health`);
				responsive = (await res.json())?.responsive === true;
			} catch {
				responsive = false;
			}
			if (wedgeWaitToken !== token) return;

			if (responsive) {
				// Recovered on its own — resume with the current live state.
				browserBusyWaiting = false;
				await handleRefreshScreenshot();
				return;
			}
			if (Date.now() - start >= RENDERER_GRACE_MS) {
				// Stayed wedged past the grace window — treat it as a real hard wedge.
				browserBusyWaiting = false;
				browserUnresponsive = true;
				return;
			}
		}
	}

	async function pollScreenshot() {
		if (!session.id || !tabId) return;
		try {
			const response = await fetch(`/api/sessions/${session.id}/refresh`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				// live: read the pushed screencast frame only, never force a capture
				body: JSON.stringify({ tabId, live: true })
			});
			const data = await response.json();
			if (response.status === 503 && data?.code === 'RENDERER_UNRESPONSIVE') {
				// Renderer is wedged — wait it out (many stalls are transient)
				// before escalating to the restart prompt.
				beginWedgeWait();
				return;
			}
			// The server reuses the same path when the screencast frame is unchanged
			// (idle dedupe), so a matching path means nothing to update — skip the
			// version bump and the img re-fetch it would trigger.
			if (data.screenshotPath && data.screenshotPath !== screenshotPath) {
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
		// A fresh action supersedes any trailing wind-down from the previous one,
		// so its scheduled stop can't cut this action's live updates short.
		if (trailingStopTimeout) {
			clearTimeout(trailingStopTimeout);
			trailingStopTimeout = null;
		}

		showLoadingIndicator = true;
		lateUpdateShown = false;

		// Hide indicator after 1 second (polling continues in background)
		// But keep showing if there's a queued action
		if (hideIndicatorTimeout) clearTimeout(hideIndicatorTimeout);
		hideIndicatorTimeout = setTimeout(() => {
			if (pendingAction === null) {
				showLoadingIndicator = false;
			}
		}, 1000);

		if (pollingActive) return; // already looping (e.g. still in the trailing window)
		pollingActive = true;
		pollTick();
	}

	// End-of-action stop that keeps live frames flowing for a short trailing window
	// first, so paints that land just after the server's settle still reach the
	// canvas without a manual refresh. A new action (via startScreenshotPolling)
	// cancels this and takes over.
	function settleScreenshotPolling() {
		if (!pollingActive || trailingStopTimeout) return;
		trailingStopTimeout = setTimeout(() => {
			trailingStopTimeout = null;
			stopScreenshotPolling();
		}, 1500);
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
		if (trailingStopTimeout) {
			clearTimeout(trailingStopTimeout);
			trailingStopTimeout = null;
		}
		showLoadingIndicator = false;
	}

	onMount(() => {
		if (!isCompleted) {
			initializeBrowser();
		}

		// Poll for browser URL changes every 2 seconds
		const pollInterval = setInterval(async () => {
			if (!session.id || !tabId || browserLoading || actionLoading || replayLoading || browserBusyWaiting)
				return;

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

	// Idle auto-refresh loop. While the toggle is on and we're parked on the live
	// view (not previewing, not mid-action), pull the latest pushed screencast
	// frame so in-page changes that don't navigate still reach the canvas. Reads
	// pushed frames only (never forces a capture); the server dedupes unchanged
	// frames so a static page writes nothing and the canvas doesn't flicker. The
	// interval closure reads state lazily, so this effect only re-runs on toggle.
	const AUTO_REFRESH_INTERVAL_MS = 700;
	let autoRefreshInFlight = false;
	$effect(() => {
		if (!autoRefresh) return;
		const interval = setInterval(async () => {
			if (
				autoRefreshInFlight ||
				isCompleted ||
				!session.id ||
				!tabId ||
				previewIndex !== null ||
				pollingActive ||
				browserLoading ||
				actionLoading ||
				replayLoading ||
				browserBusyWaiting ||
				refreshLoading
			)
				return;
			autoRefreshInFlight = true;
			try {
				await pollScreenshot();
			} finally {
				autoRefreshInFlight = false;
			}
		}, AUTO_REFRESH_INTERVAL_MS);
		return () => clearInterval(interval);
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
			// Land the inspector on the restored active step.
			formResyncNonce++;

			// A fresh Chrome with steps already recorded means the previous browser
			// was lost (hard wedge or crash) and we've restarted from the beginning.
			// Surface it so the reset to step 1 isn't a surprise; steps are preserved.
			restartNotice = response.isNew && response.session.actions.length > 0;
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

		// Mark which card is running (for its spinner) but DON'T advance the playhead
		// yet: the inspector follows the playhead, so advancing now would jump the
		// form/overlay to the next step while this one is still submitting.
		runningIndex = index;

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

			// The step ran: now advance the playhead onto it, which rolls the inspector
			// forward to the next step and refreshes the screenshot underneath.
			replayedUpTo = index;
		} catch (e) {
			reportError(e);
		} finally {
			settleScreenshotPolling();
			replayLoading = false;
			runningIndex = null;

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
			// inline=true embeds screenshots as base64 so the file is self-contained
			// and can be re-imported anywhere.
			const response = await apiRequest<{ session: unknown }>(
				`/api/sessions/${session.id}?inline=true`
			);

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

	// Tab operations (switch/new/close) all post to /api/action with the same
	// loading/response/error plumbing — only the action-specific body differs.
	async function runTabAction(body: Record<string, unknown>) {
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
				body: { sessionId: session.id, tabId, ...body }
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

	async function handleSwitchTab(newTabId: string) {
		if (!session.id || !tabId || newTabId === tabId) return;
		await runTabAction({ actionType: 'switchTab', explanation: 'Switch to tab', targetTabId: newTabId });
	}

	async function handleNewTab() {
		if (!session.id || !tabId) return;

		const newUrl = window.prompt('Enter URL for new tab:', 'https://');
		if (!newUrl) return;

		await runTabAction({ actionType: 'newTab', explanation: `Open new tab: ${newUrl}`, targetUrl: newUrl });
	}

	async function handleCloseTab(closeTabId: string) {
		if (!session.id || !tabId) return;

		const openTabs = tabs.filter((t) => !t.closedAt);
		if (openTabs.length <= 1) {
			error = 'Cannot close the last tab';
			return;
		}

		await runTabAction({ actionType: 'closeTab', explanation: 'Close tab', targetTabId: closeTabId });
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

			// The active step is derived from the playhead, but a delete can shift a
			// different action into the same index without moving the playhead — force
			// the inspector to re-sync to whatever is now the active step.
			formResyncNonce++;
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

		// "Go to result" repositions the live browser to where this step ended. The
		// playhead follows (set to `index` below), so the inspector will land on the
		// next step; make sure we're not stuck in an explicit compose.
		composing = false;

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

	// The merged ▶ Run in edit mode: apply the form to the active step, then replay
	// it against the live browser. handleReplayAction advances the playhead onto the
	// step, so the active step becomes the next one and the form-sync effect prefills
	// it — edit mode "moves along" exactly like stepping through.
	async function runActiveStep() {
		if (selectedStep === null || !session.id || !selectedAction || !explanation.trim()) {
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
				`/api/sessions/${session.id}/actions/${selectedStep}`,
				{ method: 'PATCH', body: actionUpdate }
			);

			actions = response.session.actions;
			const startIndex = selectedStep;

			// Replay the edited step; this advances the playhead onto it, so the
			// active step (and the prefilled form) roll forward to the next one.
			await handleReplayAction(startIndex);
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			actionLoading = false;
		}
	}

	function startEditTask() {
		taskDraft = session.prompt;
		editingTask = true;
	}

	function cancelEditTask() {
		editingTask = false;
	}

	async function saveTask() {
		const trimmed = taskDraft.trim();
		if (!trimmed) {
			error = 'Task cannot be empty';
			return;
		}
		if (trimmed === session.prompt) {
			editingTask = false;
			return;
		}

		savingTask = true;
		error = null;

		try {
			const response = await apiRequest<{ session: { prompt: string } }>(
				`/api/sessions/${session.id}`,
				{ method: 'PATCH', body: { prompt: trimmed } }
			);
			session.prompt = response.session.prompt;
			editingTask = false;
		} catch (e) {
			error = getErrorMessage(e);
		} finally {
			savingTask = false;
		}
	}

	function handleClick(x: number, y: number) {
		if (selectedAction === 'click' || selectedAction === 'hover' || selectedAction === 'dismiss') {
			clickCoordinates = { x, y };
		}
	}

	// Dismiss a popup/overlay at the selected coordinates. Clears the obstruction
	// in the live browser so recording can continue; it's not a recorded task step
	// and does NOT move the playhead.
	async function handleDismiss() {
		if (!session.id || !tabId || !clickCoordinates) return;

		actionLoading = true;
		error = null;
		startScreenshotPolling();

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				currentUrl?: string;
				tabId: string;
			}>(`/api/sessions/${session.id}/dismiss`, {
				method: 'POST',
				body: { tabId, coordinates: clickCoordinates }
			});

			screenshotPath = response.screenshotPath;
			currentUrl = response.currentUrl ?? null;

			// Dismiss didn't move the playhead, so drop back onto whatever you were
			// working on: re-sync the inspector to re-prefill the active step (edit
			// state, runnable again) — or empty the form when in add mode.
			formResyncNonce++;
		} catch (e) {
			reportError(e);
		} finally {
			settleScreenshotPolling();
			actionLoading = false;
		}
	}

	// Clicking a filmstrip step pins a read-only preview of its recorded screenshot.
	// It deliberately does NOT touch the playhead or the inspector: the browser can't
	// teleport to a past state, so pretending it's there (and letting ▶ Run fire
	// against the wrong page) was misleading. Click the same step again to unpin.
	function handleSelectStep(index: number) {
		if (!actions[index]) return;
		// The current step (the edit target you're about to run) isn't a preview
		// target — edit mode already shows it. Clicking it just clears any pinned
		// preview and returns you to the current view. Every other step — finished or
		// upcoming — previews read-only on the canvas.
		if (index === selectedStep) {
			previewIndex = null;
			return;
		}
		previewIndex = previewIndex === index ? null : index;
	}

	// Any genuine movement of the browser position returns the canvas to live. run,
	// replay, sync, insert, restart and reconnect all set replayedUpTo, so watching
	// it clears a stale preview without instrumenting each handler.
	let previewAnchor = $state(-1);
	$effect(() => {
		const pos = replayedUpTo;
		if (pos !== previewAnchor) {
			previewAnchor = pos;
			previewIndex = null;
		}
	});

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
		clearActionForm();

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

		// The insertion point is the cursor: just after the playhead. Computed here
		// (not when the form was submitted) so a queued add lands after the one
		// before it — each successful add advances replayedUpTo, so the next queued
		// add reads the updated cursor. At/past the end this is an append.
		const insertIndex = replayedUpTo + 1;

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
				body: { ...params, insertIndex }
			});

			screenshotPath = response.screenshotPath;
			currentUrl = response.currentUrl ?? null;
			actions = response.session.actions;
			isCompleted = response.completed;
			tabId = response.tabId;
			if (response.session.tabs) {
				tabs = response.session.tabs;
			}

			// The browser is now at the state after this just-recorded action, which
			// now lives at insertIndex. Advance the playhead onto it and leave compose
			// mode, so the inspector rolls to the next step (mid-insert) or stays in
			// add mode at the frontier (append). For an append insertIndex is the last
			// index; for a mid-list insert the shifted-down steps are still ahead.
			composing = false;
			replayedUpTo = insertIndex;

			// Clear the compose form. If the active step is now an existing one
			// (mid-insert), the form-sync effect immediately refills it with that step.
			clearActionForm();
		} catch (e) {
			reportError(e);
		} finally {
			settleScreenshotPolling();
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

	// The active step is the next-playable one — the step the browser sits right
	// before — so the inspector edits it by default. Past the end (or while
	// explicitly composing) there's no step to edit: add mode.
	let selectedStep = $derived(
		!composing && replayedUpTo + 1 < actions.length ? replayedUpTo + 1 : null
	);
	let isEditMode = $derived(selectedStep !== null);
	let isAddMode = $derived(selectedStep === null);

	// An explicit insert (via a "+" seam) sitting in front of an existing step can be
	// cancelled back to editing that step. Appending past the end has nothing to undo.
	let canCancelInsert = $derived(composing && replayedUpTo + 1 < actions.length);

	// Insert a brand-new step in front of the active (about-to-run) step. The playhead
	// stays put — the browser is already sitting there — we just switch from editing
	// that existing step to composing a new one at the same spot. The step you were on
	// shifts down one, and you return to it after running the new one. Only meaningful
	// in edit mode; at the end of history you're already composing the last step.
	function addStepHere() {
		composing = true;
		formResyncNonce++; // reset the compose form to empty
		error = null;
	}

	// Leave an explicit insert and return to editing the active step.
	function cancelInsert() {
		composing = false;
		formResyncNonce++;
	}

	// Reset the inspector form to empty (add mode / after a submit).
	function clearActionForm() {
		selectedAction = null;
		explanation = '';
		clickCoordinates = null;
		typeText = '';
		scrollDirection = 'down';
	}

	// Prefill the inspector form from a recorded action (edit mode).
	function prefillForm(action: Action) {
		clickCoordinates = null;
		typeText = '';
		scrollDirection = 'down';
		const supported = ['click', 'hover', 'scroll', 'type', 'stop'] as const;
		selectedAction = supported.includes(action.type as (typeof supported)[number])
			? (action.type as (typeof supported)[number])
			: null;
		explanation = action.explanation;
		if ((action.type === 'click' || action.type === 'hover') && action.coordinates) {
			clickCoordinates = action.coordinates;
		} else if (action.type === 'scroll' && action.direction) {
			scrollDirection = action.direction;
		} else if (action.type === 'type' && action.text) {
			typeText = action.text;
		}
	}

	// Keep the inspector form in lockstep with the active step: prefill it in edit
	// mode, empty it in add mode. Keyed on the active step (+ a resync nonce) so it
	// fires only when the target actually changes — an in-progress compose or a
	// screenshot refresh never clobbers what you've typed.
	let lastFormKey = $state('');
	$effect(() => {
		const key = `${selectedStep === null ? 'add' : selectedStep}:${formResyncNonce}`;
		if (key === lastFormKey) return;
		lastFormKey = key;
		if (selectedStep === null) {
			clearActionForm();
		} else {
			const action = actions[selectedStep];
			if (action) prefillForm(action);
		}
	});

	// Deliberately restart the browser from the first step. Tears down the live
	// Chrome and relaunches it clean at the session's start URL, resetting the
	// current step to the beginning. Recorded steps are kept — this only discards
	// the live browser and playhead so the session can be re-walked from the top.
	async function handleRestart() {
		if (!session.id || browserLoading || actionLoading || replayLoading) return;
		if (
			!confirm(
				'Restart the browser from the first step?\n\nYour recorded steps are kept — only the live browser and the current position reset.'
			)
		) {
			return;
		}

		browserLoading = true;
		error = null;
		stopScreenshotPolling();

		try {
			const response = await apiRequest<{
				screenshotPath: string;
				viewport: { width: number; height: number };
				tabId: string;
				tabs?: Tab[];
				currentUrl?: string;
				replayPosition: number;
			}>(`/api/sessions/${session.id}/restart`, { method: 'POST' });

			tabId = response.tabId;
			tabs = response.tabs ?? tabs;
			screenshotPath = response.screenshotPath;
			screenshotVersion = Date.now();
			viewport = response.viewport;
			currentUrl = response.currentUrl ?? null;
			replayedUpTo = -1;

			// Deliberate restart, not the involuntary "browser was lost" case, so
			// clear the wedge prompt, the recovery banner, and any in-flight wait.
			wedgeWaitToken++;
			browserBusyWaiting = false;
			browserUnresponsive = false;
			restartNotice = false;

			// Clear transient action/edit state so the reset is clean. The playhead
			// reset to -1 above puts the inspector on the first step (or add mode when
			// empty); the form-sync effect refills the form, so just nudge it.
			composing = false;
			formResyncNonce++;
			pendingAction = null;
			pendingActionPreview = null;
			queuedReplayIndex = null;
		} catch (e) {
			reportError(e);
		} finally {
			browserLoading = false;
		}
	}

	let canExecute = $derived(
		selectedAction !== null &&
			explanation.trim() !== '' &&
			((selectedAction !== 'click' && selectedAction !== 'hover') || clickCoordinates !== null) &&
			(selectedAction !== 'type' || typeText.trim() !== '')
	);

	// Dismiss only needs a target point — explanation is optional (it's not a step).
	let canDismiss = $derived(selectedAction === 'dismiss' && clickCoordinates !== null);

	// Where an added step will land (the cursor), for the add-mode header.
	let insertPosition = $derived(replayedUpTo + 1);
	let insertLabel = $derived(
		insertPosition >= actions.length ? 'at the end' : `before step #${insertPosition}`
	);

	// Only disable buttons if there's already a pending action queued (allow one queue)
	let isLoading = $derived(actionLoading || tabLoading || pendingAction !== null);

	// The pinned step being previewed, if any (guarded against a stale index after a
	// delete). Drives a read-only view; null means we're showing the live browser.
	let previewAction = $derived(previewIndex !== null ? actions[previewIndex] ?? null : null);

	// Normally edit against the live browser: the coordinates you place must land on
	// the same screenshot the action will run against (replaySingleAction executes
	// against current browser state, not a recorded snapshot). While a step is pinned
	// for preview we instead show that step's stored screenshot — read-only, canvas
	// clicking disabled — so it never gets confused with what ▶ Run targets.
	let displayScreenshot = $derived(previewAction ? previewAction.screenshotPath : screenshotPath);

	// Effective hoverInfo: a pinned preview shows that step's own recorded marker;
	// otherwise show current editing state when editing, else the history hover.
	let effectiveHoverInfo = $derived.by((): HoverInfo => {
		if (previewAction) return actionToHoverInfo(previewAction);
		// When editing a click/hover action with coordinates, show those
		if ((selectedAction === 'click' || selectedAction === 'hover') && clickCoordinates) {
			return { type: selectedAction, coordinates: clickCoordinates };
		}
		// Dismiss: reuse the click marker so the target point is visible.
		if (selectedAction === 'dismiss' && clickCoordinates) {
			return { type: 'click', coordinates: clickCoordinates };
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

<svelte:head>
	<title>{session.prompt} · Web Annotator</title>
</svelte:head>

<main>
	<div class="page-header">
		<button class="back-btn" onclick={goHome}>&larr;</button>
		<span class="page-title">Web Annotator</span>
	</div>

	{#if error}
		<div class="error">{error}</div>
	{/if}

	{#if restartNotice}
		<div class="restart-notice">
			<span>
				The browser session was lost, so it restarted from the beginning. Your
				recorded steps are preserved — the current step is back at the start.
			</span>
			<button
				class="restart-notice-dismiss"
				onclick={() => (restartNotice = false)}
				aria-label="Dismiss"
			>×</button>
		</div>
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
				{#if editingTask}
					<div class="task-edit">
						<label for="task-edit-input"><strong>Task:</strong></label>
						<textarea
							id="task-edit-input"
							value={taskDraft}
							oninput={(e) => (taskDraft = e.currentTarget.value)}
							rows="3"
							disabled={savingTask}
						></textarea>
						<div class="task-edit-actions">
							<button
								class="task-save-btn"
								onclick={saveTask}
								disabled={savingTask || !taskDraft.trim()}
							>
								{savingTask ? 'Saving…' : 'Save'}
							</button>
							<button class="task-cancel-btn" onclick={cancelEditTask} disabled={savingTask}>
								Cancel
							</button>
						</div>
					</div>
				{:else}
					<p class="task-line">
						<span><strong>Task:</strong> {session.prompt}</span>
						<button class="task-edit-btn" onclick={startEditTask}>Edit</button>
					</p>
				{/if}
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

			<div class="main-content">
				<div class="screenshot-section">
					{#if browserBusyWaiting}
						<div class="screenshot-placeholder">
							<div class="unresponsive-content">
								<span class="spinner"></span>
								<p class="unresponsive-title">Page is busy</p>
								<p class="unresponsive-text">
									Waiting for it to respond… ({busyWaitElapsed}s). Heavy pages sometimes
									stall for a few seconds and recover on their own.
								</p>
								<button class="reload-btn" onclick={recoverBrowser}>Restart now</button>
							</div>
						</div>
					{:else if browserUnresponsive}
						<div class="screenshot-placeholder">
							<div class="unresponsive-content">
								<p class="unresponsive-title">Browser stopped responding</p>
								<p class="unresponsive-text">
									The page froze and can't be used. Restarting relaunches the browser back at the first step — your recorded steps are kept.
								</p>
								<button class="reload-btn" onclick={recoverBrowser}>Restart from the beginning</button>
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
						<div class="screenshot-wrapper" class:action-running={showLoadingIndicator}>
							<svelte:boundary onerror={(e) => error = `Screenshot error: ${getErrorMessage(e)}`}>
								<ScreenshotViewer
									src={versionedSrc(displayScreenshot)}
									{viewport}
									onclick={handleClick}
									clickEnabled={previewIndex === null &&
										(selectedAction === 'click' ||
											selectedAction === 'hover' ||
											selectedAction === 'dismiss')}
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
						<!-- Contextual to the canvas, so it stays next to it: readouts plus
						     Refresh (which acts on the live screenshot). Session-global
						     actions live in .action-bar below the filmstrip. -->
						<div class="screenshot-toolbar">
							{#if previewIndex !== null}
								<span class="preview-badge" title="Read-only preview of a recorded step — the live browser is unchanged">
									Previewing step #{previewIndex} (read-only)
								</span>
								<button class="back-to-live-btn" onclick={() => (previewIndex = null)}>
									Back to live
								</button>
							{:else if actions.length > 0}
								<span class="position-readout" title="Playhead position">
									Step {replayedUpTo + 1} / {actions.length}
								</span>
							{/if}
							{#if clickCoordinates && (selectedAction === 'click' || selectedAction === 'hover' || selectedAction === 'dismiss')}
								<span class="coordinates">Selected: ({clickCoordinates.x}, {clickCoordinates.y})</span>
							{/if}
							{#if previewIndex === null}
								<button
									class="toolbar-btn refresh-btn"
									onclick={handleRefreshScreenshot}
									disabled={refreshLoading}
									title="Refresh screenshot"
								>
									{refreshLoading ? '...' : '↻'} Refresh
								</button>
								<button
									class="toolbar-btn autorefresh-btn"
									class:active={autoRefresh}
									onclick={() => (autoRefresh = !autoRefresh)}
									aria-pressed={autoRefresh}
									title={autoRefresh
										? 'Auto-refresh on — the live view updates on its own'
										: 'Auto-refresh off — keep the live view updating automatically'}
								>
									{autoRefresh ? '◉' : '○'} Auto
								</button>
							{/if}
						</div>
					{:else}
						<div class="screenshot-placeholder">
							<p>No screenshot available</p>
						</div>
					{/if}
				</div>
				{#if actions.length > 0 || screenshotPath}
					<div class="history-section">
						<svelte:boundary onerror={(e) => error = `History error: ${getErrorMessage(e)}`}>
							<SessionHistory
								{actions}
								{viewport}
								currentScreenshot={screenshotPath}
								{currentUrl}
								{replayedUpTo}
								loadingIndex={runningIndex}
								queuedIndex={queuedReplayIndex}
								onDelete={handleDeleteAction}
								{deletingIndex}
								onHoverAction={(info) => (hoverInfo = info)}
								selectedIndex={selectedStep}
								{previewIndex}
								onSelect={handleSelectStep}
								{pendingActionPreview}
								{screenshotVersion}
							/>
							{#snippet failed()}
								<div class="error">Failed to render session history. Please refresh the page.</div>
							{/snippet}
						</svelte:boundary>
					</div>
				{/if}

				{#if displayScreenshot}
					<!-- Session-global actions, below the filmstrip so the screenshot and its
					     history sit back-to-back. -->
					<div class="action-bar">
						<div class="toolbar-buttons">
							<button
								class="toolbar-btn"
								onclick={handleExportSession}
								title="Export session as JSON"
							>
								↓ Export
							</button>
							<button
								class="toolbar-btn restart-btn"
								onclick={handleRestart}
								disabled={browserLoading || actionLoading || replayLoading}
								title="Restart the browser from the first step (recorded steps are kept)"
							>
								↺ Restart
							</button>
						</div>
					</div>
				{/if}

				<div class="controls-section">
					{#if browserLoading}
						<div class="controls-placeholder">
							<p>Waiting for browser...</p>
						</div>
					{:else}
						<div class="inspector-header" class:editing={isEditMode}>
							<div class="inspector-head-left">
								<span class="inspector-title">
									<span
										class="inspector-dot"
										class:editing={isEditMode}
										class:adding={isAddMode}
									></span>
									{#if isEditMode}
										Editing step #{selectedStep} of {actions.length}
									{:else}
										Add step
									{/if}
								</span>
								{#if isAddMode}
									<span class="inspector-sub">inserts {insertLabel}</span>
								{/if}
							</div>
							{#if canCancelInsert}
								<button class="inspector-cancel" onclick={cancelInsert}>Cancel insert</button>
							{/if}
						</div>

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
							disabled={isLoading}
						/>

						<ExplanationInput
							value={explanation}
							oninput={(v) => (explanation = v)}
							disabled={isLoading || selectedAction === 'dismiss'}
							label={selectedAction === 'stop' ? 'Final Answer' : 'Explanation'}
							placeholder={selectedAction === 'dismiss'
								? 'Not needed — dismissing a popup is not recorded as a step'
								: selectedAction === 'stop'
									? 'Provide the final answer to the task...'
									: 'Explain why you are taking this action...'}
						/>

						{#if selectedAction === 'dismiss'}
							<button class="dismiss-btn" onclick={handleDismiss} disabled={isLoading || !canDismiss}>
								{isLoading ? 'Dismissing...' : 'Dismiss popup'}
							</button>
						{:else if isEditMode && selectedStep !== null}
							{@const idx = selectedStep}
							{@const step = actions[idx]}
							<button class="run-btn" onclick={runActiveStep} disabled={isLoading || !canExecute}>
								{isLoading ? 'Running…' : `▶ Run step #${idx}`}
							</button>
							<button
								class="add-step-btn"
								onclick={addStepHere}
								disabled={isLoading}
								title="Insert a new step at the current browser position, before step #{idx}"
							>
								＋ Add a step here
							</button>
							<div class="inspector-actions">
								{#if step && step.afterUrl && step.afterUrl !== step.url}
									{@const resultUrl = step.afterUrl}
									<button
										class="inspector-secondary-btn"
										onclick={() => handleNavigateTo(idx, resultUrl)}
										disabled={navigatingIndex !== null}
										title="Move the live browser to where this step ended"
									>
										{navigatingIndex === idx ? 'Going…' : '↗ Go to result'}
									</button>
								{/if}
								<button
									class="inspector-danger-btn"
									onclick={() => handleDeleteAction(idx)}
									disabled={deletingIndex !== null}
									title="Delete this step"
								>
									{deletingIndex === idx ? 'Deleting…' : '× Delete step'}
								</button>
							</div>
						{:else}
							<button class="run-btn" onclick={executeAction} disabled={isLoading || !canExecute}>
								{isLoading ? 'Running…' : '▶ Run new step'}
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

	.restart-notice {
		display: flex;
		align-items: flex-start;
		gap: var(--space-md);
		background: var(--color-warning-bg, #fef3c7);
		color: var(--color-warning-text, #92400e);
		border: 1px solid var(--color-warning, #f59e0b);
		padding: var(--space-md) var(--space-lg);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-lg);
		font-size: 0.9rem;
	}

	.restart-notice-dismiss {
		margin-left: auto;
		flex-shrink: 0;
		background: transparent;
		border: none;
		color: inherit;
		font-size: 1.25rem;
		line-height: 1;
		padding: 0 var(--space-xs);
		cursor: pointer;
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

	.task-line {
		display: flex;
		align-items: baseline;
		gap: var(--space-sm);
	}

	.task-edit-btn {
		padding: var(--space-xs) var(--space-sm);
		font-size: 0.8rem;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.task-edit-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
	}

	.task-edit {
		display: flex;
		flex-direction: column;
		gap: var(--space-sm);
		margin: var(--space-xs) 0;
	}

	.task-edit textarea {
		width: 100%;
		padding: var(--space-md);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 1rem;
		font-family: inherit;
		box-sizing: border-box;
		resize: vertical;
	}

	.task-edit textarea:focus {
		outline: none;
		border-color: var(--color-primary);
	}

	.task-edit-actions {
		display: flex;
		gap: var(--space-sm);
	}

	.task-save-btn,
	.task-cancel-btn {
		padding: var(--space-sm) var(--space-lg);
		font-size: 0.9rem;
	}

	.task-cancel-btn {
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.task-cancel-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
	}

	.main-content {
		display: grid;
		grid-template-columns: 1fr 350px;
		grid-template-rows: auto auto auto;
		grid-template-areas:
			'screenshot controls'
			'history controls'
			'actionbar controls';
		align-items: start;
		column-gap: var(--space-2xl);
		row-gap: var(--space-lg);
	}

	.screenshot-section {
		grid-area: screenshot;
		/* min-width:0 lets the history's horizontal scroll stay inside this column
		   instead of stretching the grid track. */
		min-width: 0;
		overflow: auto;
	}

	.screenshot-wrapper {
		position: relative;
		display: inline-block;
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

	/* Readouts strip directly under the canvas: playhead position + selected
	   coordinates. Contextual to the screenshot, so it stays adjacent to it. */
	.screenshot-toolbar {
		margin-top: var(--space-sm);
		display: flex;
		align-items: center;
		gap: var(--space-md);
		min-height: 1.5rem;
	}

	/* Refresh acts on the live screenshot, so it lives in this strip — pushed to
	   the right edge, clear of the readouts. */
	.screenshot-toolbar .refresh-btn {
		margin-left: auto;
	}

	/* Auto-refresh toggle sits next to Refresh; highlight it while active. */
	.screenshot-toolbar .autorefresh-btn.active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-bg-white);
	}

	/* Session-global action bar, below the history filmstrip. */
	.action-bar {
		grid-area: actionbar;
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		padding-top: var(--space-lg);
		border-top: 1px solid var(--color-border-light);
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

	/* Warning tint ties Restart to the "reset to step 1" recovery banner. */
	.toolbar-btn.restart-btn {
		color: var(--color-warning-text, #92400e);
		border-color: var(--color-warning, #f59e0b);
	}

	.toolbar-btn.restart-btn:hover:not(:disabled) {
		background: var(--color-warning-bg, #fef3c7);
		border-color: var(--color-warning, #f59e0b);
	}

	.coordinates {
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.position-readout {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.preview-badge {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-purple-text, var(--color-purple));
		background: var(--color-purple-bg, var(--color-purple-border));
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		white-space: nowrap;
	}

	.back-to-live-btn {
		font-size: 0.8rem;
		padding: 0.15rem 0.6rem;
		background: var(--color-bg-white);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.back-to-live-btn:hover {
		background: var(--color-bg-tertiary);
		border-color: var(--color-border-hover);
	}

	.controls-section {
		grid-area: controls;
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}

	/* Inspector header: names the mode (Add vs Edit) and, in add mode, the spot the
	   new step will land. Ties the right pane to the timeline's cursor. */
	.inspector-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
		background: var(--color-bg-tertiary);
		border-left: 3px solid var(--color-success);
	}

	.inspector-header.editing {
		border-left-color: var(--color-purple);
		background: var(--color-purple-light, var(--color-bg-tertiary));
	}

	.inspector-head-left {
		display: flex;
		align-items: baseline;
		gap: var(--space-sm);
		min-width: 0;
	}

	.inspector-title {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		font-weight: 600;
		font-size: 0.95rem;
		color: var(--color-text-secondary);
	}

	.inspector-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.inspector-dot.adding {
		background: var(--color-success);
	}

	.inspector-dot.editing {
		background: var(--color-purple);
	}

	.inspector-sub {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.inspector-cancel {
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
		background: var(--color-bg-white);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.inspector-cancel:hover {
		background: var(--color-bg-secondary);
	}

	.inspector-actions {
		display: flex;
		gap: var(--space-sm);
	}

	.inspector-secondary-btn,
	.inspector-danger-btn {
		flex: 1;
		padding: var(--space-sm) var(--space-md);
		font-size: 0.9rem;
		font-weight: 500;
		border-radius: var(--radius-md);
		cursor: pointer;
	}

	.inspector-secondary-btn {
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.inspector-secondary-btn:hover:not(:disabled) {
		background: var(--color-bg-secondary);
	}

	.inspector-danger-btn {
		background: var(--color-bg-tertiary);
		color: var(--color-danger, #ef4444);
		border: 1px solid var(--color-danger, #ef4444);
	}

	.inspector-danger-btn:hover:not(:disabled) {
		background: var(--color-danger, #ef4444);
		color: white;
	}

	.inspector-secondary-btn:disabled,
	.inspector-danger-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.controls-placeholder {
		padding: var(--space-2xl);
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-lg);
		text-align: center;
		color: var(--color-text-muted);
	}

	/* The merged primary action — runs the active step (edit mode) or the composed
	   new step (add mode) and advances the playhead. */
	.run-btn {
		width: 100%;
		padding: var(--space-lg);
		font-size: 1.1rem;
		font-weight: 600;
	}

	/* Secondary "compose a new step here" affordance — dashed so it reads as an
	   alternative to running the existing step, not the primary action. */
	.add-step-btn {
		width: 100%;
		margin-top: var(--space-sm);
		padding: var(--space-sm);
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		background: transparent;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}

	.add-step-btn:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
		background: var(--color-primary-light);
	}

	.add-step-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dismiss-btn {
		width: 100%;
		padding: var(--space-lg);
		font-size: 1.1rem;
		font-weight: 600;
		background: var(--color-warning, #f59e0b);
		color: white;
	}

	.dismiss-btn:hover:not(:disabled) {
		background: var(--color-warning-hover, #d97706);
	}

	/* Now a "filmstrip" under the screenshot (bottom-left of the grid). min-width:0
	   keeps its horizontal scroll inside the column; the top border separates it
	   from the canvas above. */
	.history-section {
		grid-area: history;
		min-width: 0;
		padding-top: var(--space-sm);
		border-top: 1px solid var(--color-border-light);
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
