import { useLayoutEffect, useRef } from "react";

import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { MatchesSection } from "../components/MatchesSection";
import { SongSection } from "../components/SongSection";
import type { MatchingSessionProps } from "../types";

export function MatchingSession({
	currentSong,
	playlists,
	addedTo,
	state,
	onAdd,
	onDismiss,
	onNext,
}: MatchingSessionProps) {
	const theme = useTheme();
	const topGridRef = useRef<HTMLDivElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const wrapper = wrapperRef.current;
		const inner = topGridRef.current;
		if (!wrapper || !inner) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				wrapper.style.height = `${entry.contentRect.height}px`;
			}
		});

		observer.observe(inner);
		return () => observer.disconnect();
	}, []);

	return (
		<>
			<div className="mb-10 h-px" style={{ background: theme.border }} />

			<div
				ref={wrapperRef}
				className="origin-top overflow-hidden will-change-[height]"
			>
				<div
					ref={topGridRef}
					className="origin-top transition-transform duration-500 ease-in-out"
				>
					<div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
						<SongSection
							songKey={currentSong.id}
							song={{
								name: currentSong.name,
								album: currentSong.album ?? "",
								artist: currentSong.artist,
							}}
							metaVisible={state.songMetaVisible}
							albumArtUrl={currentSong.albumArtUrl ?? undefined}
							isLoading={false}
						/>
						<MatchesSection
							playlists={playlists}
							addedTo={addedTo}
							onAdd={onAdd}
							onDismiss={onDismiss}
							onNext={onNext}
						/>
					</div>
				</div>
			</div>
		</>
	);
}
