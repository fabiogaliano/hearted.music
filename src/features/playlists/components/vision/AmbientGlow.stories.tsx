import type { Story } from "@ladle/react";

export default { title: "Vision / Ambient Glow" };

import { useState } from "react";

import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";

type Track = {
	title: string;
	artist: string;
	color: string;
};

const tracks: Track[] = [
	{
		title: "Motion Sickness",
		artist: "Phoebe Bridgers",
		color: "hsl(14, 55%, 68%)",
	}, // coral
	{ title: "Pink + White", artist: "Frank Ocean", color: "hsl(38, 60%, 68%)" }, // amber
	{ title: "Alright", artist: "Kendrick Lamar", color: "hsl(100, 25%, 60%)" }, // sage
	{ title: "Ivy", artist: "Frank Ocean", color: "hsl(265, 35%, 72%)" }, // lavender
	{ title: "Cellophane", artist: "FKA twigs", color: "hsl(200, 40%, 68%)" }, // sky
];

const DEFAULT_GLOW = "hsl(30, 30%, 70%)"; // soft warm baseline mood

const intensities = {
	Subtle: 0.15,
	Medium: 0.25,
	Warm: 0.35,
} as const;

type Intensity = keyof typeof intensities;

function Workspace() {
	const [glowColor, setGlowColor] = useState(DEFAULT_GLOW);
	const [intensity, setIntensity] = useState<Intensity>("Medium");

	return (
		<div
			style={{
				position: "relative",
				minHeight: "100vh",
				width: "100%",
				background: "var(--t-bg)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 48,
				overflow: "hidden",
				fontFamily: fonts.body,
			}}
		>
			{/* ambient glow layer — sits between page bg and the content surface */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					background: `radial-gradient(ellipse at 30% 40%, ${glowColor} 0%, transparent 70%)`,
					filter: "blur(80px)",
					opacity: intensities[intensity],
					transition: "background 800ms ease, opacity 400ms ease",
					pointerEvents: "none",
					zIndex: 0,
				}}
			/>

			{/* intensity switcher */}
			<div
				style={{
					position: "absolute",
					top: 32,
					right: 32,
					zIndex: 2,
					display: "flex",
					gap: 8,
					background: "var(--t-surface)",
					border: "1px solid var(--t-border)",
					borderRadius: 999,
					padding: 4,
				}}
			>
				{(Object.keys(intensities) as Intensity[]).map((key) => (
					<button
						key={key}
						type="button"
						onClick={() => setIntensity(key)}
						style={{
							appearance: "none",
							border: "none",
							cursor: "pointer",
							borderRadius: 999,
							padding: "6px 14px",
							fontSize: 13,
							fontFamily: fonts.body,
							color:
								intensity === key
									? "var(--t-text-on-primary)"
									: "var(--t-text-muted)",
							background:
								intensity === key ? "var(--t-primary)" : "transparent",
							transition: "background 200ms ease, color 200ms ease",
						}}
					>
						{key}
					</button>
				))}
			</div>

			{/* content surface */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: hover-only ambient reset, not an interactive control */}
			<div
				style={{
					position: "relative",
					zIndex: 1,
					width: 520,
					maxWidth: "90vw",
					background: "var(--t-surface)",
					border: "1px solid var(--t-border)",
					borderRadius: 20,
					padding: "40px 40px 24px",
					boxShadow: "0 40px 80px -40px rgba(0,0,0,0.25)",
				}}
				onMouseLeave={() => setGlowColor(DEFAULT_GLOW)}
			>
				<div style={{ marginBottom: 32 }}>
					<p
						style={{
							margin: 0,
							fontSize: 12,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: "var(--t-text-muted)",
						}}
					>
						Studio
					</p>
					<h1
						style={{
							margin: "4px 0 0",
							fontFamily: fonts.display,
							fontWeight: 200,
							fontSize: 44,
							color: "var(--t-text)",
							lineHeight: 1.1,
						}}
					>
						Late Night Drive
					</h1>
				</div>

				<div style={{ display: "flex", flexDirection: "column" }}>
					{tracks.map((track) => (
						<button
							key={track.title}
							type="button"
							onMouseEnter={() => setGlowColor(track.color)}
							onFocus={(e) => {
								setGlowColor(track.color);
								e.currentTarget.style.background = "var(--t-surface-dim)";
							}}
							onBlur={(e) => {
								e.currentTarget.style.background = "transparent";
							}}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 16,
								padding: "12px 8px",
								borderRadius: 10,
								cursor: "default",
								transition: "background 300ms ease",
								appearance: "none",
								border: "none",
								background: "transparent",
								textAlign: "left",
								width: "100%",
								font: "inherit",
							}}
							onMouseOver={(e) => {
								e.currentTarget.style.background = "var(--t-surface-dim)";
							}}
							onMouseOut={(e) => {
								e.currentTarget.style.background = "transparent";
							}}
						>
							<div
								style={{
									width: 44,
									height: 44,
									borderRadius: 8,
									background: track.color,
									flexShrink: 0,
									boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
								}}
							/>
							<div style={{ minWidth: 0 }}>
								<p
									style={{
										margin: 0,
										fontSize: 15,
										color: "var(--t-text)",
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
									}}
								>
									{track.title}
								</p>
								<p
									style={{
										margin: 0,
										fontSize: 13,
										color: "var(--t-text-muted)",
									}}
								>
									{track.artist}
								</p>
							</div>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

export const AmbientGlow: Story = () => {
	const [themeKey, setThemeKey] = useState<ThemeColor>("rose");

	return (
		<ThemeHueProvider theme={themes[themeKey]}>
			<div style={{ position: "relative" }}>
				<div
					style={{
						position: "fixed",
						top: 32,
						left: 32,
						zIndex: 2,
						display: "flex",
						gap: 8,
						background: "var(--t-surface)",
						border: "1px solid var(--t-border)",
						borderRadius: 999,
						padding: 4,
					}}
				>
					{(Object.keys(themes) as ThemeColor[]).map((key) => (
						<button
							key={key}
							type="button"
							onClick={() => setThemeKey(key)}
							style={{
								appearance: "none",
								border: "none",
								cursor: "pointer",
								borderRadius: 999,
								padding: "6px 14px",
								fontSize: 13,
								fontFamily: fonts.body,
								color:
									themeKey === key
										? "var(--t-text-on-primary)"
										: "var(--t-text-muted)",
								background:
									themeKey === key ? "var(--t-primary)" : "transparent",
								transition: "background 200ms ease, color 200ms ease",
							}}
						>
							{themes[key].name}
						</button>
					))}
				</div>
				<Workspace />
			</div>
		</ThemeHueProvider>
	);
};

AmbientGlow.meta = { width: "100vw" };
