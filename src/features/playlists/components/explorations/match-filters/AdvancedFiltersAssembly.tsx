/**
 * AdvancedFiltersAssembly — the converged composition for CMHF-06.
 *
 * Chosen directions (rationale for CMHF-13):
 *   Language:     LanguagePickerCombobox — always-visible list allows scanning
 *                 before typing and fits the drawer's fixed width without needing
 *                 a popover open/close cycle.
 *   Release year: ReleaseYearControlA   — explicit mode tabs + Apply works in
 *                 narrow widths; slider (B) needs too much horizontal room in the
 *                 520–760px drawer range.
 *   Liked date:   LikedDateTimelineA    — year presets are the dominant case; the
 *                 horizontal draggable bar (B) is awkward in the panel's constrained
 *                 width.
 *
 * This component is a thin assembler: it wires one PlaylistMatchFiltersV1 draft
 * and one set of PlaylistMatchFilterOptions into AdvancedFiltersPanel's two slots,
 * then passes everything down. No state is owned here — the caller owns the draft.
 *
 * When options are loading or failed, pass optionsState="loading"|"error" and the
 * controls render disabled while chips remain removable (decisions §7).
 */

import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { AdvancedFiltersPanel } from "./AdvancedFiltersPanel";
import { LanguagePickerCombobox } from "./LanguagePickerCombobox";
import { LikedDateTimelineA } from "./LikedDateTimelineA";
import { ReleaseYearControlA } from "./ReleaseYearControlA";
import { VocalsControl } from "./VocalsControl";

export type OptionsState = "ready" | "loading" | "error";

export interface AdvancedFiltersAssemblyProps {
	filters: PlaylistMatchFiltersV1;
	onFiltersChange: (next: PlaylistMatchFiltersV1) => void;
	options: PlaylistMatchFilterOptions;
	/** "loading" and "error" disable add/edit controls while keeping chip removal enabled. */
	optionsState?: OptionsState;
}

/**
 * Small inline notice for loading/error options state — minimal copy per decisions §7.
 * Chips remain removable; this surfaces next to the trigger, not inside the controls.
 */
function OptionsStateNotice({ state }: { state: "loading" | "error" }) {
	return (
		<p
			className="text-[11px] theme-text-muted"
			style={{ fontFamily: fonts.body }}
		>
			{state === "loading"
				? "Loading filter options…"
				: "Filter options unavailable."}
		</p>
	);
}

export function AdvancedFiltersAssembly({
	filters,
	onFiltersChange,
	options,
	optionsState = "ready",
}: AdvancedFiltersAssemblyProps) {
	const disabled = optionsState !== "ready";

	const languageVocalsSlot = (
		<div className="flex flex-col gap-4">
			{optionsState !== "ready" && <OptionsStateNotice state={optionsState} />}
			<LanguagePickerCombobox
				filters={filters}
				onFiltersChange={onFiltersChange}
				options={options}
				disabled={disabled}
			/>
			<VocalsControl
				filters={filters}
				onFiltersChange={onFiltersChange}
				disabled={disabled}
			/>
		</div>
	);

	const yearDateSlot = (
		<div className="flex flex-col gap-4">
			<ReleaseYearControlA
				filters={filters}
				onFiltersChange={onFiltersChange}
				options={options}
				disabled={disabled}
			/>
			<LikedDateTimelineA
				filters={filters}
				onFiltersChange={onFiltersChange}
				options={options}
				disabled={disabled}
			/>
		</div>
	);

	return (
		<AdvancedFiltersPanel
			filters={filters}
			onFiltersChange={onFiltersChange}
			languageVocalsControlsSlot={languageVocalsSlot}
			yearDateControlsSlot={yearDateSlot}
		/>
	);
}
