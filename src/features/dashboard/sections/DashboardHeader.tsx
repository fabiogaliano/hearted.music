/** Welcome greeting with stats and sync button. */

import { Button } from "@/components/ui/Button";
import { ClientNumberFlow } from "@/features/matching/components/ClientNumberFlow";
import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { fonts } from "@/lib/theme/fonts";
import type { DashboardStats } from "../types";

interface DashboardHeaderProps {
	accountId: string;
	stats: DashboardStats;
	displayName: string | null;
	lastSyncText: string;
}

export function DashboardHeader({
	accountId,
	stats,
	displayName,
	lastSyncText,
}: DashboardHeaderProps) {
	const { isEnrichmentRunning, enrichmentProgress } = useActiveJobs(accountId);

	const analyzedPercent = enrichmentProgress
		? enrichmentProgress.total > 0
			? Math.round((enrichmentProgress.done / enrichmentProgress.total) * 100)
			: 0
		: stats.analyzedPercent;

	return (
		<div className="mb-8 flex items-start justify-between">
			<div>
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Welcome back
				</p>
				{displayName && (
					<h2
						className="theme-text mt-3 text-page-title font-extralight tracking-tight"
						style={{ fontFamily: fonts.display }}
					>
						{displayName}
					</h2>
				)}
			</div>
			<div
				className="theme-text-muted flex items-center gap-2 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				<span className="tabular-nums">
					{stats.totalSongs}{" "}
					<span className="tracking-widest uppercase">songs</span>
				</span>
				<span className="opacity-40">·</span>
				<span className="tabular-nums">
					{stats.playlistCount}{" "}
					<span className="tracking-widest uppercase">playlists</span>
				</span>
				<span className="opacity-40">·</span>
				<span className="tabular-nums">
					<ClientNumberFlow value={analyzedPercent} suffix="%" continuous />{" "}
					<span className="tracking-widest uppercase">
						{isEnrichmentRunning ? "analyzing" : "analyzed"}
					</span>
				</span>
				<span className="mx-1 opacity-40">|</span>
				<span className="flex items-center gap-2">
					<span className="theme-text-muted-bg size-1.5 rounded-full" />
					{lastSyncText}
				</span>
				<Button
					variant="link"
					size="sm"
					style={{ fontFamily: fonts.body }}
					aria-label="Sync library"
				>
					Sync
				</Button>
			</div>
		</div>
	);
}
