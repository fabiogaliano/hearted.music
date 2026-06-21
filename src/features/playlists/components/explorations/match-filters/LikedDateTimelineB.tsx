/**
 * LikedDateTimeline — Direction B: Horizontal timeline bar with draggable bounds.
 *
 * A compact horizontal bar represents the account's full liked-song timeline
 * (oldest → today). Two draggable handles define the active date window. A row of
 * year markers below the bar (derived from yearCounts) act as snap targets when
 * dragging — clicking one snaps the nearest handle to Jan 1 of that year.
 *
 * Mode is inferred from handle position:
 *   - Both handles inside the span → kind:"range" with fixed end date
 *   - Left handle at track start → kind:"before"
 *   - Right handle at track end → kind:"after"
 *   - Right handle pinned to "today" via toggle → end.kind:"today"
 *
 * Direction B differs from A by making the temporal span spatially tangible —
 * good for users who think in "how much of my history" rather than specific dates.
 *
 * Props identical to Direction A.
 */

import { XIcon } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
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
}

/** YYYY-MM-DD → days since unix epoch (UTC) */
function dateToDays(dateStr: string): number {
	return Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 86_400_000);
}

/** days since unix epoch → YYYY-MM-DD UTC */
function daysToDate(days: number): string {
	return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

function clamp(n: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, n));
}

/** Build year tick positions from yearCounts within the timeline span. */
function buildYearTicks(
	yearCounts: Array<{ year: number; count: number }>,
	minDays: number,
	maxDays: number,
): Array<{ year: number; days: number; pct: number; count: number }> {
	const span = maxDays - minDays || 1;
	return yearCounts
		.map(({ year, count }) => {
			const days = dateToDays(`${year}-01-01`);
			const pct = ((days - minDays) / span) * 100;
			return { year, days, pct, count };
		})
		.filter(({ pct }) => pct >= 0 && pct <= 100)
		.sort((a, b) => a.days - b.days);
}

/** Resolve saved filter into timeline handle positions (in days). */
function resolveHandles(
	filter: LikedAtFilterV1 | undefined,
	minDays: number,
	maxDays: number,
): {
	lowDays: number;
	highDays: number;
	todayPinned: boolean;
} {
	if (!filter)
		return { lowDays: minDays, highDays: maxDays, todayPinned: false };
	switch (filter.kind) {
		case "before":
			return {
				lowDays: minDays,
				highDays: dateToDays(filter.endDate),
				todayPinned: false,
			};
		case "after":
			return {
				lowDays: dateToDays(filter.startDate),
				highDays: maxDays,
				todayPinned: false,
			};
		case "range":
			return {
				lowDays: dateToDays(filter.startDate),
				highDays:
					filter.end.kind === "today" ? maxDays : dateToDays(filter.end.date),
				todayPinned: filter.end.kind === "today",
			};
	}
}

/** Derive a LikedAtFilterV1 from handle positions + todayPinned flag. */
function deriveFilter(
	lowDays: number,
	highDays: number,
	minDays: number,
	maxDays: number,
	todayPinned: boolean,
): LikedAtFilterV1 {
	const startDate = daysToDate(lowDays);
	const endDate = daysToDate(highDays);

	if (todayPinned) {
		return { kind: "range", startDate, end: { kind: "today" } };
	}
	if (lowDays <= minDays && highDays < maxDays) {
		return { kind: "before", endDate };
	}
	if (lowDays > minDays && highDays >= maxDays) {
		return { kind: "after", startDate };
	}
	return { kind: "range", startDate, end: { kind: "date", date: endDate } };
}

function TimelineBar({
	minDays,
	maxDays,
	lowDays,
	highDays,
	disabled,
	onChange,
}: {
	minDays: number;
	maxDays: number;
	lowDays: number;
	highDays: number;
	disabled: boolean;
	onChange: (low: number, high: number) => void;
}) {
	const trackRef = useRef<HTMLDivElement>(null);
	const span = maxDays - minDays || 1;

	// Clamp percentages to [0,100] for display only — saved values outside library
	// bounds remain valid and editable via the text inputs below.
	const lowPct = clamp(((lowDays - minDays) / span) * 100, 0, 100);
	const highPct = clamp(((highDays - minDays) / span) * 100, 0, 100);

	function pxToDays(clientX: number): number {
		if (!trackRef.current) return minDays;
		const rect = trackRef.current.getBoundingClientRect();
		const ratio = (clientX - rect.left) / rect.width;
		return clamp(Math.round(minDays + ratio * span), minDays, maxDays);
	}

	function startDrag(e: React.PointerEvent, thumb: "low" | "high") {
		if (disabled) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		const onMove = (ev: PointerEvent) => {
			const days = pxToDays(ev.clientX);
			if (thumb === "low") {
				onChange(Math.min(days, highDays), highDays);
			} else {
				onChange(lowDays, Math.max(days, lowDays));
			}
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	return (
		<div
			ref={trackRef}
			className="relative h-2 rounded-full"
			style={{
				background: "color-mix(in srgb, var(--t-text) 10%, transparent)",
			}}
		>
			<div
				className="absolute inset-y-0 rounded-full pointer-events-none"
				style={{
					left: `${lowPct}%`,
					right: `${100 - highPct}%`,
					background: "var(--t-primary)",
					opacity: disabled ? 0.4 : 0.7,
				}}
			/>

			<div
				role="slider"
				aria-label="Start date"
				aria-valuemin={minDays}
				aria-valuemax={highDays}
				aria-valuenow={lowDays}
				aria-valuetext={daysToDate(lowDays)}
				aria-disabled={disabled}
				tabIndex={disabled ? -1 : 0}
				className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 theme-bg cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
				style={{
					left: `${lowPct}%`,
					borderColor: "var(--t-primary)",
					opacity: disabled ? 0.4 : 1,
				}}
				onPointerDown={(e) => startDrag(e, "low")}
				onKeyDown={(e) => {
					if (disabled) return;
					if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
						e.preventDefault();
						onChange(clamp(lowDays - 1, minDays, highDays), highDays);
					} else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
						e.preventDefault();
						onChange(clamp(lowDays + 1, minDays, highDays), highDays);
					}
				}}
			/>

			<div
				role="slider"
				aria-label="End date"
				aria-valuemin={lowDays}
				aria-valuemax={maxDays}
				aria-valuenow={highDays}
				aria-valuetext={daysToDate(highDays)}
				aria-disabled={disabled}
				tabIndex={disabled ? -1 : 0}
				className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 theme-bg cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
				style={{
					left: `${highPct}%`,
					borderColor: "var(--t-primary)",
					opacity: disabled ? 0.4 : 1,
				}}
				onPointerDown={(e) => startDrag(e, "high")}
				onKeyDown={(e) => {
					if (disabled) return;
					if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
						e.preventDefault();
						onChange(lowDays, clamp(highDays - 1, lowDays, maxDays));
					} else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
						e.preventDefault();
						onChange(lowDays, clamp(highDays + 1, lowDays, maxDays));
					}
				}}
			/>
		</div>
	);
}

export function LikedDateTimelineB({
	filters,
	onFiltersChange,
	options,
	disabled = false,
}: LikedDateTimelineProps) {
	const baseId = useId();
	const { oldest, today, yearCounts } = options.likedAt;

	// Stable numeric bounds; hooks run before any conditional return
	const minDays = oldest !== null ? dateToDays(oldest) : 0;
	const maxDays = dateToDays(today);

	const active = filters.likedAt;
	const { lowDays, highDays, todayPinned } = resolveHandles(
		active,
		minDays,
		maxDays,
	);

	const [draftLow, setDraftLow] = useState(lowDays);
	const [draftHigh, setDraftHigh] = useState(highDays);
	const [isTodayPinned, setIsTodayPinned] = useState(todayPinned);
	const [editStart, setEditStart] = useState(daysToDate(lowDays));
	const [editEnd, setEditEnd] = useState(daysToDate(highDays));
	const [fieldError, setFieldError] = useState<string | undefined>();

	// No oldest bound → hide add/edit affordance (hooks already ran above)
	if (oldest === null) return null;

	const yearTicks = buildYearTicks(yearCounts, minDays, maxDays);

	const commitFilter = (low: number, high: number, pinToday: boolean) => {
		const f = deriveFilter(low, high, minDays, maxDays, pinToday);
		const next = normalizeMatchFilters({ ...filters, likedAt: f });
		onFiltersChange(next);
	};

	const clearFilter = () => {
		const { likedAt: _dropped, ...rest } = filters;
		setFieldError(undefined);
		onFiltersChange(normalizeMatchFilters({ ...rest }));
	};

	const handleSliderChange = (low: number, high: number) => {
		setDraftLow(low);
		setDraftHigh(high);
		setEditStart(daysToDate(low));
		setEditEnd(daysToDate(high));
		setFieldError(undefined);
		commitFilter(low, high, isTodayPinned && high >= maxDays);
	};

	const toggleTodayPin = () => {
		const next = !isTodayPinned;
		setIsTodayPinned(next);
		if (next) {
			setDraftHigh(maxDays);
			setEditEnd(today);
		}
		commitFilter(draftLow, next ? maxDays : draftHigh, next);
	};

	const handleFieldApply = () => {
		const startOk =
			/^\d{4}-\d{2}-\d{2}$/.test(editStart) &&
			!Number.isNaN(Date.parse(`${editStart}T00:00:00Z`));
		const endOk =
			/^\d{4}-\d{2}-\d{2}$/.test(editEnd) &&
			!Number.isNaN(Date.parse(`${editEnd}T00:00:00Z`));

		if (!startOk) {
			setFieldError("Start must be YYYY-MM-DD");
			return;
		}
		if (!isTodayPinned && !endOk) {
			setFieldError("End must be YYYY-MM-DD");
			return;
		}
		if (!isTodayPinned && editStart > editEnd) {
			setFieldError("Start date must be on or before end date");
			return;
		}
		setFieldError(undefined);
		const newLow = dateToDays(editStart);
		const newHigh = isTodayPinned ? maxDays : dateToDays(editEnd);
		setDraftLow(newLow);
		setDraftHigh(newHigh);
		commitFilter(newLow, newHigh, isTodayPinned);
	};

	const inputClass =
		"w-full border rounded-sm px-2 py-1 text-sm tabular-nums theme-border-color theme-bg theme-text placeholder:theme-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] disabled:opacity-50";

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
							aria-label="Remove liked date filter"
							className="grid size-[16px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 transition-[color] duration-150 hover:theme-text active:scale-[0.9]"
							style={{ color: "var(--t-primary)" }}
						>
							<XIcon size={9} weight="bold" aria-hidden />
						</button>
					</span>
				</div>
			)}

			<div className="relative mb-1 px-2">
				<TimelineBar
					minDays={minDays}
					maxDays={maxDays}
					lowDays={draftLow}
					highDays={draftHigh}
					disabled={disabled}
					onChange={handleSliderChange}
				/>
			</div>

			{yearTicks.length > 0 && (
				<div className="relative mb-3 px-2" aria-hidden>
					<div className="relative h-4">
						{yearTicks.map(({ year, pct, days }) => (
							<button
								key={year}
								type="button"
								disabled={disabled}
								tabIndex={-1}
								onClick={() => {
									const nearLow =
										Math.abs(days - draftLow) <= Math.abs(days - draftHigh);
									const newLow = nearLow
										? clamp(days, minDays, draftHigh)
										: draftLow;
									const newHigh = nearLow
										? draftHigh
										: clamp(days, draftLow, maxDays);
									setDraftLow(newLow);
									setDraftHigh(newHigh);
									setEditStart(daysToDate(newLow));
									setEditEnd(daysToDate(newHigh));
									commitFilter(
										newLow,
										newHigh,
										isTodayPinned && newHigh >= maxDays,
									);
								}}
								className="absolute text-[10px] tabular-nums theme-text-muted -translate-x-1/2 cursor-pointer disabled:opacity-50 hover:theme-text transition-[color] duration-100"
								style={{ left: `${pct}%`, top: 0 }}
							>
								{year}
							</button>
						))}
					</div>
				</div>
			)}

			<div className="flex items-center gap-2 mb-2">
				<div className="flex-1">
					<label
						htmlFor={`${baseId}-start`}
						className="text-[10px] tracking-[0.06em] uppercase theme-text-muted block mb-0.5"
					>
						From
					</label>
					<input
						id={`${baseId}-start`}
						type="text"
						placeholder={oldest}
						value={editStart}
						onChange={(e) => {
							setEditStart(e.target.value);
							setFieldError(undefined);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleFieldApply();
						}}
						disabled={disabled}
						className={inputClass}
					/>
				</div>
				<span className="theme-text-muted text-sm shrink-0 mt-4" aria-hidden>
					–
				</span>
				<div className="flex-1">
					<label
						htmlFor={`${baseId}-end`}
						className="text-[10px] tracking-[0.06em] uppercase theme-text-muted block mb-0.5"
					>
						Through
					</label>
					{isTodayPinned ? (
						// The label above points to baseId-end; give this static display the same
						// id so the association remains valid when the input is replaced.
						<div
							id={`${baseId}-end`}
							role="status"
							aria-label="Through today"
							className="w-full border px-2 py-1 text-sm theme-border-color theme-text-muted"
						>
							today
						</div>
					) : (
						<input
							id={`${baseId}-end`}
							type="text"
							placeholder={today}
							value={editEnd}
							onChange={(e) => {
								setEditEnd(e.target.value);
								setFieldError(undefined);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleFieldApply();
							}}
							disabled={disabled}
							className={inputClass}
						/>
					)}
				</div>
			</div>

			{fieldError && (
				<p
					className="text-xs mt-1 mb-2"
					role="alert"
					style={{ color: "var(--t-primary)" }}
				>
					{fieldError}
				</p>
			)}

			<div className="flex items-center gap-2 mb-3">
				<button
					type="button"
					disabled={disabled}
					onClick={toggleTodayPin}
					aria-pressed={isTodayPinned}
					className="border px-2.5 py-1 text-xs tracking-[0.04em] cursor-pointer transition-[background-color,color,border-color] duration-150 disabled:opacity-50"
					style={
						isTodayPinned
							? {
									background:
										"color-mix(in srgb, var(--t-primary) 12%, transparent)",
									borderColor: "var(--t-primary)",
									color: "var(--t-primary)",
								}
							: undefined
					}
				>
					<span className={isTodayPinned ? "" : "theme-text-muted"}>
						Through today
					</span>
				</button>
				{isTodayPinned && (
					<span className="text-[11px] theme-text-muted">
						Updates at each match refresh.
					</span>
				)}
			</div>

			<button
				type="button"
				onClick={handleFieldApply}
				disabled={disabled}
				className="w-full border py-1.5 text-xs tracking-[0.06em] uppercase theme-border-color theme-text cursor-pointer transition-[background-color] duration-150 hover:bg-(--t-surface) active:scale-[0.98] disabled:opacity-50"
			>
				Apply
			</button>
		</div>
	);
}
