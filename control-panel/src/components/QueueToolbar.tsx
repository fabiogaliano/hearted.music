import type { ReactNode, Ref } from "react";
import { useEffect, useState } from "react";
import type { QueueMode, QueueOrder } from "../lib/queue-state";
import type { PageSize } from "../lib/types";

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
	total,
	page,
	focusIndex,
	onPrev,
	onNext,
	hasPrev,
	hasNext,
}: QueueToolbarProps) {
	const [searchInput, setSearchInput] = useState(search);
	useEffect(() => setSearchInput(search), [search]);
	useEffect(() => {
		if (searchInput === search) return;
		const timer = window.setTimeout(() => onSearchChange(searchInput), 250);
		return () => window.clearTimeout(timer);
	}, [onSearchChange, search, searchInput]);

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
				{filters && <div className="data-table-filters">{filters}</div>}
				<div className="data-table-actions">
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
