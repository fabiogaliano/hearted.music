import { FrameCornersIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
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
	const filterRef = useRef<HTMLDivElement>(null);
	useEffect(() => setSearchInput(search), [search]);
	useEffect(() => {
		if (searchInput === search) return;
		const timer = window.setTimeout(() => onSearchChange(searchInput), 250);
		return () => window.clearTimeout(timer);
	}, [onSearchChange, search, searchInput]);
	useEffect(() => {
		if (!filtersOpen) return;
		function onPointerDown(event: PointerEvent) {
			if (!filterRef.current?.contains(event.target as Node))
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
		<div className="card queue-bar span-12" aria-busy={refreshing}>
			{/* data-table-search kept: the palette's focus-search helper targets it. */}
			<label className="queue-search data-table-search">
				<span className="sr-only">Search queue</span>
				<input
					ref={searchRef}
					className="input"
					type="search"
					placeholder="Search… ( / )"
					value={searchInput}
					onChange={(event) => setSearchInput(event.target.value)}
				/>
			</label>
			{filters && (
				<div className="table-menu filter-popover" ref={filterRef}>
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
					onOrderChange(event.target.value === "newest" ? "newest" : "oldest")
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
					title="Focus — one card at a time"
					onClick={() => onModeChange("focus")}
				>
					<FrameCornersIcon size={15} weight="bold" />
				</button>
				<button
					type="button"
					className={`btn ${mode === "list" ? "primary" : ""}`}
					aria-label="List mode"
					aria-pressed={mode === "list"}
					title="List — queue rail with detail"
					onClick={() => onModeChange("list")}
				>
					<SidebarSimpleIcon size={15} weight="bold" />
				</button>
			</div>
			<span className="queue-sep" aria-hidden="true" />
			<label className="queue-pagesize">
				<span className="sr-only">Rows per page</span>
				<select
					className="select"
					value={pageSize}
					onChange={(event) =>
						onPageSizeChange(parsePageSize(event.target.value))
					}
				>
					<option value={25}>25</option>
					<option value={50}>50</option>
					<option value={100}>100</option>
				</select>
			</label>
			<span className="dim queue-pos">{position}</span>
			<div className="queue-nav">
				<button
					type="button"
					className="btn"
					disabled={!hasPrev}
					onClick={onPrev}
					aria-label={isFocus ? "Previous" : "Previous page"}
				>
					‹
				</button>
				<button
					type="button"
					className="btn"
					disabled={!hasNext}
					onClick={onNext}
					aria-label={isFocus ? "Next" : "Next page"}
				>
					›
				</button>
			</div>
			{refreshing && <span className="refreshing">Refreshing…</span>}
			<button type="button" className="btn queue-reset" onClick={onReset}>
				Reset
			</button>
		</div>
	);
}
