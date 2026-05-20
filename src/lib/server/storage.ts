import * as fs from 'fs/promises';
import * as path from 'path';
import type { AnnotationSession, Action, Tab } from '$lib/types';

const DATA_DIR = path.join(process.cwd(), 'data', 'sessions');

async function ensureDataDir(): Promise<void> {
	await fs.mkdir(DATA_DIR, { recursive: true });
}

function getSessionPath(sessionId: string): string {
	return path.join(DATA_DIR, `${sessionId}.json`);
}

export async function createSession(
	id: string,
	url: string,
	prompt: string,
	plan: string,
	initialScreenshot: string,
	initialTabId: string
): Promise<AnnotationSession> {
	await ensureDataDir();

	const initialTab: Tab = {
		id: initialTabId,
		url,
		createdAt: new Date().toISOString()
	};

	const session: AnnotationSession = {
		id,
		url,
		prompt,
		plan,
		createdAt: new Date().toISOString(),
		tabs: [initialTab],
		activeTabId: initialTabId,
		actions: [],
		initialScreenshot
	};

	await fs.writeFile(getSessionPath(id), JSON.stringify(session, null, 2));
	return session;
}

export async function importSession(session: AnnotationSession): Promise<AnnotationSession> {
	await ensureDataDir();

	// Generate new ID to avoid conflicts
	const newId = crypto.randomUUID();
	const importedSession: AnnotationSession = {
		...session,
		id: newId,
		createdAt: new Date().toISOString()
	};

	await fs.writeFile(getSessionPath(newId), JSON.stringify(importedSession, null, 2));
	return importedSession;
}

export async function getSession(sessionId: string): Promise<AnnotationSession | null> {
	try {
		const data = await fs.readFile(getSessionPath(sessionId), 'utf-8');
		return JSON.parse(data) as AnnotationSession;
	} catch {
		return null;
	}
}

export async function addAction(
	sessionId: string,
	action: Action
): Promise<AnnotationSession | null> {
	const session = await getSession(sessionId);
	if (!session) return null;

	session.actions.push(action);

	if (action.type === 'stop') {
		session.finalAnswer = action.explanation;
	}

	await fs.writeFile(getSessionPath(sessionId), JSON.stringify(session, null, 2));
	return session;
}

export async function deleteSession(sessionId: string): Promise<boolean> {
	try {
		await fs.unlink(getSessionPath(sessionId));
		return true;
	} catch {
		return false;
	}
}

export async function updateAction(
	sessionId: string,
	actionIndex: number,
	action: Partial<Action>
): Promise<AnnotationSession | null> {
	const session = await getSession(sessionId);
	if (!session) return null;

	if (actionIndex < 0 || actionIndex >= session.actions.length) {
		return null;
	}

	// Merge the updates into the existing action
	session.actions[actionIndex] = { ...session.actions[actionIndex], ...action };

	// Update finalAnswer if this is a stop action
	if (session.actions[actionIndex].type === 'stop') {
		session.finalAnswer = session.actions[actionIndex].explanation;
	}

	await fs.writeFile(getSessionPath(sessionId), JSON.stringify(session, null, 2));
	return session;
}

export async function deleteAction(
	sessionId: string,
	actionIndex: number
): Promise<AnnotationSession | null> {
	const session = await getSession(sessionId);
	if (!session) return null;

	if (actionIndex < 0 || actionIndex >= session.actions.length) {
		return null;
	}

	session.actions.splice(actionIndex, 1);

	// If we deleted a 'stop' action, clear the finalAnswer
	if (session.finalAnswer && !session.actions.some((a) => a.type === 'stop')) {
		delete session.finalAnswer;
	}

	await fs.writeFile(getSessionPath(sessionId), JSON.stringify(session, null, 2));
	return session;
}

export async function listSessions(): Promise<AnnotationSession[]> {
	await ensureDataDir();
	const files = await fs.readdir(DATA_DIR);
	const sessionFiles = files.filter((f: string) => f.endsWith('.json'));

	const sessions: AnnotationSession[] = [];
	for (const file of sessionFiles) {
		const data = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
		sessions.push(JSON.parse(data) as AnnotationSession);
	}

	// Sort by creation date, newest first
	sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	return sessions;
}

// Tab management functions

export async function addTab(
	sessionId: string,
	tab: Tab
): Promise<AnnotationSession | null> {
	const session = await getSession(sessionId);
	if (!session) return null;

	session.tabs.push(tab);
	session.activeTabId = tab.id;

	await fs.writeFile(getSessionPath(sessionId), JSON.stringify(session, null, 2));
	return session;
}

export async function updateTab(
	sessionId: string,
	tabId: string,
	updates: Partial<Tab>
): Promise<AnnotationSession | null> {
	const session = await getSession(sessionId);
	if (!session) return null;

	const tabIndex = session.tabs.findIndex((t) => t.id === tabId);
	if (tabIndex === -1) return null;

	session.tabs[tabIndex] = { ...session.tabs[tabIndex], ...updates };

	await fs.writeFile(getSessionPath(sessionId), JSON.stringify(session, null, 2));
	return session;
}

export async function closeTabInSession(
	sessionId: string,
	tabId: string
): Promise<AnnotationSession | null> {
	const session = await getSession(sessionId);
	if (!session) return null;

	const tabIndex = session.tabs.findIndex((t) => t.id === tabId);
	if (tabIndex === -1) return null;

	// Mark tab as closed rather than removing it (preserves history)
	session.tabs[tabIndex].closedAt = new Date().toISOString();

	// If this was the active tab, switch to another open tab
	if (session.activeTabId === tabId) {
		const openTab = session.tabs.find((t) => !t.closedAt && t.id !== tabId);
		session.activeTabId = openTab?.id ?? '';
	}

	await fs.writeFile(getSessionPath(sessionId), JSON.stringify(session, null, 2));
	return session;
}

export async function setActiveTab(
	sessionId: string,
	tabId: string
): Promise<AnnotationSession | null> {
	const session = await getSession(sessionId);
	if (!session) return null;

	const tab = session.tabs.find((t) => t.id === tabId && !t.closedAt);
	if (!tab) return null;

	session.activeTabId = tabId;

	await fs.writeFile(getSessionPath(sessionId), JSON.stringify(session, null, 2));
	return session;
}
