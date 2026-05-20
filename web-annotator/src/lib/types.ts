export interface AnnotationSession {
	id: string;
	url: string;
	prompt: string;
	plan: string;
	createdAt: string;
	actions: Action[];
	initialScreenshot: string;
	finalAnswer?: string;
}

export interface Action {
	type: 'click' | 'scroll' | 'type' | 'stop';
	explanation: string;
	timestamp: string;
	coordinates?: { x: number; y: number };
	direction?: 'up' | 'down';
	text?: string;
	screenshotPath: string;
}

export interface ClickAction extends Action {
	type: 'click';
	coordinates: { x: number; y: number };
}

export interface ScrollAction extends Action {
	type: 'scroll';
	direction: 'up' | 'down';
}

export interface StopAction extends Action {
	type: 'stop';
}
