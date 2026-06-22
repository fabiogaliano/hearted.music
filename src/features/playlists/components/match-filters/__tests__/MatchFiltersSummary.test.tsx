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

	it("does not attach the hover list when two or fewer languages fit", () => {
		render(
			<MatchFiltersSummary
				filters={{ version: 1, languages: { codes: ["en", "pt"] } }}
				onEdit={vi.fn()}
			/>,
		);
		const value = screen.getByText("English, Portuguese");
		fireEvent.pointerEnter(value);
		expect(screen.queryByRole("tooltip")).toBeNull();
	});
});
