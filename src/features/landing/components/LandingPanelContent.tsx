/**
 * Landing page version of PanelContent.
 * Same as production PanelContent but without the PlaylistsSection.
 */
import { useState } from "react";

import { fonts } from "@/lib/theme/fonts";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { HorizontalJourney } from "@/features/liked-songs/components/detail/HorizontalJourney";
import { KeyLinesSection } from "@/features/liked-songs/components/detail/KeyLinesSection";
import type {
	ColorProps,
	PanelColors,
} from "@/features/liked-songs/components/detail/types";

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
							fontSize: "var(--s0)",
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
							fontSize: "clamp(1.25rem, 1.6vw, 1.75rem)",
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
					fontSize: "0.625rem",
					letterSpacing: "0.04em",
					color: colorProps.textDim,
					opacity: hovered ? 1 : 0,
					position: "absolute",
					right: 0,
					bottom: -16,
					transition: "opacity 200ms",
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
					fontSize: "0.5rem",
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
						fontSize: "0.5rem",
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

interface LandingPanelContentProps {
	colors: PanelColors;
	colorProps: ColorProps;
	song: LikedSong;
	analysis?: AnalysisContent;
	isAnalysisOpen: boolean;
	toggleAnalysis: () => void;
	getStaggerRef: (index: number) => (el: HTMLDivElement | null) => void;
	refs: {
		contentRef: React.RefObject<HTMLDivElement | null>;
		spacerRef: React.RefObject<HTMLDivElement | null>;
		crossfadeContentRef: React.RefObject<HTMLDivElement | null>;
		analysisPhaseRef: React.RefObject<HTMLDivElement | null>;
	};
}

export function LandingPanelContent({
	colors,
	colorProps,
	song,
	analysis,
	isAnalysisOpen,
	toggleAnalysis,
	getStaggerRef,
	refs: { contentRef, spacerRef, crossfadeContentRef, analysisPhaseRef },
}: LandingPanelContentProps) {
	return (
		<div
			ref={contentRef}
			className="pb-4"
			style={{
				paddingInline: "var(--hero-panel-padding-x)",
			}}
		>
			<div ref={spacerRef} style={{ height: 0 }} />
			<div ref={crossfadeContentRef}>
				<div ref={getStaggerRef(0)} className="mb-6" style={{ opacity: 0 }}>
					<GenrePills genres={song.track.genres} colorProps={colorProps} />
				</div>

				{analysis ? (
					<>
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
												fontSize: "0.5625rem",
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
												fontSize: "0.625rem",
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
					</>
				) : (
					<div ref={getStaggerRef(1)} style={{ opacity: 0 }}>
						<p
							className="text-sm italic"
							style={{
								fontFamily: fonts.body,
								color: colors.textMuted,
							}}
						>
							Analysis in progress...
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
