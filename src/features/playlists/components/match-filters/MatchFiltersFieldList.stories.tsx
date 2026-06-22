import type { Story } from "@ladle/react";
import { useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import {
	MatchFiltersFieldList,
	type OptionsState,
} from "./MatchFiltersFieldList";
import { MOCK_FILTER_OPTIONS } from "./mock-filter-options";

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

type Args = { preset: string; width: number; optionsState: OptionsState };

export default { title: "Match Filters" };

function Harness({ preset, width, optionsState }: Args) {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(
		PRESETS[preset] ?? { version: 1 },
	);
	return (
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
						marginBottom: 4,
					}}
				>
					Filters
				</div>
				<MatchFiltersFieldList
					filters={filters}
					onFiltersChange={setFilters}
					options={MOCK_FILTER_OPTIONS}
					optionsState={optionsState}
				/>
			</div>
		</div>
	);
}

export const FieldList: Story<Args> = ({ preset, width, optionsState }) => (
	<Harness
		key={`${preset}-${width}-${optionsState}`}
		preset={preset}
		width={width}
		optionsState={optionsState}
	/>
);
FieldList.storyName = "Filters";
FieldList.args = { preset: "a few active", width: 600, optionsState: "ready" };
FieldList.argTypes = {
	preset: { options: Object.keys(PRESETS), control: { type: "select" } },
	width: { options: [380, 520, 600, 760], control: { type: "inline-radio" } },
	optionsState: {
		options: ["ready", "loading", "error"],
		control: { type: "inline-radio" },
	},
};
