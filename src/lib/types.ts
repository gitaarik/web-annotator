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
	plan: string;
	createdAt: string;
	tabs: Tab[];
	activeTabId: string;
	actions: Action[];
	initialScreenshot: string;
	finalAnswer?: string;
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
