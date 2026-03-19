import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { AnalysisContent, LikedSong } from "../../types";
import { Nav } from "./Nav";
import { LAYOUT } from "./panel-constants";
import type { ColorProps, PanelColors } from "./types";

function balancedLines(text: string) {
	const mid = Math.floor(text.length / 2);
	const spaceAfter = text.indexOf(" ", mid);
	const spaceBefore = text.lastIndexOf(" ", mid);
	const breakAt =
		spaceAfter !== -1 && spaceAfter - mid <= mid - spaceBefore
			? spaceAfter
			: spaceBefore;
	if (breakAt <= 0) return text;
	return (
		<>
			{text.slice(0, breakAt)}
			<br />
			{text.slice(breakAt + 1)}
		</>
	);
}

interface AudioFeatures {
	tempo: number | null;
	energy: number | null;
	valence: number | null;
}

function deriveAudioLabels(af: AudioFeatures | null) {
	const bpm = af?.tempo ? Math.round(af.tempo) : null;
	const energy =
		af?.energy != null
			? af.energy > 0.66
				? "High Energy"
				: af.energy > 0.33
					? "Mid Energy"
					: "Low Energy"
			: null;
	const valence =
		af?.valence != null
			? af.valence > 0.66
				? "Bright"
				: af.valence > 0.33
					? "Neutral"
					: "Dark"
			: null;
	return { bpm, energy, valence };
}

function SonicNumbers({
	audioFeatures,
	colorProps,
}: {
	audioFeatures: AudioFeatures | null;
	colorProps: ColorProps;
}) {
	const { bpm, energy, valence } = deriveAudioLabels(audioFeatures);
	const columns = [
		bpm ? { value: String(bpm), label: "bpm" } : null,
		energy ? { value: energy.replace(" Energy", ""), label: "energy" } : null,
		valence ? { value: valence, label: "valence" } : null,
	].filter(Boolean) as { value: string; label: string }[];

	if (columns.length === 0) return null;

	return (
		<div style={{ display: "flex", gap: 20, flexShrink: 0 }}>
			{columns.map(({ value, label }) => (
				<div
					key={label}
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 2,
						alignItems: "flex-end",
					}}
				>
					<span
						style={{
							fontFamily: fonts.display,
							fontSize: 22,
							fontWeight: 400,
							lineHeight: 1,
							color: colorProps.text,
						}}
					>
						{value}
					</span>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 7,
							letterSpacing: "0.12em",
							textTransform: "uppercase",
							color: colorProps.textDim,
						}}
					>
						{label}
					</span>
				</div>
			))}
		</div>
	);
}

interface PanelHeroProps {
	colors: PanelColors;
	colorProps: ColorProps;
	isDark: boolean;
	vignetteGradient: string;
	artistImageUrl?: string;
	albumArtUrl?: string;
	isExpanded: boolean;
	isAnalysisOpen: boolean;
	sonicTextureSingleLine: boolean;
	stackMetaBelowArt?: boolean;
	song: LikedSong;
	analysis?: AnalysisContent;
	baseTheme: ThemeConfig;
	heroHeight: number;
	onClose: () => void;
	onNext: () => void;
	onPrevious: () => void;
	hasNext: boolean;
	hasPrevious: boolean;
	refs: {
		headerRef: React.RefObject<HTMLDivElement | null>;
		heroRef: React.RefObject<HTMLDivElement | null>;
		artistImageRef: React.RefObject<HTMLDivElement | null>;
		vignetteRef: React.RefObject<HTMLDivElement | null>;
		bottomFadeRef: React.RefObject<HTMLDivElement | null>;
		genreRef: React.RefObject<HTMLDivElement | null>;
		albumArtRef: React.RefObject<HTMLDivElement | null>;
		textBlockRef: React.RefObject<HTMLDivElement | null>;
		titleRef: React.RefObject<HTMLDivElement | null>;
		metaRef: React.RefObject<HTMLDivElement | null>;
		sonicTextureRef: React.RefObject<HTMLParagraphElement | null>;
	};
}

export function PanelHero({
	colors,
	colorProps,
	isDark,
	vignetteGradient,
	artistImageUrl,
	albumArtUrl,
	isExpanded,
	isAnalysisOpen,
	sonicTextureSingleLine,
	stackMetaBelowArt = false,
	song,
	analysis,
	baseTheme,
	heroHeight: heroHeightProp,
	onClose,
	onNext,
	onPrevious,
	hasNext,
	hasPrevious,
	refs: {
		headerRef,
		heroRef,
		artistImageRef,
		vignetteRef,
		bottomFadeRef,
		genreRef,
		albumArtRef,
		textBlockRef,
		titleRef,
		metaRef,
		sonicTextureRef,
	},
}: PanelHeroProps) {
	const expandedTextLeft = stackMetaBelowArt
		? LAYOUT.paddingX
		: LAYOUT.paddingX + LAYOUT.albumArtExpanded + 16;
	const expandedTextTop = stackMetaBelowArt
		? heroHeightProp - 18 + 16
		: heroHeightProp - LAYOUT.albumArtExpanded - 18;
	const expandedTextHeight = stackMetaBelowArt ? 84 : LAYOUT.albumArtExpanded;

	return (
		<div
			ref={headerRef}
			className="sticky top-0 z-20"
			style={{
				background: colors.bg,
				borderBottom: `1px solid transparent`,
				height: "108px",
				overflow: "visible",
				willChange: "border-bottom-color",
			}}
		>
			<div className="relative h-full">
				<div
					ref={heroRef}
					className="absolute inset-x-0 top-0"
					style={{
						height: `${heroHeightProp}px`,
						pointerEvents: "none",
					}}
				>
					{artistImageUrl ? (
						<>
							<div
								ref={artistImageRef}
								className="absolute inset-0"
								style={{
									backgroundImage: `url(${artistImageUrl})`,
									backgroundSize: "cover",
									backgroundPosition: `center ${LAYOUT.imagePositionY}%`,
								}}
							/>
							<div
								ref={vignetteRef}
								className="absolute inset-0"
								style={{
									background: vignetteGradient,
								}}
							/>
						</>
					) : (
						<div
							ref={artistImageRef}
							className="absolute inset-0"
							style={{ background: colors.bg }}
						/>
					)}

					<div
						ref={bottomFadeRef}
						className="pointer-events-none absolute inset-x-0 bottom-0"
						style={{
							height: "50%",
							background: `linear-gradient(to bottom, transparent 0%, ${colors.bg} 100%)`,
							opacity: 0,
						}}
					/>

					<div
						ref={genreRef}
						className="absolute top-3 left-5"
						style={{ left: "20px" }}
					/>

					{albumArtUrl && isExpanded && (
						<div
							ref={albumArtRef}
							className={`absolute left-5 ${isDark ? "shadow-lg" : "shadow-md"}`}
							style={{
								left: `${LAYOUT.paddingX}px`,
								width: `${LAYOUT.albumArtExpanded}px`,
								height: `${LAYOUT.albumArtExpanded}px`,
								top: `${heroHeightProp - LAYOUT.albumArtExpanded - 18}px`,
								transform: `translateY(${LAYOUT.albumArtExpanded / 3}px)`,
								boxShadow: isDark
									? `0 8px 32px ${colors.bg}`
									: `0 4px 20px ${baseTheme.primary}20`,
								viewTransitionName: isExpanded ? "song-album" : "none",
							}}
						>
							<img
								src={albumArtUrl}
								alt=""
								className="h-full w-full object-cover"
							/>
						</div>
					)}

					<div
						ref={textBlockRef}
						className={`absolute flex flex-row ${isAnalysisOpen && analysis?.sonic_texture ? "items-start" : "items-end"}`}
						style={{
							overflow: "hidden",
							right: `${LAYOUT.paddingX}px`,
							left: `${expandedTextLeft}px`,
							top: `${expandedTextTop}px`,
							height: `${expandedTextHeight}px`,
							transform: `translateY(${LAYOUT.albumArtExpanded / 3}px)`,
						}}
					>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div
								style={{
									display:
										isAnalysisOpen && analysis?.sonic_texture
											? "flex"
											: "block",
									alignItems: "baseline",
									gap: isAnalysisOpen && analysis?.sonic_texture ? "5px" : 0,
									minWidth: 0,
									overflow: "hidden",
								}}
							>
								<div
									ref={titleRef}
									className="leading-tight font-light"
									style={{
										fontFamily: fonts.display,
										fontSize: "24px",
										color: colors.text,
										viewTransitionName: isExpanded ? "song-title" : "none",
										...(isAnalysisOpen && analysis?.sonic_texture
											? {
													fontFamily: fonts.body,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
													minWidth: 0,
													flexShrink: 1,
												}
											: {}),
									}}
								>
									{song.track.name}
								</div>
								<div
									ref={metaRef}
									className="leading-tight"
									style={{
										fontFamily: fonts.body,
										fontSize: "14px",
										color: colors.textMuted,
										viewTransitionName: isExpanded ? "song-artist" : "none",
										...(isAnalysisOpen && analysis?.sonic_texture
											? {
													whiteSpace: "nowrap",
													overflow: "hidden",
													textOverflow: "ellipsis",
													minWidth: 0,
													flexShrink: 2,
												}
											: { marginTop: "0.375rem" }),
									}}
								>
									{isAnalysisOpen && analysis?.sonic_texture && (
										<span style={{ opacity: 0.35, marginRight: 3 }}>·</span>
									)}
									{song.track.artist}
								</div>
								{!isAnalysisOpen && song.track.album && (
									<div
										style={{
											fontFamily: fonts.body,
											fontSize: 12,
											lineHeight: 1.25,
											letterSpacing: "0.03em",
											color: colors.textDim,
											marginTop: 2,
										}}
									>
										{song.track.album}
									</div>
								)}
							</div>
							{isAnalysisOpen && analysis?.sonic_texture && (
								<p
									ref={sonicTextureRef}
									style={{
										fontFamily: fonts.body,
										fontSize: 10,
										fontStyle: "italic",
										lineHeight: 1.4,
										color: colorProps.textMuted,
										margin: "4px 0 0",
										overflow: "hidden",
										...(sonicTextureSingleLine
											? {}
											: {
													display: "-webkit-box",
													WebkitLineClamp: 3,
													WebkitBoxOrient: "vertical" as const,
												}),
									}}
								>
									{sonicTextureSingleLine
										? balancedLines(analysis.sonic_texture)
										: analysis.sonic_texture}
								</p>
							)}
						</div>
						{!isAnalysisOpen && (
							<SonicNumbers
								audioFeatures={song.track.audio_features}
								colorProps={colorProps}
							/>
						)}
					</div>
				</div>

				<div
					className={`absolute top-3 right-3 transition-opacity duration-300 ${isExpanded ? "opacity-100" : "opacity-0"}`}
				>
					<Nav
						onClose={onClose}
						onNext={onNext}
						onPrevious={onPrevious}
						hasNext={hasNext}
						hasPrevious={hasPrevious}
						isDark={isDark}
					/>
				</div>
			</div>
		</div>
	);
}
