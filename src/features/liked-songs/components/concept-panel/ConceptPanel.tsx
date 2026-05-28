/**
 * ConceptPanel — Step 0 read-coherence test for the new song-detail concept.
 *
 * Layout:
 *   Layer 1 — The Read (lens · tension, then the image)
 *   Layer 2 — The Take (take paragraph + optional contradiction)
 *   Layer 3 — The Trace
 *     - Arc: a clickable mood spine; the open beat's detail is revealed below.
 *     - Lines: the two key quotes; an "↳ why" toggle reveals each insight.
 *     - Texture: a single line, always inline.
 *
 * Palette comes from getThemedDarkColors driven by the song's brand theme,
 * so this panel sits in the same color system as the prod SongDetailPanel.
 */

import { Fragment, useEffect, useState } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { getThemedDarkColors } from "../detail/themed-dark-colors";
import type { ConceptArcBeat, ConceptRead, ConceptSong } from "./concept-types";

type Palette = ReturnType<typeof getThemedDarkColors>;

const PADDING_X = 24;
const ALBUM_ART_SIZE = 112;
const ALBUM_ART_BOTTOM = 24; // album art sits fully inside the hero so the hero's borderBottom can run clean
const SECTION_GAP = 40; // padding above + below each section separator (between Read / Take / Trace)
const FOCUSED_LINE_INTERVAL_MS = 7000;

const CONCEPT_KEYFRAMES = `
@keyframes concept-line-in {
	from { opacity: 0; transform: translateY(6px); }
	to   { opacity: 1; transform: translateY(0); }
}
@keyframes concept-line-progress {
	from { transform: scaleX(0); }
	to   { transform: scaleX(1); }
}
`;

export function ConceptPanel({ song }: { song: ConceptSong }) {
	const themeConfig = themes[song.theme];
	const colors = getThemedDarkColors(themeConfig);

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				right: 0,
				width: "clamp(440px, 50vw, 760px)",
				height: "100vh",
				background: colors.bg,
				borderLeft: `1px solid ${colors.border}`,
				overflowY: "auto",
				overscrollBehaviorY: "contain",
				color: colors.text,
				fontFamily: fonts.body,
			}}
		>
			<style>{CONCEPT_KEYFRAMES}</style>
			<Hero song={song} colors={colors} />
			<div
				style={{
					paddingLeft: PADDING_X,
					paddingRight: PADDING_X,
					paddingBottom: 80,
				}}
			>
				<SectionSeparator colors={colors} />
				<ReadLayer read={song.read} colors={colors} />
				<SectionSeparator colors={colors} />
				<TakeLayer read={song.read} colors={colors} />
				<SectionSeparator colors={colors} />
				<TraceLayer read={song.read} colors={colors} />
			</div>
		</div>
	);
}

function Hero({ song, colors }: { song: ConceptSong; colors: Palette }) {
	const heroHeight = song.artistImageUrl ? 450 : 200;
	const vignette = `radial-gradient(ellipse at center, transparent 20%, ${colors.bgVignette} 100%),
		linear-gradient(to bottom, transparent 40%, ${colors.bgFade} 100%)`;

	return (
		<div
			style={{
				position: "relative",
				height: heroHeight,
				flexShrink: 0,
			}}
		>
			{song.artistImageUrl ? (
				<>
					<div
						style={{
							position: "absolute",
							inset: 0,
							backgroundImage: `url(${song.artistImageUrl})`,
							backgroundSize: "cover",
							backgroundPosition: "center 30%",
						}}
					/>
					<div
						style={{ position: "absolute", inset: 0, background: vignette }}
					/>
				</>
			) : (
				<div
					style={{ position: "absolute", inset: 0, background: colors.bg }}
				/>
			)}

			<div
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					bottom: 0,
					height: "65%",
					background: `linear-gradient(to bottom, transparent 0%, ${colors.bg} 100%)`,
				}}
			/>

			{song.albumArtUrl ? (
				<img
					src={song.albumArtUrl}
					alt=""
					style={{
						position: "absolute",
						left: PADDING_X,
						bottom: ALBUM_ART_BOTTOM,
						width: ALBUM_ART_SIZE,
						height: ALBUM_ART_SIZE,
						borderRadius: 4,
						objectFit: "cover",
						boxShadow: `0 8px 32px ${colors.bg}`,
						zIndex: 3,
					}}
				/>
			) : (
				<div
					style={{
						position: "absolute",
						left: PADDING_X,
						bottom: ALBUM_ART_BOTTOM,
						width: ALBUM_ART_SIZE,
						height: ALBUM_ART_SIZE,
						background: colors.surface,
						border: `1px solid ${colors.border}`,
						borderRadius: 4,
						zIndex: 3,
					}}
				/>
			)}

			<div
				style={{
					position: "absolute",
					left: PADDING_X + ALBUM_ART_SIZE + 16,
					right: PADDING_X,
					bottom: ALBUM_ART_BOTTOM,
					display: "flex",
					alignItems: "flex-end",
					gap: 14,
					overflow: "hidden",
					zIndex: 4,
				}}
			>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div
						style={{
							fontFamily: fonts.display,
							fontWeight: 400,
							fontSize: 24,
							lineHeight: 1.1,
							color: colors.text,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{song.title}
					</div>
					<div
						style={{
							fontFamily: fonts.body,
							fontSize: 13,
							letterSpacing: "0.04em",
							color: colors.textMuted,
							marginTop: 6,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{song.artist}
					</div>
					<div
						style={{
							fontFamily: fonts.body,
							fontSize: 11,
							lineHeight: 1.25,
							letterSpacing: "0.03em",
							color: colors.textMuted,
							opacity: 0.7,
							marginTop: 3,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{song.album} · {song.year}
					</div>
				</div>
				<SonicNumbers song={song} colors={colors} />
			</div>
		</div>
	);
}

function SonicNumbers({
	song,
	colors,
}: {
	song: ConceptSong;
	colors: Palette;
}) {
	const { tempo, energy, valence } = song.audioFeatures;
	const energyLabel = energy > 0.66 ? "High" : energy > 0.33 ? "Mid" : "Low";
	const valenceLabel =
		valence > 0.66 ? "Bright" : valence > 0.33 ? "Neutral" : "Dark";

	const items: { value: string; label: string }[] = [
		{ value: String(Math.round(tempo)), label: "bpm" },
		{ value: energyLabel, label: "energy" },
		{ value: valenceLabel, label: "valence" },
	];

	return (
		<div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
			{items.map((it) => (
				<div
					key={it.label}
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
							fontSize: 24,
							fontWeight: 400,
							lineHeight: 1,
							color: colors.text,
						}}
					>
						{it.value}
					</span>
					<span
						style={{
							fontSize: 10,
							letterSpacing: "0.14em",
							textTransform: "uppercase",
							color: colors.textMuted,
						}}
					>
						{it.label}
					</span>
				</div>
			))}
		</div>
	);
}

function SectionSeparator({ colors }: { colors: Palette }) {
	return (
		<div
			aria-hidden
			style={{
				height: 1,
				background: colors.border,
				margin: `${SECTION_GAP}px 0`,
			}}
		/>
	);
}

function ReadLayer({ read, colors }: { read: ConceptRead; colors: Palette }) {
	return (
		<section>
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					alignItems: "center",
					gap: 10,
					marginBottom: 16,
				}}
			>
				<span
					style={{
						fontSize: 11,
						letterSpacing: "0.16em",
						textTransform: "uppercase",
						fontWeight: 500,
						color: colors.accent,
					}}
				>
					{read.lens}
				</span>
				<span aria-hidden style={{ color: colors.textDim, fontSize: 11 }}>
					·
				</span>
				<span
					style={{
						fontSize: 11,
						letterSpacing: "0.16em",
						textTransform: "uppercase",
						fontWeight: 500,
						color: colors.textMuted,
					}}
				>
					{read.tension}
				</span>
			</div>

			<h1
				style={{
					fontFamily: fonts.display,
					fontWeight: 400,
					fontSize: 44,
					lineHeight: 1.08,
					letterSpacing: "-0.01em",
					color: colors.text,
					margin: 0,
				}}
			>
				{read.image}
			</h1>
		</section>
	);
}

function TakeLayer({ read, colors }: { read: ConceptRead; colors: Palette }) {
	return (
		<section>
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 16,
					lineHeight: 1.7,
					color: colors.text,
					margin: 0,
				}}
			>
				{read.take}
			</p>
			{read.contradiction && (
				<div
					style={{
						marginTop: 20,
						paddingLeft: 14,
						borderLeft: `2px solid ${colors.accent}`,
					}}
				>
					<p
						style={{
							fontFamily: fonts.body,
							fontStyle: "italic",
							fontSize: 14,
							lineHeight: 1.55,
							color: colors.textMuted,
							margin: 0,
						}}
					>
						{read.contradiction}
					</p>
				</div>
			)}
		</section>
	);
}

function TraceLayer({ read, colors }: { read: ConceptRead; colors: Palette }) {
	const [openArcIdx, setOpenArcIdx] = useState<number | null>(null);

	const onArcToggle = (idx: number) =>
		setOpenArcIdx((cur) => (cur === idx ? null : idx));

	return (
		<section>
			<TraceBlock label="Arc" colors={colors} isFirst>
				<MoodSpine
					arc={read.arc}
					openArcIdx={openArcIdx}
					onArcToggle={onArcToggle}
					colors={colors}
				/>
				{openArcIdx !== null && (
					<ArcDetailCard beat={read.arc[openArcIdx]} colors={colors} />
				)}
			</TraceBlock>

			<TraceBlock label="Lines" colors={colors}>
				<FocusedLines lines={read.lines} colors={colors} />
			</TraceBlock>

			<TraceBlock label="Texture" colors={colors}>
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 14,
						lineHeight: 1.6,
						color: colors.textMuted,
						margin: 0,
					}}
				>
					{read.texture}
				</p>
			</TraceBlock>
		</section>
	);
}

function TraceBlock({
	label,
	colors,
	children,
	isFirst = false,
	paddingBottom = 24,
}: {
	label: string;
	colors: Palette;
	children: React.ReactNode;
	isFirst?: boolean;
	paddingBottom?: number;
}) {
	return (
		<div
			style={{
				paddingTop: isFirst ? 0 : 24,
				paddingBottom,
				borderTop: isFirst ? "none" : `1px solid ${colors.border}`,
			}}
		>
			<div
				style={{
					fontSize: 10,
					letterSpacing: "0.18em",
					textTransform: "uppercase",
					fontWeight: 500,
					color: colors.textDim,
					marginBottom: 18,
				}}
			>
				{label}
			</div>
			{children}
		</div>
	);
}

function MoodSpine({
	arc,
	openArcIdx,
	onArcToggle,
	colors,
}: {
	arc: ConceptRead["arc"];
	openArcIdx: number | null;
	onArcToggle: (idx: number) => void;
	colors: Palette;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: 10,
			}}
		>
			{arc.map((beat, i) => (
				<Fragment key={beat.label}>
					<MoodButton
						mood={beat.mood}
						isOpen={openArcIdx === i}
						onClick={() => onArcToggle(i)}
						colors={colors}
					/>
					{i < arc.length - 1 && (
						<span
							aria-hidden
							style={{
								color: colors.textDim,
								fontSize: 14,
								fontFamily: fonts.body,
							}}
						>
							→
						</span>
					)}
				</Fragment>
			))}
		</div>
	);
}

function MoodButton({
	mood,
	isOpen,
	onClick,
	colors,
}: {
	mood: string;
	isOpen: boolean;
	onClick: () => void;
	colors: Palette;
}) {
	const [hover, setHover] = useState(false);
	const active = isOpen || hover;
	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				background: "transparent",
				border: "none",
				padding: 0,
				cursor: "pointer",
				fontFamily: fonts.body,
				fontSize: 12,
				fontWeight: 500,
				letterSpacing: "0.06em",
				textTransform: "uppercase",
				color: active ? colors.accent : colors.textMuted,
				transition: "color 150ms ease",
			}}
		>
			{mood}
		</button>
	);
}

function ArcDetailCard({
	beat,
	colors,
}: {
	beat: ConceptArcBeat;
	colors: Palette;
}) {
	return (
		<div style={{ marginTop: 18 }}>
			<div
				style={{
					fontSize: 9,
					letterSpacing: "0.14em",
					color: colors.textDim,
					textTransform: "uppercase",
					fontWeight: 400,
					marginBottom: 8,
				}}
			>
				{beat.label}
			</div>
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 14,
					lineHeight: 1.55,
					color: colors.text,
					margin: 0,
				}}
			>
				{beat.scene}
			</p>
		</div>
	);
}

/**
 * One lyric line at a time, looping every FOCUSED_LINE_INTERVAL_MS.
 * Hover/focus pauses the cycle AND reveals the insight beneath the line —
 * one gesture, two purposes: "I'm reading this" + "tell me why it matters."
 *
 * The active dash's CSS animation is the timer: its onAnimationEnd
 * triggers the advance, so pausing (animation-play-state) keeps the visible
 * progress and the next-line trigger perfectly in sync — there is no JS
 * interval that could drift away from what the user sees.
 */
function FocusedLines({
	lines,
	colors,
}: {
	lines: ConceptRead["lines"];
	colors: Palette;
}) {
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const reducedMotion = usePrefersReducedMotion();

	const advance = () => setIndex((i) => (i + 1) % lines.length);

	const current = lines[index];

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: passive pause wrapper; real controls are the buttons inside.
		<div
			onMouseEnter={() => setPaused(true)}
			onMouseLeave={() => setPaused(false)}
			onFocus={() => setPaused(true)}
			onBlur={() => setPaused(false)}
		>
			<div style={{ display: "flex", gap: 6 }}>
				{lines.map((line, i) => {
					const state: TrackState =
						i < index ? "filled" : i === index ? "filling" : "empty";
					return (
						<LineProgressTrack
							key={line.line}
							state={state}
							paused={paused}
							reducedMotion={reducedMotion}
							label={`Show line ${i + 1} of ${lines.length}`}
							onClick={() => setIndex(i)}
							onComplete={advance}
							colors={colors}
						/>
					);
				})}
			</div>

			<div
				key={index}
				style={{
					marginTop: 18,
					animation: reducedMotion
						? undefined
						: "concept-line-in 240ms ease-out both",
				}}
			>
				<p
					style={{
						fontFamily: fonts.display,
						fontStyle: "italic",
						fontSize: 20,
						lineHeight: 1.35,
						color: colors.text,
						margin: 0,
					}}
				>
					&ldquo;{current.line}&rdquo;
				</p>
				{/* Grid 0fr→1fr reveal: collapsed = literally 0px reserved, expanded = */}
				{/* the insight's natural height. Smoothly pushes Texture below during open. */}
				<div
					aria-hidden={!paused}
					style={{
						display: "grid",
						gridTemplateRows: paused ? "1fr" : "0fr",
						transition: reducedMotion
							? "none"
							: "grid-template-rows 260ms ease-out",
					}}
				>
					<div style={{ overflow: "hidden", minHeight: 0 }}>
						<p
							style={{
								marginTop: 14,
								marginBottom: 0,
								fontFamily: fonts.body,
								fontSize: 13,
								lineHeight: 1.6,
								color: colors.textMuted,
							}}
						>
							{current.insight}
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

type TrackState = "empty" | "filling" | "filled";

function LineProgressTrack({
	state,
	paused,
	reducedMotion,
	label,
	onClick,
	onComplete,
	colors,
}: {
	state: TrackState;
	paused: boolean;
	reducedMotion: boolean;
	label: string;
	onClick: () => void;
	onComplete: () => void;
	colors: Palette;
}) {
	const filling = state === "filling";
	const filled = state === "filled";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			aria-current={filling}
			style={{
				position: "relative",
				width: 28,
				height: 2,
				padding: 0,
				border: "none",
				background: filled ? colors.accent : colors.border,
				cursor: "pointer",
				overflow: "hidden",
				transition: "background 220ms ease",
			}}
		>
			{filling && !reducedMotion && (
				<span
					aria-hidden
					onAnimationEnd={onComplete}
					style={{
						position: "absolute",
						inset: 0,
						background: colors.accent,
						transformOrigin: "left",
						transform: "scaleX(0)",
						animation: `concept-line-progress ${FOCUSED_LINE_INTERVAL_MS}ms linear forwards`,
						animationPlayState: paused ? "paused" : "running",
					}}
				/>
			)}
		</button>
	);
}

function usePrefersReducedMotion() {
	const [prefers, setPrefers] = useState(false);
	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		setPrefers(media.matches);
		const onChange = (e: MediaQueryListEvent) => setPrefers(e.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	return prefers;
}
