/** Welcome greeting with stats and the inline sync control. */

import { ClientNumberFlow } from "@/features/matching/components/ClientNumberFlow";
import { useActiveJobs } from "@/lib/hooks/useActiveJobs";
import { fonts } from "@/lib/theme/fonts";
import type { DashboardStats } from "../types";

interface DashboardHeaderProps {
	accountId: string;
	stats: DashboardStats;
	handle: string | null;
}

export function DashboardHeader({
	accountId,
	stats,
	handle,
}: DashboardHeaderProps) {
	const { isEnrichmentRunning, enrichmentProgress } = useActiveJobs(accountId);

	const analyzedPercent = enrichmentProgress
		? enrichmentProgress.total > 0
			? Math.round((enrichmentProgress.done / enrichmentProgress.total) * 100)
			: 0
		: stats.analyzedPercent;

	return (
		<div className="mb-10 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
			<div>
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Welcome back
				</p>
				{handle && (
					<h2
						className="theme-text mt-3 text-page-title font-extralight tracking-tight text-balance"
						style={{ fontFamily: fonts.display }}
					>
						@{handle}
					</h2>
				)}
			</div>
			<div
				className="theme-text-muted flex flex-wrap items-center gap-x-2 gap-y-2 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				<span className="tabular-nums">
					{stats.totalSongs}{" "}
					<span className="tracking-widest uppercase">songs</span>
				</span>
				<span aria-hidden="true" className="opacity-40">
					·
				</span>
				<span className="tabular-nums">
					{stats.playlistCount}{" "}
					<span className="tracking-widest uppercase">playlists</span>
				</span>
				<span aria-hidden="true" className="opacity-40">
					·
				</span>
				<span className="tabular-nums">
					<ClientNumberFlow value={analyzedPercent} suffix="%" continuous />{" "}
					<span className="tracking-widest uppercase">
						{isEnrichmentRunning ? "analyzing" : "analyzed"}
					</span>
				</span>
			</div>
		</div>
	);
}
