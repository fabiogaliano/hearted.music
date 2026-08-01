/**
 * Unified Vision — side-by-side "Current" vs "Evolved" comparison across three
 * app faces: the playlist studio sidebar, song detail, and the library
 * overview. Left column is the design language as it actually ships today
 * (flat cards, 999px pills, grayish unselected fill, no glow/grain). Right
 * column layers on the four evolved treatments: color-temperature depth,
 * squircle geometry, ambient glow, ceramic grain.
 *
 * Throwaway: delete once a direction is picked.
 */

import type { Story } from "@ladle/react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";

const TRACK_DATA = [
	{
		title: "Don't Hurt Me, I'm Trying",
		artist: "NoSo",
		art: "https://i.scdn.co/image/ab67616d0000b273a0528382229c84aae80a14d6",
	},
	{
		title: "Electric Fish",
		artist: "Ana Frango Elétrico",
		art: "https://i.scdn.co/image/ab67616d0000b273dfa82523de5ab6b5508d7aa5",
	},
	{
		title: "Life Will Be",
		artist: "Cleo Sol",
		art: "https://i.scdn.co/image/ab67616d0000b2738128b3a01e0246795dfab1a2",
	},
	{
		title: "GO!",
		artist: "Common",
		art: "https://i.scdn.co/image/ab67616d0000b2736c1e31e10c7a5b2ed2258e29",
	},
	{
		title: "The Wave",
		artist: "SE SO NEON",
		art: "https://i.scdn.co/image/ab67616d0000b27301286474faacf2334695f99f",
	},
] as const;

const PLAYLIST_DATA = [
	{
		name: "Late Night Drive",
		count: "15 songs",
		art: "https://mosaic.scdn.co/640/ab67616d00001e027ac9593478963cbbe6f47277ab67616d00001e028c697f553a46006a5d8886b2ab67616d00001e0296b331e479adacf1ca778c2cab67616d00001e02bbd45c8d36e0e045ef640411",
	},
	{
		name: "old rock - coding zone",
		count: "507 songs",
		art: "https://mosaic.scdn.co/640/ab67616d00001e0251136aeb3f6b077a3f9d9a0fab67616d00001e025d11c2fe73a7d376d3b06107ab67616d00001e026e042c39906a7c7d49b67b91ab67616d00001e02dc30583ba717007b00cceb25",
	},
	{
		name: "focus - v2",
		count: "202 songs",
		art: "https://mosaic.scdn.co/640/ab67616d00001e02014080d39d56c94c0b285362ab67616d00001e022057743ed6bf8bd21f5e68f2ab67616d00001e02b35037d0dedbd9f7d8e26fe8ab67616d00001e02d87ab9da3347b385930734aa",
	},
	{
		name: "2009~2013",
		count: "244 songs",
		art: "https://mosaic.scdn.co/640/ab67616d00001e021488c6ffb241dc6306581a2eab67616d00001e02c7d00568db33ae806cfdcbdfab67616d00001e02e198b6b9c5bfe013458e8ec9ab67616d00001e02e9a18c4792e88f34bd17bbaf",
	},
] as const;

const RECENT_DATA = [
	{
		title: "Gone Baby, Don't Be Long",
		artist: "Erykah Badu",
		mood: "wry tenderness",
		art: "https://i.scdn.co/image/ab67616d0000b2732c1b088d399087bd3a1de30b",
	},
	{
		title: "What is Love",
		artist: "TWICE",
		mood: "euphoric liberation",
		art: "https://i.scdn.co/image/ab67616d0000b273d72bea64eca7f26647f8e57a",
	},
	{
		title: "FANCY",
		artist: "TWICE",
		mood: "unhinged sweetness",
		art: "https://i.scdn.co/image/ab67616d0000b2739e87fd81ab0dfad228f8a004",
	},
] as const;

const DETAIL_SONG = {
	title: "Don't Hurt Me, I'm Trying",
	artist: "NoSo",
	art: "https://i.scdn.co/image/ab67616d0000b273a0528382229c84aae80a14d6",
	mood: "Anxious Nostalgia",
	interpretation:
		"A quiet plea dressed as a love song — the vulnerability isn't weakness, it's the whole point.",
	tags: ["letting go", "self-forgiveness", "gentle defiance"],
	journey: [
		{
			label: "Verse",
			description:
				"Steady pulse, words measured out like they might break if pushed too hard.",
		},
		{
			label: "Chorus",
			description:
				"The guard drops — raw, open, almost surprised by its own honesty.",
		},
	],
	energy: "Mid energy · 118 BPM",
} as const;

export default { title: "Vision / Unified" };

let grainCounter = 0;
function GrainOverlay({ opacity = 0.12 }: { opacity?: number }) {
	const [id] = useState(() => `uv-grain-${++grainCounter}`);
	return (
		<svg
			aria-hidden="true"
			style={{
				position: "absolute",
				inset: 0,
				width: "100%",
				height: "100%",
				pointerEvents: "none",
				zIndex: 1,
				opacity,
				mixBlendMode: "overlay",
			}}
		>
			<filter id={id}>
				<feTurbulence
					type="fractalNoise"
					baseFrequency="0.65"
					numOctaves="4"
					stitchTiles="stitch"
				/>
			</filter>
			<rect width="100%" height="100%" filter={`url(#${id})`} />
		</svg>
	);
}

const squircle: CSSProperties = {
	// @ts-expect-error -- corner-shape is not yet in the CSS typings
	cornerShape: "squircle",
};

const sectionLabel: CSSProperties = {
	fontSize: 11,
	fontWeight: 500,
	letterSpacing: "0.16em",
	textTransform: "uppercase",
	color: "var(--t-text-muted)",
};

// Evolved-only fills: color-temperature depth (warmer/lighter than surface).
const evolvedChipFill =
	"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))";
const evolvedRaisedSurface =
	"oklch(from var(--t-surface) calc(l - 0.012) calc(c + 0.002) calc(h + 2))";
// Current fill: the grayish color-mix already in prod (see playlist-ui.css gp-pill).
const currentChipFill = "color-mix(in srgb, var(--t-text) 7%, transparent)";

function Grain() {
	return <GrainOverlay />;
}

function Glow({
	color,
	opacity = 0.22,
	blur = 80,
}: {
	color: string;
	opacity?: number;
	blur?: number;
}) {
	return (
		<div
			style={{
				position: "absolute",
				inset: "-10%",
				zIndex: 0,
				pointerEvents: "none",
				background: `radial-gradient(closest-side, ${color} 0%, transparent 70%)`,
				filter: `blur(${blur}px)`,
				opacity,
			}}
		/>
	);
}

function Chip({
	label,
	selected,
	dim,
	evolved,
}: {
	label: string;
	selected?: boolean;
	dim?: boolean;
	evolved: boolean;
}) {
	return (
		<span
			style={{
				...(evolved ? squircle : undefined),
				display: "inline-flex",
				alignItems: "center",
				borderRadius: 999,
				padding: "6px 14px",
				fontSize: 12.5,
				color: selected ? "var(--t-text-on-primary)" : "var(--t-text-muted)",
				background: selected
					? "var(--t-primary)"
					: evolved
						? evolvedChipFill
						: currentChipFill,
				border: evolved ? "1px solid transparent" : "none",
				opacity: dim ? 0.45 : 1,
				transition: "background 150ms ease-out, color 150ms ease-out",
				whiteSpace: "nowrap",
			}}
		>
			{label}
		</span>
	);
}

function FilterRow({
	label,
	value,
	evolved,
}: {
	label: string;
	value: string;
	evolved: boolean;
}) {
	return (
		<div
			style={{
				...(evolved ? squircle : undefined),
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				padding: "10px 14px",
				borderRadius: evolved ? 10 : 0,
				background: evolved ? evolvedChipFill : "transparent",
				borderBottom: evolved ? "none" : "1px solid var(--t-border)",
				fontSize: 12.5,
				color: "var(--t-text)",
			}}
		>
			<span style={{ color: "var(--t-text-muted)" }}>{label}</span>
			<span>{value}</span>
		</div>
	);
}

function AlbumSquare({
	color,
	src,
	size = 44,
}: {
	color?: string;
	src?: string;
	size?: number;
}) {
	if (src) {
		return (
			<img
				src={src}
				alt=""
				draggable={false}
				style={{
					width: size,
					height: size,
					borderRadius: 0,
					objectFit: "cover",
					flexShrink: 0,
				}}
			/>
		);
	}
	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius: 0,
				background: color,
				flexShrink: 0,
			}}
		/>
	);
}

function ThemeTag({ label, evolved }: { label: string; evolved: boolean }) {
	return (
		<span
			style={{
				...(evolved ? squircle : undefined),
				display: "inline-flex",
				borderRadius: 999,
				padding: "5px 12px",
				fontSize: 11.5,
				color: "var(--t-text-muted)",
				background: evolved ? evolvedChipFill : currentChipFill,
			}}
		>
			{label}
		</span>
	);
}

function SearchInput({
	placeholder,
	evolved,
}: {
	placeholder: string;
	evolved: boolean;
}) {
	return (
		<div
			style={{
				...(evolved ? squircle : undefined),
				borderRadius: evolved ? 10 : 6,
				border: "1px solid var(--t-border)",
				background: evolved ? evolvedChipFill : "var(--t-surface)",
				padding: "9px 12px",
				fontSize: 12.5,
				color: "var(--t-text-muted)",
			}}
		>
			{placeholder}
		</div>
	);
}

// Card wrapper: evolved gets grain + squircle + no border; current stays flat
// with a 1px border and square corners.
function Card({
	children,
	evolved,
	style,
}: {
	children: ReactNode;
	evolved: boolean;
	style?: CSSProperties;
}) {
	return (
		<div
			style={{
				...(evolved ? squircle : undefined),
				position: "relative",
				overflow: "hidden",
				borderRadius: evolved ? 18 : 0,
				background: "var(--t-surface)",
				border: evolved ? "1px solid transparent" : "1px solid var(--t-border)",
				...style,
			}}
		>
			{evolved && <Grain />}
			<div style={{ position: "relative", zIndex: 2 }}>{children}</div>
		</div>
	);
}

function ScreenSeparator({ label }: { label: string }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "28px 0",
			}}
		>
			<span style={{ ...sectionLabel, opacity: 0.55 }}>— {label} —</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Screen 1 — Playlist Studio Sidebar
// ---------------------------------------------------------------------------

function PlaylistSidebar({ evolved }: { evolved: boolean }) {
	const inner = (
		<div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
			<div>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "baseline",
						marginBottom: 12,
					}}
				>
					<span style={sectionLabel}>Genres</span>
					<span
						style={{
							fontSize: 11,
							color: "var(--t-text-muted)",
							fontVariantNumeric: "tabular-nums",
						}}
					>
						3/5
					</span>
				</div>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
					<Chip label="hip-hop" selected evolved={evolved} />
					<Chip label="electronic" selected evolved={evolved} />
					<Chip label="rap" selected evolved={evolved} />
					<Chip label="jazz" evolved={evolved} />
					<Chip label="soul" evolved={evolved} />
					<Chip label="indie" evolved={evolved} />
					<Chip label="+ add genre" evolved={evolved} />
				</div>
			</div>

			<div>
				<span style={{ ...sectionLabel, display: "block", marginBottom: 10 }}>
					Artists
				</span>
				<SearchInput placeholder="Find a liked artist…" evolved={evolved} />
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						marginTop: 10,
					}}
				>
					<Chip label="Kendrick Lamar 42" selected evolved={evolved} />
					<Chip label="Tyler 18" dim evolved={evolved} />
					<Chip label="JPEGMAFIA 12" evolved={evolved} />
				</div>
			</div>

			<div>
				<span style={{ ...sectionLabel, display: "block", marginBottom: 10 }}>
					Filters
				</span>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: evolved ? 8 : 0,
					}}
				>
					<FilterRow label="Language" value="Portuguese" evolved={evolved} />
					<FilterRow label="Vocals" value="Female" evolved={evolved} />
					<FilterRow
						label="Release era"
						value="2000s–2020s"
						evolved={evolved}
					/>
					<FilterRow label="Liked date" value="Any" evolved={evolved} />
				</div>
			</div>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					paddingTop: 14,
					borderTop: "1px solid var(--t-border)",
				}}
			>
				<span style={sectionLabel}>Songs</span>
				<div style={{ textAlign: "right" }}>
					<span
						style={{
							fontFamily: fonts.display,
							fontWeight: 200,
							fontSize: 24,
							color: "var(--t-text)",
						}}
					>
						15
					</span>
					<span
						style={{
							display: "block",
							fontSize: 11,
							color: "var(--t-text-muted)",
						}}
					>
						about 50 minutes
					</span>
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				{TRACK_DATA.map((track) => (
					<div
						key={track.title}
						style={{ display: "flex", alignItems: "center", gap: 10 }}
					>
						<AlbumSquare src={track.art} size={36} />
						<div style={{ display: "flex", flexDirection: "column" }}>
							<span style={{ fontSize: 12.5, color: "var(--t-text)" }}>
								{track.title}
							</span>
							<span
								style={{
									fontSize: 11,
									fontStyle: "italic",
									color: "var(--t-text-muted)",
								}}
							>
								{track.artist}
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);

	return (
		<Card evolved={evolved} style={{ width: 320, padding: 24 }}>
			{inner}
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Screen 2 — Song Detail
// ---------------------------------------------------------------------------

function JourneyStep({
	label,
	description,
}: {
	label: string;
	description: string;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
			<span style={{ ...sectionLabel, fontSize: 10.5 }}>{label}</span>
			<p
				style={{
					margin: 0,
					fontSize: 13.5,
					color: "var(--t-text)",
					lineHeight: 1.6,
				}}
			>
				{description}
			</p>
		</div>
	);
}

function SongDetail({ evolved }: { evolved: boolean }) {
	const body = (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "180px 1fr",
				gap: 32,
			}}
		>
			<img
				src={DETAIL_SONG.art}
				alt=""
				draggable={false}
				style={{
					...(evolved ? squircle : undefined),
					width: 180,
					height: 180,
					borderRadius: evolved ? 24 : 0,
					objectFit: "cover",
					flexShrink: 0,
				}}
			/>

			<div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
				<div>
					<h2
						style={{
							margin: 0,
							fontFamily: fonts.display,
							fontWeight: 200,
							fontSize: 28,
							color: "var(--t-text)",
						}}
					>
						{DETAIL_SONG.title}
					</h2>
					<p
						style={{
							margin: "6px 0 0",
							fontSize: 14,
							fontStyle: "italic",
							color: "var(--t-text-muted)",
						}}
					>
						{DETAIL_SONG.artist}
					</p>
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						flexWrap: "wrap",
					}}
				>
					<span
						style={{
							fontSize: 12.5,
							fontWeight: 500,
							letterSpacing: "0.06em",
							color: "var(--t-primary)",
						}}
					>
						{DETAIL_SONG.mood}
					</span>
					<span
						style={{
							fontSize: 12,
							color: "var(--t-text-muted)",
							fontVariantNumeric: "tabular-nums",
						}}
					>
						{DETAIL_SONG.energy}
					</span>
				</div>

				<p
					style={{
						margin: 0,
						fontSize: 14,
						fontStyle: "italic",
						color: "var(--t-text)",
						lineHeight: 1.6,
						maxWidth: 420,
					}}
				>
					{DETAIL_SONG.interpretation}
				</p>

				<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
					{DETAIL_SONG.tags.map((tag) => (
						<ThemeTag key={tag} label={tag} evolved={evolved} />
					))}
				</div>

				<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
					<span style={sectionLabel}>Journey</span>
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						{DETAIL_SONG.journey.map((step) => (
							<JourneyStep
								key={step.label}
								label={step.label}
								description={step.description}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	);

	if (!evolved) {
		return (
			<Card evolved={false} style={{ padding: 32 }}>
				{body}
			</Card>
		);
	}

	return (
		<Card evolved style={{ padding: 32 }}>
			<div style={{ position: "relative" }}>
				<Glow color="oklch(0.72 0.15 40)" opacity={0.22} />
				<div style={{ position: "relative", zIndex: 2 }}>{body}</div>
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Screen 3 — Library Overview
// ---------------------------------------------------------------------------

function PlaylistCard({
	name,
	count,
	art,
	evolved,
}: {
	name: string;
	count: string;
	art: string;
	evolved: boolean;
}) {
	const inner = (
		<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
			<AlbumSquare src={art} size={64} />
			<div style={{ display: "flex", flexDirection: "column" }}>
				<span style={{ fontSize: 14, color: "var(--t-text)" }}>{name}</span>
				<span style={{ fontSize: 11.5, color: "var(--t-text-muted)" }}>
					{count}
				</span>
			</div>
		</div>
	);

	if (!evolved) {
		return (
			<div
				style={{
					padding: 16,
					border: "1px solid var(--t-border)",
					background: "var(--t-surface)",
				}}
			>
				{inner}
			</div>
		);
	}

	return (
		<div
			style={{
				...squircle,
				position: "relative",
				overflow: "hidden",
				borderRadius: 16,
				background: evolvedRaisedSurface,
				padding: 16,
			}}
		>
			<Grain />
			<div style={{ position: "relative", zIndex: 2 }}>{inner}</div>
		</div>
	);
}

function LibraryOverview({ evolved }: { evolved: boolean }) {
	const body = (
		<div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
			<div>
				<h2
					style={{
						margin: 0,
						fontFamily: fonts.display,
						fontWeight: 200,
						fontSize: 30,
						color: "var(--t-text)",
					}}
				>
					Your Library
				</h2>
				<p
					style={{
						margin: "6px 0 0",
						fontSize: 12.5,
						color: "var(--t-text-muted)",
					}}
				>
					1,238 liked songs · 47 playlists
				</p>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(4, 1fr)",
					gap: 14,
				}}
			>
				{PLAYLIST_DATA.map((p) => (
					<PlaylistCard key={p.name} {...p} evolved={evolved} />
				))}
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				<span style={sectionLabel}>Recent</span>
				<div style={{ display: "flex", flexDirection: "column" }}>
					{RECENT_DATA.map((song, i) => (
						<div
							key={song.title}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "12px 4px",
								borderBottom:
									i === RECENT_DATA.length - 1
										? "none"
										: "1px solid var(--t-border)",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
								<AlbumSquare src={song.art} size={36} />
								<div style={{ display: "flex", flexDirection: "column" }}>
									<span style={{ fontSize: 13.5, color: "var(--t-text)" }}>
										{song.title}
									</span>
									<span
										style={{
											fontSize: 12,
											fontStyle: "italic",
											color: "var(--t-text-muted)",
										}}
									>
										{song.artist}
									</span>
								</div>
							</div>
							<ThemeTag label={song.mood} evolved={evolved} />
						</div>
					))}
				</div>
			</div>
		</div>
	);

	if (!evolved) {
		return (
			<Card evolved={false} style={{ padding: 32 }}>
				{body}
			</Card>
		);
	}

	return (
		<Card evolved style={{ padding: 32 }}>
			<div style={{ position: "relative" }}>
				<Glow color="oklch(0.80 0.03 60)" opacity={0.12} blur={100} />
				<div style={{ position: "relative", zIndex: 2 }}>{body}</div>
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

function ThemeSwitcher({
	themeKey,
	onChange,
}: {
	themeKey: ThemeColor;
	onChange: (t: ThemeColor) => void;
}) {
	const themeKeys = Object.keys(themes) as ThemeColor[];
	return (
		<div
			style={{
				position: "sticky",
				top: 0,
				zIndex: 20,
				display: "flex",
				gap: 8,
				padding: "14px 20px",
				borderRadius: 14,
				background: "var(--t-surface)",
				backdropFilter: "blur(12px)",
				border: "1px solid var(--t-border)",
				width: "fit-content",
				margin: "24px auto 0",
			}}
		>
			{themeKeys.map((t) => (
				<button
					key={t}
					type="button"
					onClick={() => onChange(t)}
					style={{
						padding: "7px 16px",
						borderRadius: 999,
						border: "1px solid transparent",
						background: t === themeKey ? "var(--t-primary)" : currentChipFill,
						color:
							t === themeKey ? "var(--t-text-on-primary)" : "var(--t-text)",
						fontSize: 12.5,
						fontFamily: fonts.body,
						cursor: "pointer",
						transition: "background 150ms ease-out, color 150ms ease-out",
					}}
				>
					{themes[t].name}
				</button>
			))}
		</div>
	);
}

function ColumnHeader({ label }: { label: string }) {
	return (
		<div
			style={{
				position: "sticky",
				top: 68,
				zIndex: 15,
				background: "var(--t-bg)",
				padding: "16px 0",
				textAlign: "center",
			}}
		>
			<span
				style={{
					fontFamily: fonts.display,
					fontWeight: 300,
					fontSize: 20,
					color: "var(--t-text)",
				}}
			>
				{label}
			</span>
		</div>
	);
}

function Column({ evolved }: { evolved: boolean }) {
	return (
		<div
			style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
		>
			<PlaylistSidebar evolved={evolved} />
			<ScreenSeparator label="Song Detail" />
			<SongDetail evolved={evolved} />
			<ScreenSeparator label="Library" />
			<LibraryOverview evolved={evolved} />
		</div>
	);
}

export const Vision: Story = () => {
	const [themeKey, setThemeKey] = useState<ThemeColor>("rose");

	return (
		<ThemeHueProvider theme={themes[themeKey]}>
			<div
				style={{
					position: "relative",
					minHeight: "100vh",
					background: "var(--t-bg)",
					fontFamily: fonts.body,
					paddingBottom: 120,
				}}
			>
				<ThemeSwitcher themeKey={themeKey} onChange={setThemeKey} />

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						maxWidth: 1280,
						margin: "0 auto",
						padding: "0 40px",
					}}
				>
					<div
						style={{
							borderRight: "1px solid var(--t-border)",
							paddingRight: 32,
						}}
					>
						<ColumnHeader label="Current" />
						<div style={{ padding: "20px 0" }}>
							<ScreenSeparator label="Playlist Studio" />
							<Column evolved={false} />
						</div>
					</div>
					<div style={{ paddingLeft: 32 }}>
						<ColumnHeader label="Evolved" />
						<div style={{ padding: "20px 0" }}>
							<ScreenSeparator label="Playlist Studio" />
							<Column evolved={true} />
						</div>
					</div>
				</div>
			</div>
		</ThemeHueProvider>
	);
};
Vision.meta = { width: "100vw" };
