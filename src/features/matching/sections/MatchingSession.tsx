import { useLayoutEffect, useMemo, useRef } from "react";

import { MatchesSection } from "../components/MatchesSection";
import { SongSection } from "../components/SongSection";
import type { MatchingSessionProps } from "../types";

export function MatchingSession({
	currentSong,
	playlists,
	addedTo,
	isDemo,
	realAvailable,
	reconnectNeeded,
	navigationDisabled,
	isLastSong,
	onRefresh,
	onAdd,
	onDismiss,
	onNext,
	onPrevious,
}: MatchingSessionProps) {
	const song = useMemo(
		() => ({
			name: currentSong.name,
			album: currentSong.album ?? "",
			artist: currentSong.artist,
		}),
		[currentSong.name, currentSong.album, currentSong.artist],
	);

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
		<div
			ref={wrapperRef}
			className="origin-top overflow-hidden will-change-[height]"
		>
			<div
				ref={topGridRef}
				className="origin-top transition-transform duration-300 ease-in-out"
			>
				<div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
					<SongSection
						songKey={currentSong.id}
						song={song}
						albumArtUrl={currentSong.albumArtUrl ?? undefined}
						spotifyId={currentSong.spotifyId}
					/>
					<MatchesSection
						songKey={currentSong.id}
						playlists={playlists}
						addedTo={addedTo}
						isDemo={isDemo}
						realAvailable={realAvailable}
						reconnectNeeded={reconnectNeeded}
						navigationDisabled={navigationDisabled}
						isLastSong={isLastSong}
						onRefresh={onRefresh}
						onAdd={onAdd}
						onDismiss={onDismiss}
						onNext={onNext}
						onPrevious={onPrevious}
					/>
				</div>
			</div>
		</div>
	);
}
