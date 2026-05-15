import type { CSSProperties, ReactNode } from "react";
import type { LikedSong } from "@/features/liked-songs/types";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { extractHue } from "@/lib/utils/color";

interface AudioFeatures {
	tempo: number | null;
	energy: number | null;
	valence: number | null;
}

export function deriveAudio(af: AudioFeatures | null) {
	const bpm = af?.tempo ? Math.round(af.tempo) : null;
	const energyLabel =
		af?.energy != null
			? af.energy > 0.66
				? "High"
				: af.energy > 0.33
					? "Mid"
					: "Low"
			: null;
	const valenceLabel =
		af?.valence != null
			? af.valence > 0.66
				? "Bright"
				: af.valence > 0.33
					? "Neutral"
					: "Dark"
			: null;
	return { bpm, energyLabel, valenceLabel, raw: af };
}

export function GenrePill({
	label,
	primary,
	theme,
	size = "default",
}: {
	label: string;
	primary?: boolean;
	theme: ThemeConfig;
	size?: "default" | "small";
}) {
	const px = size === "small" ? 7 : 8;
	const py = size === "small" ? 1 : 2;
	const fs = size === "small" ? 10 : 11;
	return (
		<span
			style={{
				fontFamily: fonts.body,
				fontSize: fs,
				letterSpacing: "0.06em",
				padding: `${py}px ${px}px`,
				border: `0.5px solid ${primary ? theme.primary : theme.border}`,
				borderRadius: 12,
				color: primary ? theme.primary : theme.textMuted,
				whiteSpace: "nowrap",
			}}
		>
			{label}
		</span>
	);
}

export function GenrePills({
	genres,
	theme,
	size = "default",
}: {
	genres: string[];
	theme: ThemeConfig;
	size?: "default" | "small";
}) {
	const slice = genres.slice(0, 3);
	const [primary, ...alts] = slice;
	if (!primary) return null;
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: "4px 6px" }}>
			<GenrePill label={primary} primary theme={theme} size={size} />
			{alts.map((g) => (
				<GenrePill key={g} label={g} theme={theme} size={size} />
			))}
		</div>
	);
}

export interface VariantShellProps {
	theme: ThemeConfig;
	song: LikedSong;
	albumArtUrl?: string;
	artistImageUrl?: string;
	isExpanded: boolean;
	onClose: () => void;
	children: ReactNode;
	/** Custom hero height. Defaults to 450 with image, 180 without. */
	heroHeight?: number;
	/** Custom album art size in px. Defaults to 112. */
	albumArtSize?: number;
	/** Content overlaid on top of the hero (e.g. metadata strip). Positioned absolute. */
	heroOverlay?: ReactNode;
	/** Z-index for hero overlay content. */
	overlayStyle?: CSSProperties;
}

export function VariantShell({
	theme,
	albumArtUrl,
	artistImageUrl,
	isExpanded,
	onClose,
	children,
	heroHeight: heroHeightProp,
	albumArtSize = 112,
	heroOverlay,
	overlayStyle,
}: VariantShellProps) {
	const heroHeight = heroHeightProp ?? (artistImageUrl ? 450 : 180);
	const hue = extractHue(theme.primary);
	const vignetteGradient = `linear-gradient(to bottom,
		hsla(${hue}, 25%, 88%, 0) 0%,
		hsla(${hue}, 25%, 88%, 0.1) 57%,
		hsla(${hue}, 25%, 88%, 0.8) 80%,
		hsla(${hue}, 25%, 88%, 1) 100%)`;

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				right: 0,
				width: "clamp(380px, 45vw, calc(100vw - 280px))",
				height: "100vh",
				zIndex: 50,
				overflow: "hidden",
				background: theme.bg,
				borderLeft: `1px solid ${theme.border}`,
				transform: isExpanded ? "translateX(0)" : "translateX(100%)",
				opacity: isExpanded ? 1 : 0,
				pointerEvents: isExpanded ? "auto" : "none",
				transition:
					"transform 300ms cubic-bezier(0.25, 0, 0, 1), opacity 300ms",
			}}
		>
			<style>{`
				@keyframes hearted-slide-fwd {
					from { opacity: 0; transform: translateX(12px); }
					to { opacity: 1; transform: translateX(0); }
				}
				@keyframes hearted-slide-back {
					from { opacity: 0; transform: translateX(-12px); }
					to { opacity: 1; transform: translateX(0); }
				}
				@keyframes hearted-fade {
					from { opacity: 0; }
					to { opacity: 1; }
				}
				@keyframes hearted-push-up {
					from { opacity: 0; transform: translateY(14px); }
					to { opacity: 1; transform: translateY(0); }
				}
			`}</style>
			<div style={{ height: "100%", overflowY: "auto" }}>
				<div
					style={{ position: "relative", height: heroHeight, flexShrink: 0 }}
				>
					{artistImageUrl ? (
						<>
							<div
								style={{
									position: "absolute",
									inset: 0,
									backgroundImage: `url(${artistImageUrl})`,
									backgroundSize: "cover",
									backgroundPosition: "center 30%",
								}}
							/>
							<div
								style={{
									position: "absolute",
									inset: 0,
									background: vignetteGradient,
								}}
							/>
						</>
					) : (
						<div
							style={{ position: "absolute", inset: 0, background: theme.bg }}
						/>
					)}
					<div
						style={{
							position: "absolute",
							left: 0,
							right: 0,
							bottom: 0,
							height: "50%",
							background: `linear-gradient(to bottom, transparent 0%, ${theme.bg} 100%)`,
						}}
					/>
					{heroOverlay && (
						<div
							style={{
								position: "absolute",
								inset: 0,
								pointerEvents: "none",
								...overlayStyle,
							}}
						>
							{heroOverlay}
						</div>
					)}
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						style={{
							position: "absolute",
							top: 12,
							right: 12,
							width: 32,
							height: 32,
							background: "rgba(0,0,0,0.35)",
							color: "#fff",
							border: "none",
							borderRadius: 2,
							fontSize: 18,
							lineHeight: 1,
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							zIndex: 5,
						}}
					>
						×
					</button>
					{albumArtUrl && (
						<img
							src={albumArtUrl}
							alt=""
							style={{
								position: "absolute",
								left: 24,
								bottom: -Math.round(albumArtSize / 3),
								width: albumArtSize,
								height: albumArtSize,
								borderRadius: 4,
								objectFit: "cover",
								boxShadow: `0 4px 20px ${theme.primary}20`,
								zIndex: 3,
							}}
						/>
					)}
				</div>
				<div style={{ position: "relative" }}>{children}</div>
			</div>
		</div>
	);
}

/** Prod-style audio signature: BPM number + Energy/Valence labels, bottom-aligned. */
export function HeroSonicNumbers({
	song,
	theme,
}: {
	song: LikedSong;
	theme: ThemeConfig;
}) {
	const { bpm, energyLabel, valenceLabel } = deriveAudio(
		song.track.audio_features,
	);
	const cols: { v: string; l: string }[] = [
		{ v: bpm != null ? String(bpm) : "—", l: "bpm" },
		{ v: energyLabel ?? "—", l: "energy" },
		{ v: valenceLabel ?? "—", l: "valence" },
	];

	return (
		<div
			style={{
				display: "flex",
				gap: 16,
				flexShrink: 0,
				alignItems: "flex-end",
			}}
		>
			{cols.map((c) => (
				<div
					key={c.l}
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "flex-end",
						gap: 3,
					}}
				>
					<span
						style={{
							fontFamily: fonts.display,
							fontWeight: 400,
							fontSize: 24,
							lineHeight: 1,
							color: theme.text,
						}}
					>
						{c.v}
					</span>
					<span
						style={{
							fontFamily: fonts.body,
							fontSize: 10,
							letterSpacing: "0.14em",
							textTransform: "uppercase",
							color: theme.textMuted,
						}}
					>
						{c.l}
					</span>
				</div>
			))}
		</div>
	);
}

/** Standard title/artist/album block, bottom-anchored to the hero like in prod.
 *  Renders prod-style SonicNumbers on the right by default. Pass `right` to override. */
export function HeroTitleBlock({
	song,
	theme,
	right,
	stackBelowArt = false,
}: {
	song: LikedSong;
	theme: ThemeConfig;
	right?: ReactNode | "none";
	stackBelowArt?: boolean;
}) {
	const rightContent =
		right === "none"
			? null
			: (right ?? <HeroSonicNumbers song={song} theme={theme} />);

	return (
		<div
			style={{
				position: "absolute",
				left: stackBelowArt ? 24 : 152,
				right: 24,
				bottom: -37,
				display: "flex",
				flexDirection: "row",
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
						color: theme.text,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{song.track.name}
				</div>
				<div
					style={{
						fontFamily: fonts.body,
						fontSize: 13,
						letterSpacing: "0.04em",
						color: theme.textMuted,
						marginTop: 6,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{song.track.artist}
				</div>
				{song.track.album && (
					<div
						style={{
							fontFamily: fonts.body,
							fontSize: 11,
							lineHeight: 1.25,
							letterSpacing: "0.03em",
							color: theme.textMuted,
							opacity: 0.7,
							marginTop: 3,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{song.track.album}
					</div>
				)}
			</div>
			{rightContent && <div style={{ flexShrink: 0 }}>{rightContent}</div>}
		</div>
	);
}
