/**
 * Last-sync indicator paired with the inline sync control.
 *
 * Sits on the Recent Activity header line — syncing is itself an activity, so
 * the timestamp and its CTA belong next to the feed they update. Owns the
 * useDashboardSync wiring so the surrounding layout stays presentational.
 */

import type { ConnectionVerdict } from "@/lib/extension/connection/verdict";
import { fonts } from "@/lib/theme/fonts";
import { useDashboardSync } from "../hooks/useDashboardSync";
import { DashboardSyncControl } from "./DashboardSyncControl";

interface DashboardSyncStatusProps {
	accountId: string;
	lastSyncText: string;
	verdict: ConnectionVerdict;
	/** null before first sync — narrows which reconnect CTA the control keeps
	 * (see useDashboardSync's deriveState: pre-link has no banner to own it). */
	linkedSpotifyId: string | null;
}

export function DashboardSyncStatus({
	accountId,
	lastSyncText,
	verdict,
	linkedSpotifyId,
}: DashboardSyncStatusProps) {
	const { state, onAction } = useDashboardSync(
		accountId,
		verdict,
		linkedSpotifyId,
	);

	return (
		<div
			className="theme-text-muted flex items-center gap-x-2 text-xs"
			style={{ fontFamily: fonts.body }}
		>
			<span className="flex items-center gap-2" aria-live="polite">
				<span className="theme-text-muted-bg size-1.5 rounded-full" />
				{lastSyncText}
			</span>
			<DashboardSyncControl state={state} onAction={onAction} />
		</div>
	);
}
