/**
 * Studio Tracklist — side-by-side "Current" vs "Evolved" comparison of the
 * playlist creation studio's main content area. Left column matches shipped
 * design (flat rows, square art, no depth). Right column layers the four
 * evolved treatments: ambient glow, color-temperature depth (warm tracklist
 * vs. cool suggestions), squircle geometry, ceramic grain.
 *
 * Throwaway: delete once a direction is picked.
 */

import type { Story } from "@ladle/react";
import { type CSSProperties, useState } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";

const VIBE_TEXT = "Late-night drive through an empty city";

// `id` is explicit (not the map index) because the list intentionally repeats
// tracks to pad the demo to a realistic length — title/artist alone collide.
const MAIN_SONGS = [
	{
		id: "main-1",
		title: "Don't Hurt Me, I'm Trying",
		artist: "NoSo",
		art: "https://i.scdn.co/image/ab67616d0000b273a0528382229c84aae80a14d6",
	},
	{
		id: "main-2",
		title: "Electric Fish",
		artist: "Ana Frango Elétrico",
		art: "https://i.scdn.co/image/ab67616d0000b273dfa82523de5ab6b5508d7aa5",
	},
	{
		id: "main-3",
		title: "Gone Baby, Don't Be Long",
		artist: "Erykah Badu",
		art: "https://i.scdn.co/image/ab67616d0000b2732c1b088d399087bd3a1de30b",
	},
	{
		id: "main-4",
		title: "What is Love",
		artist: "TWICE",
		art: "https://i.scdn.co/image/ab67616d0000b273d72bea64eca7f26647f8e57a",
	},
	{
		id: "main-5",
		title: "FANCY",
		artist: "TWICE",
		art: "https://i.scdn.co/image/ab67616d0000b2739e87fd81ab0dfad228f8a004",
	},
	{
		id: "main-6",
		title: "The Wave",
		artist: "SE SO NEON",
		art: "https://i.scdn.co/image/ab67616d0000b27301286474faacf2334695f99f",
	},
	{
		id: "main-7",
		title: "Life Will Be",
		artist: "Cleo Sol",
		art: "https://i.scdn.co/image/ab67616d0000b2738128b3a01e0246795dfab1a2",
	},
	{
		id: "main-8",
		title: "GO!",
		artist: "Common",
		art: "https://i.scdn.co/image/ab67616d0000b2736c1e31e10c7a5b2ed2258e29",
	},
	{
		id: "main-9",
		title: "Fall In Love",
		artist: "Phantogram",
		art: "https://i.scdn.co/image/ab67616d0000b2734a02353678a4f62a9d2e3d2b",
	},
	{
		id: "main-10",
		title: "Don't Hurt Me, I'm Trying",
		artist: "NoSo",
		art: "https://i.scdn.co/image/ab67616d0000b273a0528382229c84aae80a14d6",
	},
	{
		id: "main-11",
		title: "Electric Fish",
		artist: "Ana Frango Elétrico",
		art: "https://i.scdn.co/image/ab67616d0000b273dfa82523de5ab6b5508d7aa5",
	},
	{
		id: "main-12",
		title: "Gone Baby, Don't Be Long",
		artist: "Erykah Badu",
		art: "https://i.scdn.co/image/ab67616d0000b2732c1b088d399087bd3a1de30b",
	},
] as const;

const SUGGESTED_SONGS = [
	{
		id: "sug-1",
		title: "What is Love",
		artist: "TWICE",
		art: "https://i.scdn.co/image/ab67616d0000b273d72bea64eca7f26647f8e57a",
	},
	{
		id: "sug-2",
		title: "FANCY",
		artist: "TWICE",
		art: "https://i.scdn.co/image/ab67616d0000b2739e87fd81ab0dfad228f8a004",
	},
	{
		id: "sug-3",
		title: "The Wave",
		artist: "SE SO NEON",
		art: "https://i.scdn.co/image/ab67616d0000b27301286474faacf2334695f99f",
	},
	{
		id: "sug-4",
		title: "Life Will Be",
		artist: "Cleo Sol",
		art: "https://i.scdn.co/image/ab67616d0000b2738128b3a01e0246795dfab1a2",
	},
	{
		id: "sug-5",
		title: "GO!",
		artist: "Common",
		art: "https://i.scdn.co/image/ab67616d0000b2736c1e31e10c7a5b2ed2258e29",
	},
] as const;

export default { title: "Vision / Studio Tracklist" };

let grainCounter = 0;
function GrainOverlay({ opacity = 0.1 }: { opacity?: number }) {
	const [id] = useState(() => `st-grain-${++grainCounter}`);
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

const warmRaisedSurface =
	"oklch(from var(--t-surface) calc(l - 0.012) calc(c + 0.002) calc(h + 2))";
const coolLoweredSurface =
	"oklch(from var(--t-surface) calc(l - 0.02) calc(c + 0.001) calc(h - 2))";
const currentChipFill = "color-mix(in srgb, var(--t-text) 7%, transparent)";

function Glow({
	color,
	opacity = 0.2,
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
				inset: "-15%",
				zIndex: 0,
				pointerEvents: "none",
				background: `radial-gradient(closest-side, ${color} 0%, transparent 70%)`,
				filter: `blur(${blur}px)`,
				opacity,
			}}
		/>
	);
}

function SongRow({
	title,
	artist,
	art,
	evolved,
}: {
	title: string;
	artist: string;
	art: string;
	evolved: boolean;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 12,
				width: "100%",
				border: "none",
				font: "inherit",
				textAlign: "left",
				cursor: "pointer",
				padding: evolved ? "8px 10px" : "10px 4px",
				borderRadius: evolved ? 10 : 0,
				borderBottom: evolved ? "none" : "1px solid var(--t-border)",
				background: hover
					? evolved
						? "oklch(from var(--t-surface) calc(l - 0.01) calc(c + 0.004) calc(h + 4))"
						: "color-mix(in srgb, var(--t-text) 7%, transparent)"
					: "transparent",
				transition: "background 150ms ease-out",
			}}
		>
			<img
				src={art}
				alt=""
				draggable={false}
				style={{
					...(evolved ? squircle : undefined),
					width: 40,
					height: 40,
					borderRadius: evolved ? 11 : 0,
					objectFit: "cover",
					flexShrink: 0,
				}}
			/>
			<div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
				<span
					style={{
						fontSize: 13,
						color: "var(--t-text)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{title}
				</span>
				<span
					style={{
						fontSize: 12,
						fontStyle: "italic",
						color: "var(--t-text-muted)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{artist}
				</span>
			</div>
		</button>
	);
}

function CreateButton({ evolved }: { evolved: boolean }) {
	return (
		<div style={{ position: "relative", marginTop: 20 }}>
			{evolved && <Glow color="oklch(0.72 0.15 40)" opacity={0.18} blur={40} />}
			<button
				type="button"
				style={{
					...(evolved ? squircle : undefined),
					position: "relative",
					zIndex: 2,
					width: "100%",
					padding: "13px 20px",
					borderRadius: evolved ? 14 : 6,
					border: "none",
					background: "var(--t-primary)",
					color: "var(--t-text-on-primary)",
					fontSize: 13,
					fontWeight: 500,
					fontFamily: fonts.body,
					cursor: "pointer",
				}}
			>
				Create playlist · 12 songs
			</button>
		</div>
	);
}

function CurrentTracklist() {
	return (
		<div
			style={{
				width: 420,
				background: "var(--t-surface)",
				border: "1px solid var(--t-border)",
				padding: 20,
			}}
		>
			<p
				style={{
					margin: "0 0 20px",
					fontSize: 14,
					fontStyle: "italic",
					color: "var(--t-text)",
				}}
			>
				&ldquo;{VIBE_TEXT}&rdquo;
			</p>

			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "baseline",
					paddingBottom: 12,
					marginBottom: 8,
					borderBottom: "1px solid var(--t-border)",
				}}
			>
				<span
					style={{
						fontFamily: fonts.display,
						fontWeight: 200,
						fontSize: 20,
						color: "var(--t-text)",
					}}
				>
					Your playlist
				</span>
				<div style={{ textAlign: "right" }}>
					<span
						style={{
							display: "block",
							fontSize: 12,
							color: "var(--t-text-muted)",
						}}
					>
						12 songs
					</span>
					<span style={{ fontSize: 12, color: "var(--t-text-muted)" }}>
						about 42 minutes
					</span>
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column" }}>
				{MAIN_SONGS.map(({ id, ...s }) => (
					<SongRow key={id} {...s} evolved={false} />
				))}
			</div>

			<div style={{ margin: "16px 0 8px" }}>
				<span style={sectionLabel}>Suggestions</span>
			</div>
			<div style={{ display: "flex", flexDirection: "column" }}>
				{SUGGESTED_SONGS.map(({ id, ...s }) => (
					<SongRow key={id} {...s} evolved={false} />
				))}
			</div>

			<CreateButton evolved={false} />
		</div>
	);
}

function EvolvedTracklist() {
	return (
		<div
			style={{
				position: "relative",
				width: 420,
				borderRadius: 20,
				overflow: "hidden",
				background: "var(--t-surface)",
			}}
		>
			<Glow color="oklch(0.72 0.14 45)" opacity={0.2} blur={80} />
			<GrainOverlay />

			<div style={{ position: "relative", zIndex: 2, padding: 20 }}>
				<div
					style={{
						...squircle,
						borderRadius: 14,
						background: warmRaisedSurface,
						padding: "14px 16px",
						marginBottom: 18,
					}}
				>
					<p
						style={{
							margin: 0,
							fontSize: 14,
							fontStyle: "italic",
							color: "var(--t-text)",
						}}
					>
						&ldquo;{VIBE_TEXT}&rdquo;
					</p>
				</div>

				<div
					style={{
						...squircle,
						background: warmRaisedSurface,
						borderRadius: 16,
						padding: 16,
						marginBottom: 10,
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "baseline",
							marginBottom: 12,
						}}
					>
						<span
							style={{
								fontFamily: fonts.display,
								fontWeight: 200,
								fontSize: 20,
								color: "var(--t-text)",
							}}
						>
							Your playlist
						</span>
						<div style={{ textAlign: "right" }}>
							<span
								style={{
									display: "block",
									fontSize: 12,
									color: "var(--t-text-muted)",
								}}
							>
								12 songs
							</span>
							<span style={{ fontSize: 12, color: "var(--t-text-muted)" }}>
								about 42 minutes
							</span>
						</div>
					</div>

					<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
						{MAIN_SONGS.map(({ id, ...s }) => (
							<SongRow key={id} {...s} evolved />
						))}
					</div>
				</div>

				<div
					style={{
						...squircle,
						background: coolLoweredSurface,
						borderRadius: 16,
						padding: 16,
					}}
				>
					<div style={{ marginBottom: 10 }}>
						<span style={sectionLabel}>Suggestions</span>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
						{SUGGESTED_SONGS.map(({ id, ...s }) => (
							<SongRow key={id} {...s} evolved />
						))}
					</div>
				</div>

				<CreateButton evolved />
			</div>
		</div>
	);
}

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

export const StudioTracklist: Story = () => {
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
						maxWidth: 1000,
						margin: "0 auto",
						padding: "0 40px",
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							borderRight: "1px solid var(--t-border)",
							paddingRight: 32,
						}}
					>
						<ColumnHeader label="Current" />
						<div style={{ padding: "20px 0" }}>
							<CurrentTracklist />
						</div>
					</div>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							paddingLeft: 32,
						}}
					>
						<ColumnHeader label="Evolved" />
						<div style={{ padding: "20px 0" }}>
							<EvolvedTracklist />
						</div>
					</div>
				</div>
			</div>
		</ThemeHueProvider>
	);
};
StudioTracklist.meta = { width: "100vw" };
