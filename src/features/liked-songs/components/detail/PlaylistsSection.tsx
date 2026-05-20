import { PlaylistMatchRow } from "@/components/ui/PlaylistMatchRow";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import type { SongSuggestion } from "@/lib/server/matching.functions";
import { fonts } from "@/lib/theme/fonts";

interface PlaylistsSectionProps {
	suggestions: SongSuggestion[];
	addedTo: string[];
	onAdd: (playlistId: string) => void;
	reconnectNeeded?: boolean;
}

export function PlaylistsSection({
	suggestions,
	addedTo,
	onAdd,
	reconnectNeeded,
}: PlaylistsSectionProps) {
	const sorted = suggestions.toSorted((a, b) => b.score - a.score);

	const reconnectAction = reconnectNeeded ? (
		<SpotifyReconnectLink label="Reconnect to Spotify" />
	) : undefined;

	return (
		<section className="theme-border-color border-t pt-6">
			<p
				className="theme-text-muted mb-5 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Playlist Suggestions
			</p>

			<div className="flex flex-col gap-4">
				{sorted.map((suggestion) => (
					<PlaylistMatchRow
						key={suggestion.playlistId}
						playlistId={suggestion.playlistId}
						name={suggestion.playlistName}
						scoreDisplay={
							<span
								className="theme-text font-extralight tabular-nums leading-none"
								style={{
									fontFamily: fonts.display,
									fontSize: "1.125rem",
								}}
							>
								{Math.round(suggestion.score * 100)}%
							</span>
						}
						action={
							addedTo.includes(suggestion.playlistId)
								? { type: "added" }
								: reconnectAction
									? { type: "custom", node: reconnectAction }
									: { type: "add", onAdd }
						}
					/>
				))}
			</div>
		</section>
	);
}
