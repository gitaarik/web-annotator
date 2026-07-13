import { describe, it, expect } from 'vitest';
import { formatAction, type Action } from './types';

describe('formatAction', () => {
	const baseAction: Omit<Action, 'type'> = {
		tabId: 'tab-1',
		explanation: 'Test action',
		timestamp: new Date().toISOString(),
		screenshotPath: '/screenshots/test.png',
		url: 'https://example.com'
	};

	it('formats click action with coordinates', () => {
		const action: Action = {
			...baseAction,
			type: 'click',
			coordinates: { x: 100, y: 200 }
		};
		expect(formatAction(action)).toBe('Click (100, 200)');
	});

	it('formats scroll down action', () => {
		const action: Action = {
			...baseAction,
			type: 'scroll',
			direction: 'down'
		};
		expect(formatAction(action)).toBe('Scroll down');
	});

	it('formats scroll up action', () => {
		const action: Action = {
			...baseAction,
			type: 'scroll',
			direction: 'up'
		};
		expect(formatAction(action)).toBe('Scroll up');
	});

	it('formats type action with text', () => {
		const action: Action = {
			...baseAction,
			type: 'type',
			text: 'Hello World'
		};
		expect(formatAction(action)).toBe('Type "Hello World"');
	});

	it('formats stop action', () => {
		const action: Action = {
			...baseAction,
			type: 'stop'
		};
		expect(formatAction(action)).toBe('Stop');
	});

	it('formats newTab action without URL', () => {
		const action: Action = {
			...baseAction,
			type: 'newTab'
		};
		expect(formatAction(action)).toBe('New Tab');
	});

	it('formats newTab action with URL', () => {
		const action: Action = {
			...baseAction,
			type: 'newTab',
			targetUrl: 'https://google.com'
		};
		expect(formatAction(action)).toBe('New Tab → https://google.com');
	});

	it('formats switchTab action', () => {
		const action: Action = {
			...baseAction,
			type: 'switchTab',
			targetTabId: 'tab-2'
		};
		expect(formatAction(action)).toBe('Switch Tab → tab-2');
	});

	it('formats closeTab action', () => {
		const action: Action = {
			...baseAction,
			type: 'closeTab',
			targetTabId: 'tab-3'
		};
		expect(formatAction(action)).toBe('Close Tab tab-3');
	});

	it('handles click action without coordinates gracefully', () => {
		const action: Action = {
			...baseAction,
			type: 'click'
		};
		expect(formatAction(action)).toBe('Click (undefined, undefined)');
	});
});
