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
import {
	DashboardSyncControl,
	rendersActionOnly,
} from "./DashboardSyncControl";

interface DashboardSyncStatusProps {
	accountId: string;
	/** null when no sync has completed — the row then shows only the action. */
	lastSyncText: string | null;
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

	// Two independent reasons to say nothing, one derived state. Either the
	// control is already reporting the present — and "when did this last happen"
	// beside "what is happening now" reads as one sentence nobody wrote ("Nothing
	// synced yet up to date") — or there is no completed sync to report at all.
	const showsLastSync = lastSyncText !== null && rendersActionOnly(state);

	return (
		<div
			className="theme-text-muted flex items-center gap-x-2 text-xs"
			style={{ fontFamily: fonts.body }}
		>
			{showsLastSync && (
				<span className="flex items-center gap-2">
					<span className="theme-text-muted-bg size-1.5 rounded-full" />
					{lastSyncText}
				</span>
			)}
			<DashboardSyncControl state={state} onAction={onAction} />
		</div>
	);
}
