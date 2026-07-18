// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableProps } from "../DataTable";

interface Row {
	id: string;
	name: string;
}

const rows: Row[] = [{ id: "row-1", name: "Adele" }];

function renderTable(overrides: Partial<DataTableProps<Row>> = {}) {
	return render(
		<DataTable<Row>
			columns={[
				{
					key: "name",
					header: "Name",
					sortable: true,
					render: (row) => row.name,
				},
			]}
			rows={rows}
			total={1}
			page={1}
			pageSize={50}
			search=""
			sort="name"
			direction="asc"
			getRowId={(row) => row.id}
			onSearchChange={vi.fn()}
			onSortChange={vi.fn()}
			onPageChange={vi.fn()}
			onPageSizeChange={vi.fn()}
			onReset={vi.fn()}
			{...overrides}
		/>,
	);
}

describe("DataTable", () => {
	it("renders accessible sortable headers and stable row content", () => {
		renderTable();

		expect(
			screen
				.getByRole("columnheader", { name: /name/i })
				.getAttribute("aria-sort"),
		).toBe("ascending");
		expect(screen.getByRole("cell", { name: "Adele" })).toBeTruthy();
	});

	it("supports page selection and persisted column controls", () => {
		const onToggleRow = vi.fn();
		renderTable({
			tableId: "fixture",
			selection: {
				selectedIds: new Set(),
				onToggleRow,
				onTogglePage: vi.fn(),
			},
		});

		fireEvent.click(screen.getByRole("checkbox", { name: "Select row-1" }));
		expect(onToggleRow).toHaveBeenCalledWith("row-1");
		expect(screen.getByText("Columns")).toBeTruthy();
	});

	it("distinguishes no-match results from an unfiltered empty table", () => {
		renderTable({ rows: [], total: 0, search: "missing" });
		expect(screen.getByText("No records match these filters.")).toBeTruthy();
	});
});
