import {
	type ExtensionSyncDiagnosticSummary,
	isExtensionSyncDiagnosticSummary,
} from "../../../shared/extension-sync-diagnostics";
import { browser } from "./browser";

const STORAGE_KEY = "pendingSyncDiagnostics";
const MAX_PENDING_DIAGNOSTICS = 25;

async function getPendingSyncDiagnostics(): Promise<
	ExtensionSyncDiagnosticSummary[]
> {
	const result = await browser.storage.local.get(STORAGE_KEY);
	const raw = result[STORAGE_KEY];
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.filter(isExtensionSyncDiagnosticSummary);
}

async function setPendingSyncDiagnostics(
	entries: ExtensionSyncDiagnosticSummary[],
): Promise<void> {
	await browser.storage.local.set({
		[STORAGE_KEY]: entries.slice(-MAX_PENDING_DIAGNOSTICS),
	});
}

export async function enqueueSyncDiagnostic(
	diagnostic: ExtensionSyncDiagnosticSummary,
): Promise<void> {
	const pending = await getPendingSyncDiagnostics();
	await setPendingSyncDiagnostics([...pending, diagnostic]);
}

export async function flushPendingSyncDiagnostics(
	send: (diagnostic: ExtensionSyncDiagnosticSummary) => Promise<Response>,
): Promise<void> {
	const pending = await getPendingSyncDiagnostics();
	if (pending.length === 0) {
		return;
	}

	const remaining: ExtensionSyncDiagnosticSummary[] = [];
	for (let index = 0; index < pending.length; index += 1) {
		const diagnostic = pending[index];
		try {
			const response = await send(diagnostic);
			if (!response.ok) {
				remaining.push(...pending.slice(index));
				break;
			}
		} catch {
			remaining.push(...pending.slice(index));
			break;
		}
	}

	await setPendingSyncDiagnostics(remaining);
}
