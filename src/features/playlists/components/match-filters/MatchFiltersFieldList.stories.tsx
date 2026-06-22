import type { Story } from "@ladle/react";
import { useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";
import {
	MatchFiltersFieldList,
	type OptionsState,
} from "./MatchFiltersFieldList";
import { MOCK_FILTER_OPTIONS } from "./mock-filter-options";

// The hue-washed band the writing surface (and these filters) actually render on
// in SpotlightPanel — see SpotlightPanel BAND_BG. Stories must reproduce it, or
// border/surface tokens look fine here and wash out in production.
const BAND_BG =
	"color-mix(in srgb, var(--t-primary) 12%, var(--t-surface-dim))";

/**
 * The production match-filters surface (Structure A "field list"). Active filters
 * show as rows; inactive facets are named dashed "Add" pills below — tap one to
 * reveal that facet inline, close it without a value and it folds back. Release
 * era picks a consecutive decade span; Liked date is a From/To range with a
 * rolling "Through today"; Language opens the command-palette search. One shared
 * row grammar, draft state owned by the harness.
 */

const PRESETS: Record<string, PlaylistMatchFiltersV1> = {
	empty: { version: 1 },
	"one active (vocals)": { version: 1, vocalGender: "female" },
	"a few active": {
		version: 1,
		languages: { codes: ["ko", "pt"] },
		releaseYear: { kind: "range", start: 1990, end: 2000 },
		vocalGender: "female",
	},
	"all active": {
		version: 1,
		languages: { codes: ["en", "pt", "ja", "ko"] },
		releaseYear: { kind: "after", start: 2010 },
		likedAt: { kind: "range", startDate: "2022-01-01", end: { kind: "today" } },
		vocalGender: "male",
	},
};

type Args = {
	preset: string;
	width: number;
	optionsState: OptionsState;
	theme: ThemeColor;
};

export default { title: "Match Filters" };

function Harness({ preset, width, optionsState, theme }: Args) {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(
		PRESETS[preset] ?? { version: 1 },
	);
	return (
		<ThemeHueProvider theme={themes[theme]}>
			<div
				className="theme-bg"
				style={{
					minHeight: "100vh",
					padding: "2rem 1.25rem",
					fontFamily: fonts.body,
				}}
			>
				<div style={{ maxWidth: width, margin: "0 auto" }}>
					<div
						style={{
							fontSize: 11,
							fontWeight: 600,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: "var(--t-text-muted)",
							marginBottom: 8,
						}}
					>
						Filters
					</div>
					{/* Reproduce the SpotlightPanel band the surface sits on. */}
					<div style={{ background: BAND_BG, borderRadius: 14, padding: 18 }}>
						<MatchFiltersFieldList
							filters={filters}
							onFiltersChange={setFilters}
							options={MOCK_FILTER_OPTIONS}
							optionsState={optionsState}
						/>
					</div>
				</div>
			</div>
		</ThemeHueProvider>
	);
}

export const FieldList: Story<Args> = ({
	preset,
	width,
	optionsState,
	theme,
}) => (
	<Harness
		key={`${preset}-${width}-${optionsState}-${theme}`}
		preset={preset}
		width={width}
		optionsState={optionsState}
		theme={theme}
	/>
);
FieldList.storyName = "Filters";
FieldList.args = {
	preset: "a few active",
	width: 520,
	optionsState: "ready",
	theme: "blue",
};
FieldList.argTypes = {
	preset: { options: Object.keys(PRESETS), control: { type: "select" } },
	width: { options: [380, 520, 600, 760], control: { type: "inline-radio" } },
	optionsState: {
		options: ["ready", "loading", "error"],
		control: { type: "inline-radio" },
	},
	theme: {
		options: Object.keys(themes) as ThemeColor[],
		control: { type: "inline-radio" },
	},
};
