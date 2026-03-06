import { useLayoutEffect, useRef } from "react";

import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { DetailsPanel } from "../components/DetailsPanel";
import { MatchesSection } from "../components/MatchesSection";
import { SongSection } from "../components/SongSection";
import type { MatchingSessionProps } from "../types";

const COLLAPSED_ALBUM_SIZE = "min(100%, clamp(280px, 30vw, 560px))";

export function MatchingSession({
	currentSong,
	playlists,
	state,
	onAdd,
	onDiscard,
	onNext,
	onToggleDetails,
	onCloseDetails,
	onJourneyStepHover,
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
							song={currentSong}
							isExpanded={state.showMeaning}
							metaVisible={state.songMetaVisible}
							albumArtUrl={currentSong.albumArtUrl}
							isLoading={false}
						/>
						<MatchesSection
							playlists={playlists}
							addedTo={state.addedTo[currentSong.id] || []}
							onAdd={onAdd}
							onDiscard={onDiscard}
							onNext={onNext}
							isExpanded={state.showMeaning}
						/>
					</div>
				</div>
			</div>

			<div
				className="transition-[padding-top] duration-500 ease-in-out"
				style={{ paddingTop: "2rem" }}
			>
				<div
					className="h-px transition-all duration-500 ease-in-out"
					style={{
						background: theme.border,
						maxWidth: state.showMeaning ? "100%" : COLLAPSED_ALBUM_SIZE,
					}}
				/>

				{!state.showMeaning && (
					<div className="mt-6">
						<button
							onClick={onToggleDetails}
							className="text-sm tracking-widest uppercase transition-all duration-300 hover:opacity-70"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							Explore +
						</button>
					</div>
				)}
			</div>

			<DetailsPanel
				song={currentSong}
				isExpanded={state.showMeaning}
				activeJourneyStep={state.activeJourneyStep}
				onJourneyStepHover={onJourneyStepHover}
				onClose={onCloseDetails}
			/>
		</>
	);
}
