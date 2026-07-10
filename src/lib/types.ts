export interface Tab {
	id: string;
	url: string;
	title?: string;
	createdAt: string;
	closedAt?: string;
}

export interface Redirect {
	url: string;
	screenshotPath?: string; // Only captured if page actually loaded
}

export interface AnnotationSession {
	id: string;
	url: string;
	prompt: string;
	createdAt: string;
	tabs: Tab[];
	activeTabId: string;
	actions: Action[];
	initialScreenshot: string;
	finalAnswer?: string;
	/**
	 * Popup/overlay dismissals performed by the annotator. Kept separate from
	 * `actions` because they're incidental to the task, not task steps. The
	 * captured locator + domain seed future per-site auto-dismissal (Phase 2).
	 */
	dismissals?: DismissEvent[];
}

/**
 * A robust-ish description of an element, captured at dismiss time so a
 * dismissal can later be recognized/re-applied on the same site (Phase 2).
 * Deliberately attribute-based (text/role/aria), not a brittle DOM path.
 */
export interface ElementLocator {
	tag?: string;
	text?: string;
	ariaLabel?: string;
	role?: string;
	id?: string;
	classes?: string[];
}

/**
 * A manual popup/notification dismissal. Recorded outside the task action
 * sequence so the annotator can clear obstructions without polluting the steps.
 */
export interface DismissEvent {
	id: string;
	tabId: string;
	coordinates: { x: number; y: number };
	explanation?: string;
	timestamp: string;
	url: string;
	domain: string;
	locator?: ElementLocator;
	screenshotBefore: string;
	screenshotAfter: string;
}

export interface Action {
	type: 'click' | 'hover' | 'scroll' | 'type' | 'wait' | 'stop' | 'newTab' | 'switchTab' | 'closeTab';
	tabId: string;
	explanation: string;
	timestamp: string;
	coordinates?: { x: number; y: number };
	direction?: 'up' | 'down';
	text?: string;
	targetTabId?: string; // for switchTab/closeTab
	targetUrl?: string; // for newTab
	screenshotPath: string;
	url: string;
	afterUrl?: string; // URL after action completed (if different from url)
	redirects?: Redirect[]; // Chain of intermediate URLs during navigation
}

export interface ClickAction extends Action {
	type: 'click';
	coordinates: { x: number; y: number };
}

export interface HoverAction extends Action {
	type: 'hover';
	coordinates: { x: number; y: number };
}

export interface ScrollAction extends Action {
	type: 'scroll';
	direction: 'up' | 'down';
}

export interface StopAction extends Action {
	type: 'stop';
}

export interface NewTabAction extends Action {
	type: 'newTab';
	targetUrl?: string;
}

export interface SwitchTabAction extends Action {
	type: 'switchTab';
	targetTabId: string;
}

export interface CloseTabAction extends Action {
	type: 'closeTab';
	targetTabId: string;
}

export interface SessionSummary {
	id: string;
	url: string;
	prompt: string;
	createdAt: string;
	actionCount: number;
	isCompleted: boolean;
}

export type HoverInfo =
	| { type: 'click'; coordinates: { x: number; y: number } }
	| { type: 'hover'; coordinates: { x: number; y: number } }
	| { type: 'scroll'; direction: 'up' | 'down' }
	| { type: 'type'; text: string }
	| null;

/**
 * Formats an action for display (e.g., "Click (100, 200)", "Scroll down")
 */
export function formatAction(action: Action): string {
	switch (action.type) {
		case 'click':
			return `Click (${action.coordinates?.x}, ${action.coordinates?.y})`;
		case 'hover':
			return `Hover (${action.coordinates?.x}, ${action.coordinates?.y})`;
		case 'scroll':
			return `Scroll ${action.direction}`;
		case 'type':
			return `Type "${action.text}"`;
		case 'wait':
			return 'Wait';
		case 'stop':
			return 'Stop';
		case 'newTab':
			return `New Tab${action.targetUrl ? ` → ${action.targetUrl}` : ''}`;
		case 'switchTab':
			return `Switch Tab → ${action.targetTabId}`;
		case 'closeTab':
			return `Close Tab ${action.targetTabId}`;
		default:
			return 'Unknown';
	}
}

/**
 * Converts an action to HoverInfo for display overlay
 */
export function actionToHoverInfo(action: Action): HoverInfo {
	if (action.type === 'click' && action.coordinates) {
		return { type: 'click', coordinates: action.coordinates };
	}
	if (action.type === 'hover' && action.coordinates) {
		return { type: 'hover', coordinates: action.coordinates };
	}
	if (action.type === 'scroll' && action.direction) {
		return { type: 'scroll', direction: action.direction };
	}
	if (action.type === 'type' && action.text) {
		return { type: 'type', text: action.text };
	}
	return null;
}
