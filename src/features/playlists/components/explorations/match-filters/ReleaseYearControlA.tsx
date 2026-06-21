/**
 * ReleaseYearControl — Direction A: Segmented mode tabs + numeric inputs.
 *
 * The user picks a mode (Exact / Before / After / Range) via a segmented button
 * row, then fills in year field(s). Decade presets appear below the mode row as
 * quick-pick buttons. This direction front-loads mode selection before any typing,
 * making the intent explicit — good for users who know what constraint they want.
 *
 * Props are identical to Direction B so stories can swap them directly.
 */

import { XIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { releaseYearLabel } from "@/lib/domains/taste/match-filters/labels";
import { normalizeMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
	ReleaseYearFilterV1,
} from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import "../playlist-explorations.css";

export interface ReleaseYearControlProps {
	filters: PlaylistMatchFiltersV1;
	onFiltersChange: (next: PlaylistMatchFiltersV1) => void;
	options: PlaylistMatchFilterOptions;
	disabled?: boolean;
}

type Mode = "exact" | "before" | "after" | "range";

const MODE_LABELS: Record<Mode, string> = {
	exact: "Exact",
	before: "Through",
	after: "From",
	range: "Range",
};

const YEAR_MIN = 1000;
const YEAR_MAX = 9999;

/** Decade presets derived from the library span in options. */
function buildDecadePresets(
	min: number,
	max: number,
): Array<{ label: string; start: number; end: number }> {
	const decades: Array<{ label: string; start: number; end: number }> = [];
	const startDecade = Math.floor(min / 10) * 10;
	const endDecade = Math.floor(max / 10) * 10;
	for (let d = startDecade; d <= endDecade; d += 10) {
		decades.push({ label: `${d}s`, start: d, end: Math.min(d + 9, max) });
	}
	return decades.slice(-6);
}

function isValidYear(s: string): boolean {
	const n = Number(s);
	return (
		/^\d{4}$/.test(s) && Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX
	);
}

function inferMode(filter: ReleaseYearFilterV1 | undefined): Mode {
	if (!filter) return "exact";
	return filter.kind === "exact"
		? "exact"
		: filter.kind === "before"
			? "before"
			: filter.kind === "after"
				? "after"
				: "range";
}

export function ReleaseYearControlA({
	filters,
	onFiltersChange,
	options,
	disabled = false,
}: ReleaseYearControlProps) {
	const baseId = useId();
	const { min, max } = options.releaseYears;

	// If no bounds, hide add/edit affordance (existing chips handled by ActiveFilterChips)
	const hasBounds = min !== null && max !== null;

	const active = filters.releaseYear;
	const [mode, setMode] = useState<Mode>(inferMode(active));

	// Draft field values as strings for controlled inputs
	const [exactVal, setExactVal] = useState(() =>
		active?.kind === "exact" ? String(active.year) : "",
	);
	const [beforeVal, setBeforeVal] = useState(() =>
		active?.kind === "before" ? String(active.end) : "",
	);
	const [afterVal, setAfterVal] = useState(() =>
		active?.kind === "after" ? String(active.start) : "",
	);
	const [rangeStart, setRangeStart] = useState(() =>
		active?.kind === "range" ? String(active.start) : "",
	);
	const [rangeEnd, setRangeEnd] = useState(() =>
		active?.kind === "range" ? String(active.end) : "",
	);

	// Validation errors for local display
	const [error, setError] = useState<string | undefined>();

	if (!hasBounds) {
		// Bounds unavailable — no add/edit affordance
		return null;
	}

	const decadePresets = buildDecadePresets(min, max);

	const applyFilter = (f: ReleaseYearFilterV1) => {
		setError(undefined);
		const next = normalizeMatchFilters({ ...filters, releaseYear: f });
		onFiltersChange(next);
	};

	const clearFilter = () => {
		const { releaseYear: _dropped, ...rest } = filters;
		setError(undefined);
		onFiltersChange(normalizeMatchFilters({ ...rest }));
	};

	const handleApply = () => {
		switch (mode) {
			case "exact": {
				if (!isValidYear(exactVal)) {
					setError("Enter a 4-digit year (1000–9999)");
					return;
				}
				applyFilter({ kind: "exact", year: Number(exactVal) });
				return;
			}
			case "before": {
				if (!isValidYear(beforeVal)) {
					setError("Enter a 4-digit year (1000–9999)");
					return;
				}
				applyFilter({ kind: "before", end: Number(beforeVal) });
				return;
			}
			case "after": {
				if (!isValidYear(afterVal)) {
					setError("Enter a 4-digit year (1000–9999)");
					return;
				}
				applyFilter({ kind: "after", start: Number(afterVal) });
				return;
			}
			case "range": {
				if (!isValidYear(rangeStart) || !isValidYear(rangeEnd)) {
					setError("Enter valid 4-digit years (1000–9999)");
					return;
				}
				const s = Number(rangeStart);
				const e = Number(rangeEnd);
				if (s > e) {
					setError("Start year must be ≤ end year");
					return;
				}
				applyFilter({ kind: "range", start: s, end: e });
				return;
			}
		}
	};

	const inputClass =
		"w-full border rounded-sm px-3 py-1.5 text-sm tabular-nums theme-border-color theme-bg theme-text placeholder:theme-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] disabled:opacity-50";

	return (
		<div style={{ fontFamily: fonts.body }}>
			<div className="text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-2">
				Release year
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
							className="text-sm leading-none tabular-nums"
							style={{ color: "var(--t-primary)" }}
						>
							{releaseYearLabel(active)}
						</span>
						<button
							type="button"
							onClick={clearFilter}
							aria-label="Remove release year filter"
							className="grid size-[16px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 transition-[color] duration-150 hover:theme-text active:scale-[0.9]"
							style={{ color: "var(--t-primary)" }}
						>
							<XIcon size={9} weight="bold" aria-hidden />
						</button>
					</span>
				</div>
			)}

			{decadePresets.length > 0 && (
				<fieldset className="m-0 border-0 p-0 mb-3">
					<legend className="sr-only">Decade presets</legend>
					<div className="flex flex-wrap gap-1">
						{decadePresets.map((d) => {
							const isActive =
								active?.kind === "range" &&
								active.start === d.start &&
								active.end === d.end;
							return (
								<button
									key={d.label}
									type="button"
									disabled={disabled}
									onClick={() => {
										setMode("range");
										setRangeStart(String(d.start));
										setRangeEnd(String(d.end));
										applyFilter({ kind: "range", start: d.start, end: d.end });
									}}
									aria-pressed={isActive}
									className="border px-2.5 py-1 text-xs tabular-nums theme-border-color transition-[background-color,color,border-color] duration-150 disabled:opacity-50 cursor-pointer"
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
										{d.label}
									</span>
								</button>
							);
						})}
					</div>
				</fieldset>
			)}

			<fieldset className="m-0 border-0 p-0 mb-3">
				<legend className="sr-only">Release year mode</legend>
				<div
					className="grid border theme-border-color"
					style={{
						gridTemplateColumns: `repeat(${Object.keys(MODE_LABELS).length}, 1fr)`,
					}}
				>
					{(Object.entries(MODE_LABELS) as Array<[Mode, string]>).map(
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
									className={`py-1.5 text-xs tracking-[0.04em] cursor-pointer border-0 transition-[background-color,color] duration-150 disabled:opacity-50 ${isFirst ? "" : "border-l theme-border-color"}`}
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
				{mode === "exact" && (
					<div>
						<label htmlFor={`${baseId}-exact`} className="sr-only">
							Year
						</label>
						<input
							id={`${baseId}-exact`}
							type="text"
							inputMode="numeric"
							maxLength={4}
							placeholder={min !== null ? String(min) : "YYYY"}
							value={exactVal}
							onChange={(e) => {
								setExactVal(e.target.value);
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

				{mode === "before" && (
					<div>
						<label htmlFor={`${baseId}-before`} className="sr-only">
							Through year
						</label>
						<input
							id={`${baseId}-before`}
							type="text"
							inputMode="numeric"
							maxLength={4}
							placeholder={max !== null ? String(max) : "YYYY"}
							value={beforeVal}
							onChange={(e) => {
								setBeforeVal(e.target.value);
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
							From year
						</label>
						<input
							id={`${baseId}-after`}
							type="text"
							inputMode="numeric"
							maxLength={4}
							placeholder={min !== null ? String(min) : "YYYY"}
							value={afterVal}
							onChange={(e) => {
								setAfterVal(e.target.value);
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
								From year
							</label>
							<input
								id={`${baseId}-range-start`}
								type="text"
								inputMode="numeric"
								maxLength={4}
								placeholder={min !== null ? String(min) : "YYYY"}
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
								Through year
							</label>
							<input
								id={`${baseId}-range-end`}
								type="text"
								inputMode="numeric"
								maxLength={4}
								placeholder={max !== null ? String(max) : "YYYY"}
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
