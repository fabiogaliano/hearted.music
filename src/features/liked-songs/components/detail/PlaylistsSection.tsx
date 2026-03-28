/**
 * PlaylistsSection: Read-only playlist suggestions from match results.
 * Shows prominent matches (score >= 0.6) expanded, others collapsed.
 */
import { useMemo } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { SongSuggestion } from "@/lib/server/matching.functions";
import { getMatchQuality } from "./utils";
import type { ColorProps } from "./types";

function PlaylistRow({
	suggestion,
	isOther,
	colors,
}: {
	suggestion: SongSuggestion;
	isOther: boolean;
	colors?: ColorProps;
}) {
	if (isOther) {
		return (
			<div className="flex items-center justify-between py-2">
				<span
					className="text-sm"
					style={{
						fontFamily: fonts.body,
						color: colors?.textMuted,
					}}
				>
					{suggestion.playlistName}
				</span>
				<span
					className="text-xs tabular-nums"
					style={{
						fontFamily: fonts.body,
						color: colors?.border,
					}}
				>
					{Math.round(suggestion.score * 100)}%
				</span>
			</div>
		);
	}

	const quality = getMatchQuality(suggestion.score);

	return (
		<div className="flex items-center justify-between py-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-3">
					<h5
						className="text-base font-light"
						style={{
							fontFamily: fonts.display,
							color: colors?.text,
						}}
					>
						{suggestion.playlistName}
					</h5>
					<span
						className="text-xs tracking-wide"
						style={{
							fontFamily: fonts.body,
							color: colors?.textMuted,
						}}
					>
						{quality.label}
					</span>
				</div>
			</div>
			<span
				className="ml-4 text-xs tabular-nums"
				style={{
					fontFamily: fonts.body,
					color: colors?.textMuted,
				}}
			>
				{Math.round(suggestion.score * 100)}%
			</span>
		</div>
	);
}

interface PlaylistsSectionProps {
	suggestions: SongSuggestion[];
	isOtherExpanded: boolean;
	onToggleOther: () => void;
	colors?: ColorProps;
}

export function PlaylistsSection({
	suggestions,
	isOtherExpanded,
	onToggleOther,
	colors,
}: PlaylistsSectionProps) {
	const { prominentMatches, otherMatches } = useMemo(() => {
		const sorted = suggestions.toSorted((a, b) => b.score - a.score);
		const prominent: SongSuggestion[] = [];
		const other: SongSuggestion[] = [];
		for (const s of sorted) {
			if (getMatchQuality(s.score).showProminent) prominent.push(s);
			else other.push(s);
		}
		return { prominentMatches: prominent, otherMatches: other };
	}, [suggestions]);

	return (
		<section className="border-t pt-6" style={{ borderColor: colors?.border }}>
			<h4
				className="mb-5 text-xs tracking-widest uppercase"
				style={{
					fontFamily: fonts.body,
					color: colors?.textMuted,
				}}
			>
				Playlist Suggestions
			</h4>

			<div className="space-y-1">
				{prominentMatches.map((suggestion) => (
					<PlaylistRow
						key={suggestion.playlistId}
						suggestion={suggestion}
						isOther={false}
						colors={colors}
					/>
				))}

				{otherMatches.length > 0 && (
					<button
						onClick={onToggleOther}
						className="group w-full py-2 text-left"
					>
						<span
							className="text-xs tracking-wide"
							style={{
								fontFamily: fonts.body,
								color: colors?.textMuted,
							}}
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
					<div className="animate-in fade-in slide-in-from-top-2 mt-2 space-y-1 duration-300">
						{otherMatches.map((suggestion) => (
							<PlaylistRow
								key={suggestion.playlistId}
								suggestion={suggestion}
								isOther={true}
								colors={colors}
							/>
						))}
					</div>
				)}
			</div>
		</section>
	);
}
