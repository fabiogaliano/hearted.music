import { Result } from "better-result";
import { getAccountById } from "@/lib/domains/library/accounts/queries";

/**
 * Resolves a human-readable label for an account, for log lines.
 *
 * Prefers @handle, then the Spotify display name, then a short id. Worker logs
 * otherwise show only truncated UUIDs, which tell you nothing about *who* a job
 * is for — this turns `acct=1a2b3c4d` into `@fabio`.
 */

const cache = new Map<string, string>();

function shortId(accountId: string): string {
	return `acct:${accountId.slice(0, 8)}`;
}

export async function resolveAccountLabel(accountId: string): Promise<string> {
	const cached = cache.get(accountId);
	if (cached) {
		return cached;
	}

	// A logging helper must never break the pipeline: any failure resolving the
	// label (DB down, client misconfigured) degrades to the short id.
	try {
		const result = await getAccountById(accountId);
		if (Result.isError(result) || !result.value) {
			// Don't cache the bare-id fallback: a handle/display name set later
			// (e.g. during onboarding, after the first job ran) is still picked up.
			return shortId(accountId);
		}

		const account = result.value;
		const label = account.handle
			? `@${account.handle}`
			: (account.display_name ?? null);

		if (!label) {
			return shortId(accountId);
		}

		cache.set(accountId, label);
		return label;
	} catch {
		return shortId(accountId);
	}
}
