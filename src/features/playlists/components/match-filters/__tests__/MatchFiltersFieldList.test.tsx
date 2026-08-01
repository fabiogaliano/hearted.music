import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { MatchFiltersFieldList } from "../MatchFiltersFieldList";

const OPTIONS: PlaylistMatchFilterOptions = {
	languages: [
		{ code: "en", label: "English", count: 3, source: "detected" },
		{ code: "pt", label: "Portuguese", count: 1, source: "detected" },
	],
	releaseYears: { min: 1990, max: 2020 },
	likedAt: { oldest: "2020-01-01", today: "2026-06-21", yearCounts: [] },
};

const VOCALS_ACTIVE: PlaylistMatchFiltersV1 = {
	version: 1,
	vocalGender: "female",
};

const LANGUAGE_ACTIVE: PlaylistMatchFiltersV1 = {
	version: 1,
	languages: { codes: ["en"] },
};

describe("MatchFiltersFieldList — structure", () => {
	it("shows all facets as rows, active ones with a remove control", () => {
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Remove Vocals filter" }),
		).toBeInTheDocument();
		// Inactive facets show "Any" in their row value; the vocals segment
		// also has an "Any" option button, so 3 row values + 1 segment = 4.
		expect(screen.getAllByText("Any")).toHaveLength(4);
	});

	it("edits a facet value through its segment (vocals)", () => {
		const onFiltersChange = vi.fn();
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={onFiltersChange}
				options={OPTIONS}
			/>,
		);

		const segment = screen.getByRole("group", { name: "Vocals" });
		fireEvent.click(within(segment).getByRole("button", { name: "Male" }));

		expect(onFiltersChange).toHaveBeenCalledWith(
			expect.objectContaining({ vocalGender: "male" }),
		);
	});

	it("Clear all resets to an empty filter set", () => {
		const onFiltersChange = vi.fn();
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={onFiltersChange}
				options={OPTIONS}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
		expect(onFiltersChange).toHaveBeenCalledWith({ version: 1 });
	});
});

describe("MatchFiltersFieldList — save freeze (§7)", () => {
	it("freezes per-row removal while a save is in flight", () => {
		const onFiltersChange = vi.fn();
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={onFiltersChange}
				options={OPTIONS}
				optionsState="ready"
				isSaving
			/>,
		);

		const remove = screen.getByRole("button", { name: "Remove Vocals filter" });
		expect(remove).toBeDisabled();
		fireEvent.click(remove);
		expect(onFiltersChange).not.toHaveBeenCalled();
	});

	it("disables the language command-palette trigger while saving", () => {
		render(
			<MatchFiltersFieldList
				filters={LANGUAGE_ACTIVE}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
				optionsState="ready"
				isSaving
			/>,
		);

		expect(screen.getByRole("button", { name: "Language" })).toBeDisabled();
	});
});

describe("MatchFiltersFieldList — options loading (§7)", () => {
	it("renders no loading notice (the facet rows are the skeleton) while keeping removal live", () => {
		const onFiltersChange = vi.fn();
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={onFiltersChange}
				options={OPTIONS}
				optionsState="loading"
			/>,
		);

		expect(screen.queryByRole("status")).toBeNull();

		const remove = screen.getByRole("button", { name: "Remove Vocals filter" });
		expect(remove).not.toBeDisabled();
		fireEvent.click(remove);
		expect(onFiltersChange).toHaveBeenCalledTimes(1);
	});

	it("shows the unavailable notice on options error", () => {
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
				optionsState="error"
			/>,
		);

		expect(screen.getByRole("status")).toHaveTextContent(/unavailable/i);
	});

	// Regression: a saved liked-date filter keeps the facet visible, so LikedEditor
	// mounts even while options are still loading (likedAt.today === ""). Its preset
	// spans call shiftDate(today, ...); shiftDate("") must not build an Invalid Date
	// whose toISOString() throws a RangeError and crashes the panel before options arrive.
	it("renders an active liked-date filter without crashing while options load", () => {
		const LOADING_OPTIONS: PlaylistMatchFilterOptions = {
			languages: [],
			releaseYears: { min: null, max: null },
			likedAt: { oldest: null, today: "", yearCounts: [] },
		};
		const LIKED_ACTIVE: PlaylistMatchFiltersV1 = {
			version: 1,
			likedAt: { kind: "after", startDate: "2021-06-01" },
		};

		expect(() =>
			render(
				<MatchFiltersFieldList
					filters={LIKED_ACTIVE}
					onFiltersChange={vi.fn()}
					options={LOADING_OPTIONS}
					optionsState="loading"
				/>,
			),
		).not.toThrow();

		expect(
			screen.getByRole("button", { name: "Remove Liked date filter" }),
		).toBeInTheDocument();
	});
});

describe("MatchFiltersFieldList — empty-language freeze (§7)", () => {
	// With no languages selected, LanguagePicker renders its command palette
	// unconditionally (no trigger button gates it) — regression coverage for a bug
	// where that always-on palette ignored disabled/isSaving entirely. Loading
	// and isSaving both flow through the single editFrozen guard, so one case
	// covers the wiring.
	it("freezes the language palette while options are loading", () => {
		const onFiltersChange = vi.fn();
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={onFiltersChange}
				options={OPTIONS}
				optionsState="loading"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /language/i }));

		expect(
			screen.getByRole("combobox", { name: "Search languages" }),
		).toBeDisabled();
		fireEvent.click(screen.getByRole("option", { name: /^English/ }));
		expect(onFiltersChange).not.toHaveBeenCalled();
	});
});
