/**
 * New songs call-to-action
 *
 * Displays when there are pending songs to match.
 * Shows count and fan-spread album art preview.
 */

import { Link } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { RecentActivityItem } from "../types";
import { FanSpreadAlbumArt } from "./FanSpreadAlbumArt";

interface NewSongsCTAProps {
	theme: ThemeConfig;
	newSongsCount: number;
	recentActivity: RecentActivityItem[];
}

export function NewSongsCTA({
	theme,
	newSongsCount,
	recentActivity,
}: NewSongsCTAProps) {
	if (newSongsCount === 0) return null;

	return (
		<Link
			to="/dashboard/match"
			className="group -mx-4 mb-10 block px-4 py-6 transition-colors"
			style={{ background: theme.surface }}
		>
			<p
				className="mb-2 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Ready to match
			</p>
			<div className="flex items-center justify-between">
				<h3
					className="text-3xl font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{newSongsCount} new {newSongsCount === 1 ? "song" : "songs"}
				</h3>
				<div className="flex items-center gap-8">
					<FanSpreadAlbumArt images={recentActivity.slice(0, 3)} />
					<span
						className="text-sm transition-transform group-hover:translate-x-1"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Start →
					</span>
				</div>
			</div>
		</Link>
	);
}
