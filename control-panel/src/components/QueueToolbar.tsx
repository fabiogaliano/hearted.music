import type { ReactNode, Ref } from "react";
import { useEffect, useRef, useState } from "react";
import type { QueueMode, QueueOrder } from "../lib/queue-state";
import type { PageSize } from "../lib/types";
import { Badge } from "./primitives";

export interface QueueToolbarProps {
	searchRef?: Ref<HTMLInputElement>;
	search: string;
	onSearchChange: (value: string) => void;
	order: QueueOrder;
	onOrderChange: (order: QueueOrder) => void;
	mode: QueueMode;
	onModeChange: (mode: QueueMode) => void;
	pageSize: PageSize;
	onPageSizeChange: (pageSize: PageSize) => void;
	onReset: () => void;
	refreshing?: boolean;
	filters?: ReactNode;
	activeFilterCount?: number;
	total: number;
	page: number;
	// Present → focus mode: card-by-card position across the whole result set.
	focusIndex?: number;
	onPrev: () => void;
	onNext: () => void;
	hasPrev: boolean;
	hasNext: boolean;
}

function parsePageSize(value: string): PageSize {
	if (value === "25") return 25;
	if (value === "100") return 100;
	return 50;
}

export function QueueToolbar({
	searchRef,
	search,
	onSearchChange,
	order,
	onOrderChange,
	mode,
	onModeChange,
	pageSize,
	onPageSizeChange,
	onReset,
	refreshing = false,
	filters,
	activeFilterCount = 0,
	total,
	page,
	focusIndex,
	onPrev,
	onNext,
	hasPrev,
	hasNext,
}: QueueToolbarProps) {
	const [searchInput, setSearchInput] = useState(search);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const toolbarRef = useRef<HTMLDivElement>(null);
	useEffect(() => setSearchInput(search), [search]);
	useEffect(() => {
		if (searchInput === search) return;
		const timer = window.setTimeout(() => onSearchChange(searchInput), 250);
		return () => window.clearTimeout(timer);
	}, [onSearchChange, search, searchInput]);
	useEffect(() => {
		if (!filtersOpen) return;
		function onPointerDown(event: PointerEvent) {
			if (!toolbarRef.current?.contains(event.target as Node))
				setFiltersOpen(false);
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setFiltersOpen(false);
		}
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
		};
	}, [filtersOpen]);

	const isFocus = focusIndex !== undefined;
	const position =
		total === 0
			? "0 of 0"
			: isFocus
				? `${(page - 1) * pageSize + focusIndex + 1} of ${total}`
				: `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`;

	return (
		<div className="queue-toolbar" aria-busy={refreshing}>
			<div className="data-table-toolbar">
				<label className="data-table-search">
					<span className="sr-only">Search queue</span>
					<input
						ref={searchRef}
						className="input"
						type="search"
						placeholder="Search title or artist… ( / )"
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
								aria-expanded={filtersOpen}
								aria-haspopup="dialog"
								onClick={() => setFiltersOpen((open) => !open)}
							>
								Filters
								{activeFilterCount > 0 && (
									<Badge tone="accent">{activeFilterCount}</Badge>
								)}
							</button>
							{filtersOpen && <div className="filter-panel">{filters}</div>}
						</div>
					)}
					<select
						className="select"
						aria-label="Order"
						value={order}
						onChange={(event) =>
							onOrderChange(
								event.target.value === "newest" ? "newest" : "oldest",
							)
						}
					>
						<option value="oldest">Oldest first</option>
						<option value="newest">Newest first</option>
					</select>
					<div className="queue-mode">
						<button
							type="button"
							className={`btn ${mode === "focus" ? "primary" : ""}`}
							aria-label="Focus mode"
							aria-pressed={mode === "focus"}
							onClick={() => onModeChange("focus")}
						>
							Focus
						</button>
						<button
							type="button"
							className={`btn ${mode === "list" ? "primary" : ""}`}
							aria-label="List mode"
							aria-pressed={mode === "list"}
							onClick={() => onModeChange("list")}
						>
							List
						</button>
					</div>
					{refreshing && <span className="refreshing">Refreshing…</span>}
					<button type="button" className="btn" onClick={onReset}>
						Reset
					</button>
				</div>
			</div>

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
				<span className="dim">{position}</span>
				<div className="btn-row">
					<button
						type="button"
						className="btn"
						disabled={!hasPrev}
						onClick={onPrev}
					>
						{isFocus ? "Previous" : "Previous page"}
					</button>
					<button
						type="button"
						className="btn"
						disabled={!hasNext}
						onClick={onNext}
					>
						{isFocus ? "Next" : "Next page"}
					</button>
				</div>
			</div>
		</div>
	);
}
