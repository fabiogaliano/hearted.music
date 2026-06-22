import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { MatchFiltersSummary } from "../MatchFiltersSummary";

describe("MatchFiltersSummary", () => {
	it("renders nothing when no filters are active", () => {
		const { container } = render(
			<MatchFiltersSummary filters={{ version: 1 }} onEdit={vi.fn()} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("enters edit mode when the summary is clicked", () => {
		const onEdit = vi.fn();
		render(
			<MatchFiltersSummary
				filters={{ version: 1, vocalGender: "female" }}
				onEdit={onEdit}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit filters" }));
		expect(onEdit).toHaveBeenCalledTimes(1);
	});

	it("reveals every language on hover when the value is truncated", () => {
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["en", "pt", "fr", "de"] },
		};
		render(<MatchFiltersSummary filters={filters} onEdit={vi.fn()} />);

		// No tooltip until hover; the hidden languages aren't shown in the chip.
		expect(screen.queryByRole("tooltip")).toBeNull();

		// The truncated value names the first two; hover surfaces the full list.
		const truncated = screen.getByText(/English, Portuguese \+2/);
		fireEvent.pointerEnter(truncated);

		const tip = screen.getByRole("tooltip");
		expect(tip).toHaveTextContent("English, Portuguese, French, German");

		fireEvent.pointerLeave(truncated);
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("names the facet on hover, even when the value isn't truncated", () => {
		render(
			<MatchFiltersSummary
				filters={{
					version: 1,
					vocalGender: "female",
					languages: { codes: ["en", "pt"] },
				}}
				onEdit={vi.fn()}
			/>,
		);

		// Nothing revealed until hover.
		expect(screen.queryByRole("tooltip")).toBeNull();

		// The vocals chip is just a mic glyph + "Female" — the value is already
		// clear, so the tip names the facet only (no redundant value).
		const vocals = screen.getByText("Female");
		fireEvent.pointerEnter(vocals);
		expect(screen.getByRole("tooltip").textContent).toBe("Vocals");
		fireEvent.pointerLeave(vocals);
		expect(screen.queryByRole("tooltip")).toBeNull();

		// A language chip that fits still gains the name prefix.
		const langs = screen.getByText("English, Portuguese");
		fireEvent.pointerEnter(langs);
		expect(screen.getByRole("tooltip")).toHaveTextContent(
			"Language: English, Portuguese",
		);
	});
});
