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
	it("shows active facets as rows and inactive facets as named Add pills", () => {
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
			/>,
		);

		// Active vocals → a removable row.
		expect(
			screen.getByRole("button", { name: "Remove Vocals filter" }),
		).toBeInTheDocument();
		// The other three facets are still addable.
		expect(
			screen.getByRole("button", { name: "Add Language filter" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Add Release era filter" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Add Liked date filter" }),
		).toBeInTheDocument();
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
	it("shows the loading notice but still allows removal", () => {
		const onFiltersChange = vi.fn();
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={onFiltersChange}
				options={OPTIONS}
				optionsState="loading"
			/>,
		);

		expect(screen.getByText(/loading filter options/i)).toBeInTheDocument();

		const remove = screen.getByRole("button", { name: "Remove Vocals filter" });
		expect(remove).not.toBeDisabled();
		fireEvent.click(remove);
		expect(onFiltersChange).toHaveBeenCalledTimes(1);
	});

	it("does not show the loading notice during a save (only optionsState drives it)", () => {
		render(
			<MatchFiltersFieldList
				filters={VOCALS_ACTIVE}
				onFiltersChange={vi.fn()}
				options={OPTIONS}
				optionsState="ready"
				isSaving
			/>,
		);

		expect(screen.queryByText(/loading filter options/i)).toBeNull();
	});
});
