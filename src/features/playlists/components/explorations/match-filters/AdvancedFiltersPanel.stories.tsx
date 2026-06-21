import type { Story } from "@ladle/react";
import { useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { AdvancedFiltersPanel } from "./AdvancedFiltersPanel";

export default { title: "Match Filters/AdvancedFiltersPanel" };

const PRESETS: Record<string, PlaylistMatchFiltersV1> = {
	"no filters": { version: 1 },
	"one language": { version: 1, languages: { codes: ["en"] } },
	"three languages": {
		version: 1,
		languages: { codes: ["en", "pt", "es"] },
	},
	"many languages (narrow stress)": {
		version: 1,
		languages: { codes: ["en", "pt", "es", "fr", "de", "ja"] },
	},
	"all filters": {
		version: 1,
		languages: { codes: ["en", "pt"] },
		releaseYear: { kind: "range", start: 2000, end: 2010 },
		likedAt: { kind: "after", startDate: "2022-01-01" },
		vocalGender: "female",
	},
	"vocals only (detector-filled)": { version: 1, vocalGender: "male" },
	"year only": { version: 1, releaseYear: { kind: "before", end: 2015 } },
};

function Harness({ preset }: { preset: string }) {
	const initial = PRESETS[preset] ?? { version: 1 };
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(initial);

	return (
		<div className="theme-bg p-10" style={{ maxWidth: 440 }}>
			{/* Simulates the WritingSurface context — intent and genres above, panel below */}
			<div
				className="mb-4 text-sm theme-text-muted"
				style={{ fontFamily: fonts.body }}
			>
				↑ Matching intent + Genres area (above)
			</div>

			<AdvancedFiltersPanel filters={filters} onFiltersChange={setFilters} />

			<div
				className="mt-4 text-sm theme-text-muted"
				style={{ fontFamily: fonts.body }}
			>
				↓ Save / Cancel row (below)
			</div>
		</div>
	);
}

export const Default: Story<{ preset: string }> = ({ preset }) => (
	<Harness key={preset} preset={preset} />
);
Default.args = { preset: "no filters" };
Default.argTypes = {
	preset: {
		options: Object.keys(PRESETS),
		control: { type: "select" },
	},
};
