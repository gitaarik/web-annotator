import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	executeClick,
	executeHover,
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
import type { Action, AnnotationSession, Tab } from '$lib/types';

interface ActionContext {
	tabId: string;
	sessionId: string;
	screenshotIndex: number;
	session: AnnotationSession;
	coordinates?: { x: number; y: number };
	direction?: 'up' | 'down';
	text?: string;
	targetUrl?: string;
	targetTabId?: string;
}

interface ActionHandlerResult {
	actionResult?: ActionResult;
	screenshotPath: string;
	currentScreenshot: string;
	url: string;
	currentUrl: string;
	newTabId?: string;
	currentTabId: string;
}

type ActionHandler = (ctx: ActionContext) => Promise<ActionHandlerResult | Response>;

const actionHandlers: Record<string, ActionHandler> = {
	async click(ctx) {
		if (!ctx.coordinates?.x || !ctx.coordinates?.y) {
			return badRequest('Coordinates required for click action');
		}
		const actionResult = await executeClick(
			ctx.tabId,
			ctx.coordinates.x,
			ctx.coordinates.y,
			ctx.sessionId,
			ctx.screenshotIndex
		);
		return {
			actionResult,
			screenshotPath: actionResult.beforeScreenshot,
			currentScreenshot: actionResult.afterScreenshot,
			url: actionResult.beforeUrl,
			currentUrl: actionResult.afterUrl,
			currentTabId: ctx.tabId
		};
	},

	async hover(ctx) {
		if (!ctx.coordinates?.x || !ctx.coordinates?.y) {
			return badRequest('Coordinates required for hover action');
		}
		const actionResult = await executeHover(
			ctx.tabId,
			ctx.coordinates.x,
			ctx.coordinates.y,
			ctx.sessionId,
			ctx.screenshotIndex
		);
		return {
			actionResult,
			screenshotPath: actionResult.beforeScreenshot,
			currentScreenshot: actionResult.afterScreenshot,
			url: actionResult.beforeUrl,
			currentUrl: actionResult.afterUrl,
			currentTabId: ctx.tabId
		};
	},

	async scroll(ctx) {
		if (!ctx.direction) {
			return badRequest('Direction required for scroll action');
		}
		const actionResult = await executeScroll(
			ctx.tabId,
			ctx.direction,
			ctx.sessionId,
			ctx.screenshotIndex
		);
		return {
			actionResult,
			screenshotPath: actionResult.beforeScreenshot,
			currentScreenshot: actionResult.afterScreenshot,
			url: actionResult.beforeUrl,
			currentUrl: actionResult.afterUrl,
			currentTabId: ctx.tabId
		};
	},

	async type(ctx) {
		if (!ctx.text) {
			return badRequest('Text required for type action');
		}
		const actionResult = await executeType(ctx.tabId, ctx.text, ctx.sessionId, ctx.screenshotIndex);
		return {
			actionResult,
			screenshotPath: actionResult.beforeScreenshot,
			currentScreenshot: actionResult.afterScreenshot,
			url: actionResult.beforeUrl,
			currentUrl: actionResult.afterUrl,
			currentTabId: ctx.tabId
		};
	},

	async wait(ctx) {
		const actionResult = await executeWait(ctx.tabId, ctx.sessionId, ctx.screenshotIndex);
		return {
			actionResult,
			screenshotPath: actionResult.beforeScreenshot,
			currentScreenshot: actionResult.afterScreenshot,
			url: actionResult.beforeUrl,
			currentUrl: actionResult.afterUrl,
			currentTabId: ctx.tabId
		};
	},

	async stop(ctx) {
		const lastAction = ctx.session.actions[ctx.session.actions.length - 1];
		const screenshotPath = lastAction?.screenshotPath ?? ctx.session.initialScreenshot;
		const url = lastAction?.url ?? ctx.session.url;
		return {
			screenshotPath,
			currentScreenshot: screenshotPath,
			url,
			currentUrl: url,
			currentTabId: ctx.tabId
		};
	},

	async newTab(ctx) {
		const result = await createTab(ctx.targetUrl);
		const newTabId = result.tabId;
		const newTab: Tab = {
			id: newTabId,
			url: result.url,
			createdAt: new Date().toISOString()
		};
		await addTab(ctx.sessionId, newTab);

		const lastAction = ctx.session.actions[ctx.session.actions.length - 1];
		return {
			screenshotPath: lastAction?.screenshotPath ?? ctx.session.initialScreenshot,
			currentScreenshot: await refreshScreenshot(newTabId, ctx.sessionId),
			url: lastAction?.url ?? ctx.session.url,
			currentUrl: await getCurrentUrl(newTabId),
			newTabId,
			currentTabId: newTabId
		};
	},

	async switchTab(ctx) {
		if (!ctx.targetTabId) {
			return badRequest('targetTabId required for switchTab action');
		}
		const screenshotPath = await refreshScreenshot(ctx.tabId, ctx.sessionId);
		const url = await getCurrentUrl(ctx.tabId);
		switchTab(ctx.targetTabId);
		await setActiveTab(ctx.sessionId, ctx.targetTabId);
		return {
			screenshotPath,
			currentScreenshot: await refreshScreenshot(ctx.targetTabId, ctx.sessionId),
			url,
			currentUrl: await getCurrentUrl(ctx.targetTabId),
			currentTabId: ctx.targetTabId
		};
	},

	async closeTab(ctx) {
		if (!ctx.targetTabId) {
			return badRequest('targetTabId required for closeTab action');
		}
		const screenshotPath = await refreshScreenshot(ctx.targetTabId, ctx.sessionId);
		const url = await getCurrentUrl(ctx.targetTabId);
		await closeTab(ctx.targetTabId);
		const updatedSession = await closeTabInSession(ctx.sessionId, ctx.targetTabId);
		const currentTabId = updatedSession?.activeTabId ?? ctx.tabId;

		if (currentTabId) {
			return {
				screenshotPath,
				currentScreenshot: await refreshScreenshot(currentTabId, ctx.sessionId),
				url,
				currentUrl: await getCurrentUrl(currentTabId),
				currentTabId
			};
		}
		return {
			screenshotPath,
			currentScreenshot: screenshotPath,
			url,
			currentUrl: url,
			currentTabId
		};
	}
};

export const POST: RequestHandler = async ({ request }) => {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return badRequest('Invalid JSON');
	}

	const {
		sessionId,
		tabId,
		actionType,
		explanation,
		coordinates,
		direction,
		text,
		targetUrl,
		targetTabId
	} = body as {
		sessionId?: string;
		tabId?: string;
		actionType?: string;
		explanation?: string;
		coordinates?: { x: number; y: number };
		direction?: 'up' | 'down';
		text?: string;
		targetUrl?: string;
		targetTabId?: string;
	};

	if (!sessionId || !actionType || !explanation) {
		return badRequest('sessionId, actionType, and explanation are required');
	}

	if (!tabId && actionType !== 'newTab') {
		return badRequest('tabId is required for this action type');
	}

	const session = await getSession(sessionId);
	if (!session) {
		return notFound('Session not found');
	}

	const handler = actionHandlers[actionType];
	if (!handler) {
		return badRequest('Invalid action type');
	}

	try {
		const ctx: ActionContext = {
			tabId: tabId ?? '',
			sessionId,
			screenshotIndex: session.actions.length + 1,
			session,
			coordinates,
			direction,
			text,
			targetUrl,
			targetTabId
		};

		const result = await handler(ctx);

		// Handler returned an error response
		if (result instanceof Response) {
			return result;
		}

		const action: Action = {
			type: actionType as Action['type'],
			tabId: result.currentTabId || tabId || '',
			explanation,
			timestamp: new Date().toISOString(),
			screenshotPath: result.screenshotPath,
			url: result.url,
			...(result.currentUrl &&
				result.currentUrl !== result.url && { afterUrl: result.currentUrl }),
			...((actionType === 'click' || actionType === 'hover') && { coordinates }),
			...(actionType === 'scroll' && { direction }),
			...(actionType === 'type' && { text }),
			...(actionType === 'newTab' && { targetUrl, targetTabId: result.newTabId }),
			...(actionType === 'switchTab' && { targetTabId }),
			...(actionType === 'closeTab' && { targetTabId }),
			...(result.actionResult?.redirects?.length && { redirects: result.actionResult.redirects })
		};

		const updatedSession = await addAction(sessionId, action);

		return json({
			session: updatedSession,
			screenshotPath: result.currentScreenshot,
			currentUrl: result.currentUrl,
			completed: actionType === 'stop',
			tabId: result.currentTabId,
			newTabId: result.newTabId
		});
	} catch (error) {
		return errorResponse(getServerErrorMessage(error, 'Failed to execute action'));
	}
};
