import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	executeClick,
	executeScroll,
	executeType,
	executeWait,
	getCurrentUrl,
	createTab,
	switchTab,
	closeTab,
	refreshScreenshot,
	type ActionResult
} from '$lib/server/browser';
import { addAction, getSession, addTab, setActiveTab, closeTabInSession } from '$lib/server/storage';
import { badRequest, notFound, errorResponse, getServerErrorMessage } from '$lib/server/api-utils';
import type { Action, Tab } from '$lib/types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { sessionId, tabId, actionType, explanation, coordinates, direction, text, targetUrl, targetTabId } = body;

	if (!sessionId || !actionType || !explanation) {
		return badRequest('sessionId, actionType, and explanation are required');
	}

	if (!tabId && !['newTab'].includes(actionType)) {
		return badRequest('tabId is required for this action type');
	}

	const session = await getSession(sessionId);
	if (!session) {
		return notFound('Session not found');
	}

	// Screenshot index: 0 is initial, so actions start at 1
	const screenshotIndex = session.actions.length + 1;

	try {
		let actionResult: ActionResult | null = null;
		let screenshotPath!: string; // BEFORE screenshot for action record
		let currentScreenshot!: string; // AFTER screenshot for UI
		let url!: string; // BEFORE URL for action record
		let currentUrl!: string; // AFTER URL for UI
		let newTabId: string | undefined;
		let currentTabId = tabId;

		if (actionType === 'click') {
			if (!coordinates?.x || !coordinates?.y) {
				return badRequest('Coordinates required for click action');
			}
			actionResult = await executeClick(tabId, coordinates.x, coordinates.y, sessionId, screenshotIndex);
		} else if (actionType === 'scroll') {
			if (!direction) {
				return badRequest('Direction required for scroll action');
			}
			actionResult = await executeScroll(tabId, direction, sessionId, screenshotIndex);
		} else if (actionType === 'type') {
			if (!text) {
				return badRequest('Text required for type action');
			}
			actionResult = await executeType(tabId, text, sessionId, screenshotIndex);
		} else if (actionType === 'wait') {
			actionResult = await executeWait(tabId, sessionId, screenshotIndex);
		} else if (actionType === 'stop') {
			// Stop uses the previous action's after screenshot as its before state
			const lastAction = session.actions[session.actions.length - 1];
			screenshotPath = lastAction?.screenshotPath ?? session.initialScreenshot;
			currentScreenshot = screenshotPath;
			url = lastAction?.url ?? session.url;
			currentUrl = url;
		} else if (actionType === 'newTab') {
			const result = await createTab(targetUrl);
			newTabId = result.tabId;
			currentTabId = newTabId;
			const newTab: Tab = {
				id: newTabId,
				url: result.url,
				createdAt: new Date().toISOString()
			};
			await addTab(sessionId, newTab);
			// For newTab, the before state is the previous tab's state
			const lastAction = session.actions[session.actions.length - 1];
			screenshotPath = lastAction?.screenshotPath ?? session.initialScreenshot;
			url = lastAction?.url ?? session.url;
			currentScreenshot = await refreshScreenshot(newTabId, sessionId);
			currentUrl = getCurrentUrl(newTabId);
		} else if (actionType === 'switchTab') {
			if (!targetTabId) {
				return badRequest('targetTabId required for switchTab action');
			}
			// Capture before state from current tab
			screenshotPath = await refreshScreenshot(tabId, sessionId);
			url = getCurrentUrl(tabId);
			switchTab(targetTabId);
			await setActiveTab(sessionId, targetTabId);
			currentTabId = targetTabId;
			currentScreenshot = await refreshScreenshot(targetTabId, sessionId);
			currentUrl = getCurrentUrl(targetTabId);
		} else if (actionType === 'closeTab') {
			if (!targetTabId) {
				return badRequest('targetTabId required for closeTab action');
			}
			// Capture before state from tab being closed
			screenshotPath = await refreshScreenshot(targetTabId, sessionId);
			url = getCurrentUrl(targetTabId);
			await closeTab(targetTabId);
			const updatedSession = await closeTabInSession(sessionId, targetTabId);
			currentTabId = updatedSession?.activeTabId ?? tabId;
			// Screenshot the new active tab
			if (currentTabId) {
				currentScreenshot = await refreshScreenshot(currentTabId, sessionId);
				currentUrl = getCurrentUrl(currentTabId);
			} else {
				// No tabs left
				currentScreenshot = screenshotPath;
				currentUrl = url;
			}
		} else {
			return badRequest('Invalid action type');
		}

		// For actions with ActionResult, extract before/after values
		if (actionResult) {
			screenshotPath = actionResult.beforeScreenshot;
			currentScreenshot = actionResult.afterScreenshot;
			url = actionResult.beforeUrl;
			currentUrl = actionResult.afterUrl;
		}

		const action: Action = {
			type: actionType,
			tabId: currentTabId || tabId,
			explanation,
			timestamp: new Date().toISOString(),
			screenshotPath,
			url,
			...(actionType === 'click' && { coordinates }),
			...(actionType === 'scroll' && { direction }),
			...(actionType === 'type' && { text }),
			...(actionType === 'newTab' && { targetUrl, targetTabId: newTabId }),
			...(actionType === 'switchTab' && { targetTabId }),
			...(actionType === 'closeTab' && { targetTabId })
		};

		const updatedSession = await addAction(sessionId, action);

		return json({
			session: updatedSession,
			screenshotPath: currentScreenshot, // Return AFTER screenshot for UI
			currentUrl, // Return AFTER URL for UI
			completed: actionType === 'stop',
			tabId: currentTabId,
			newTabId
		});
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to execute action'));
	}
};
