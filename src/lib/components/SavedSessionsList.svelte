<script lang="ts">
	import type { SessionSummary } from '$lib/types';

	interface Props {
		sessions: SessionSummary[];
		loading: boolean;
		loadingSessionId: string | null;
		onResume: (id: string) => void;
		onDelete: (session: SessionSummary, event: Event) => void;
		onImport: (event: Event) => void;
	}

	let {
		sessions,
		loading,
		loadingSessionId,
		onResume,
		onDelete,
		onImport
	}: Props = $props();

	let incompleteSessions = $derived(sessions.filter((s) => !s.isCompleted));
</script>

<section class="saved-sessions">
	<div class="sessions-header">
		<h2>Recent Sessions</h2>
		<label class="import-btn">
			&uarr; Import
			<input type="file" accept=".json" onchange={onImport} hidden disabled={loading} />
		</label>
	</div>
	{#if incompleteSessions.length > 0}
		<div class="sessions-list">
			{#each incompleteSessions as session}
				<div class="session-row">
					<button
						class="session-card"
						class:loading={loadingSessionId === session.id}
						onclick={() => onResume(session.id)}
						disabled={loading}
					>
						{#if loadingSessionId === session.id}
							<div class="loading-overlay">
								<span class="spinner"></span>
								<span>Loading...</span>
							</div>
						{/if}
						<div class="session-url">{session.url}</div>
						<div class="session-prompt">{session.prompt}</div>
						<div class="session-meta">
							<span>{session.actionCount} actions</span>
							<span>{new Date(session.createdAt).toLocaleDateString()}</span>
						</div>
					</button>
					<button
						class="delete-session-btn"
						onclick={(e) => onDelete(session, e)}
						disabled={loading}
						title="Delete session"
					>
						&times;
					</button>
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No sessions yet. Click "New Session" to get started.</p>
		</div>
	{/if}
</section>

<style>
	.saved-sessions {
		max-width: 600px;
	}

	h2 {
		margin: 0;
		font-size: 1.25rem;
	}

	.sessions-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-lg);
	}

	.import-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-sm) var(--space-lg);
		font-size: 0.9rem;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.2s;
	}

	.import-btn:hover {
		background: var(--color-bg-secondary);
		border-color: var(--color-border-hover);
	}

	.sessions-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.session-row {
		display: flex;
		gap: var(--space-sm);
		align-items: stretch;
	}

	.delete-session-btn {
		padding: 0 var(--space-md);
		font-size: 1.25rem;
		background: var(--color-danger);
		color: white;
		border: none;
		border-radius: var(--radius-lg);
		cursor: pointer;
		font-weight: bold;
		flex-shrink: 0;
	}

	.delete-session-btn:hover:not(:disabled) {
		background: var(--color-danger-hover);
	}

	.session-card {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--color-bg-white);
		color: var(--color-text-primary);
		padding: var(--space-lg);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		cursor: pointer;
		transition: all 0.2s;
		position: relative;
	}

	.session-card:hover:not(:disabled) {
		border-color: var(--color-primary);
		background: var(--color-primary-light);
	}

	.session-card.loading {
		border-color: var(--color-primary);
	}

	.loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-sm);
		background: var(--color-loading-bg);
		border-radius: var(--radius-md);
		color: var(--color-primary);
		font-weight: 500;
	}

	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid var(--color-spinner-track);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.session-url {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-bottom: var(--space-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-prompt {
		font-weight: 500;
		margin-bottom: var(--space-sm);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.session-meta {
		display: flex;
		gap: var(--space-lg);
		font-size: 0.8rem;
		color: var(--color-text-subtle);
	}

	.empty-state {
		background: var(--color-bg-white);
		padding: var(--space-2xl);
		border-radius: var(--radius-lg);
		border: 2px dashed var(--color-border);
		text-align: center;
	}

	.empty-state p {
		margin: 0;
		color: var(--color-text-muted);
	}
</style>
