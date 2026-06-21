/**
 * LikedDateTimeline — Direction A: Year-preset pills + date inputs.
 *
 * A row of year preset buttons (derived from likedAt.yearCounts) acts as the
 * primary shortcut. Below them, a mode segmented row (Before / After / Range /
 * Through today) expands into date field(s). This direction keeps the most common
 * case (picking a full calendar year) a single tap, while still supporting
 * precision date ranges via inputs.
 *
 * Normalization rules (decisions §5):
 *   - Year presets → kind:"range", fixed Jan 1 – Dec 31 UTC, end.kind:"date"
 *   - Explicit "through today" → kind:"range", end.kind:"today"
 *   - Before → kind:"before", endDate
 *   - After → kind:"after", startDate
 *   - Custom range → kind:"range", end.kind:"date"
 *
 * Props identical to Direction B.
 */

import { XIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { isValidDateOnly } from "@/lib/domains/taste/match-filters/dates";
import { likedAtLabel } from "@/lib/domains/taste/match-filters/labels";
import { normalizeMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import type {
	LikedAtFilterV1,
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import "../playlist-explorations.css";

export interface LikedDateTimelineProps {
	filters: PlaylistMatchFiltersV1;
	onFiltersChange: (next: PlaylistMatchFiltersV1) => void;
	options: PlaylistMatchFilterOptions;
	disabled?: boolean;
	/** True while a save is in flight — freezes chip removal (see §7 vs save). */
	isSaving?: boolean;
}

type DateMode = "before" | "after" | "range" | "today";

const MODE_LABELS: Record<DateMode, string> = {
	before: "Before",
	after: "After",
	range: "Range",
	today: "↑ Today",
};

/** Build year preset list from yearCounts, newest first. */
function buildYearPresets(
	yearCounts: Array<{ year: number; count: number }>,
	today: string,
): Array<{ year: number; count: number }> {
	const currentYear = Number(today.slice(0, 4));
	const byYear = new Map(yearCounts.map((y) => [y.year, y.count]));
	if (!byYear.has(currentYear)) byYear.set(currentYear, 0);
	return [...byYear.entries()]
		.sort(([a], [b]) => b - a)
		.slice(0, 6)
		.map(([year, count]) => ({ year, count }));
}

/** Fixed UTC year range for a preset — decisions §5. */
function yearPresetFilter(year: number): {
	kind: "range";
	startDate: string;
	end: { kind: "date"; date: string };
} {
	return {
		kind: "range",
		startDate: `${year}-01-01`,
		end: { kind: "date", date: `${year}-12-31` },
	};
}

function inferMode(filter: LikedAtFilterV1 | undefined): DateMode {
	if (!filter) return "range";
	if (filter.kind === "before") return "before";
	if (filter.kind === "after") return "after";
	if (filter.kind === "range" && filter.end.kind === "today") return "today";
	return "range";
}

export function LikedDateTimelineA({
	filters,
	onFiltersChange,
	options,
	disabled = false,
	isSaving = false,
}: LikedDateTimelineProps) {
	const baseId = useId();
	const { oldest, today, yearCounts } = options.likedAt;

	const active = filters.likedAt;

	// All hooks must run before any conditional return
	const [mode, setMode] = useState<DateMode>(inferMode(active));
	const [beforeDate, setBeforeDate] = useState(() =>
		active?.kind === "before" ? active.endDate : "",
	);
	const [afterDate, setAfterDate] = useState(() =>
		active?.kind === "after" ? active.startDate : "",
	);
	const [rangeStart, setRangeStart] = useState(() =>
		active?.kind === "range" ? active.startDate : "",
	);
	const [rangeEnd, setRangeEnd] = useState(() =>
		active?.kind === "range" && active.end.kind === "date"
			? active.end.date
			: "",
	);
	const [error, setError] = useState<string | undefined>();

	// If no oldest bound, hide the add/edit affordance (hooks already ran above)
	if (oldest === null) return null;

	const yearPresets = buildYearPresets(yearCounts, today);

	const applyFilter = (f: LikedAtFilterV1) => {
		setError(undefined);
		const next = normalizeMatchFilters({ ...filters, likedAt: f });
		onFiltersChange(next);
	};

	const clearFilter = () => {
		// Frozen during a pending save so the removal isn't lost on reconcile.
		if (isSaving) return;
		const { likedAt: _dropped, ...rest } = filters;
		setError(undefined);
		onFiltersChange(normalizeMatchFilters({ ...rest }));
	};

	const handleApply = () => {
		switch (mode) {
			case "before": {
				if (!isValidDateOnly(beforeDate)) {
					setError("Enter a date as YYYY-MM-DD");
					return;
				}
				applyFilter({ kind: "before", endDate: beforeDate });
				return;
			}
			case "after": {
				if (!isValidDateOnly(afterDate)) {
					setError("Enter a date as YYYY-MM-DD");
					return;
				}
				applyFilter({ kind: "after", startDate: afterDate });
				return;
			}
			case "range": {
				if (!isValidDateOnly(rangeStart) || !isValidDateOnly(rangeEnd)) {
					setError("Enter dates as YYYY-MM-DD");
					return;
				}
				if (rangeStart > rangeEnd) {
					setError("Start date must be on or before end date");
					return;
				}
				applyFilter({
					kind: "range",
					startDate: rangeStart,
					end: { kind: "date", date: rangeEnd },
				});
				return;
			}
			case "today": {
				if (!isValidDateOnly(rangeStart)) {
					setError("Enter a start date as YYYY-MM-DD");
					return;
				}
				applyFilter({
					kind: "range",
					startDate: rangeStart,
					end: { kind: "today" },
				});
				return;
			}
		}
	};

	const inputClass =
		"w-full border rounded-sm px-3 py-1.5 text-sm tabular-nums theme-border-color theme-bg theme-text placeholder:theme-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] disabled:opacity-50";

	return (
		<div style={{ fontFamily: fonts.body }}>
			<div className="text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-2">
				Liked date
			</div>

			{active && (
				<div className="flex items-center gap-1.5 mb-3">
					<span
						className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 theme-border-color xpl-chip-enter"
						style={{
							background:
								"color-mix(in srgb, var(--t-primary) 12%, transparent)",
						}}
					>
						<span
							className="text-sm leading-none"
							style={{ color: "var(--t-primary)" }}
						>
							{likedAtLabel(active)}
						</span>
						<button
							type="button"
							onClick={clearFilter}
							disabled={isSaving}
							aria-label="Remove liked date filter"
							className="grid size-[16px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 transition-[color] duration-150 hover:theme-text active:scale-[0.9] disabled:cursor-default disabled:opacity-50"
							style={{ color: "var(--t-primary)" }}
						>
							<XIcon size={9} weight="bold" aria-hidden />
						</button>
					</span>
				</div>
			)}

			{yearPresets.length > 0 && (
				<fieldset className="m-0 border-0 p-0 mb-3">
					<legend className="sr-only">Year presets</legend>
					<div className="flex flex-wrap gap-1">
						{yearPresets.map(({ year, count }) => {
							const presetFilter = yearPresetFilter(year);
							const presetEndDate = presetFilter.end.date;
							const isActive =
								active?.kind === "range" &&
								active.end.kind === "date" &&
								active.startDate === presetFilter.startDate &&
								active.end.date === presetEndDate;
							return (
								<button
									key={year}
									type="button"
									disabled={disabled}
									onClick={() => {
										setMode("range");
										applyFilter(presetFilter);
									}}
									aria-pressed={isActive}
									className="inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs tabular-nums theme-border-color transition-[background-color,color,border-color] duration-150 disabled:opacity-50 cursor-pointer"
									style={
										isActive
											? {
													background:
														"color-mix(in srgb, var(--t-primary) 14%, transparent)",
													borderColor: "var(--t-primary)",
													color: "var(--t-primary)",
												}
											: {}
									}
								>
									<span className={isActive ? "" : "theme-text-muted"}>
										{year}
									</span>
									{count > 0 && (
										<span className="text-[10px] tabular-nums theme-text-muted">
											{count}
										</span>
									)}
								</button>
							);
						})}
					</div>
				</fieldset>
			)}

			<fieldset className="m-0 border-0 p-0 mb-3">
				<legend className="sr-only">Liked date mode</legend>
				<div
					className="grid border theme-border-color"
					style={{
						gridTemplateColumns: `repeat(${Object.keys(MODE_LABELS).length}, 1fr)`,
					}}
				>
					{(Object.entries(MODE_LABELS) as Array<[DateMode, string]>).map(
						([m, label], i) => {
							const isActive = mode === m;
							const isFirst = i === 0;
							return (
								<button
									key={m}
									type="button"
									disabled={disabled}
									onClick={() => {
										setMode(m);
										setError(undefined);
									}}
									aria-pressed={isActive}
									className="py-1.5 text-xs tracking-[0.04em] cursor-pointer border-0 transition-[background-color,color] duration-150 disabled:opacity-50"
									style={{
										background: isActive
											? "color-mix(in srgb, var(--t-primary) 10%, var(--t-surface))"
											: "transparent",
										color: isActive ? "var(--t-primary)" : undefined,
										borderLeft: isFirst
											? undefined
											: "1px solid var(--t-border)",
									}}
								>
									{label}
								</button>
							);
						},
					)}
				</div>
			</fieldset>

			<div className="flex flex-col gap-2 mb-2">
				{mode === "before" && (
					<div>
						<label htmlFor={`${baseId}-before`} className="sr-only">
							Before date
						</label>
						<input
							id={`${baseId}-before`}
							type="text"
							placeholder="YYYY-MM-DD"
							value={beforeDate}
							onChange={(e) => {
								setBeforeDate(e.target.value);
								setError(undefined);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleApply();
							}}
							disabled={disabled}
							className={inputClass}
						/>
					</div>
				)}

				{mode === "after" && (
					<div>
						<label htmlFor={`${baseId}-after`} className="sr-only">
							After date
						</label>
						<input
							id={`${baseId}-after`}
							type="text"
							placeholder="YYYY-MM-DD"
							value={afterDate}
							onChange={(e) => {
								setAfterDate(e.target.value);
								setError(undefined);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleApply();
							}}
							disabled={disabled}
							className={inputClass}
						/>
					</div>
				)}

				{mode === "range" && (
					<div className="flex items-center gap-2">
						<div className="flex-1">
							<label htmlFor={`${baseId}-range-start`} className="sr-only">
								Start date
							</label>
							<input
								id={`${baseId}-range-start`}
								type="text"
								placeholder="YYYY-MM-DD"
								value={rangeStart}
								onChange={(e) => {
									setRangeStart(e.target.value);
									setError(undefined);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleApply();
								}}
								disabled={disabled}
								className={inputClass}
							/>
						</div>
						<span className="theme-text-muted text-sm shrink-0" aria-hidden>
							–
						</span>
						<div className="flex-1">
							<label htmlFor={`${baseId}-range-end`} className="sr-only">
								End date
							</label>
							<input
								id={`${baseId}-range-end`}
								type="text"
								placeholder="YYYY-MM-DD"
								value={rangeEnd}
								onChange={(e) => {
									setRangeEnd(e.target.value);
									setError(undefined);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleApply();
								}}
								disabled={disabled}
								className={inputClass}
							/>
						</div>
					</div>
				)}

				{mode === "today" && (
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2">
							<div className="flex-1">
								<label htmlFor={`${baseId}-today-start`} className="sr-only">
									Start date (through today)
								</label>
								<input
									id={`${baseId}-today-start`}
									type="text"
									placeholder="YYYY-MM-DD"
									value={rangeStart}
									onChange={(e) => {
										setRangeStart(e.target.value);
										setError(undefined);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") handleApply();
									}}
									disabled={disabled}
									className={inputClass}
								/>
							</div>
							<span className="theme-text-muted text-sm shrink-0" aria-hidden>
								–
							</span>
							{/* Dynamic "today" end — shown as read-only text, not an interactive input */}
							<div className="flex-1 border px-3 py-1.5 text-sm theme-border-color theme-text-muted">
								today
							</div>
						</div>
						<p className="text-[11px] theme-text-muted">
							Upper bound updates automatically at each match refresh.
						</p>
					</div>
				)}
			</div>

			{error && (
				<p
					className="text-xs mt-1 mb-2"
					role="alert"
					style={{ color: "var(--t-primary)" }}
				>
					{error}
				</p>
			)}

			<button
				type="button"
				onClick={handleApply}
				disabled={disabled}
				className="w-full border py-1.5 text-xs tracking-[0.06em] uppercase theme-border-color theme-text cursor-pointer transition-[background-color] duration-150 hover:bg-(--t-surface) active:scale-[0.98] disabled:opacity-50"
			>
				Apply
			</button>
		</div>
	);
}
