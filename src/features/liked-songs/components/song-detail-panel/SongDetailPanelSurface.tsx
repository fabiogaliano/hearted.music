/**
 * SongDetailPanelSurface — the song-detail read surface.
 *
 * Layout:
 *   The Read — lens · tension, then the image. The header is the toggle (cued by
 *     "read deeper →"); clicking reveals the take in a selectable drawer below, so the
 *     headline lands on its own first.
 *   The Trace
 *     - Arc: a clickable mood spine; the open beat's detail is revealed below.
 *     - Lines: the key quotes, cycled one at a time.
 *     - Texture: a single line, always inline.
 *
 * Palette comes from getThemedDarkColors driven by the song's brand theme.
 * SongDetailPanel supplies the slide-in chrome around this surface.
 */

import { LockSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { useStepNavigation } from "@/features/onboarding/hooks/useStepNavigation";
import type { SongDisplayState } from "@/lib/domains/billing/state";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { getThemedDarkColors } from "../detail/themed-dark-colors";
import { getThemedLightColors } from "../detail/themed-light-colors";
import type {
	PlaylistSuggestionView,
	PlaylistsPanel,
	SongDetail,
	SongInstrumentalRead,
	SongRead,
} from "./song-detail-types";

type Palette = ReturnType<typeof getThemedDarkColors>;

// The locked-state action, computed by the page (which owns billing) and handed
// in pre-resolved so this surface stays billing-agnostic and Ladle-renderable.
export interface LockedCta {
	label: string;
	onClick: () => void;
}

const PADDING_X = 24;
// Shared by the fixed surface and the walkthrough scrim so both cover the same box.
// Full-screen overlay on small screens, fixed side panel at lg+ (see styles.css).
const PANEL_WIDTH = "var(--song-panel-width)";
const ALBUM_ART_SIZE = 112;
const ALBUM_ART_BOTTOM = 24; // album art sits fully inside the hero so the hero's borderBottom can run clean
const SONIC_NUMBERS_HEIGHT = 38; // approx height of the bpm/energy/valence block — lets the genre cluster stack just above it in the hero
const GENRE_STACK_GAP = 12; // vertical gap between the genre cluster and the sonic numbers below it
const SECTION_GAP = 40; // padding above + below each section's content, framing it between dividers
const HERO_HEIGHT = 450; // tall hero when there's an artist image to fill it
const HERO_HEIGHT_NO_IMAGE = 200; // short hero (album-art-only) — no backdrop to give height
// How far the locked CTA is lifted above the geometric center of the space below
// the hero. Geometric centering reads as too low (worse with the tall 450px hero,
// which leaves the CTA stranded in the lower half), so we bias up. The content's
// center lands at roughly (50% − LOCKED_LIFT/2) of that space. Tunable knob.
const LOCKED_LIFT = 0.3;
const FOCUSED_LINE_INTERVAL_MS = 7000;
// Take-drawer reveal. Longer than the Arc's 260ms (taller block = more travel), still under
// the 300ms ceiling. Shares the genre fan's ease-out-quint so the reveals feel of a piece.
const READ_DEEPER_MS = 300;
const READ_DEEPER_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
// Hover-intent grace before the genre fan collapses. Long enough to bridge a quick
// sweep across the cluster and the sub-pixel seams between pills as they animate (so
// the fan doesn't flap open/shut), short enough not to feel sticky on a small reveal.
const GENRE_HOVER_CLOSE_MS = 120;

const CONCEPT_STYLES = `
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
/* Staggered entrance for the read's content bands, after the shell's slide-in. Replays per
   song (surface is keyed). transform only in from-keyframe, so no band lingers as a transformed
   ancestor — that would become a containing block over the close morph. */
@keyframes concept-rise-in {
	from { opacity: 0; transform: translateY(10px); }
	to   { opacity: 1; }
}
.concept-rise { animation: concept-rise-in 420ms var(--ease-out-quart) both; }
.concept-rise-1 { animation-delay: 0ms; }
.concept-rise-2 { animation-delay: 90ms; }
.concept-rise-3 { animation-delay: 180ms; }
/* Hit-area extenders: a transparent ::after grows a small control to the 40px minimum
   without shifting layout. Host must not clip overflow, or the pseudo gets cropped. */
.concept-hit-40 { position: relative; }
.concept-hit-40::after {
	content: "";
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: 100%;
	height: 100%;
	min-width: 40px;
	min-height: 40px;
}
.concept-line-track { position: relative; }
.concept-line-track::after {
	content: "";
	position: absolute;
	left: 0;
	right: 0;
	/* 2px bar → ~40px target; vertical-only so it can't cross the 6px gap into a neighbour. */
	top: -19px;
	bottom: -19px;
}
/* Hide the panel's own scrollbar so only the browser/list scrollbar shows — no more
   double bars. The panel still scrolls when the cursor is over it; overscrollBehaviorY
   "contain" (set on the element) keeps that scroll from chaining into the list behind. */
.song-detail-panel-scroll { scrollbar-width: none; }
.song-detail-panel-scroll::-webkit-scrollbar { display: none; }
@media (prefers-reduced-motion: reduce) {
	.concept-rise { animation: none; }
}
`;

export function SongDetailPanelSurface({
	song,
	isExpanded = true,
	isWalkthrough = false,
	isEnrichmentRunning = false,
	lockedCta,
	playlists,
	readDeeperOpen,
	onReadDeeperChange,
	variant = "fixed",
	colorMode = "dark",
}: {
	song: SongDetail;
	/** "fixed" (default) is the app's slide-in panel pinned to the viewport's right
	 *  edge. "embedded" drops the fixed positioning so the surface fills its parent
	 *  box instead — used by the landing hero, which mounts the read inside its own
	 *  layer rather than over the viewport. */
	variant?: "fixed" | "embedded";
	/** The app panel stays on the dark palette by default. Landing can opt into a
	 *  light palette while still rendering the same production surface. */
	colorMode?: "dark" | "light";
	/** Drives the shared-element view-transition names on the hero's album / title /
	 *  artist. While open the hero carries `song-album` / `song-title` / `song-artist`
	 *  so the close morph (panel → clicked row) has a "from" element; the wrapper flips
	 *  this to false inside the transition so the names hand off to the card. Defaults
	 *  to true so a standalone render (Ladle) still shows the open hero. */
	isExpanded?: boolean;
	isWalkthrough?: boolean;
	/** The enrichment pipeline is actively running, so an unread song is being
	 *  analyzed right now rather than simply missing a read. */
	isEnrichmentRunning?: boolean;
	/** Action for the locked state (unlock or see-plans). Omitted in contexts
	 *  without billing (Ladle, walkthrough) — the button then hides. */
	lockedCta?: LockedCta;
	/** Add-to-playlist matches for the bottom of an analyzed read, resolved by the
	 *  page. Omitted in walkthrough/Ladle or when there are no matches — the
	 *  section then hides. */
	playlists?: PlaylistsPanel;
	/** "Read deeper" open state, lifted to the chrome to survive the per-song remount.
	 *  Controlled when provided; falls back to internal state (Ladle) seeded by isWalkthrough. */
	readDeeperOpen?: boolean;
	onReadDeeperChange?: (open: boolean) => void;
}) {
	const themeConfig = themes[song.theme];
	const colors =
		colorMode === "light"
			? getThemedLightColors(themeConfig)
			: getThemedDarkColors(themeConfig);
	const heroHeight = song.artistImageUrl ? HERO_HEIGHT : HERO_HEIGHT_NO_IMAGE;
	const isLocked =
		!song.read && !song.instrumentalRead && song.displayState === "locked";

	// Controlled by the chrome, with a local fallback for standalone (Ladle). ?? not || so a
	// controlled `false` is honored. Starts collapsed — the headline lands first.
	const [internalReadDeeperOpen, setInternalReadDeeperOpen] = useState(false);
	const resolvedReadDeeperOpen = readDeeperOpen ?? internalReadDeeperOpen;
	const setResolvedReadDeeperOpen =
		onReadDeeperChange ?? setInternalReadDeeperOpen;

	return (
		<div
			className="song-detail-panel-scroll"
			style={{
				...(variant === "embedded"
					? { position: "relative", width: "100%", height: "100%" }
					: {
							position: "fixed",
							top: 0,
							right: 0,
							width: PANEL_WIDTH,
							height: "100vh",
							borderLeft: `1px solid ${colors.border}`,
						}),
				background: colors.bg,
				overflowY: "auto",
				// The app panel contains overscroll so the list behind never moves; embedded
				// (landing) chains it so the page keeps scrolling once the read bottoms out.
				overscrollBehaviorY: variant === "embedded" ? "auto" : "contain",
				color: colors.text,
				fontFamily: fonts.body,
			}}
		>
			<style>{CONCEPT_STYLES}</style>
			<Hero
				song={song}
				colors={colors}
				heroHeight={heroHeight}
				isExpanded={isExpanded}
			/>
			<div
				style={{
					paddingLeft: PADDING_X,
					paddingRight: PADDING_X,
					// Sections draw their own divider + padding; this pads above the first so it
					// doesn't hug the hero. Locked has no frame, so 0.
					paddingTop: isLocked ? 0 : SECTION_GAP,
					// Locked centers its CTA in the full space below the hero, and
					// walkthrough's CTA owns the bottom — both fill exactly, so drop the
					// runway. Otherwise leave scroll runway below the last Trace block.
					paddingBottom: isWalkthrough || isLocked ? 0 : 80,
				}}
			>
				{song.read ? (
					<>
						<div className="concept-rise concept-rise-1">
							<ReadLayer
								read={song.read}
								colors={colors}
								open={resolvedReadDeeperOpen}
								onOpenChange={setResolvedReadDeeperOpen}
							/>
						</div>
						<div className="concept-rise concept-rise-2">
							<TraceLayer read={song.read} colors={colors} />
						</div>
						{playlists && playlists.matches.length > 0 && (
							<div className="concept-rise concept-rise-3">
								<PlaylistsLayer colors={colors} playlists={playlists} />
							</div>
						)}
					</>
				) : song.instrumentalRead ? (
					<div className="concept-rise concept-rise-1">
						<InstrumentalReadLayer
							read={song.instrumentalRead}
							colors={colors}
						/>
					</div>
				) : (
					<div className="concept-rise concept-rise-1">
						<UnreadState
							colors={colors}
							displayState={song.displayState}
							contentFetchStatus={song.contentFetchStatus}
							isEnrichmentRunning={isEnrichmentRunning}
							heroHeight={heroHeight}
							lockedCta={lockedCta}
						/>
					</div>
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
	isExpanded,
}: {
	song: SongDetail;
	colors: Palette;
	heroHeight: number;
	isExpanded: boolean;
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
					data-panel-album-art=""
					style={{
						position: "absolute",
						left: PADDING_X,
						bottom: ALBUM_ART_BOTTOM,
						width: ALBUM_ART_SIZE,
						height: ALBUM_ART_SIZE,
						objectFit: "cover",
						// Layered shadow (contact + ambient) reads as depth against the hero; the old
						// single bg-coloured glow vanished into the matching dark background.
						boxShadow:
							"0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.45)",
						// Crisp 1px edge: pure white, not a tinted neutral (which reads as dirt). outline,
						// not box-shadow, so the close-morph shadow-strip can't erase it.
						outline: "1px solid rgba(255, 255, 255, 0.1)",
						outlineOffset: "-1px",
						zIndex: 3,
						// Shared-element morph target for the clicked card's album art. The
						// box-shadow above is stripped during close (styles.css, keyed off
						// data-panel-album-art) so it isn't baked into the morph snapshot.
						viewTransitionName: isExpanded ? "song-album" : "none",
					}}
				/>
			) : (
				<div
					data-panel-album-art=""
					style={{
						position: "absolute",
						left: PADDING_X,
						bottom: ALBUM_ART_BOTTOM,
						width: ALBUM_ART_SIZE,
						height: ALBUM_ART_SIZE,
						background: colors.surface,
						// Match the real art's lift + pure-white edge so the placeholder reads as the same object.
						boxShadow:
							"0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.45)",
						outline: "1px solid rgba(255, 255, 255, 0.1)",
						outlineOffset: "-1px",
						zIndex: 3,
						viewTransitionName: isExpanded ? "song-album" : "none",
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
							viewTransitionName: isExpanded ? "song-title" : "none",
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
							viewTransitionName: isExpanded ? "song-artist" : "none",
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
	audioFeatures: SongDetail["audioFeatures"],
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

function SonicNumbers({ song, colors }: { song: SongDetail; colors: Palette }) {
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
							// Tabular figures so bpm digits don't jitter the column width song to song.
							fontVariantNumeric: "tabular-nums",
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

// Stands in for the Read/Instrumental/Trace layers when a song has no read yet.
// The hero still renders above — every selected song opens the panel. Four branches
// answer *why* the content is missing:
//   - locked      → not unlocked yet; offer the unlock path (terminal CTA, no divider).
//   - analyzing   → genuinely in-flight: no settled fetch outcome yet, or the fetch
//                   found lyrics but the read hasn’t been generated yet.
//   - unavailable → lyrics-fetch has settled to a no-read outcome (not_found or
//                   instrumental without a read), or the analysis ran and produced no
//                   parseable output. Distinct from analyzing: honest "No words yet".
//
// Resolved-unknown fix: a song that cleanly resolves to "unknown" (retry candidate:
// lyrics fetch returned not_found, no song_analysis row written) used to show
// "Listening" forever because display_state stays ‘pending’ with no analysis row.
// contentFetchStatus = ‘not_found’ is the settled signal that breaks the loop:
// no read + not_found → "No words yet", not "Listening".
//
// instrumental without a read: fetch settled to ‘instrumental’ but no analysis row
// parsed successfully — treated as "No words yet" (the read is unavailable, not in-
// flight). This matches the resolved-unknown treatment: a settled fetch with no read.
//
// isEnrichmentRunning still matters for the genuinely in-flight case (e.g. a song
// just unlocked with no fetch outcome yet), but it is NOT allowed to override a
// settled not_found — a song whose fetch is done is not "Listening" regardless of
// whether the pipeline is running for other songs.
function UnreadState({
	colors,
	displayState,
	contentFetchStatus,
	isEnrichmentRunning = false,
	heroHeight,
	lockedCta,
}: {
	colors: Palette;
	displayState?: SongDisplayState;
	contentFetchStatus?: "lyrics" | "instrumental" | "not_found" | null;
	isEnrichmentRunning?: boolean;
	heroHeight: number;
	lockedCta?: LockedCta;
}) {
	// Locked is a terminal CTA, centered in the hero-free viewport space.
	if (displayState === "locked") {
		return (
			<LockedState colors={colors} heroHeight={heroHeight} cta={lockedCta} />
		);
	}

	// A settled fetch outcome with no read means the song is resolved-unknown or
	// resolved-instrumental-without-read — show "No words yet", not "Listening".
	// not_found: the lyrics fetch confirmed no lyrics exist for this song.
	// instrumental without a read: the fetch found it’s instrumental but no analysis
	// row parsed successfully yet — still "unavailable", not in-flight.
	const fetchSettledWithNoRead =
		contentFetchStatus === "not_found" || contentFetchStatus === "instrumental";

	// "Listening" only when genuinely pre-resolution:
	// - the fetch has not settled yet (null) AND the song is in-flight per
	//   display_state or the pipeline is actively running;
	// - OR the fetch returned lyrics but the read hasn’t arrived yet.
	// A settled not_found always overrides isEnrichmentRunning.
	const isAnalyzing =
		!fetchSettledWithNoRead &&
		(isEnrichmentRunning ||
			displayState === "analyzing" ||
			displayState === "pending" ||
			contentFetchStatus === "lyrics");

	return (
		<section
			style={{
				borderTop: `1px solid ${colors.border}`,
				padding: `${SECTION_GAP}px 0`,
			}}
		>
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
				{isAnalyzing ? "Listening" : "No words yet"}
			</div>
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 14,
					lineHeight: 1.6,
					// Pretty: no orphan word on the last line.
					textWrap: "pretty",
					color: colors.textMuted,
					margin: 0,
				}}
			>
				{isAnalyzing
					? "Getting a feel for this one…"
					: "We don’t have the words for this one yet."}
			</p>
		</section>
	);
}

// Renders a confirmed-instrumental analysis: sound-first, brand-voiced. Follows
// the ReadLayer section idiom (border-top divider, SECTION_GAP padding) so it
// reads as the same visual family as the lyrical read without inventing a new
// language. The compound_mood/sonic_texture pair mirrors lens/tension’s role as
// the overture before the headline lands, and mood_description is the "take"
// equivalent — the evocative paragraph that earns the headline.
function InstrumentalReadLayer({
	read,
	colors,
}: {
	read: SongInstrumentalRead;
	colors: Palette;
}) {
	return (
		<section
			style={{
				borderTop: `1px solid ${colors.border}`,
				padding: `${SECTION_GAP}px 0`,
			}}
		>
			{/* compound_mood · sonic_texture — the overture, mirrors lens · tension */}
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
					{read.compound_mood}
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
					{read.sonic_texture}
				</span>
			</div>

			{/* headline — the image-scale lead, mirrors `read.image` */}
			<p
				style={{
					fontFamily: fonts.display,
					fontWeight: 400,
					fontSize: 44,
					lineHeight: 1.08,
					letterSpacing: "-0.01em",
					color: colors.text,
					margin: "0 0 20px",
				}}
			>
				{read.headline}
			</p>

			{/* mood_description — the evocative paragraph, mirrors `read.take` */}
			<p
				style={{
					fontFamily: fonts.body,
					fontSize: 16,
					lineHeight: 1.7,
					// Pretty: no orphan word on the last line.
					textWrap: "pretty",
					color: colors.text,
					margin: 0,
				}}
			>
				{read.mood_description}
			</p>
		</section>
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
	const [pressed, setPressed] = useState(false);
	const reducedMotion = usePrefersReducedMotion();

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
						// Pretty: no orphan word on the last line.
						textWrap: "pretty",
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
					onMouseLeave={() => {
						setHovered(false);
						setPressed(false);
					}}
					onMouseDown={() => setPressed(true)}
					onMouseUp={() => setPressed(false)}
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
						// Tactile press, matching Button.tsx's active:scale-[0.98].
						transform: pressed && !reducedMotion ? "scale(0.98)" : "scale(1)",
						transition: reducedMotion
							? "none"
							: "opacity 150ms ease, transform 150ms ease",
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
// genre shows at rest (a quiet "+N" hints there's more); hovering OR keyboard-focusing
// fans the alternates out to the LEFT, into the hero's open band, so the reveal never
// runs past the right edge or reflows the title. It reveals on hover/focus with no click
// action (open = hovered || focused): an outer div owns the hover "blast radius", an
// inner button is the Tab stop and carries the themed focus ring snug around the pills.
// Every genre also stays in the DOM, and the button is aria-labelled with the full list
// ("+N" is aria-hidden), so screen readers get all of it. Order is
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
	const reducedMotion = usePrefersReducedMotion();
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Hover or keyboard focus reveals the fan; focus makes it Tab-reachable.
	const open = hovered || focused;

	// Hover-intent: open at once, but defer the collapse. A quick sweep across the
	// cluster — or the cursor hopping the sub-pixel seams between pills as they grow —
	// would otherwise fire enter/leave in bursts and flap the fan open and shut.
	// Re-entering within the grace window cancels the pending close, so the fan only
	// collapses once the cursor has truly left (the nav-menu hover-intent pattern).
	const openFan = () => {
		if (closeTimer.current) {
			clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		setHovered(true);
	};
	const closeFanSoon = () => {
		closeTimer.current = setTimeout(
			() => setHovered(false),
			GENRE_HOVER_CLOSE_MS,
		);
	};
	// Keyboard focus opens now and closes on blur — blur is deliberate, so no grace
	// window. Clear any pending hover-close so tabbing in mid-collapse won't yank it shut.
	const focusFan = () => {
		if (closeTimer.current) {
			clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		setFocused(true);
	};
	const blurFan = () => setFocused(false);
	useEffect(
		() => () => {
			if (closeTimer.current) clearTimeout(closeTimer.current);
		},
		[],
	);

	// One genre → nothing to reveal, so render a plain static pill.
	if (alternates.length === 0) {
		return <GenrePill label={primary} colors={colors} primary />;
	}

	// ease-out-quint: fast start, soft settle — the curve for elements that
	// enter/exit (animations.dev). Shared by the grid reveal and the pill slide so
	// the two read as one motion.
	const ease = "cubic-bezier(0.22, 1, 0.36, 1)";

	// The 0fr↔1fr grid trick (same as the Arc's expand) animates a child between
	// zero and content width with no hard-coded max — so a genre of any length
	// reveals without clipping. It drives grid-template-columns (a layout prop, not
	// transform), against the animate-transform-only rule — but it's two pills moved
	// occasionally, so the off-GPU cost is negligible and it's the only way to reach
	// content width with no magic max. Pills are small over a short distance, so the
	// reveal is quick (240ms) and the collapse runs ~20% faster (190ms) per the
	// skill's exit-faster-than-entrance rule. `i` staggers the entering fan; the
	// collapse moves as one (no stagger).
	const reveal = (visible: boolean, i: number): React.CSSProperties => ({
		display: "grid",
		gridTemplateColumns: visible ? "1fr" : "0fr",
		transition: reducedMotion
			? "none"
			: `grid-template-columns ${visible ? 240 : 190}ms ${ease}`,
		transitionDelay: reducedMotion || !visible ? "0ms" : `${i * 40}ms`,
	});

	return (
		// Outer layer: the forgiving hover "blast radius". Not focusable, default cursor,
		// no text selection. The padding extends the hover zone past the pills so the reveal
		// triggers across the whole cluster; the matching negative margin pulls the layout
		// back so the pills don't move.
		// biome-ignore lint/a11y/noStaticElementInteractions: passive hover-reveal wrapper, no activation.
		<div
			onMouseEnter={openFan}
			onMouseLeave={closeFanSoon}
			style={{
				display: "inline-flex",
				alignItems: "center",
				cursor: "default",
				userSelect: "none",
				WebkitUserSelect: "none",
				padding: "10px 14px",
				margin: "-10px -14px",
			}}
		>
			{/* Inner layer: the keyboard Tab stop. Focus opens the fan exactly like hover
			    (open = hovered || focused), and the themed focus ring hugs these pills rather
			    than the wide hit area. It's a <button> only to be natively focusable — there's
			    no onClick, the cursor stays default, and mousedown is prevented so a pointer
			    click never focuses it (pointer = hover-only, keyboard = focus-only). aria-label
			    names the stop and reads the whole list in one announcement. */}
			<button
				type="button"
				aria-label={`Genres: ${genres.join(", ")}`}
				onFocus={focusFan}
				onBlur={blurFan}
				onMouseDown={(e) => e.preventDefault()}
				style={{
					display: "inline-flex",
					alignItems: "center",
					whiteSpace: "nowrap",
					padding: 0,
					margin: 0,
					border: "none",
					borderRadius: 10,
					background: "transparent",
					font: "inherit",
					color: "inherit",
					cursor: "default",
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
									// Slide matched to the grid reveal (paired-elements rule); opacity
									// leads slightly so the pill is seen as it settles. Exit ~20% faster.
									transition: reducedMotion
										? "none"
										: open
											? `opacity 180ms ease, transform 240ms ${ease}`
											: `opacity 140ms ease, transform 190ms ${ease}`,
									transitionDelay:
										reducedMotion || !open ? "0ms" : `${i * 40}ms`,
								}}
							>
								<GenrePill label={genre} colors={colors} />
							</span>
						</span>
					</span>
				))}
			</button>
		</div>
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

function ReadLayer({
	read,
	colors,
	open,
	onOpenChange,
}: {
	read: SongRead;
	colors: Palette;
	// Controlled by the chrome so open survives song-to-song navigation (starts open in walkthrough).
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [hovered, setHovered] = useState(false);
	const reducedMotion = usePrefersReducedMotion();
	const takeId = useId();
	const nudge = hovered && !reducedMotion;

	// Clicking the open take collapses it too, but the take is a sibling of the toggle so its
	// prose stays selectable — bail when text is selected (selecting ≠ collapsing).
	const collapseFromTake = () => {
		if (window.getSelection()?.toString()) return;
		onOpenChange(false);
	};

	return (
		// The header (lens/tension + image + cue) is the toggle. The take is the button's SIBLING
		// so its prose stays selectable (a button makes children presentational); collapseFromTake
		// re-adds click-to-collapse on the take without costing that.
		<section
			style={{
				borderTop: `1px solid ${colors.border}`,
				padding: `${SECTION_GAP}px 0`,
			}}
		>
			<button
				type="button"
				onClick={() => onOpenChange(!open)}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				aria-expanded={open}
				aria-controls={takeId}
				style={{
					display: "block",
					width: "100%",
					textAlign: "left",
					border: "none",
					background: "transparent",
					padding: 0,
					margin: 0,
					cursor: "pointer",
					userSelect: "none",
					WebkitUserSelect: "none",
					font: "inherit",
					color: "inherit",
				}}
			>
				<span
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
				</span>

				<span
					style={{
						display: "block",
						fontFamily: fonts.display,
						fontWeight: 400,
						fontSize: 44,
						lineHeight: 1.08,
						letterSpacing: "-0.01em",
						// Greedy wrap (no balance): the first line fills the width, only the overflow
						// drops to a second. Balance would split it into two short lines stranded in
						// empty space — a stark jump from one line to two.
						color: hovered ? colors.accent : colors.text,
						transition: reducedMotion ? "none" : "color 200ms ease",
					}}
				>
					{read.image}
				</span>

				{/* Toggle cue: both states stay mounted and cross-fade so the direction reverses as
				    motion, not a hard swap. "read deeper" when closed, "collapse" when open. */}
				<span
					aria-hidden
					style={{
						position: "relative",
						display: "block",
						marginTop: 12,
						height: 16,
						fontFamily: fonts.body,
						fontSize: 12,
						letterSpacing: "0.04em",
					}}
				>
					<span
						style={{
							position: "absolute",
							top: 0,
							right: 0,
							whiteSpace: "nowrap",
							color: hovered ? colors.textMuted : colors.textDim,
							opacity: open ? 0 : 1,
							transition: reducedMotion
								? "none"
								: "opacity 200ms cubic-bezier(0.2, 0, 0, 1), color 200ms ease",
						}}
					>
						read deeper{" "}
						<span
							style={{
								display: "inline-block",
								transform: nudge ? "translateX(3px)" : "translateX(0)",
								transition: reducedMotion ? "none" : "transform 180ms ease",
							}}
						>
							→
						</span>
					</span>
					<span
						style={{
							position: "absolute",
							top: 0,
							right: 0,
							whiteSpace: "nowrap",
							color: hovered ? colors.textMuted : colors.textDim,
							opacity: open ? 1 : 0,
							transition: reducedMotion
								? "none"
								: "opacity 200ms cubic-bezier(0.2, 0, 0, 1), color 200ms ease",
						}}
					>
						<span
							style={{
								display: "inline-block",
								transform: nudge ? "translateX(-3px)" : "translateX(0)",
								transition: reducedMotion ? "none" : "transform 180ms ease",
							}}
						>
							←
						</span>{" "}
						collapse
					</span>
				</span>
			</button>

			{/* Take drawer. Clipped by the 0fr↔1fr grid (the Arc's expand mechanic); aria-hidden
			    tracks the collapsed state. Collapse runs ~20% faster than the reveal
			    (exit-faster-than-entrance), matching the genre fan's 240/190 split. */}
			<div
				id={takeId}
				aria-hidden={!open}
				style={{
					display: "grid",
					gridTemplateRows: open ? "1fr" : "0fr",
					transition: reducedMotion
						? "none"
						: `grid-template-rows ${
								open ? READ_DEEPER_MS : Math.round(READ_DEEPER_MS * 0.8)
							}ms ${READ_DEEPER_EASE}`,
				}}
			>
				<div style={{ overflow: "hidden", minHeight: 0 }}>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only convenience. */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: header toggle already handles keyboard collapse; a key handler here would be redundant. */}
					<div
						onClick={collapseFromTake}
						// Hovering the take drives the same `hovered` state as the header, so the whole
						// open read brightens as one unit (cueing the take is part of the toggle).
						onMouseEnter={() => setHovered(true)}
						onMouseLeave={() => setHovered(false)}
						style={{
							paddingTop: 16,
							// Pointer cues that the open take is clickable to collapse; prose stays
							// selectable (collapseFromTake bails on a selection).
							cursor: "pointer",
							// Opacity trails the height on open so the text settles in instead of
							// wiping in with the clip edge.
							opacity: open ? 1 : 0,
							transition: reducedMotion
								? "none"
								: `opacity ${Math.round(READ_DEEPER_MS * 0.7)}ms ease`,
							transitionDelay: reducedMotion || !open ? "0ms" : "70ms",
						}}
					>
						<p
							style={{
								margin: 0,
								fontFamily: fonts.body,
								fontSize: 16,
								lineHeight: 1.7,
								// Pretty: no orphan word on the last line.
								textWrap: "pretty",
								color: colors.text,
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
										margin: 0,
										fontFamily: fonts.body,
										fontStyle: "italic",
										fontSize: 14,
										lineHeight: 1.55,
										// Pretty: no trailing orphan word.
										textWrap: "pretty",
										color: colors.textMuted,
									}}
								>
									{read.contradiction}
								</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</section>
	);
}

function TraceLayer({ read, colors }: { read: SongRead; colors: Palette }) {
	return (
		<section
			style={{
				borderTop: `1px solid ${colors.border}`,
				padding: `${SECTION_GAP}px 0`,
			}}
		>
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
							// Pretty: no orphan word on the last line.
							textWrap: "pretty",
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
function ArcSpine({ arc, colors }: { arc: SongRead["arc"]; colors: Palette }) {
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
											// Pretty: no orphan word on the last line.
											textWrap: "pretty",
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
	lines: SongRead["lines"];
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
			// concept-line-track adds a ::after so the 2px bar gets a ~40px tap target. No
			// overflow:hidden — it would crop the extender; the scaleX fill stays in bounds anyway.
			className="concept-line-track"
			style={{
				position: "relative",
				width: 28,
				height: 2,
				padding: 0,
				border: "none",
				background: filled ? colors.accent : colors.border,
				cursor: "pointer",
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

// The read's coda: where this song fits. The only outbound action in the panel,
// so it sits last — after the contemplative Read/Take/Trace. Pure presentation:
// the page owns the query and the Spotify/server side-effects (see
// useSongPlaylistSuggestions) and passes the resolved matches + onAdd in, the same
// way lockedCta is resolved upstream. The score echoes the hero's SonicNumbers
// (display font, tabular figures) so the panel's "numbers" read consistently.
function PlaylistsLayer({
	colors,
	playlists,
}: {
	colors: Palette;
	playlists: PlaylistsPanel;
}) {
	return (
		<section
			aria-label="Add to playlist"
			style={{
				borderTop: `1px solid ${colors.border}`,
				padding: `${SECTION_GAP}px 0`,
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
				Where it fits
			</div>
			{playlists.matches.map((match, i) => (
				<PlaylistRow
					key={match.playlistId}
					match={match}
					colors={colors}
					isFirst={i === 0}
					added={playlists.addedTo.includes(match.playlistId)}
					reconnectNeeded={playlists.reconnectNeeded}
					onAdd={playlists.onAdd}
				/>
			))}
		</section>
	);
}

function PlaylistRow({
	match,
	colors,
	isFirst,
	added,
	reconnectNeeded,
	onAdd,
}: {
	match: PlaylistSuggestionView;
	colors: Palette;
	isFirst: boolean;
	added: boolean;
	reconnectNeeded: boolean;
	onAdd: (playlistId: string) => void;
}) {
	const [hovered, setHovered] = useState(false);
	const [pressed, setPressed] = useState(false);
	const reducedMotion = usePrefersReducedMotion();

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 16,
				paddingTop: isFirst ? 0 : 14,
				paddingBottom: 14,
				borderTop: isFirst ? "none" : `1px solid ${colors.border}`,
			}}
		>
			<span
				style={{
					flexShrink: 0,
					width: 44,
					fontFamily: fonts.display,
					fontWeight: 400,
					fontSize: 18,
					lineHeight: 1,
					fontVariantNumeric: "tabular-nums",
					color: colors.text,
				}}
			>
				{Math.round(match.score * 100)}%
			</span>
			<span
				title={match.name}
				style={{
					flex: 1,
					minWidth: 0,
					fontFamily: fonts.body,
					fontSize: 14,
					color: colors.text,
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis",
				}}
			>
				{match.name}
			</span>
			{reconnectNeeded && !added ? (
				<div style={{ flexShrink: 0 }}>
					<SpotifyReconnectLink label="Reconnect" />
				</div>
			) : (
				// Add and Added are stacked and cross-faded, not hard-swapped. The Add button stays
				// in flow (opacity 0 once added) to hold the slot width, so the row never shifts.
				<div
					style={{
						flexShrink: 0,
						position: "relative",
						display: "inline-flex",
					}}
				>
					<button
						type="button"
						className="concept-hit-40"
						onClick={() => onAdd(match.playlistId)}
						onMouseEnter={() => setHovered(true)}
						onMouseLeave={() => {
							setHovered(false);
							setPressed(false);
						}}
						onMouseDown={() => setPressed(true)}
						onMouseUp={() => setPressed(false)}
						aria-label={`Add to ${match.name}`}
						aria-hidden={added}
						tabIndex={added ? -1 : 0}
						style={{
							padding: "6px 14px",
							fontFamily: fonts.body,
							fontSize: 10,
							fontWeight: 600,
							// Uppercase + wide tracking matches the "Added" sibling that swaps
							// into this slot and the app-wide button voice (Button.tsx), instead
							// of reading as its own sentence-case outlier.
							letterSpacing: "0.14em",
							textTransform: "uppercase",
							color: colors.accent,
							// Quiet at rest — neutral border, no fill — so the action stays
							// recessive in the read's coda; the accent wash only blooms on hover.
							// Mirrors /match's recessive Add while keeping accent = interactive
							// in the panel's vocabulary.
							background: hovered
								? `color-mix(in srgb, ${colors.accent} 12%, transparent)`
								: "transparent",
							border: `1px solid ${
								hovered
									? `color-mix(in srgb, ${colors.accent} 32%, transparent)`
									: colors.border
							}`,
							borderRadius: 999,
							cursor: "pointer",
							opacity: added ? 0 : 1,
							pointerEvents: added ? "none" : "auto",
							// The app-wide tactile press (Button.tsx active:scale-[0.98]); driven
							// by state to match this file's JS-hover idiom rather than CSS :active.
							transform: !added && pressed ? "scale(0.98)" : "scale(1)",
							transition: reducedMotion
								? "background 150ms ease, border-color 150ms ease"
								: "background 150ms ease, border-color 150ms ease, transform 150ms ease, opacity 200ms cubic-bezier(0.2, 0, 0, 1)",
						}}
					>
						Add
					</button>
					<span
						aria-hidden={!added}
						style={{
							position: "absolute",
							inset: 0,
							display: "flex",
							alignItems: "center",
							justifyContent: "flex-end",
							whiteSpace: "nowrap",
							fontSize: 10,
							letterSpacing: "0.14em",
							textTransform: "uppercase",
							color: colors.textDim,
							opacity: added ? 1 : 0,
							pointerEvents: "none",
							transition: reducedMotion
								? "none"
								: "opacity 200ms cubic-bezier(0.2, 0, 0, 1)",
						}}
					>
						Added
					</span>
				</div>
			)}
		</div>
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
	const [pressed, setPressed] = useState(false);
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
		<>
			{/* Darkness scrim over the whole panel. Fixed so it tracks the panel
			    viewport (same box as the surface via PANEL_WIDTH); z-index sits above
			    the read/hero (z 3–4) but below the raised CTA bar, so the button is
			    the one lit element. The close button lives in the chrome's own
			    stacking context above the surface, so it stays bright on top. */}
			<div
				aria-hidden
				style={{
					position: "fixed",
					top: 0,
					right: 0,
					width: PANEL_WIDTH,
					height: "100vh",
					zIndex: 40,
					pointerEvents: "none",
					background: `color-mix(in srgb, ${colors.bg} 60%, transparent)`,
				}}
			/>
			<div
				style={{
					position: "sticky",
					bottom: 0,
					paddingTop: 24,
					paddingBottom: 28,
					zIndex: 50,
					background: `linear-gradient(to bottom, transparent, ${colors.bg} 32%)`,
				}}
			>
				<style>{`
				@keyframes walkthrough-cta-arrow-nudge {
					0%, 100% { transform: translateX(0); }
					50% { transform: translateX(3px); }
				}
			`}</style>
				<button
					type="button"
					onClick={handleClick}
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => {
						setHovered(false);
						setPressed(false);
					}}
					onMouseDown={() => setPressed(true)}
					onMouseUp={() => setPressed(false)}
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
						// Tactile press, matching Button.tsx's active:scale-[0.98]. Hover
						// lifts brightness slightly so the CTA still acknowledges the pointer
						// now that the arrow's idle nudge is what draws the eye.
						transform:
							pressed && !disabled && !reducedMotion
								? "scale(0.98)"
								: "scale(1)",
						filter: hovered && !disabled ? "brightness(1.06)" : "none",
						transition: reducedMotion
							? "opacity 150ms ease, filter 150ms ease"
							: "opacity 150ms ease, transform 150ms ease, filter 150ms ease",
					}}
				>
					See where this song belongs
					<span
						aria-hidden
						style={{
							display: "inline-block",
							// Continuous idle nudge ported from the SongCard "See what's
							// inside →" hint, so the CTA advertises itself instead of waiting
							// for hover. Hover holds the arrow forward; disabled stops it.
							animation:
								reducedMotion || disabled
									? "none"
									: hovered
										? "none"
										: "walkthrough-cta-arrow-nudge 2s ease-in-out infinite",
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
		</>
	);
}
