import * as fs from 'fs/promises';
import * as path from 'path';
import type { AnnotationSession, Action } from '$lib/types';

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
	initialScreenshot: string
): Promise<AnnotationSession> {
	await ensureDataDir();

	const session: AnnotationSession = {
		id,
		url,
		prompt,
		plan,
		createdAt: new Date().toISOString(),
		actions: [],
		initialScreenshot
	};

	await fs.writeFile(getSessionPath(id), JSON.stringify(session, null, 2));
	return session;
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
