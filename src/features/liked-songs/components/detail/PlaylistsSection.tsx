import { PlaylistMatchRow } from "@/components/ui/PlaylistMatchRow";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import type { SongSuggestion } from "@/lib/server/matching.functions";
import { fonts } from "@/lib/theme/fonts";
import type { ColorProps } from "./types";

interface PlaylistsSectionProps {
	suggestions: SongSuggestion[];
	addedTo: string[];
	onAdd: (playlistId: string) => void;
	reconnectNeeded?: boolean;
	colors?: ColorProps;
}

export function PlaylistsSection({
	suggestions,
	addedTo,
	onAdd,
	reconnectNeeded,
	colors,
}: PlaylistsSectionProps) {
	const sorted = [...suggestions].sort((a, b) => b.score - a.score);

	const rowColors = {
		text: colors?.text ?? "",
		textMuted: colors?.textMuted ?? "",
		border: colors?.border ?? "",
	};

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

			<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
				{sorted.map((suggestion) => (
					<PlaylistMatchRow
						key={suggestion.playlistId}
						playlistId={suggestion.playlistId}
						name={suggestion.playlistName}
						scoreDisplay={
							<span
								className={`${suggestion.score >= 0.7 ? "theme-text" : "theme-text-muted"} font-extralight tabular-nums`}
								style={{
									fontFamily: fonts.display,
									fontSize: "1.125rem",
								}}
							>
								{Math.round(suggestion.score * 100)}%
							</span>
						}
						colors={rowColors}
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
