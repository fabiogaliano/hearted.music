/**
 * Thin selector over the shared connection query — consumers read a verdict,
 * not raw fields, so the ordering rules in verdict.ts stay the single source
 * of truth across every surface (dashboard, studio gate, liked
 * songs/matching, onboarding, settings).
 */

import { useQuery } from "@tanstack/react-query";
import { useAuthFailedAt } from "./auth-failed-store";
import {
	type ExtensionConnection,
	extensionConnectionQueryOptions,
} from "./connection-state";
import { type ConnectionVerdict, deriveConnectionVerdict } from "./verdict";

export interface UseExtensionConnectionResult {
	connection: ExtensionConnection | undefined;
	verdict: ConnectionVerdict;
	/** Re-run the check now instead of waiting out the poll interval (e.g.
	 * right after repair, or a "check again" affordance). */
	refetch: () => Promise<unknown>;
}

export function useExtensionConnection(
	linkedSpotifyId: string | null,
): UseExtensionConnectionResult {
	const query = useQuery(extensionConnectionQueryOptions());
	// authFailedAt is merged in here, not read off `query.data` — it lives in
	// its own store precisely so the poll can never clobber it (see
	// auth-failed-store.ts). This is the one place the two are combined into
	// the public `ExtensionConnection` shape every consumer expects.
	const authFailedAt = useAuthFailedAt();
	const connection: ExtensionConnection | undefined = query.data && {
		...query.data,
		authFailedAt,
	};
	return {
		connection,
		verdict: deriveConnectionVerdict(connection, linkedSpotifyId),
		refetch: query.refetch,
	};
}
