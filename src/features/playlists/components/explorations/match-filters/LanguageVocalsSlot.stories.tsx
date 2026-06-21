/**
 * Shows the CMHF-04 controls composed into AdvancedFiltersPanel via the
 * languageVocalsControlsSlot — proves the slot contract works without modifying
 * the panel itself.
 */

import type { Story } from "@ladle/react";
import { useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { AdvancedFiltersPanel } from "./AdvancedFiltersPanel";
import { LanguagePickerCombobox } from "./LanguagePickerCombobox";
import { LanguagePickerCommandPalette } from "./LanguagePickerCommandPalette";
import { LanguagePickerInline } from "./LanguagePickerInline";
import { MOCK_FILTER_OPTIONS } from "./mock-filter-options";
import { VocalsControl } from "./VocalsControl";

export default { title: "Match Filters/LanguageVocalsSlot" };

const PRESETS: Record<string, PlaylistMatchFiltersV1> = {
	"no filters": { version: 1 },
	"language + vocals": {
		version: 1,
		languages: { codes: ["pt", "es"] },
		vocalGender: "female",
	},
	"loading/error (disabled)": {
		version: 1,
		languages: { codes: ["en"] },
		vocalGender: "male",
	},
	"many languages": {
		version: 1,
		languages: { codes: ["en", "pt", "es", "fr", "de", "ja"] },
	},
};

type SlotArgs = {
	preset: string;
	picker: "Combobox" | "CommandPalette" | "Inline";
	disabled: boolean;
};

function Harness({ preset, picker, disabled }: SlotArgs) {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(
		PRESETS[preset] ?? { version: 1 },
	);

	const pickerNode =
		picker === "Combobox" ? (
			<LanguagePickerCombobox
				filters={filters}
				onFiltersChange={setFilters}
				options={MOCK_FILTER_OPTIONS}
				disabled={disabled}
			/>
		) : picker === "CommandPalette" ? (
			<LanguagePickerCommandPalette
				filters={filters}
				onFiltersChange={setFilters}
				options={MOCK_FILTER_OPTIONS}
				disabled={disabled}
			/>
		) : (
			<LanguagePickerInline
				filters={filters}
				onFiltersChange={setFilters}
				options={MOCK_FILTER_OPTIONS}
				disabled={disabled}
			/>
		);

	const slotNode = (
		<div className="flex flex-col gap-4">
			{pickerNode}
			<VocalsControl
				filters={filters}
				onFiltersChange={setFilters}
				disabled={disabled}
			/>
		</div>
	);

	return (
		<div
			className="theme-bg p-10"
			style={{
				maxWidth: picker === "Inline" ? 580 : 460,
				fontFamily: fonts.body,
			}}
		>
			<div className="mb-4 text-sm theme-text-muted">
				↑ Matching intent + Genres area (above)
			</div>

			<AdvancedFiltersPanel
				filters={filters}
				onFiltersChange={setFilters}
				languageVocalsControlsSlot={slotNode}
			/>

			<div className="mt-4 text-sm theme-text-muted">
				↓ Save / Cancel row (below)
			</div>
		</div>
	);
}

export const Default: Story<SlotArgs> = ({ preset, picker, disabled }) => (
	<Harness
		key={`${preset}-${picker}`}
		preset={preset}
		picker={picker}
		disabled={disabled}
	/>
);
Default.args = { preset: "no filters", picker: "Combobox", disabled: false };
Default.argTypes = {
	preset: {
		options: Object.keys(PRESETS),
		control: { type: "select" },
	},
	picker: {
		options: ["Combobox", "CommandPalette", "Inline"],
		control: { type: "radio" },
	},
	disabled: { control: { type: "boolean" } },
};
Default.meta = {
	description:
		"All three picker directions + VocalsControl composed into AdvancedFiltersPanel via languageVocalsControlsSlot. Switch pickers without editing panel code.",
};
