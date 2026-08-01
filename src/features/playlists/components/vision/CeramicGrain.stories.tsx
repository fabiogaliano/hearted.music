/**
 * Ceramic matte grain — vision prototype for a barely-perceptible noise
 * texture over surfaces, tuned to feel like matte ceramic/exhibition-catalog
 * paper stock rather than a flat, plastic UI.
 *
 * Throwaway: delete once a direction is picked.
 */

import { useState } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";

export default { title: "Vision / Ceramic Grain" };

const INTENSITIES = {
	off: { label: "Off", opacity: 0 },
	paper: { label: "Paper 4%", opacity: 0.04 },
	matte: { label: "Matte 8%", opacity: 0.08 },
	ceramic: { label: "Ceramic 14%", opacity: 0.14 },
} as const;
type Intensity = keyof typeof INTENSITIES;

let grainId = 0;
function GrainOverlay({ opacity }: { opacity: number }) {
	const [id] = useState(() => `cg-grain-${++grainId}`);
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

const chipFill =
	"color-mix(in srgb, var(--t-surface-dim) 25%, var(--t-surface))";

function GenreChips() {
	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 8,
				position: "relative",
				zIndex: 2,
			}}
		>
			{["hip-hop", "electronic", "rap"].map((g, i) => (
				<span
					key={g}
					style={{
						display: "inline-flex",
						alignItems: "center",
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: i === 0 ? "var(--t-text-on-primary)" : "var(--t-text-muted)",
						background: i === 0 ? "var(--t-primary)" : chipFill,
						border: "1px solid transparent",
					}}
				>
					{g}
				</span>
			))}
		</div>
	);
}

function FilterRows() {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 6,
				position: "relative",
				zIndex: 2,
			}}
		>
			{["Decade", "Mood", "Energy"].map((row) => (
				<div
					key={row}
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "8px 10px",
						borderRadius: 8,
						background: chipFill,
						fontSize: 12,
						color: "var(--t-text-muted)",
					}}
				>
					<span>{row}</span>
					<span style={{ opacity: 0.6 }}>Any</span>
				</div>
			))}
		</div>
	);
}

function ArtistChips() {
	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 8,
				position: "relative",
				zIndex: 2,
			}}
		>
			{[
				{ name: "Kendrick Lamar", n: 42, on: true },
				{ name: "Tyler", n: 18, on: false },
				{ name: "JPEGMAFIA", n: 12, on: false },
			].map((a) => (
				<span
					key={a.name}
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: a.on ? "var(--t-text-on-primary)" : "var(--t-text-muted)",
						background: a.on ? "var(--t-primary)" : chipFill,
						border: "1px solid transparent",
					}}
				>
					{a.name} <span style={{ opacity: 0.6 }}>{a.n}</span>
				</span>
			))}
		</div>
	);
}

function SidebarPanel({
	grained,
	opacity,
}: {
	grained: boolean;
	opacity: number;
}) {
	return (
		<div
			style={{
				position: "relative",
				borderRadius: 14,
				border: "1px solid var(--t-border)",
				background: "var(--t-surface)",
				padding: 20,
				display: "flex",
				flexDirection: "column",
				gap: 16,
				overflow: "hidden",
			}}
		>
			{grained && <GrainOverlay opacity={opacity} />}
			<span
				style={{
					fontSize: 11,
					fontWeight: 600,
					letterSpacing: "0.12em",
					textTransform: "uppercase",
					color: "var(--t-text-muted)",
					position: "relative",
					zIndex: 2,
				}}
			>
				Vibe
			</span>
			<GenreChips />
			<FilterRows />
			<ArtistChips />
		</div>
	);
}

function PlaylistCard({
	grained,
	opacity,
}: {
	grained: boolean;
	opacity: number;
}) {
	return (
		<div
			style={{
				position: "relative",
				borderRadius: 14,
				border: "1px solid var(--t-border)",
				background: "var(--t-surface)",
				padding: 22,
				overflow: "hidden",
				minHeight: 120,
				display: "flex",
				flexDirection: "column",
				justifyContent: "flex-end",
			}}
		>
			{grained && <GrainOverlay opacity={opacity} />}
			<h3
				style={{
					position: "relative",
					zIndex: 2,
					margin: 0,
					fontFamily: fonts.display,
					fontWeight: 300,
					fontSize: 26,
					color: "var(--t-text)",
				}}
			>
				Late Night Drives
			</h3>
			<p
				style={{
					position: "relative",
					zIndex: 2,
					margin: "4px 0 0",
					fontSize: 12,
					color: "var(--t-text-muted)",
				}}
			>
				38 tracks · updated Jul 29
			</p>
		</div>
	);
}

function Row({
	label,
	grained,
	opacity,
}: {
	label: string;
	grained: boolean;
	opacity: number;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			<span
				style={{
					fontSize: 11,
					fontWeight: 600,
					letterSpacing: "0.12em",
					textTransform: "uppercase",
					color: "var(--t-text-muted)",
				}}
			>
				{label}
			</span>
			<div
				style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}
			>
				<SidebarPanel grained={grained} opacity={opacity} />
				<PlaylistCard grained={grained} opacity={opacity} />
			</div>
		</div>
	);
}

export const CeramicGrain: React.FC & { meta?: { width?: string } } = () => {
	const [themeKey, setThemeKey] = useState<ThemeColor>("rose");
	const [intensity, setIntensity] = useState<Intensity>("matte");
	const themeKeys = Object.keys(themes) as ThemeColor[];
	const opacity = INTENSITIES[intensity].opacity;

	return (
		<ThemeHueProvider theme={themes[themeKey]}>
			<div
				style={{
					position: "relative",
					padding: 40,
					background: "var(--t-bg)",
					minHeight: "100vh",
					fontFamily: fonts.body,
					overflow: "hidden",
				}}
			>
				{/* Page-level grain — always ceramic-intensity, shown continuously so
				    the full background texture can be judged against the card comparisons below */}
				<GrainOverlay opacity={opacity} />

				<div
					style={{
						position: "relative",
						zIndex: 2,
						display: "flex",
						flexDirection: "column",
						gap: 32,
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "flex-end",
							flexWrap: "wrap",
							gap: 16,
						}}
					>
						<div>
							<h1
								style={{
									margin: 0,
									fontFamily: fonts.display,
									fontWeight: 200,
									fontSize: 36,
									color: "var(--t-text)",
								}}
							>
								Ceramic matte grain
							</h1>
							<p
								style={{
									margin: "6px 0 0",
									fontSize: 13,
									color: "var(--t-text-muted)",
									maxWidth: 560,
								}}
							>
								A texture so faint it reads as material, not decoration — like
								the difference between matte and glossy paper stock. No depth,
								no shadow, just surface.
							</p>
						</div>

						<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							{themeKeys.map((t) => (
								<button
									key={t}
									type="button"
									onClick={() => setThemeKey(t)}
									style={{
										padding: "6px 14px",
										borderRadius: 999,
										border:
											t === themeKey
												? "2px solid var(--t-primary)"
												: "1px solid var(--t-border)",
										background:
											t === themeKey ? "var(--t-primary)" : "var(--t-surface)",
										color:
											t === themeKey
												? "var(--t-text-on-primary)"
												: "var(--t-text)",
										fontSize: 12,
										fontWeight: t === themeKey ? 600 : 400,
										cursor: "pointer",
									}}
								>
									{themes[t].name}
								</button>
							))}
						</div>
					</div>

					<div style={{ display: "flex", gap: 8 }}>
						{(Object.keys(INTENSITIES) as Intensity[]).map((key) => (
							<button
								key={key}
								type="button"
								onClick={() => setIntensity(key)}
								style={{
									padding: "8px 16px",
									borderRadius: 10,
									border:
										key === intensity
											? "2px solid var(--t-primary)"
											: "1px solid var(--t-border)",
									background:
										key === intensity ? "var(--t-primary)" : "var(--t-surface)",
									color:
										key === intensity
											? "var(--t-text-on-primary)"
											: "var(--t-text)",
									fontSize: 12,
									fontWeight: key === intensity ? 600 : 400,
									cursor: "pointer",
								}}
							>
								{INTENSITIES[key].label}{" "}
								<span style={{ opacity: 0.65 }}>
									{(INTENSITIES[key].opacity * 100).toFixed(1)}%
								</span>
							</button>
						))}
					</div>

					<Row label="Flat (current)" grained={false} opacity={opacity} />
					<Row
						label={`Ceramic — ${INTENSITIES[intensity].label}`}
						grained
						opacity={opacity}
					/>
				</div>
			</div>
		</ThemeHueProvider>
	);
};
CeramicGrain.meta = { width: "100vw" };
