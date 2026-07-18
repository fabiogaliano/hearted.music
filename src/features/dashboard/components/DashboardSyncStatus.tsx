/**
 * Last-sync indicator paired with the inline sync control.
 *
 * Sits on the Recent Activity header line — syncing is itself an activity, so
 * the timestamp and its CTA belong next to the feed they update. Owns the
 * useDashboardSync wiring so the surrounding layout stays presentational.
 */

import type { ExtensionAccountCheck } from "@/lib/extension/useExtensionAccountConflict";
import { fonts } from "@/lib/theme/fonts";
import { useDashboardSync } from "../hooks/useDashboardSync";
import { DashboardSyncControl } from "./DashboardSyncControl";

interface DashboardSyncStatusProps {
	accountId: string;
	lastSyncText: string;
	accountCheck: ExtensionAccountCheck;
}

export function DashboardSyncStatus({
	accountId,
	lastSyncText,
	accountCheck,
}: DashboardSyncStatusProps) {
	const { state, onAction } = useDashboardSync(accountId, accountCheck);

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
