import type { Story } from "@ladle/react";
import { useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { LanguagePickerCombobox } from "./LanguagePickerCombobox";
import { LanguagePickerCommandPalette } from "./LanguagePickerCommandPalette";
import { LanguagePickerInline } from "./LanguagePickerInline";
import { MOCK_FILTER_OPTIONS } from "./mock-filter-options";

const PRESETS: Record<string, PlaylistMatchFiltersV1> = {
	empty: { version: 1 },
	"one selected (en)": { version: 1, languages: { codes: ["en"] } },
	"few selected": { version: 1, languages: { codes: ["en", "pt", "fr"] } },
	"many selected (narrow-width stress)": {
		version: 1,
		languages: { codes: ["en", "pt", "es", "fr", "de", "ja", "ko", "it"] },
	},
	"catalog-only selected (no count)": {
		version: 1,
		languages: { codes: ["zh", "ru", "pl"] },
	},
};

type PickerArgs = { preset: string; disabled: boolean };

const PRESET_ARG_TYPE = {
	options: Object.keys(PRESETS),
	control: { type: "select" as const },
};

const STORY_WRAPPER_STYLE = {
	maxWidth: 460,
	padding: "2rem",
	fontFamily: fonts.body,
};

export default { title: "Match Filters/LanguagePicker" };

function ComboboxHarness({ preset, disabled }: PickerArgs) {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(
		PRESETS[preset] ?? { version: 1 },
	);
	return (
		<div className="theme-bg" style={STORY_WRAPPER_STYLE}>
			<LanguagePickerCombobox
				filters={filters}
				onFiltersChange={setFilters}
				options={MOCK_FILTER_OPTIONS}
				disabled={disabled}
			/>
			<pre
				className="mt-4 text-xs theme-text-muted"
				style={{ fontFamily: "monospace" }}
			>
				{JSON.stringify(filters.languages, null, 2)}
			</pre>
		</div>
	);
}

export const Combobox: Story<PickerArgs> = ({ preset, disabled }) => (
	<ComboboxHarness key={preset} preset={preset} disabled={disabled} />
);
Combobox.args = { preset: "empty", disabled: false };
Combobox.argTypes = {
	preset: PRESET_ARG_TYPE,
	disabled: { control: { type: "boolean" } },
};
Combobox.meta = {
	description:
		"Direction A — always-visible list with inline search input above. Selected appear as chips. Keyboard: arrows navigate list, Enter selects, Backspace removes last chip.",
};

function CommandPaletteHarness({ preset, disabled }: PickerArgs) {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(
		PRESETS[preset] ?? { version: 1 },
	);
	return (
		<div className="theme-bg" style={STORY_WRAPPER_STYLE}>
			<LanguagePickerCommandPalette
				filters={filters}
				onFiltersChange={setFilters}
				options={MOCK_FILTER_OPTIONS}
				disabled={disabled}
			/>
			<pre
				className="mt-4 text-xs theme-text-muted"
				style={{ fontFamily: "monospace" }}
			>
				{JSON.stringify(filters.languages, null, 2)}
			</pre>
		</div>
	);
}

export const CommandPalette: Story<PickerArgs> = ({ preset, disabled }) => (
	<CommandPaletteHarness key={preset} preset={preset} disabled={disabled} />
);
CommandPalette.args = { preset: "empty", disabled: false };
CommandPalette.argTypes = {
	preset: PRESET_ARG_TYPE,
	disabled: { control: { type: "boolean" } },
};
CommandPalette.meta = {
	description:
		"Direction B — compact trigger row opens a floating command-palette overlay with search + scrollable list. Minimal footprint until opened.",
};

function InlineHarness({ preset, disabled }: PickerArgs) {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(
		PRESETS[preset] ?? { version: 1 },
	);
	return (
		<div className="theme-bg" style={{ ...STORY_WRAPPER_STYLE, maxWidth: 560 }}>
			<LanguagePickerInline
				filters={filters}
				onFiltersChange={setFilters}
				options={MOCK_FILTER_OPTIONS}
				disabled={disabled}
			/>
			<pre
				className="mt-4 text-xs theme-text-muted"
				style={{ fontFamily: "monospace" }}
			>
				{JSON.stringify(filters.languages, null, 2)}
			</pre>
		</div>
	);
}

export const Inline: Story<PickerArgs> = ({ preset, disabled }) => (
	<InlineHarness key={preset} preset={preset} disabled={disabled} />
);
Inline.args = { preset: "empty", disabled: false };
Inline.argTypes = {
	preset: PRESET_ARG_TYPE,
	disabled: { control: { type: "boolean" } },
};
Inline.meta = {
	description:
		"Direction C — two-pane layout: detected library languages (with counts) on the left, full catalog search on the right. Uses horizontal space; no popover.",
};
