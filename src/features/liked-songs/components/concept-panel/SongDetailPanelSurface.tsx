/**
 * SongDetailPanelSurface — the song-detail read surface.
 *
 * Layout:
 *   Layer 1 — The Read (lens · tension, then the image)
 *   Layer 2 — The Take (take paragraph + optional contradiction)
 *   Layer 3 — The Trace
 *     - Arc: a clickable mood spine; the open beat's detail is revealed below.
 *     - Lines: the key quotes, cycled one at a time.
 *     - Texture: a single line, always inline.
 *
 * Palette comes from getThemedDarkColors driven by the song's brand theme.
 * SongDetailPanel supplies the slide-in chrome around this surface.
 */

import { LockSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useStepNavigation } from "@/features/onboarding/hooks/useStepNavigation";
import type { SongDisplayState } from "@/lib/domains/billing/state";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { getThemedDarkColors } from "../detail/themed-dark-colors";
import type { ConceptRead, ConceptSong } from "./concept-types";

type Palette = ReturnType<typeof getThemedDarkColors>;

// The locked-state action, computed by the page (which owns billing) and handed
// in pre-resolved so this surface stays billing-agnostic and Ladle-renderable.
export interface LockedCta {
	label: string;
	onClick: () => void;
}

const PADDING_X = 24;
const ALBUM_ART_SIZE = 112;
const ALBUM_ART_BOTTOM = 24; // album art sits fully inside the hero so the hero's borderBottom can run clean
const SONIC_NUMBERS_HEIGHT = 38; // approx height of the bpm/energy/valence block — lets the genre cluster stack just above it in the hero
const GENRE_STACK_GAP = 12; // vertical gap between the genre cluster and the sonic numbers below it
const SECTION_GAP = 40; // padding above + below each section separator (between Read / Take / Trace)
const HERO_HEIGHT = 450; // tall hero when there's an artist image to fill it
const HERO_HEIGHT_NO_IMAGE = 200; // short hero (album-art-only) — no backdrop to give height
// How far the locked CTA is lifted above the geometric center of the space below
// the hero. Geometric centering reads as too low (worse with the tall 450px hero,
// which leaves the CTA stranded in the lower half), so we bias up. The content's
// center lands at roughly (50% − LOCKED_LIFT/2) of that space. Tunable knob.
const LOCKED_LIFT = 0.3;
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
@keyframes concept-pulse {
	0%, 100% { opacity: 1; transform: scale(1); }
	50%      { opacity: 0.3; transform: scale(0.7); }
}
`;

export function SongDetailPanelSurface({
	song,
	isWalkthrough = false,
	isEnrichmentRunning = false,
	lockedCta,
}: {
	song: ConceptSong;
	isWalkthrough?: boolean;
	/** The enrichment pipeline is actively running, so an unread song is being
	 *  analyzed right now rather than simply missing a read. */
	isEnrichmentRunning?: boolean;
	/** Action for the locked state (unlock or see-plans). Omitted in contexts
	 *  without billing (Ladle, walkthrough) — the button then hides. */
	lockedCta?: LockedCta;
}) {
	const themeConfig = themes[song.theme];
	const colors = getThemedDarkColors(themeConfig);
	const heroHeight = song.artistImageUrl ? HERO_HEIGHT : HERO_HEIGHT_NO_IMAGE;
	const isLocked = !song.read && song.displayState === "locked";

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
			<Hero song={song} colors={colors} heroHeight={heroHeight} />
			<div
				style={{
					paddingLeft: PADDING_X,
					paddingRight: PADDING_X,
					// Locked centers its CTA in the full space below the hero, and
					// walkthrough's CTA owns the bottom — both fill exactly, so drop the
					// runway. Otherwise leave scroll runway below the last Trace block.
					paddingBottom: isWalkthrough || isLocked ? 0 : 80,
				}}
			>
				{song.read ? (
					<>
						<SectionSeparator colors={colors} />
						<ReadLayer read={song.read} colors={colors} />
						<SectionSeparator colors={colors} />
						<TakeLayer read={song.read} colors={colors} />
						<SectionSeparator colors={colors} />
						<TraceLayer read={song.read} colors={colors} />
					</>
				) : (
					<UnreadState
						colors={colors}
						displayState={song.displayState}
						isEnrichmentRunning={isEnrichmentRunning}
						heroHeight={heroHeight}
						lockedCta={lockedCta}
					/>
				)}
				{isWalkthrough && <WalkthroughCta colors={colors} />}
			</div>
		</div>
	);
}

function Hero({
	song,
	colors,
	heroHeight,
}: {
	song: ConceptSong;
	colors: Palette;
	heroHeight: number;
}) {
	const vignette = `radial-gradient(ellipse at center, transparent 20%, ${colors.bgVignette} 100%),
		linear-gradient(to bottom, transparent 40%, ${colors.bgFade} 100%)`;

	// Drives both the SonicNumbers gate and where the genre cluster stacks. The
	// block shows whenever *any* metric is present, not just tempo.
	const hasSonicNumbers = getSonicColumns(song.audioFeatures).length > 0;

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
						{song.year != null ? `${song.album} · ${song.year}` : song.album}
					</div>
				</div>
				{hasSonicNumbers && <SonicNumbers song={song} colors={colors} />}
			</div>

			{song.genres.length > 0 && (
				<div
					style={{
						position: "absolute",
						right: PADDING_X,
						// Sit directly above the sonic numbers (or at their baseline when
						// there are none). Anchored to the hero — not the overflow-clipped
						// bottom row — so the leftward fan isn't cut off.
						bottom: hasSonicNumbers
							? ALBUM_ART_BOTTOM + SONIC_NUMBERS_HEIGHT + GENRE_STACK_GAP
							: ALBUM_ART_BOTTOM,
						zIndex: 4,
					}}
				>
					<GenreCluster genres={song.genres} colors={colors} />
				</div>
			)}
		</div>
	);
}

// The hero's bpm/energy/valence columns. Each metric is independent so a song
// with partial features still shows what it has (e.g. bpm alone). tempo of 0
// reads as absent — BPM is never legitimately 0 — while energy/valence of 0 are
// real low-end values, so only null drops them.
function getSonicColumns(
	audioFeatures: ConceptSong["audioFeatures"],
): { value: string; label: string }[] {
	const { tempo, energy, valence } = audioFeatures;
	return [
		tempo != null && tempo > 0
			? { value: String(Math.round(tempo)), label: "bpm" }
			: null,
		energy != null
			? {
					value: energy > 0.66 ? "High" : energy > 0.33 ? "Mid" : "Low",
					label: "energy",
				}
			: null,
		valence != null
			? {
					value:
						valence > 0.66 ? "Bright" : valence > 0.33 ? "Neutral" : "Dark",
					label: "valence",
				}
			: null,
	].filter((column) => column !== null) as { value: string; label: string }[];
}

function SonicNumbers({
	song,
	colors,
}: {
	song: ConceptSong;
	colors: Palette;
}) {
	const items = getSonicColumns(song.audioFeatures);

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

// Stands in for the Read/Take/Trace layers when a song has no v17 read yet. The
// hero still renders above, so the panel always carries the song's identity even
// before its read exists. The three branches answer *why* the read is missing:
//   - locked      → not unlocked yet; offer the unlock path.
//   - analyzing   → queued or running (pending/analyzing) — a read is on its way.
//   - unavailable → finished without a usable read (failed, or too thin to read).
function UnreadState({
	colors,
	displayState,
	isEnrichmentRunning = false,
	heroHeight,
	lockedCta,
}: {
	colors: Palette;
	displayState?: SongDisplayState;
	isEnrichmentRunning?: boolean;
	heroHeight: number;
	lockedCta?: LockedCta;
}) {
	// Locked is a terminal CTA, so it skips the section separator and centers in
	// the space the hero leaves. Analyzing/unavailable are transient and stay
	// inline where the read would start.
	if (displayState === "locked") {
		return (
			<LockedState colors={colors} heroHeight={heroHeight} cta={lockedCta} />
		);
	}

	// "pending" (e.g. a song just unlocked and queued) and "analyzing" both mean a
	// read is on its way, so they show the live "Listening" state. Only a row that
	// finished without a usable read ("analyzed" but unparseable, or "failed") falls
	// through to the "Quiet one" couldn't-find copy.
	const isAnalyzing =
		isEnrichmentRunning ||
		displayState === "analyzing" ||
		displayState === "pending";

	return (
		<>
			<SectionSeparator colors={colors} />
			<section>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontSize: 11,
						letterSpacing: "0.16em",
						textTransform: "uppercase",
						fontWeight: 500,
						color: isAnalyzing ? colors.accent : colors.textDim,
						marginBottom: 12,
					}}
				>
					{isAnalyzing && <PulseDot color={colors.accent} />}
					{isAnalyzing ? "Listening" : "Quiet one"}
				</div>
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 14,
						lineHeight: 1.6,
						color: colors.textMuted,
						margin: 0,
					}}
				>
					{isAnalyzing
						? "Getting a feel for this one…"
						: "We couldn’t find enough about this one."}
				</p>
			</section>
		</>
	);
}

function LockedState({
	colors,
	heroHeight,
	cta,
}: {
	colors: Palette;
	heroHeight: number;
	cta?: LockedCta;
}) {
	const [hovered, setHovered] = useState(false);

	return (
		<section
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				textAlign: "center",
				gap: 18,
				// Fill the viewport height the hero leaves, then lift the CTA above the
				// midpoint (see LOCKED_LIFT) — the extra bottom padding is what raises it.
				// Proportional, so it tracks viewport and hero size.
				minHeight: `calc(100vh - ${heroHeight}px)`,
				paddingBottom: `calc((100vh - ${heroHeight}px) * ${LOCKED_LIFT})`,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 48,
					height: 48,
					borderRadius: 24,
					background: `color-mix(in srgb, ${colors.accent} 14%, transparent)`,
				}}
			>
				<LockSimpleIcon size={20} color={colors.accent} weight="light" />
			</div>
			<div>
				<p
					style={{
						fontFamily: fonts.display,
						fontWeight: 400,
						fontSize: 22,
						lineHeight: 1.2,
						color: colors.text,
						margin: 0,
					}}
				>
					This song is locked
				</p>
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 14,
						lineHeight: 1.6,
						color: colors.textMuted,
						margin: "10px auto 0",
						maxWidth: 320,
					}}
				>
					Open it up to see what it's saying, how it feels, and where it fits.
				</p>
			</div>
			{cta && (
				<button
					type="button"
					onClick={cta.onClick}
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => setHovered(false)}
					style={{
						marginTop: 4,
						padding: "11px 24px",
						fontFamily: fonts.body,
						fontSize: 13,
						fontWeight: 600,
						letterSpacing: "0.02em",
						color: colors.bg,
						background: colors.accent,
						border: "none",
						borderRadius: 999,
						cursor: "pointer",
						opacity: hovered ? 0.9 : 1,
						transition: "opacity 150ms ease",
					}}
				>
					{cta.label}
				</button>
			)}
		</section>
	);
}

// Small breathing dot that signals the panel is waiting on a live analysis. The
// pulse is the only motion in the empty state, so it reads as "working" without a
// spinner. Honors reduced-motion by holding the dot steady.
function PulseDot({ color }: { color: string }) {
	const reducedMotion = usePrefersReducedMotion();
	return (
		<span
			aria-hidden
			style={{
				width: 6,
				height: 6,
				borderRadius: 3,
				background: color,
				animation: reducedMotion
					? undefined
					: "concept-pulse 1.4s ease-in-out infinite",
			}}
		/>
	);
}

// Factual track metadata, not interpretation. It's anchored in the hero as a
// right-aligned cluster directly above the sonic numbers — pairing the two as one
// metadata column instead of floating in dead space below the hero. Only the primary
// genre shows at rest (a quiet "+N" hints there's more); hovering, focusing, or
// tapping fans the alternates out to the LEFT, into the hero's open band, so the
// reveal never runs past the right edge or reflows the title. Order is
// [primary][+N][alternates] with the whole cluster right-anchored, so at rest the
// "+N" sits at the right edge and on open it collapses while the alternates grow the
// cluster leftward. Genres are capped at 3 upstream (genres.slice(0, 3)).
function GenreCluster({
	genres,
	colors,
}: {
	genres: string[];
	colors: Palette;
}) {
	const [primary, ...alternates] = genres;
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [pinned, setPinned] = useState(false);
	const reducedMotion = usePrefersReducedMotion();
	const open = hovered || focused || pinned;

	// One genre → nothing to reveal, so render a plain static pill (no button).
	if (alternates.length === 0) {
		return <GenrePill label={primary} colors={colors} primary />;
	}

	// The 0fr↔1fr grid trick (same as the Arc's expand) animates a child between
	// zero and content width with no hard-coded max — so a genre of any length
	// reveals without clipping. `i` staggers the fan; the collapse is unstaggered.
	const reveal = (visible: boolean, i: number): React.CSSProperties => ({
		display: "grid",
		gridTemplateColumns: visible ? "1fr" : "0fr",
		transition: reducedMotion
			? "none"
			: "grid-template-columns 300ms cubic-bezier(0.22, 1, 0.36, 1)",
		transitionDelay: reducedMotion || !open ? "0ms" : `${i * 45}ms`,
	});

	return (
		<button
			type="button"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
			onClick={() => setPinned((p) => !p)}
			aria-expanded={open}
			aria-label={`Genres: ${genres.join(", ")}`}
			style={{
				display: "inline-flex",
				alignItems: "center",
				padding: 0,
				background: "transparent",
				border: "none",
				cursor: "pointer",
				whiteSpace: "nowrap",
			}}
		>
			<GenrePill label={primary} colors={colors} primary />

			<span aria-hidden style={reveal(!open, 0)}>
				<span style={{ overflow: "hidden", minWidth: 0 }}>
					<span
						style={{
							display: "inline-block",
							paddingLeft: 8,
							fontFamily: fonts.body,
							fontSize: 11,
							letterSpacing: "0.04em",
							whiteSpace: "nowrap",
							color: colors.textDim,
							opacity: open ? 0 : 1,
							transition: reducedMotion ? "none" : "opacity 160ms ease",
						}}
					>
						+{alternates.length}
					</span>
				</span>
			</span>

			{alternates.map((genre, i) => (
				<span key={genre} style={reveal(open, i)}>
					<span style={{ overflow: "hidden", minWidth: 0 }}>
						<span
							style={{
								display: "inline-block",
								paddingLeft: 6,
								opacity: open ? 1 : 0,
								transform: open ? "translateX(0)" : "translateX(-4px)",
								transition: reducedMotion
									? "none"
									: "opacity 240ms ease, transform 300ms cubic-bezier(0.22, 1, 0.36, 1)",
								transitionDelay: reducedMotion || !open ? "0ms" : `${i * 45}ms`,
							}}
						>
							<GenrePill label={genre} colors={colors} />
						</span>
					</span>
				</span>
			))}
		</button>
	);
}

function GenrePill({
	label,
	colors,
	primary = false,
}: {
	label: string;
	colors: Palette;
	primary?: boolean;
}) {
	return (
		<span
			style={{
				display: "inline-block",
				padding: "5px 12px",
				borderRadius: 999,
				fontFamily: fonts.body,
				fontSize: 11,
				lineHeight: 1,
				letterSpacing: "0.04em",
				whiteSpace: "nowrap",
				color: primary ? colors.accent : colors.textMuted,
				border: `1px solid ${
					primary
						? `color-mix(in srgb, ${colors.accent} 32%, transparent)`
						: colors.border
				}`,
				background: primary
					? `color-mix(in srgb, ${colors.accent} 9%, transparent)`
					: colors.bg,
			}}
		>
			{label}
		</span>
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
	return (
		<section>
			<TraceBlock label="Arc" colors={colors} isFirst>
				<ArcSpine arc={read.arc} colors={colors} />
			</TraceBlock>

			<TraceBlock label="Lines" colors={colors}>
				<FocusedLines lines={read.lines} colors={colors} />
			</TraceBlock>

			{read.texture && (
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
			)}
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

// Vertical timeline: order reads top→bottom (one direction, no wrap), the
// structural label stays visible as a wayfinding cue, and each beat's scene
// expands at its own node instead of detached below the whole spine.
function ArcSpine({
	arc,
	colors,
}: {
	arc: ConceptRead["arc"];
	colors: Palette;
}) {
	const [openIdx, setOpenIdx] = useState<number | null>(0);
	const reducedMotion = usePrefersReducedMotion();
	const toggle = (i: number) => setOpenIdx((cur) => (cur === i ? null : i));

	return (
		<div>
			{arc.map((beat, i) => {
				const isLast = i === arc.length - 1;
				const open = openIdx === i;
				return (
					<div key={beat.label} style={{ display: "flex", gap: 14 }}>
						<div style={{ position: "relative", width: 10, flexShrink: 0 }}>
							{!isLast && (
								<div
									aria-hidden
									style={{
										position: "absolute",
										left: "50%",
										transform: "translateX(-50%)",
										top: 6,
										bottom: 0,
										width: 1,
										background: colors.border,
									}}
								/>
							)}
							<div
								aria-hidden
								style={{
									position: "relative",
									width: 9,
									height: 9,
									marginTop: 2,
									borderRadius: 5,
									background: open ? colors.accent : colors.bg,
									border: `1.5px solid ${open ? colors.accent : colors.textDim}`,
									transition: "background 150ms ease, border-color 150ms ease",
								}}
							/>
						</div>
						<div
							style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 22 }}
						>
							<button
								type="button"
								onClick={() => toggle(i)}
								aria-expanded={open}
								style={{
									display: "flex",
									alignItems: "baseline",
									flexWrap: "wrap",
									gap: 8,
									width: "100%",
									background: "transparent",
									border: "none",
									padding: 0,
									cursor: "pointer",
									textAlign: "left",
								}}
							>
								<span
									style={{
										fontSize: 10,
										letterSpacing: "0.14em",
										textTransform: "uppercase",
										fontWeight: 500,
										color: colors.textDim,
									}}
								>
									{beat.label}
								</span>
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 13,
										fontWeight: 500,
										letterSpacing: "0.02em",
										color: open ? colors.accent : colors.text,
										transition: "color 150ms ease",
									}}
								>
									{beat.mood}
								</span>
							</button>
							<div
								aria-hidden={!open}
								style={{
									display: "grid",
									gridTemplateRows: open ? "1fr" : "0fr",
									transition: reducedMotion
										? "none"
										: "grid-template-rows 260ms ease-out",
								}}
							>
								<div style={{ overflow: "hidden", minHeight: 0 }}>
									<p
										style={{
											marginTop: 8,
											marginBottom: 0,
											fontFamily: fonts.body,
											fontSize: 13,
											lineHeight: 1.6,
											color: colors.textMuted,
										}}
									>
										{beat.scene}
									</p>
								</div>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}

/**
 * One lyric line at a time, looping every FOCUSED_LINE_INTERVAL_MS.
 * Hover/focus pauses the cycle so a line can be sat with instead of advancing.
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

// Walkthrough-only footer. The read is the demo song's payoff; this carries the
// onboarding forward into the match step. `position: sticky` (not fixed) pins it
// to the panel's own scroll viewport without escaping the slide-in chrome, and
// the gradient fades the read out behind it as it scrolls past. The hook lives
// inside this component so it only runs when the CTA is actually mounted.
function WalkthroughCta({ colors }: { colors: Palette }) {
	const { navigateTo, isPending } = useStepNavigation();
	const [isNavigating, setIsNavigating] = useState(false);
	const [hovered, setHovered] = useState(false);
	const reducedMotion = usePrefersReducedMotion();

	const disabled = isNavigating || isPending;

	const handleClick = async () => {
		if (disabled) return;
		setIsNavigating(true);
		try {
			await navigateTo("match-walkthrough");
		} finally {
			setIsNavigating(false);
		}
	};

	return (
		<div
			style={{
				position: "sticky",
				bottom: 0,
				paddingTop: 24,
				paddingBottom: 28,
				background: `linear-gradient(to bottom, transparent, ${colors.bg} 32%)`,
			}}
		>
			<button
				type="button"
				onClick={handleClick}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				disabled={disabled}
				aria-label="See where this song belongs"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: 10,
					width: "100%",
					padding: "15px 24px",
					fontFamily: fonts.body,
					fontSize: 12,
					fontWeight: 600,
					letterSpacing: "0.12em",
					textTransform: "uppercase",
					color: colors.bg,
					background: colors.accent,
					border: "none",
					borderRadius: 12,
					cursor: disabled ? "default" : "pointer",
					opacity: disabled ? 0.55 : 1,
					transition: "opacity 150ms ease",
				}}
			>
				See where this song belongs
				<span
					aria-hidden
					style={{
						transform:
							hovered && !disabled && !reducedMotion
								? "translateX(3px)"
								: "translateX(0)",
						transition: reducedMotion ? "none" : "transform 180ms ease",
					}}
				>
					&rarr;
				</span>
			</button>
		</div>
	);
}
