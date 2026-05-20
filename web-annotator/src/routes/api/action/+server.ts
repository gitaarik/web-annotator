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
	refreshScreenshot
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
		let screenshotPath: string;
		let newTabId: string | undefined;
		let currentTabId = tabId;

		if (actionType === 'click') {
			if (!coordinates?.x || !coordinates?.y) {
				return badRequest('Coordinates required for click action');
			}
			screenshotPath = await executeClick(tabId, coordinates.x, coordinates.y, sessionId, screenshotIndex);
		} else if (actionType === 'scroll') {
			if (!direction) {
				return badRequest('Direction required for scroll action');
			}
			screenshotPath = await executeScroll(tabId, direction, sessionId, screenshotIndex);
		} else if (actionType === 'type') {
			if (!text) {
				return badRequest('Text required for type action');
			}
			screenshotPath = await executeType(tabId, text, sessionId, screenshotIndex);
		} else if (actionType === 'wait') {
			screenshotPath = await executeWait(tabId, sessionId, screenshotIndex);
		} else if (actionType === 'stop') {
			const lastAction = session.actions[session.actions.length - 1];
			screenshotPath = lastAction?.screenshotPath ?? session.initialScreenshot;
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
			screenshotPath = await refreshScreenshot(newTabId, sessionId);
		} else if (actionType === 'switchTab') {
			if (!targetTabId) {
				return badRequest('targetTabId required for switchTab action');
			}
			switchTab(targetTabId);
			await setActiveTab(sessionId, targetTabId);
			currentTabId = targetTabId;
			screenshotPath = await refreshScreenshot(targetTabId, sessionId);
		} else if (actionType === 'closeTab') {
			if (!targetTabId) {
				return badRequest('targetTabId required for closeTab action');
			}
			await closeTab(targetTabId);
			const updatedSession = await closeTabInSession(sessionId, targetTabId);
			currentTabId = updatedSession?.activeTabId ?? tabId;
			// Screenshot the new active tab
			if (currentTabId) {
				screenshotPath = await refreshScreenshot(currentTabId, sessionId);
			} else {
				// No tabs left
				const lastAction = session.actions[session.actions.length - 1];
				screenshotPath = lastAction?.screenshotPath ?? session.initialScreenshot;
			}
		} else {
			return badRequest('Invalid action type');
		}

		const url = currentTabId ? getCurrentUrl(currentTabId) : '';

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
			screenshotPath,
			completed: actionType === 'stop',
			tabId: currentTabId,
			newTabId
		});
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to execute action'));
	}
};
