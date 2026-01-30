/**
 * PlaylistsSection: "Add to Your Playlists" - Playlist matching and actions
 * Internal sub-components: PlaylistRow, AddedSummary
 */
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { getMatchQuality } from "./utils";

interface Playlist {
	id: number;
	name: string;
	matchScore: number;
	reason: string;
}

function PlaylistRow({
	theme,
	playlist,
	isAdded,
	isOther,
	onAdd,
}: {
	theme: ThemeConfig;
	playlist: Playlist;
	isAdded: boolean;
	isOther: boolean;
	onAdd: () => void;
}) {
	if (isOther) {
		return (
			<div className="flex items-center justify-between py-2">
				<div>
					<span
						className="text-sm"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{playlist.name}
					</span>
					<span
						className="ml-3 text-xs"
						style={{ fontFamily: fonts.body, color: theme.border }}
					>
						{playlist.reason}
					</span>
				</div>
				{!isAdded && (
					<button
						type="button"
						onClick={onAdd}
						className="text-xs opacity-50 transition-opacity hover:opacity-100"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Add anyway
					</button>
				)}
			</div>
		);
	}

	const quality = getMatchQuality(playlist.matchScore);

	return (
		<div className="group flex items-center justify-between py-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-3">
					<h5
						className="text-base font-light"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{playlist.name}
					</h5>
					<span
						className="text-xs tracking-wide"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{quality.label}
					</span>
				</div>
				<p
					className="mt-1 truncate text-xs"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{playlist.reason}
				</p>
			</div>

			{isAdded ? (
				<span
					className="ml-4 px-4 py-2 text-xs tracking-widest uppercase"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						background: theme.surfaceDim,
					}}
				>
					Added
				</span>
			) : (
				<button
					type="button"
					onClick={onAdd}
					className="ml-4 px-4 py-2 text-xs tracking-widest uppercase opacity-60 transition-all hover:opacity-100"
					style={{
						fontFamily: fonts.body,
						color: theme.textOnPrimary,
						background: theme.primary,
					}}
				>
					Add
				</button>
			)}
		</div>
	);
}

function AddedSummary({
	theme,
	addedCount,
}: {
	theme: ThemeConfig;
	addedCount: number;
}) {
	if (addedCount === 0) return null;

	return (
		<div className="mt-6 border-t pt-4" style={{ borderColor: theme.border }}>
			<span
				className="text-sm"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Added to {addedCount} playlist{addedCount > 1 ? "s" : ""}
			</span>
		</div>
	);
}

interface PlaylistsSectionProps {
	theme: ThemeConfig;
	playlists: Playlist[];
	addedTo: number[];
	isOtherExpanded: boolean;
	onAdd: (playlistId: number) => void;
	onToggleOther: () => void;
	onSkip: () => void;
	onMarkSorted: () => void;
}

export function PlaylistsSection({
	theme,
	playlists,
	addedTo,
	isOtherExpanded,
	onAdd,
	onToggleOther,
	onSkip,
	onMarkSorted,
}: PlaylistsSectionProps) {
	const sortedPlaylists = [...playlists].sort(
		(a, b) => b.matchScore - a.matchScore,
	);
	const prominentMatches = sortedPlaylists.filter(
		(p) => getMatchQuality(p.matchScore).showProminent,
	);
	const otherMatches = sortedPlaylists.filter(
		(p) => !getMatchQuality(p.matchScore).showProminent,
	);

	return (
		<>
			<section className="border-t pt-6" style={{ borderColor: theme.border }}>
				<h4
					className="mb-5 text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Add to Your Playlists
				</h4>

				<div className="space-y-3">
					{prominentMatches.map((playlist) => (
						<PlaylistRow
							key={playlist.id}
							theme={theme}
							playlist={playlist}
							isAdded={addedTo.includes(playlist.id)}
							isOther={false}
							onAdd={() => onAdd(playlist.id)}
						/>
					))}

					{otherMatches.length > 0 && (
						<button
							type="button"
							onClick={onToggleOther}
							className="group w-full py-2 text-left"
						>
							<span
								className="text-xs tracking-wide"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								{otherMatches.length} other playlist
								{otherMatches.length > 1 ? "s" : ""}
								<span className="ml-2 opacity-40 transition-opacity group-hover:opacity-70">
									{isOtherExpanded ? "−" : "+"}
								</span>
							</span>
						</button>
					)}

					{isOtherExpanded && otherMatches.length > 0 && (
						<div className="mt-2 space-y-2">
							{otherMatches.map((playlist) => (
								<PlaylistRow
									key={playlist.id}
									theme={theme}
									playlist={playlist}
									isAdded={addedTo.includes(playlist.id)}
									isOther={true}
									onAdd={() => onAdd(playlist.id)}
								/>
							))}
						</div>
					)}
				</div>

				<AddedSummary theme={theme} addedCount={addedTo.length} />
			</section>

			<div
				className="mt-10 flex items-center justify-between border-t pt-8"
				style={{ borderColor: theme.border }}
			>
				<button
					type="button"
					onClick={onSkip}
					className="text-xs tracking-wide transition-opacity hover:opacity-70"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Skip this song
				</button>
				<button
					type="button"
					onClick={onMarkSorted}
					className="px-5 py-2.5 text-xs tracking-widest uppercase transition-opacity hover:opacity-80"
					style={{
						fontFamily: fonts.body,
						background: theme.surface,
						color: theme.text,
					}}
				>
					Mark as sorted
				</button>
			</div>
		</>
	);
}
