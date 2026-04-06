import { useState } from "react";
import { Lock } from "lucide-react";

import { fonts } from "@/lib/theme/fonts";
import type { SongSuggestion } from "@/lib/server/matching.functions";
import type { AnalysisContent, LikedSong } from "../../types";
import { HorizontalJourney } from "./HorizontalJourney";
import { KeyLinesSection } from "./KeyLinesSection";
import { PlaylistsSection } from "./PlaylistsSection";
import type { ColorProps, PanelColors } from "./types";

function AnalysisToggle({
	headline,
	interpretation,
	colorProps,
	isOpen,
	onToggle,
}: {
	headline: string;
	interpretation: string;
	colorProps: ColorProps;
	isOpen: boolean;
	onToggle: () => void;
}) {
	const [animKey, setAnimKey] = useState(0);
	const [hovered, setHovered] = useState(false);

	const toggle = () => {
		onToggle();
		setAnimKey((k) => k + 1);
	};

	return (
		<div
			onClick={toggle}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className="cursor-pointer select-none"
			style={{ position: "relative" }}
		>
			<div
				key={animKey}
				style={{ animation: "hearted-fade 250ms ease forwards" }}
			>
				{isOpen ? (
					<p
						style={{
							fontFamily: fonts.body,
							fontSize: 16,
							lineHeight: 1.55,
							color: colorProps.textMuted,
							borderLeft: `2px solid ${colorProps.accent}`,
							paddingLeft: 12,
							fontStyle: "italic",
						}}
					>
						{interpretation}
					</p>
				) : (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 26,
							fontWeight: 400,
							lineHeight: 1.35,
							color: hovered ? colorProps.accent : colorProps.text,
							transition: "color 200ms ease",
						}}
					>
						{headline}
					</p>
				)}
			</div>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 10,
					letterSpacing: "0.04em",
					color: colorProps.textDim,
					opacity: hovered ? 1 : 0,
					position: "absolute",
					top: "100%",
					right: 0,
					marginTop: 8,
					pointerEvents: "none",
					transition: "opacity 200ms ease, color 200ms ease",
				}}
			>
				{isOpen ? "\u2190 back" : "read deeper \u2192"}
			</span>
		</div>
	);
}

function GenrePills({
	genres,
	colorProps,
}: {
	genres: string[];
	colorProps: ColorProps;
}) {
	const [primaryGenre, ...altGenres] = genres;

	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 8,
					letterSpacing: "0.07em",
					padding: "2px 8px",
					border: `0.5px solid ${colorProps.accent}`,
					borderRadius: 12,
					color: colorProps.accent,
				}}
			>
				{primaryGenre ?? "\u2014"}
			</span>
			{altGenres.map((g) => (
				<span
					key={g}
					style={{
						fontFamily: fonts.body,
						fontSize: 8,
						letterSpacing: "0.06em",
						padding: "2px 8px",
						border: `0.5px solid ${colorProps.border}`,
						borderRadius: 12,
						color: colorProps.textDim,
					}}
				>
					{g}
				</span>
			))}
		</div>
	);
}

interface PanelContentProps {
	colors: PanelColors;
	colorProps: ColorProps;
	song: LikedSong;
	analysis?: AnalysisContent;
	isAnalysisOpen: boolean;
	toggleAnalysis: () => void;
	expandedSections: Set<string>;
	toggleSection: (section: string) => void;
	suggestions: SongSuggestion[] | null;
	isEnrichmentRunning: boolean;
	getStaggerRef: (index: number) => (el: HTMLDivElement | null) => void;
	refs: {
		contentRef: React.RefObject<HTMLDivElement | null>;
		spacerRef: React.RefObject<HTMLDivElement | null>;
		crossfadeContentRef: React.RefObject<HTMLDivElement | null>;
		analysisPhaseRef: React.RefObject<HTMLDivElement | null>;
	};
}

export function PanelContent({
	colors,
	colorProps,
	song,
	analysis,
	isAnalysisOpen,
	toggleAnalysis,
	expandedSections,
	toggleSection,
	suggestions,
	isEnrichmentRunning,
	getStaggerRef,
	refs: { contentRef, spacerRef, crossfadeContentRef, analysisPhaseRef },
}: PanelContentProps) {
	const hasSuggestions = suggestions != null && suggestions.length > 0;
	const isLocked = song.displayState === "locked";

	return (
		<div
			ref={contentRef}
			className="pb-4"
			style={{
				paddingLeft: "20px",
				paddingRight: "20px",
			}}
		>
			<div ref={spacerRef} style={{ height: 0 }} />
			<div ref={crossfadeContentRef}>
				{isLocked ? (
					<div ref={getStaggerRef(0)} style={{ opacity: 0 }}>
						<div className="flex flex-col items-center gap-4 py-8 text-center">
							<div
								className="flex h-12 w-12 items-center justify-center rounded-full"
								style={{
									background: `color-mix(in srgb, ${colors.accent} 15%, transparent)`,
								}}
							>
								<Lock size={20} color={colors.accent} strokeWidth={1.5} />
							</div>
							<div>
								<p
									style={{
										fontFamily: fonts.display,
										fontSize: 18,
										fontWeight: 400,
										color: colors.text,
										margin: 0,
									}}
								>
									This song is locked
								</p>
								<p
									className="mt-2"
									style={{
										fontFamily: fonts.body,
										fontSize: 13,
										lineHeight: 1.5,
										color: colors.textMuted,
										margin: 0,
									}}
								>
									Unlock to see its full analysis, themes, and playlist matches.
								</p>
							</div>
						</div>
					</div>
				) : analysis ? (
					<>
						<div ref={getStaggerRef(0)} className="mb-6" style={{ opacity: 0 }}>
							<GenrePills genres={song.track.genres} colorProps={colorProps} />
						</div>

						{analysis.headline && (
							<div
								ref={getStaggerRef(1)}
								className="mb-8"
								style={{ opacity: 0 }}
							>
								<AnalysisToggle
									headline={analysis.headline}
									interpretation={analysis.interpretation ?? ""}
									colorProps={colorProps}
									isOpen={isAnalysisOpen}
									onToggle={toggleAnalysis}
								/>
								{analysis.themes && analysis.themes.length > 0 && (
									<div style={{ marginTop: 10 }}>
										<p
											style={{
												fontFamily: fonts.body,
												fontSize: 9,
												letterSpacing: "0.05em",
												color: colorProps.textDim,
												opacity: 0.7,
												margin: 0,
											}}
										>
											{analysis.themes.map((t) => t.name).join("  \u00b7  ")}
										</p>
									</div>
								)}
							</div>
						)}

						<div
							ref={analysisPhaseRef}
							style={{
								maxHeight: analysis.headline ? 0 : "none",
								overflow: analysis.headline ? "hidden" : "visible",
							}}
						>
							{analysis.journey && analysis.journey.length > 0 && (
								<div
									ref={getStaggerRef(3)}
									className="mb-6"
									style={{ opacity: 0 }}
								>
									<HorizontalJourney
										key={song.track.id}
										journey={analysis.journey}
										colors={colorProps}
									/>
								</div>
							)}

							{analysis.key_lines && analysis.key_lines.length > 0 && (
								<div
									ref={getStaggerRef(4)}
									className="mb-6"
									style={{ opacity: 0 }}
								>
									<KeyLinesSection
										keyLines={analysis.key_lines}
										colors={colorProps}
									/>
								</div>
							)}

							{(analysis.compound_mood || analysis.mood_description) && (
								<div
									ref={getStaggerRef(5)}
									className="space-y-2"
									style={{
										borderTop: `1px solid ${colors.border}`,
										paddingTop: 20,
										marginTop: 8,
										opacity: 0,
									}}
								>
									{analysis.compound_mood && (
										<span
											style={{
												fontFamily: fonts.body,
												fontSize: 10,
												fontWeight: 500,
												letterSpacing: "0.1em",
												textTransform: "uppercase",
												color: colors.accent,
												display: "block",
											}}
										>
											{analysis.compound_mood}
										</span>
									)}
									{analysis.mood_description && (
										<p
											style={{
												fontFamily: fonts.body,
												fontStyle: "italic",
												fontSize: 13,
												lineHeight: 1.6,
												color: colors.textMuted,
											}}
										>
											{analysis.mood_description}
										</p>
									)}
								</div>
							)}
						</div>

						{hasSuggestions && (
							<div
								ref={getStaggerRef(2)}
								className="mt-5"
								style={{ opacity: 0 }}
							>
								<PlaylistsSection
									suggestions={suggestions}
									isOtherExpanded={expandedSections.has("other-playlists")}
									onToggleOther={() => toggleSection("other-playlists")}
									colors={colorProps}
								/>
							</div>
						)}
					</>
				) : (
					<div ref={getStaggerRef(0)} style={{ opacity: 0 }}>
						<p
							className="text-sm italic"
							style={{
								fontFamily: fonts.body,
								color: colors.textMuted,
							}}
						>
							{isEnrichmentRunning
								? "Analysis in progress..."
								: "We couldn't find enough information about this song"}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
