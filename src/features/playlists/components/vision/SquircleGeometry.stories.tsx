import type { Story } from "@ladle/react";

export default { title: "Vision / Squircles" };

import { useState } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";

/**
 * Standard border-radius approximates a rounded corner with a single circular
 * arc. `corner-shape: squircle` (Chromium 139+) instead traces a continuous
 * curvature (superellipse) — no sharp point where the arc meets the straight
 * edge. Support is partial, so this is layered as a progressive enhancement:
 * unsupported browsers still see a (slightly larger) rounded rect.
 */
const squircleStyle = (radius: number): React.CSSProperties =>
	({ borderRadius: radius, cornerShape: "squircle" }) as React.CSSProperties;

const radius = (squircle: boolean, r: number): React.CSSProperties =>
	squircle ? squircleStyle(r) : { borderRadius: r };

const chipFill =
	"color-mix(in srgb, var(--t-surface-dim) 25%, var(--t-surface))";
const displayHeading: React.CSSProperties = {
	fontFamily: fonts.display,
	fontWeight: 300,
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
	<div
		style={{
			fontSize: 11,
			letterSpacing: "0.08em",
			fontVariant: "small-caps",
			color: "var(--t-text-muted)",
			marginBottom: 10,
		}}
	>
		{children}
	</div>
);

function GenreChips({ squircle }: { squircle: boolean }) {
	return (
		<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
			{["hip-hop", "electronic", "rap"].map((label) => (
				<span
					key={label}
					style={{
						padding: "7px 16px",
						fontSize: 13,
						color: "var(--t-text)",
						background: chipFill,
						...radius(squircle, 999),
					}}
				>
					{label}
				</span>
			))}
		</div>
	);
}

function Buttons({ squircle }: { squircle: boolean }) {
	const base: React.CSSProperties = {
		padding: "10px 20px",
		fontSize: 13,
		fontFamily: fonts.body,
		cursor: "pointer",
	};
	return (
		<div style={{ display: "flex", gap: 10 }}>
			<button
				type="button"
				style={{
					...base,
					border: "none",
					background: "var(--t-primary)",
					color: "var(--t-text-on-primary)",
					...radius(squircle, 14),
				}}
			>
				Create playlist
			</button>
			<button
				type="button"
				style={{
					...base,
					border: "1px solid var(--t-border)",
					background: "transparent",
					color: "var(--t-text)",
					...radius(squircle, 14),
				}}
			>
				Cancel
			</button>
		</div>
	);
}

function PlaylistCard({ squircle }: { squircle: boolean }) {
	return (
		<div
			style={{
				width: 220,
				padding: 14,
				background: chipFill,
				...radius(squircle, 20),
			}}
		>
			<div
				style={{
					width: "100%",
					aspectRatio: "1 / 1",
					background:
						"linear-gradient(135deg, var(--t-primary), var(--t-surface-dim))",
					marginBottom: 12,
					...radius(squircle, 14),
				}}
			/>
			<div
				style={{
					...displayHeading,
					fontSize: 19,
					color: "var(--t-text)",
					marginBottom: 4,
				}}
			>
				Late Night Drive
			</div>
			<div style={{ fontSize: 12.5, color: "var(--t-text-muted)" }}>
				42 songs · woven from your likes
			</div>
		</div>
	);
}

function SearchInput({ squircle }: { squircle: boolean }) {
	return (
		<input
			placeholder="Search songs, artists…"
			style={{
				width: 220,
				padding: "10px 16px",
				fontSize: 13,
				fontFamily: fonts.body,
				border: "1px solid var(--t-border)",
				background: "var(--t-surface)",
				color: "var(--t-text)",
				outline: "none",
				...radius(squircle, 14),
			}}
		/>
	);
}

function Avatar({ squircle }: { squircle: boolean }) {
	return (
		<div
			style={{
				width: 56,
				height: 56,
				background:
					"linear-gradient(135deg, var(--t-surface-dim), var(--t-primary))",
				...radius(squircle, 16),
			}}
		/>
	);
}

function SegmentControl({ squircle }: { squircle: boolean }) {
	const [active, setActive] = useState("Any");
	return (
		<div
			style={{
				display: "inline-flex",
				padding: 4,
				gap: 2,
				background: chipFill,
				...radius(squircle, 999),
			}}
		>
			{["Any", "Female", "Male"].map((option) => {
				const isActive = option === active;
				return (
					<button
						key={option}
						type="button"
						onClick={() => setActive(option)}
						style={{
							padding: "6px 16px",
							fontSize: 12.5,
							fontFamily: fonts.body,
							border: "none",
							cursor: "pointer",
							background: isActive ? "var(--t-primary)" : "transparent",
							color: isActive
								? "var(--t-text-on-primary)"
								: "var(--t-text-muted)",
							...radius(squircle, 999),
						}}
					>
						{option}
					</button>
				);
			})}
		</div>
	);
}

function Column({ heading, squircle }: { heading: string; squircle: boolean }) {
	const sections: Array<[string, React.ReactNode]> = [
		["Genre pills", <GenreChips key="chips" squircle={squircle} />],
		["Buttons", <Buttons key="buttons" squircle={squircle} />],
		["Playlist card", <PlaylistCard key="card" squircle={squircle} />],
		["Search input", <SearchInput key="input" squircle={squircle} />],
		["Album thumbnail", <Avatar key="avatar" squircle={squircle} />],
		["Segment control", <SegmentControl key="segment" squircle={squircle} />],
	];
	return (
		<div style={{ flex: 1 }}>
			<div
				style={{
					...displayHeading,
					fontSize: 22,
					color: "var(--t-text)",
					marginBottom: 24,
					paddingBottom: 12,
					borderBottom: "1px solid var(--t-border)",
				}}
			>
				{heading}
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
				{sections.map(([label, node]) => (
					<div key={label}>
						<SectionLabel>{label}</SectionLabel>
						{node}
					</div>
				))}
			</div>
		</div>
	);
}

export const Squircles: Story = () => {
	const [themeKey, setThemeKey] = useState<ThemeColor>("rose");

	return (
		<ThemeHueProvider theme={themes[themeKey]}>
			<div
				style={{
					minHeight: "100vh",
					background: "var(--t-bg)",
					fontFamily: fonts.body,
					padding: "48px 56px",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "baseline",
						justifyContent: "space-between",
						marginBottom: 40,
					}}
				>
					<div>
						<h1
							style={{
								...displayHeading,
								fontWeight: 200,
								fontSize: 40,
								color: "var(--t-text)",
								margin: 0,
							}}
						>
							Squircle geometry
						</h1>
						<p
							style={{
								fontSize: 13.5,
								color: "var(--t-text-muted)",
								marginTop: 6,
							}}
						>
							Continuous-curvature corners (via CSS <code>corner-shape</code>)
							vs. standard circular <code>border-radius</code>. Subtle, but it
							reads as more considered.
						</p>
					</div>
					<div style={{ display: "flex", gap: 6 }}>
						{(Object.keys(themes) as ThemeColor[]).map((key) => (
							<button
								key={key}
								type="button"
								onClick={() => setThemeKey(key)}
								style={{
									padding: "6px 14px",
									fontSize: 12,
									fontFamily: fonts.body,
									border: "1px solid var(--t-border)",
									cursor: "pointer",
									borderRadius: 999,
									background:
										key === themeKey ? "var(--t-primary)" : "transparent",
									color:
										key === themeKey
											? "var(--t-text-on-primary)"
											: "var(--t-text-muted)",
								}}
							>
								{themes[key].name}
							</button>
						))}
					</div>
				</div>

				<div style={{ display: "flex", gap: 64 }}>
					<Column heading="Standard" squircle={false} />
					<Column heading="Squircle" squircle={true} />
				</div>

				<p
					style={{
						marginTop: 48,
						fontSize: 12,
						color: "var(--t-text-muted)",
						maxWidth: 560,
					}}
				>
					<code>corner-shape: squircle</code> ships in Chromium 139+; other
					engines fall back silently to the plain rounded rect above, so this is
					a safe progressive enhancement rather than a hard dependency.
				</p>
			</div>
		</ThemeHueProvider>
	);
};
Squircles.meta = { width: "100vw" };
