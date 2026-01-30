/**
 * Matching playlists section
 *
 * Quick preview of destination playlists with track counts.
 */

import { Link } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { DashboardPlaylist } from "../types";

interface MatchingPlaylistsSectionProps {
	theme: ThemeConfig;
	playlists: DashboardPlaylist[];
}

export function MatchingPlaylistsSection({
	theme,
	playlists,
}: MatchingPlaylistsSectionProps) {
	if (playlists.length === 0) {
		return (
			<div className="mb-8 border-b pb-6" style={{ borderColor: theme.border }}>
				<p
					className="mb-3 text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Matching playlists
				</p>
				<p
					className="text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					No destination playlists selected yet.
				</p>
				<Link
					to="/dashboard/playlists"
					className="mt-3 block text-xs tracking-widest uppercase transition-opacity hover:opacity-70"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Set up playlists →
				</Link>
			</div>
		);
	}

	return (
		<div className="mb-8 border-b pb-6" style={{ borderColor: theme.border }}>
			<p
				className="mb-3 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Matching playlists
			</p>
			<div className="flex items-center gap-4 overflow-x-auto">
				{playlists.slice(0, 4).map((playlist) => (
					<span
						key={playlist.id}
						className="text-sm whitespace-nowrap"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{playlist.name}
						<span
							className="ml-1.5 text-xs tabular-nums"
							style={{ color: theme.textMuted }}
						>
							{playlist.songCount ?? 0}
						</span>
					</span>
				))}
			</div>
			<Link
				to="/dashboard/playlists"
				className="mt-3 block text-xs tracking-widest uppercase transition-opacity hover:opacity-70"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Manage →
			</Link>
		</div>
	);
}
