import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { AdvancedFiltersAssembly } from "../AdvancedFiltersAssembly";

const OPTIONS: PlaylistMatchFilterOptions = {
	languages: [
		{ code: "en", label: "English", count: 3, source: "detected" },
		{ code: "pt", label: "Portuguese", count: 1, source: "detected" },
	],
	releaseYears: { min: 1990, max: 2020 },
	likedAt: { oldest: "2020-01-01", today: "2026-06-21", yearCounts: [] },
};

// An active filter makes the panel auto-open so the controls render immediately.
const ACTIVE_FILTERS: PlaylistMatchFiltersV1 = {
	version: 1,
	languages: { codes: ["en"] },
};

function getLanguageSearch(): HTMLInputElement {
	return screen.getByRole("combobox", { name: /language/i });
}

describe("AdvancedFiltersAssembly — save-pending disables add/edit controls", () => {
	it("disables the language search while a save is in flight", () => {
		render(
			<AdvancedFiltersAssembly
				filters={ACTIVE_FILTERS}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
				optionsState="ready"
				isSaving
			/>,
		);

		expect(getLanguageSearch()).toBeDisabled();
	});

	it("keeps the language search enabled when ready and not saving", () => {
		render(
			<AdvancedFiltersAssembly
				filters={ACTIVE_FILTERS}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
				optionsState="ready"
			/>,
		);

		expect(getLanguageSearch()).not.toBeDisabled();
	});

	it("does not show the loading-options notice during a save (only optionsState drives it)", () => {
		render(
			<AdvancedFiltersAssembly
				filters={ACTIVE_FILTERS}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
				optionsState="ready"
				isSaving
			/>,
		);

		expect(screen.queryByText(/loading filter options/i)).toBeNull();
		// Controls are still frozen even though no notice is shown.
		expect(getLanguageSearch()).toBeDisabled();
	});
});

describe("AdvancedFiltersAssembly — chip removal is frozen during save", () => {
	// The same filter shows as two chips: the panel's ActiveFilterChips row
	// ("Remove English language filter") and the language control's own selected
	// chip ("Remove English language"). Both removal paths must freeze on save.
	const PANEL_CHIP = "Remove English language filter";
	const CONTROL_CHIP = "Remove English language";

	it("renders the active-filter chip row display-only while saving (no remove X)", () => {
		render(
			<AdvancedFiltersAssembly
				filters={ACTIVE_FILTERS}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
				optionsState="ready"
				isSaving
			/>,
		);

		expect(screen.queryByRole("button", { name: PANEL_CHIP })).toBeNull();
	});

	it("keeps the active-filter chip row removable when ready and not saving", () => {
		render(
			<AdvancedFiltersAssembly
				filters={ACTIVE_FILTERS}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
				optionsState="ready"
			/>,
		);

		expect(
			screen.getByRole("button", { name: PANEL_CHIP }),
		).toBeInTheDocument();
	});

	it("disables the in-control chip remove and ignores clicks while saving", () => {
		const onFiltersChange = vi.fn();
		render(
			<AdvancedFiltersAssembly
				filters={ACTIVE_FILTERS}
				onFiltersChange={onFiltersChange}
				options={OPTIONS}
				optionsState="ready"
				isSaving
			/>,
		);

		const chipRemove = screen.getByRole("button", { name: CONTROL_CHIP });
		expect(chipRemove).toBeDisabled();
		fireEvent.click(chipRemove);
		expect(onFiltersChange).not.toHaveBeenCalled();
	});

	it("still allows chip removal while options are loading (§7 — only a save freezes chips)", () => {
		const onFiltersChange = vi.fn();
		render(
			<AdvancedFiltersAssembly
				filters={ACTIVE_FILTERS}
				onFiltersChange={onFiltersChange}
				options={OPTIONS}
				optionsState="loading"
			/>,
		);

		const chipRemove = screen.getByRole("button", { name: CONTROL_CHIP });
		expect(chipRemove).not.toBeDisabled();
		fireEvent.click(chipRemove);
		expect(onFiltersChange).toHaveBeenCalledTimes(1);
	});
});
