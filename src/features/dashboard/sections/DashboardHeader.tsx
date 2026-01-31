/** Welcome greeting with stats and sync button. */

import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { DashboardStats } from "../types";

interface DashboardHeaderProps {
	theme: ThemeConfig;
	stats: DashboardStats;
	displayName: string | null;
	lastSyncText: string;
}

export function DashboardHeader({
	theme,
	stats,
	displayName,
	lastSyncText,
}: DashboardHeaderProps) {
	return (
		<div className="mb-8 flex items-start justify-between">
			<div>
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Welcome back
				</p>
				{displayName && (
					<h2
						className="mt-2 text-4xl font-extralight"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{displayName}
					</h2>
				)}
			</div>
			<div
				className="flex items-center gap-2 text-xs"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				<span className="tabular-nums">
					{stats.totalSongs}{" "}
					<span className="tracking-widest uppercase">songs</span>
				</span>
				<span className="opacity-40">·</span>
				<span className="tabular-nums">
					{stats.analyzedPercent}%{" "}
					<span className="tracking-widest uppercase">analyzed</span>
				</span>
				<span className="mx-1 opacity-40">|</span>
				<span className="flex items-center gap-2">
					<span
						className="h-1.5 w-1.5 rounded-full"
						style={{ background: theme.text }}
					/>
					{lastSyncText}
				</span>
				<button
					className="tracking-widest uppercase transition-opacity hover:opacity-70 cursor-pointer"
					style={{ color: theme.text }}
					aria-label="Sync library"
				>
					Sync
				</button>
			</div>
		</div>
	);
}

export default DashboardHeader;
