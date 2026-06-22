import { type ReactNode, useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";
import { MatchFiltersFieldList } from "./MatchFiltersFieldList";
import { MOCK_FILTER_OPTIONS } from "./mock-filter-options";

/**
 * Three surface directions for the match-intent panel, side by side, so the flat
 * "everything is the same colour as the bg" problem can be judged at the panel
 * level (intent + genres + filters together) rather than per control.
 *
 *   A — Lift the whole panel onto one elevated surface (cohesive, distinct).
 *   B — Deepen the page/drawer bg behind flat content (more value contrast).
 *   C — Zone each section in its own consistent subtle surface.
 *
 * Throwaway: delete once a direction is picked.
 */

const SEED: PlaylistMatchFiltersV1 = {
	version: 1,
	languages: { codes: ["pt", "es", "fr"] },
	releaseYear: { kind: "after", start: 2000 },
	vocalGender: "female",
};

const EYEBROW = "color-mix(in srgb, var(--t-text) 70%, var(--t-text-muted))";

function Eyebrow({ children }: { children: string }) {
	return (
		<span
			style={{
				display: "block",
				fontFamily: fonts.body,
				fontSize: 11,
				fontWeight: 500,
				letterSpacing: "0.18em",
				textTransform: "uppercase",
				color: EYEBROW,
			}}
		>
			{children}
		</span>
	);
}

function GenrePill({
	label,
	kind,
}: {
	label: string;
	kind: "selected" | "option" | "add";
}) {
	const base = {
		fontFamily: fonts.body,
		borderRadius: 999,
		whiteSpace: "nowrap" as const,
	};
	if (kind === "selected")
		return (
			<span
				style={{
					...base,
					padding: "5px 13px",
					fontSize: 13,
					background: "var(--t-primary)",
					color: "var(--t-text-on-primary)",
				}}
			>
				{label}
			</span>
		);
	if (kind === "add")
		return (
			<span
				style={{
					...base,
					padding: "6px 13px",
					fontSize: 13,
					border:
						"1px dashed color-mix(in srgb, var(--t-text) 50%, transparent)",
					color: "color-mix(in srgb, var(--t-text) 72%, var(--t-text-muted))",
				}}
			>
				{label}
			</span>
		);
	return (
		<span
			style={{
				...base,
				padding: "6px 13px",
				fontSize: 13,
				border: "1px solid color-mix(in srgb, var(--t-text) 35%, transparent)",
				color: "color-mix(in srgb, var(--t-text) 60%, var(--t-text-muted))",
			}}
		>
			{label}
		</span>
	);
}

function Masthead() {
	return (
		<div style={{ display: "flex", gap: 16, alignItems: "center" }}>
			<div
				style={{
					width: 84,
					height: 84,
					borderRadius: 10,
					flexShrink: 0,
					background:
						"conic-gradient(from 210deg, #e8b84b, #2f6f8f, #1d3a5f, #c87da0, #e8b84b)",
					boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)",
				}}
			/>
			<div
				style={{
					fontFamily: fonts.display,
					fontSize: 26,
					lineHeight: 1.04,
					color: "var(--t-text)",
				}}
			>
				main character energy!!1!!
			</div>
		</div>
	);
}

function Intent() {
	return (
		<div>
			<Eyebrow>Matching intent</Eyebrow>
			<p
				style={{
					margin: "8px 0 0",
					fontFamily: fonts.body,
					fontSize: 16,
					lineHeight: 1.4,
					color: "var(--t-text)",
				}}
			>
				hazy psychedelic folk with a coastal drift — think Joni Mitchell meets
				Grateful Dead at dawn
			</p>
		</div>
	);
}

function Genres() {
	return (
		<div>
			<Eyebrow>Genres</Eyebrow>
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 8,
					marginTop: 10,
				}}
			>
				<GenrePill kind="selected" label="folk rock" />
				<GenrePill kind="selected" label="psychedelic folk" />
				<GenrePill kind="selected" label="singer-songwriter" />
				<GenrePill kind="add" label="+ add genre" />
			</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
				{["acoustic", "anatolian rock", "celtic rock", "contemporary folk"].map(
					(g) => (
						<GenrePill key={g} kind="option" label={g} />
					),
				)}
			</div>
		</div>
	);
}

function Filters() {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(SEED);
	return (
		<MatchFiltersFieldList
			filters={filters}
			onFiltersChange={setFilters}
			options={MOCK_FILTER_OPTIONS}
			optionsState="ready"
		/>
	);
}

// ── Surface treatments ────────────────────────────────────────────────────

const PANEL_SHADOW =
	"0 0 0 0.5px color-mix(in srgb, var(--t-text) 5%, transparent), 0 2px 8px color-mix(in srgb, var(--t-text) 7%, transparent), 0 16px 44px color-mix(in srgb, var(--t-text) 11%, transparent)";

// A — one elevated surface holding everything; page bg sits a touch deeper.
function VariantA() {
	return (
		<div style={{ background: "var(--t-bg)", padding: 22, height: "100%" }}>
			<div
				style={{
					background: "color-mix(in srgb, white 22%, var(--t-surface))",
					borderRadius: 18,
					padding: "22px 20px 18px",
					boxShadow: PANEL_SHADOW,
					display: "flex",
					flexDirection: "column",
					gap: 24,
				}}
			>
				<Masthead />
				<Intent />
				<Genres />
				<Filters />
			</div>
		</div>
	);
}

// B — flat content, but the page/drawer behind it is deepened for value contrast.
function VariantB() {
	return (
		<div
			style={{
				background:
					"color-mix(in srgb, var(--t-text) 14%, var(--t-surface-dim))",
				padding: 22,
				height: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 24,
			}}
		>
			<Masthead />
			<Intent />
			<Genres />
			<Filters />
		</div>
	);
}

function Zone({ children }: { children: ReactNode }) {
	return (
		<div
			style={{
				background: "color-mix(in srgb, white 16%, var(--t-surface))",
				borderRadius: 14,
				padding: 16,
				boxShadow:
					"0 0 0 0.5px color-mix(in srgb, var(--t-text) 4%, transparent), 0 1px 3px color-mix(in srgb, var(--t-text) 5%, transparent)",
			}}
		>
			{children}
		</div>
	);
}

// C — each section in its own consistent subtle surface zone.
function VariantC() {
	return (
		<div
			style={{
				background: "var(--t-bg)",
				padding: 22,
				height: "100%",
				display: "flex",
				flexDirection: "column",
				gap: 14,
			}}
		>
			<Masthead />
			<Zone>
				<Intent />
			</Zone>
			<Zone>
				<Genres />
			</Zone>
			<Zone>
				<Filters />
			</Zone>
		</div>
	);
}

const VARIANTS: Array<{ key: string; title: string; node: ReactNode }> = [
	{ key: "A", title: "A · Lift the whole panel", node: <VariantA /> },
	{ key: "B", title: "B · Deepen the background", node: <VariantB /> },
	{ key: "C", title: "C · Zone each section", node: <VariantC /> },
];

export default { title: "Match Filters / Surface Variations" };

function Compare({ theme }: { theme: ThemeColor }) {
	return (
		<ThemeHueProvider theme={themes[theme]}>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(3, minmax(380px, 1fr))",
					gap: 20,
					padding: 20,
					alignItems: "start",
					background: "var(--t-bg)",
					minHeight: "100vh",
					fontFamily: fonts.body,
				}}
			>
				{VARIANTS.map((v) => (
					<div key={v.key}>
						<div
							style={{
								fontSize: 12,
								fontWeight: 600,
								letterSpacing: "0.04em",
								color: "var(--t-text)",
								marginBottom: 10,
							}}
						>
							{v.title}
						</div>
						{/* No framing box — each variant fills its column with its OWN
						    surface treatment so B (flat on a deeper bg) reads honestly. */}
						<div style={{ minHeight: 940 }}>{v.node}</div>
					</div>
				))}
			</div>
		</ThemeHueProvider>
	);
}

type Args = { theme: ThemeColor };

export const Variations = ({ theme }: Args) => <Compare theme={theme} />;
Variations.args = { theme: "blue" as ThemeColor };
Variations.argTypes = {
	theme: {
		options: Object.keys(themes) as ThemeColor[],
		control: { type: "inline-radio" },
	},
};
