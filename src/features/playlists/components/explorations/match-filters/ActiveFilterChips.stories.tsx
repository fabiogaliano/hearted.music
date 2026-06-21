import type { Story } from "@ladle/react";
import { useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { ActiveFilterChips } from "./ActiveFilterChips";

export default { title: "Match Filters/ActiveFilterChips" };

const PRESETS: Record<string, PlaylistMatchFiltersV1> = {
	"no filters": { version: 1 },
	"one language": { version: 1, languages: { codes: ["en"] } },
	"three languages": {
		version: 1,
		languages: { codes: ["en", "pt", "es"] },
	},
	"languages + year": {
		version: 1,
		languages: { codes: ["en", "pt"] },
		releaseYear: { kind: "range", start: 2000, end: 2010 },
	},
	"all filters": {
		version: 1,
		languages: { codes: ["en", "pt", "es", "fr", "de"] },
		releaseYear: { kind: "after", start: 1990 },
		likedAt: { kind: "before", endDate: "2023-12-31" },
		vocalGender: "female",
	},
	"vocals only": { version: 1, vocalGender: "male" },
	"year only": { version: 1, releaseYear: { kind: "exact", year: 2019 } },
};

function Harness({
	preset,
	removable,
}: {
	preset: string;
	removable: boolean;
}) {
	const initial = PRESETS[preset] ?? { version: 1 };
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(initial);

	const removeLanguage = (code: string) => {
		const remaining = filters.languages?.codes.filter((c) => c !== code) ?? [];
		const { languages: _d, ...rest } = filters;
		setFilters(
			remaining.length === 0
				? { ...rest }
				: { ...filters, languages: { codes: remaining } },
		);
	};

	const removeReleaseYear = () => {
		const { releaseYear: _d, ...rest } = filters;
		setFilters({ ...rest });
	};

	const removeLikedAt = () => {
		const { likedAt: _d, ...rest } = filters;
		setFilters({ ...rest });
	};

	const removeVocalGender = () => {
		const { vocalGender: _d, ...rest } = filters;
		setFilters({ ...rest });
	};

	return (
		<div className="theme-bg p-10" style={{ maxWidth: 480 }}>
			<ActiveFilterChips
				filters={filters}
				onRemoveLanguage={removable ? removeLanguage : undefined}
				onRemoveReleaseYear={removable ? removeReleaseYear : undefined}
				onRemoveLikedAt={removable ? removeLikedAt : undefined}
				onRemoveVocalGender={removable ? removeVocalGender : undefined}
			/>
			{filters.languages?.codes.length === 0 &&
				!filters.releaseYear &&
				!filters.likedAt &&
				!filters.vocalGender && (
					<p
						className="text-xs theme-text-muted"
						style={{ fontFamily: fonts.body }}
					>
						All chips removed — renders nothing.
					</p>
				)}
		</div>
	);
}

export const Default: Story<{ preset: string; removable: boolean }> = ({
	preset,
	removable,
}) => (
	<Harness
		key={`${preset}|${removable}`}
		preset={preset}
		removable={removable}
	/>
);
Default.args = { preset: "three languages", removable: true };
Default.argTypes = {
	preset: {
		options: Object.keys(PRESETS),
		control: { type: "select" },
	},
	removable: { control: { type: "boolean" } },
};
