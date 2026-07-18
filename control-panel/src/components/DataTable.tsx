import { DownloadSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "./primitives";

export interface DataTableColumn<T> {
	key: string;
	header: string;
	right?: boolean;
	sortable?: boolean;
	render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
	columns: readonly DataTableColumn<T>[];
	rows: readonly T[];
	total: number;
	page: number;
	pageSize: 25 | 50 | 100;
	search: string;
	sort: string;
	direction: "asc" | "desc";
	getRowId: (row: T) => string;
	onSearchChange: (value: string) => void;
	onSortChange: (column: string) => void;
	onPageChange: (page: number) => void;
	onPageSizeChange: (pageSize: 25 | 50 | 100) => void;
	onReset: () => void;
	filters?: ReactNode;
	activeFilterCount?: number;
	loading?: boolean;
	refreshing?: boolean;
	error?: string | null;
	onRetry?: () => void;
	empty?: string;
	noMatches?: string;
	exportUrl?: string;
	hasActiveFilters?: boolean;
	tableId?: string;
	selection?: {
		selectedIds: ReadonlySet<string>;
		onToggleRow: (id: string) => void;
		onTogglePage: (selected: boolean) => void;
		onSelectAllMatching?: () => void;
	};
}

export function DataTable<T>({
	columns,
	rows,
	total,
	page,
	pageSize,
	search,
	sort,
	direction,
	getRowId,
	onSearchChange,
	onSortChange,
	onPageChange,
	onPageSizeChange,
	onReset,
	filters,
	activeFilterCount = 0,
	loading = false,
	refreshing = false,
	error = null,
	onRetry,
	empty = "No records exist yet.",
	noMatches = "No records match these filters.",
	exportUrl,
	hasActiveFilters = false,
	tableId,
	selection,
}: DataTableProps<T>) {
	const [searchInput, setSearchInput] = useState(search);
	// One toolbar menu open at a time (Filters, Columns, or Export), so opening
	// one closes the others instead of stacking two overlapping panels.
	const [openMenu, setOpenMenu] = useState<
		"filters" | "columns" | "export" | null
	>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!openMenu) return;
		function onPointerDown(event: PointerEvent) {
			if (!toolbarRef.current?.contains(event.target as Node))
				setOpenMenu(null);
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setOpenMenu(null);
		}
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [openMenu]);
	const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(
		() => {
			if (!tableId || typeof window === "undefined") return new Set();
			try {
				const stored = JSON.parse(
					window.localStorage.getItem(
						`hearted-control-panel.table-preferences.v1.${tableId}`,
					) ?? "[]",
				);
				return Array.isArray(stored) &&
					stored.every((key): key is string => typeof key === "string")
					? new Set(stored)
					: new Set();
			} catch {
				return new Set();
			}
		},
	);
	const visibleColumns = columns.filter(
		(column) => !hiddenColumns.has(column.key),
	);
	const pageIds = rows.map(getRowId);
	const allPageSelected =
		pageIds.length > 0 && pageIds.every((id) => selection?.selectedIds.has(id));
	useEffect(() => setSearchInput(search), [search]);
	useEffect(() => {
		if (!tableId) return;
		try {
			window.localStorage.setItem(
				`hearted-control-panel.table-preferences.v1.${tableId}`,
				JSON.stringify([...hiddenColumns]),
			);
		} catch {
			return;
		}
	}, [hiddenColumns, tableId]);
	function toggleColumn(key: string) {
		if (hiddenColumns.has(key) && visibleColumns.length === 0) return;
		if (!hiddenColumns.has(key) && visibleColumns.length === 1) return;
		const next = new Set(hiddenColumns);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setHiddenColumns(next);
	}
	useEffect(() => {
		if (searchInput === search) return;
		const timer = window.setTimeout(() => onSearchChange(searchInput), 250);
		return () => window.clearTimeout(timer);
	}, [onSearchChange, search, searchInput]);

	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const hasFilters = search.length > 0 || hasActiveFilters;
	const showSkeleton = loading && rows.length === 0;
	const showEmpty = !loading && rows.length === 0;

	return (
		<div className="data-table" aria-busy={loading || refreshing}>
			<div className="data-table-toolbar">
				<label className="data-table-search">
					<span className="sr-only">Search records</span>
					<input
						className="input"
						type="search"
						placeholder="Search…"
						value={searchInput}
						onChange={(event) => setSearchInput(event.target.value)}
					/>
				</label>
				<div className="data-table-actions" ref={toolbarRef}>
					{filters && (
						<div className="table-menu filter-popover">
							<button
								type="button"
								className="btn"
								aria-expanded={openMenu === "filters"}
								aria-haspopup="dialog"
								onClick={() =>
									setOpenMenu((m) => (m === "filters" ? null : "filters"))
								}
							>
								Filters
								{activeFilterCount > 0 && (
									<Badge tone="accent">{activeFilterCount}</Badge>
								)}
							</button>
							{openMenu === "filters" && (
								<div className="filter-panel">{filters}</div>
							)}
						</div>
					)}
					{tableId && (
						<div className="table-menu">
							<button
								type="button"
								className="btn"
								aria-expanded={openMenu === "columns"}
								aria-haspopup="menu"
								onClick={() =>
									setOpenMenu((m) => (m === "columns" ? null : "columns"))
								}
							>
								Columns
							</button>
							{openMenu === "columns" && (
								<div className="data-table-column-menu">
									{columns.map((column) => (
										<label key={column.key}>
											<input
												type="checkbox"
												checked={!hiddenColumns.has(column.key)}
												onChange={() => toggleColumn(column.key)}
											/>
											{column.header}
										</label>
									))}
								</div>
							)}
						</div>
					)}
					{selection && selection.selectedIds.size > 0 && (
						<span className="dim">{selection.selectedIds.size} selected</span>
					)}
					{selection?.onSelectAllMatching && total > rows.length && (
						<button
							type="button"
							className="btn"
							onClick={selection.onSelectAllMatching}
						>
							Select all {total} matching
						</button>
					)}
					{refreshing && <span className="refreshing">Refreshing…</span>}
					{exportUrl && (
						<div className="table-menu export-menu">
							<button
								type="button"
								className="icon-btn"
								title="Export production data"
								aria-label="Export production data"
								aria-expanded={openMenu === "export"}
								aria-haspopup="menu"
								onClick={() =>
									setOpenMenu((m) => (m === "export" ? null : "export"))
								}
							>
								<DownloadSimpleIcon size={16} weight="bold" />
							</button>
							{openMenu === "export" && (
								<div className="table-menu-panel" role="menu">
									<span className="table-menu-label">Export production</span>
									<a
										className="table-menu-item"
										role="menuitem"
										href={`${exportUrl}.csv`}
										download
									>
										CSV
									</a>
									<a
										className="table-menu-item"
										role="menuitem"
										href={`${exportUrl}.json`}
										download
									>
										JSON
									</a>
								</div>
							)}
						</div>
					)}
					<button type="button" className="btn" onClick={onReset}>
						Reset
					</button>
				</div>
			</div>

			{error && (
				<div className="result err" role="alert">
					{error}
					{onRetry && (
						<button type="button" className="btn" onClick={onRetry}>
							Retry
						</button>
					)}
				</div>
			)}

			{showSkeleton ? (
				<div
					className="data-table-skeleton"
					role="status"
					aria-label="Loading records"
				>
					{[1, 2, 3, 4, 5].map((row) => (
						<div className="skeleton" key={row} />
					))}
				</div>
			) : showEmpty ? (
				<div className="empty">{hasFilters ? noMatches : empty}</div>
			) : (
				<table className="table">
					<thead>
						<tr>
							{selection && (
								<th key="selection">
									<input
										type="checkbox"
										aria-label="Select current page"
										checked={allPageSelected}
										onChange={(event) =>
											selection.onTogglePage(event.target.checked)
										}
									/>
								</th>
							)}
							{visibleColumns.map((column) => {
								const ariaSort =
									sort === column.key
										? direction === "asc"
											? "ascending"
											: "descending"
										: "none";
								return (
									<th
										key={column.key}
										className={column.right ? "right" : undefined}
										aria-sort={column.sortable ? ariaSort : undefined}
									>
										{column.sortable ? (
											<button
												type="button"
												className="data-table-sort"
												onClick={() => onSortChange(column.key)}
											>
												{column.header}
												{sort === column.key &&
													(direction === "asc" ? " ↑" : " ↓")}
											</button>
										) : (
											column.header
										)}
									</th>
								);
							})}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={getRowId(row)}>
								{selection && (
									<td key="selection">
										<input
											type="checkbox"
											aria-label={`Select ${getRowId(row)}`}
											checked={selection.selectedIds.has(getRowId(row))}
											onChange={() => selection.onToggleRow(getRowId(row))}
										/>
									</td>
								)}
								{visibleColumns.map((column) => (
									<td
										key={column.key}
										className={column.right ? "right" : undefined}
									>
										{column.render(row)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			)}

			<div className="data-table-footer">
				<label>
					<span className="sr-only">Rows per page</span>
					<select
						className="select"
						value={pageSize}
						onChange={(event) =>
							onPageSizeChange(parsePageSize(event.target.value))
						}
					>
						<option value={25}>25 per page</option>
						<option value={50}>50 per page</option>
						<option value={100}>100 per page</option>
					</select>
				</label>
				<span className="dim">
					{total === 0
						? "0 records"
						: `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
				</span>
				<div className="btn-row">
					<button
						type="button"
						className="btn"
						disabled={page <= 1}
						onClick={() => onPageChange(page - 1)}
					>
						Previous
					</button>
					<button
						type="button"
						className="btn"
						disabled={page >= pageCount}
						onClick={() => onPageChange(page + 1)}
					>
						Next
					</button>
				</div>
			</div>
		</div>
	);
}

function parsePageSize(value: string): 25 | 50 | 100 {
	if (value === "25") return 25;
	if (value === "100") return 100;
	return 50;
}
