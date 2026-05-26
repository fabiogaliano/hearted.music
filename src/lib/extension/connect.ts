/**
 * Extension pairing: mint a short-lived API token and hand it to the
 * extension via CONNECT so it can POST to the backend on this account's behalf.
 *
 * Shared by onboarding's install step and the dashboard's reconnect CTA.
 * Deliberately omits resetSyncJobs() — that clears the server's phase_job_ids
 * pointer, which onboarding's SyncingStep reads but the dashboard does not
 * (the dashboard's live truth is the extension GET_STATUS). Callers that need
 * the pointer cleared call resetSyncJobs() themselves, keeping this module
 * free of the onboarding server-function import graph.
 */

import { connectExtension } from "@/lib/extension/detect";

export type PairExtensionResult = { ok: true } | { ok: false; error: string };

export async function pairExtension(): Promise<PairExtensionResult> {
	try {
		const res = await fetch("/api/extension/token", { method: "POST" });
		if (!res.ok) {
			return { ok: false, error: `Token request failed: ${res.status}` };
		}

		const { token } = (await res.json()) as { token?: string };
		if (!token) {
			return { ok: false, error: "No token in response" };
		}

		const connected = await connectExtension(token, window.location.origin);
		if (!connected) {
			return { ok: false, error: "Extension did not acknowledge CONNECT" };
		}

		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Pairing failed",
		};
	}
}
