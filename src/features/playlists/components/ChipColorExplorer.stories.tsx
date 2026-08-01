/**
 * Chip fill color explorer — 8 candidate fills for unselected chips,
 * shown on the real theme surface alongside selected (primary) chips
 * and suggestion pills so pairing can be judged in context.
 *
 * Throwaway: delete once a direction is picked.
 */

import { useState } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";

export default { title: "Chip Colors" };

const CANDIDATES: Array<{ label: string; value: string }> = [
	{
		label: "A — text 7% (current)",
		value: "color-mix(in srgb, var(--t-text) 7%, transparent)",
	},
	{
		label: "B — primary 10%",
		value: "color-mix(in srgb, var(--t-primary) 10%, transparent)",
	},
	{
		label: "C — primary 14%",
		value: "color-mix(in srgb, var(--t-primary) 14%, transparent)",
	},
	{
		label: "D — surface-dim 40%",
		value: "color-mix(in srgb, var(--t-surface-dim) 40%, var(--t-surface))",
	},
	{
		label: "E — surface-dim 55%",
		value: "color-mix(in srgb, var(--t-surface-dim) 55%, var(--t-surface))",
	},
	{
		label: "F — text-muted 10%",
		value: "color-mix(in srgb, var(--t-text-muted) 10%, transparent)",
	},
	{
		label: "G — bg darken",
		value: "color-mix(in srgb, var(--t-bg) 70%, var(--t-surface-dim))",
	},
	{
		label: "H — primary 8% + text 3%",
		value:
			"color-mix(in srgb, color-mix(in srgb, var(--t-primary) 8%, transparent) 80%, color-mix(in srgb, var(--t-text) 3%, transparent))",
	},
];

function ChipSample({
	fillColor,
	label,
}: {
	fillColor: string;
	label: string;
}) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 10,
				padding: 20,
				borderRadius: 12,
				background: "var(--t-surface)",
				fontFamily: fonts.body,
				minWidth: 260,
			}}
		>
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

			{/* Genre chips row — selected */}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: "var(--t-text-on-primary)",
						background: "var(--t-primary)",
						border: "1px solid transparent",
					}}
				>
					hip-hop
				</span>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: "var(--t-text-on-primary)",
						background: "var(--t-primary)",
						border: "1px solid transparent",
					}}
				>
					electronic
				</span>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: "var(--t-text-on-primary)",
						background: "var(--t-primary)",
						border: "1px solid transparent",
					}}
				>
					rap
				</span>
			</div>

			{/* Add genre pill */}
			<div style={{ display: "flex", gap: 8 }}>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: "var(--t-text-muted)",
						background: fillColor,
						border: "1px solid transparent",
					}}
				>
					+ add genre
				</span>
			</div>

			{/* Suggestion pills */}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{["jazz", "soul", "indie"].map((g) => (
					<span
						key={g}
						style={{
							display: "inline-flex",
							alignItems: "center",
							borderRadius: 999,
							padding: "5px 12px",
							fontSize: 12,
							color: "var(--t-text-muted)",
							background: fillColor,
							border: "1px solid transparent",
							cursor: "pointer",
						}}
					>
						{g}
					</span>
				))}
			</div>

			{/* Decade chips */}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
				{["1990s", "2000s", "2010s"].map((d, i) => (
					<span
						key={d}
						style={{
							display: "inline-flex",
							alignItems: "center",
							borderRadius: 999,
							padding: "5px 10px",
							fontSize: 12,
							color:
								i === 1 ? "var(--t-text-on-primary)" : "var(--t-text-muted)",
							background: i === 1 ? "var(--t-primary)" : fillColor,
							border: "1px solid transparent",
						}}
					>
						{d}
					</span>
				))}
			</div>

			{/* Artist chip row */}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: "var(--t-text-on-primary)",
						background: "var(--t-primary)",
						border: "1px solid transparent",
					}}
				>
					Kendrick Lamar <span style={{ opacity: 0.6 }}>42</span>
				</span>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: "var(--t-text-muted)",
						background: fillColor,
						border: "1px solid transparent",
						opacity: 0.55,
					}}
				>
					Tyler <span style={{ opacity: 0.6 }}>18</span>
				</span>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						borderRadius: 999,
						padding: "5px 12px",
						fontSize: 12,
						color: "var(--t-text-muted)",
						background: fillColor,
						border: "1px solid transparent",
					}}
				>
					JPEGMAFIA <span style={{ opacity: 0.6 }}>12</span>
				</span>
			</div>

			{/* Swatch */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginTop: 4,
				}}
			>
				<div
					style={{
						width: 24,
						height: 24,
						borderRadius: 6,
						background: fillColor,
						border:
							"1px solid color-mix(in srgb, var(--t-text) 10%, transparent)",
					}}
				/>
				<code
					style={{
						fontSize: 10,
						color: "var(--t-text-muted)",
						wordBreak: "break-all",
					}}
				>
					{fillColor}
				</code>
			</div>
		</div>
	);
}

export const Explorer: React.FC & { meta?: { width?: string } } = () => {
	const [themeKey, setThemeKey] = useState<ThemeColor>("rose");
	const themeKeys = Object.keys(themes) as ThemeColor[];

	return (
		<ThemeHueProvider theme={themes[themeKey]}>
			<div
				style={{
					padding: 32,
					background: "var(--t-bg)",
					minHeight: "100vh",
					fontFamily: fonts.body,
				}}
			>
				<div
					style={{
						display: "flex",
						gap: 8,
						marginBottom: 24,
						flexWrap: "wrap",
					}}
				>
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
									t === themeKey ? "var(--t-text-on-primary)" : "var(--t-text)",
								fontSize: 12,
								fontWeight: t === themeKey ? 600 : 400,
								cursor: "pointer",
							}}
						>
							{themes[t].name}
						</button>
					))}
				</div>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
						gap: 16,
					}}
				>
					{CANDIDATES.map((c) => (
						<ChipSample key={c.label} fillColor={c.value} label={c.label} />
					))}
				</div>
			</div>
		</ThemeHueProvider>
	);
};
Explorer.meta = { width: "100vw" };
