import { useState } from "react";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import { useThemeWithOverride } from "@/lib/theme/ThemeHueProvider";
import type { ThemeConfig } from "@/lib/theme/types";
import { GenreRow } from "./_ProdPrimitives";
import { HeroTitleBlock, VariantShell } from "./_VariantShell";

interface Props {
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	onClose: () => void;
}

type StarKind = "theme" | "line" | "journey";
interface StarPoint {
	kind: StarKind;
	index: number;
	label: string;
	x: number;
	y: number;
}

export function PanelVariantConstellation({
	song,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
}: Props) {
	const theme = useThemeWithOverride();
	const analysis = song.analysis?.analysis;
	const [selected, setSelected] = useState<StarPoint | null>(null);
	const [hovered, setHovered] = useState<StarPoint | null>(null);

	return (
		<VariantShell
			theme={theme}
			song={song}
			albumArtUrl={albumArtUrl}
			artistImageUrl={artistImageUrl}
			isExpanded={isExpanded}
			onClose={onClose}
			heroOverlay={<HeroTitleBlock song={song} theme={theme} />}
		>
			<div
				style={{
					padding: "56px 24px 80px",
					display: "flex",
					flexDirection: "column",
					gap: 24,
				}}
			>
				<GenreRow genres={song.track.genres} theme={theme} />
				{!analysis ? (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 22,
							fontWeight: 400,
							lineHeight: 1.4,
							color: theme.textMuted,
							fontStyle: "italic",
							margin: 0,
						}}
					>
						Still listening. Come back soon.
					</p>
				) : (
					<ConstellationBody
						analysis={analysis}
						theme={theme}
						selected={selected}
						hovered={hovered}
						setSelected={setSelected}
						setHovered={setHovered}
					/>
				)}
			</div>
		</VariantShell>
	);
}

function ConstellationBody({
	analysis,
	theme,
	selected,
	hovered,
	setSelected,
	setHovered,
}: {
	analysis: AnalysisContent;
	theme: ThemeConfig;
	selected: StarPoint | null;
	hovered: StarPoint | null;
	setSelected: (point: StarPoint | null) => void;
	setHovered: (point: StarPoint | null) => void;
}) {
	const headline = analysis.headline;
	const compoundMood = analysis.compound_mood;
	const moodDescription = analysis.mood_description;
	const interpretation = analysis.interpretation;
	const themes = analysis.themes ?? [];
	const journey = analysis.journey ?? [];
	const keyLines = analysis.key_lines ?? [];
	const sonicTexture = analysis.sonic_texture;

	const points: StarPoint[] = [
		...themes.slice(0, 5).map((item, index) => ({
			kind: "theme" as const,
			index,
			label: item.name,
			x: 18 + index * 16,
			y: 30 + (index % 2) * 28,
		})),
		...keyLines.slice(0, 4).map((_item, index) => ({
			kind: "line" as const,
			index,
			label: `${index + 1}`,
			x: 28 + index * 18,
			y: 72 - (index % 2) * 26,
		})),
		...journey.slice(0, 5).map((item, index) => ({
			kind: "journey" as const,
			index,
			label: item.section,
			x: 12 + index * 19,
			y: 12 + index * 12,
		})),
	];
	const active = hovered ?? selected;
	const detail = getDetail(active, themes, keyLines, journey);

	return (
		<>
			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				{headline && (
					<p
						style={{
							fontFamily: fonts.display,
							fontSize: 30,
							fontWeight: 400,
							lineHeight: 1.18,
							color: theme.text,
							margin: 0,
						}}
					>
						{headline}
					</p>
				)}
				<div
					style={{ display: "flex", justifyContent: "space-between", gap: 16 }}
				>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 11,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: theme.primary,
						}}
					>
						{compoundMood ?? "mapped by feeling"}
					</span>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 11,
							color: theme.textMuted,
						}}
					>
						{active
							? `${active.kind} ${active.label}`
							: "hover a star, click to pin"}
					</span>
				</div>
			</div>

			<div
				style={{
					border: `1px solid ${theme.border}`,
					borderRadius: 2,
					padding: 16,
					background: theme.surface,
				}}
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: hover-only visual effect, keyboard users interact with children */}
				<div
					role="presentation"
					style={{
						position: "relative",
						height: 310,
						border: `1px solid ${theme.border}`,
						borderRadius: 2,
						overflow: "hidden",
						background: `color-mix(in srgb, ${theme.surface} 76%, ${theme.bg})`,
					}}
					onMouseLeave={() => setHovered(null)}
				>
					<div
						style={{
							position: "absolute",
							left: "50%",
							top: 0,
							bottom: 0,
							width: 1,
							background: theme.border,
						}}
					/>
					<div
						style={{
							position: "absolute",
							top: "50%",
							left: 0,
							right: 0,
							height: 1,
							background: theme.border,
						}}
					/>
					{points.map((point) => {
						const isActive =
							active?.kind === point.kind && active.index === point.index;
						const size =
							point.kind === "theme" ? 18 : point.kind === "line" ? 14 : 10;
						return (
							<button
								key={`${point.kind}-${point.index}`}
								type="button"
								onMouseEnter={() => setHovered(point)}
								onClick={() => setSelected(isActive ? null : point)}
								style={{
									position: "absolute",
									left: `${point.x}%`,
									top: `${point.y}%`,
									width: isActive ? size + 8 : size,
									height: isActive ? size + 8 : size,
									transform: "translate(-50%, -50%)",
									borderRadius: point.kind === "journey" ? 1 : "50%",
									border: `1px solid ${isActive ? theme.primary : theme.border}`,
									background: isActive ? theme.primary : theme.bg,
									color: isActive ? theme.textOnPrimary : theme.textMuted,
									fontFamily: fonts.body,
									fontSize: 8,
									cursor: "pointer",
									transition:
										"width 180ms ease, height 180ms ease, background 180ms ease, border-color 180ms ease",
								}}
								aria-label={`${point.kind}: ${point.label}`}
							>
								{point.kind === "line" ? point.label : ""}
							</button>
						);
					})}
					<div
						style={{
							position: "absolute",
							left: 14,
							bottom: 14,
							display: "flex",
							gap: 8,
							fontFamily: fonts.body,
							fontSize: 10,
							color: theme.textMuted,
						}}
					>
						<span>themes</span>
						<span>lyrics</span>
						<span>movement</span>
					</div>
				</div>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
				<div
					style={{
						minHeight: 170,
						borderTop: `1px solid ${theme.border}`,
						paddingTop: 16,
					}}
				>
					{detail ? (
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							<div
								style={{
									fontFamily: fonts.display,
									fontSize: 22,
									fontStyle: detail.kind === "line" ? "italic" : "normal",
									color: theme.text,
								}}
							>
								{detail.title}
							</div>
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 13,
									lineHeight: 1.6,
									color: theme.textMuted,
									margin: 0,
								}}
							>
								{detail.body}
							</p>
						</div>
					) : moodDescription ? (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 14,
								fontStyle: "italic",
								lineHeight: 1.65,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{moodDescription}
						</p>
					) : null}
				</div>
				<div
					style={{
						minHeight: 170,
						borderTop: `1px solid ${theme.border}`,
						paddingTop: 16,
						display: "flex",
						flexDirection: "column",
						gap: 12,
					}}
				>
					{interpretation && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 13,
								lineHeight: 1.6,
								color: theme.textMuted,
								margin: 0,
							}}
						>
							{interpretation}
						</p>
					)}
					{sonicTexture && (
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 12,
								lineHeight: 1.55,
								color: theme.textMuted,
								margin: 0,
								opacity: 0.82,
							}}
						>
							{sonicTexture}
						</p>
					)}
				</div>
			</div>
		</>
	);
}

function getDetail(
	point: StarPoint | null,
	themes: NonNullable<AnalysisContent["themes"]>,
	keyLines: NonNullable<AnalysisContent["key_lines"]>,
	journey: NonNullable<AnalysisContent["journey"]>,
) {
	if (!point) return null;
	if (point.kind === "theme") {
		const item = themes[point.index];
		return item
			? { kind: point.kind, title: item.name, body: item.description }
			: null;
	}
	if (point.kind === "line") {
		const item = keyLines[point.index];
		return item
			? { kind: point.kind, title: `“${item.line}”`, body: item.insight }
			: null;
	}
	const item = journey[point.index];
	return item
		? { kind: point.kind, title: item.mood, body: item.description }
		: null;
}
