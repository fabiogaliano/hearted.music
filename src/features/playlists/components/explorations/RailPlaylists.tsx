import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { RailRow } from "./RailRow";
import { type RailSegment, SegmentedFilter } from "./SegmentedFilter";
import type { PlaylistSummary } from "./types";

interface RailPlaylistsProps {
	playlists: PlaylistSummary[];
	onOpen?: (id: string) => void;
	onAdd?: (id: string) => void;
	onRemove?: (id: string) => void;
}

/**
 * The Rail listing: one editorial column with an All / Matching / Library
 * segment that filters it in place (the segmented-toggle separation model).
 * Single column by construction — scannable straight down and mobile-first.
 */
export function RailPlaylists({
	playlists,
	onOpen = () => {},
	onAdd = () => {},
	onRemove = () => {},
}: RailPlaylistsProps) {
	const [segment, setSegment] = useState<RailSegment>("all");
	const matching = playlists.filter((p) => p.isTarget);
	const library = playlists.filter((p) => !p.isTarget);
	const list =
		segment === "matching"
			? matching
			: segment === "library"
				? library
				: playlists;

	return (
		<div className="mx-auto max-w-5xl">
			<header className="mb-[18px]">
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Library
				</p>
				<h1
					className="theme-text text-page-title mt-3 leading-[0.95] font-extralight tracking-tight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					Playlists{" "}
					<span className="theme-text-muted align-[0.32em] text-[0.5em] tabular-nums">
						{playlists.length}
					</span>
				</h1>
			</header>

			<SegmentedFilter
				value={segment}
				onChange={setSegment}
				counts={{
					all: playlists.length,
					matching: matching.length,
					library: library.length,
				}}
			/>

			<div className="theme-border-color mt-3 border-t">
				{list.length > 0 ? (
					list.map((playlist) => (
						<RailRow
							key={playlist.id}
							playlist={playlist}
							onOpen={onOpen}
							onAdd={onAdd}
							onRemove={onRemove}
						/>
					))
				) : (
					<p
						className="theme-text-muted py-6 text-[13px]"
						style={{ fontFamily: fonts.body }}
					>
						Nothing here yet.
					</p>
				)}
			</div>
		</div>
	);
}
