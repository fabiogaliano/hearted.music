/**
 * ReleaseYearControl — Direction B: Dual-handle range slider + mode inference chips.
 *
 * A horizontal slider spanning the library's year range is the primary interaction.
 * Dragging one handle moves the start bound; the other moves the end bound. When the
 * handles converge to the same year the filter becomes an exact-year. The user can
 * also pin one handle to the track edge (by clicking the ≤ / ≥ chips) to switch to
 * before/after modes — the slider then shows only one active handle. Decade presets
 * appear below the slider as quick-pick chips.
 *
 * Direction B differs from A by using spatial/visual manipulation rather than
 * mode-first segmented tabs — good for users who think in time-spans and want to
 * see their range relative to the library.
 *
 * Props identical to Direction A so stories can swap them directly.
 */

import { XIcon } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
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

const YEAR_MIN = 1000;
const YEAR_MAX = 9999;

function clamp(n: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, n));
}

/** Resolve the active filter into slider thumb positions. */
function resolveSliderState(
	filter: ReleaseYearFilterV1 | undefined,
	libMin: number,
	libMax: number,
): { low: number; high: number; mode: "range" | "before" | "after" | "exact" } {
	if (!filter) return { low: libMin, high: libMax, mode: "range" };
	switch (filter.kind) {
		case "exact":
			return { low: filter.year, high: filter.year, mode: "exact" };
		case "before":
			return { low: libMin, high: filter.end, mode: "before" };
		case "after":
			return { low: filter.start, high: libMax, mode: "after" };
		case "range":
			return { low: filter.start, high: filter.end, mode: "range" };
	}
}

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

function SliderTrack({
	libMin,
	libMax,
	low,
	high,
	mode,
	disabled,
	onChange,
}: {
	libMin: number;
	libMax: number;
	low: number;
	high: number;
	mode: "range" | "before" | "after" | "exact";
	disabled: boolean;
	onChange: (low: number, high: number) => void;
}) {
	const trackRef = useRef<HTMLDivElement>(null);
	const span = libMax - libMin || 1;

	// Clamp percentages to [0,100] for display only — saved values outside library
	// bounds remain valid and editable via the text inputs below.
	const lowPct = clamp(((low - libMin) / span) * 100, 0, 100);
	const highPct = clamp(((high - libMin) / span) * 100, 0, 100);

	const showLow = mode !== "before";
	const showHigh = mode !== "after";

	function pxToYear(clientX: number): number {
		if (!trackRef.current) return libMin;
		const rect = trackRef.current.getBoundingClientRect();
		const ratio = (clientX - rect.left) / rect.width;
		return clamp(Math.round(libMin + ratio * span), libMin, libMax);
	}

	function startDrag(e: React.PointerEvent, thumb: "low" | "high") {
		if (disabled) return;
		e.currentTarget.setPointerCapture(e.pointerId);

		const onMove = (ev: PointerEvent) => {
			const year = pxToYear(ev.clientX);
			if (thumb === "low") {
				onChange(Math.min(year, high), high);
			} else {
				onChange(low, Math.max(year, low));
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
			className="relative h-1 rounded-full"
			style={{
				background: "color-mix(in srgb, var(--t-text) 12%, transparent)",
			}}
		>
			<div
				className="absolute inset-y-0 rounded-full pointer-events-none"
				style={{
					left: `${showLow ? lowPct : 0}%`,
					right: `${100 - (showHigh ? highPct : 100)}%`,
					background: "var(--t-primary)",
					opacity: disabled ? 0.4 : 1,
				}}
			/>

			{showLow && (
				<div
					role="slider"
					aria-label="Start year"
					aria-valuemin={libMin}
					aria-valuemax={high}
					aria-valuenow={low}
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
							onChange(clamp(low - 1, libMin, high), high);
						} else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
							e.preventDefault();
							onChange(clamp(low + 1, libMin, high), high);
						}
					}}
				/>
			)}

			{showHigh && (
				<div
					role="slider"
					aria-label="End year"
					aria-valuemin={low}
					aria-valuemax={libMax}
					aria-valuenow={high}
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
							onChange(low, clamp(high - 1, low, libMax));
						} else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
							e.preventDefault();
							onChange(low, clamp(high + 1, low, libMax));
						}
					}}
				/>
			)}
		</div>
	);
}

export function ReleaseYearControlB({
	filters,
	onFiltersChange,
	options,
	disabled = false,
}: ReleaseYearControlProps) {
	const baseId = useId();
	const { min: libMinRaw, max: libMaxRaw } = options.releaseYears;

	// Stable numeric bounds; hooks must run before any conditional return
	const libMin = libMinRaw ?? 1900;
	const libMax = libMaxRaw ?? 2026;

	const active = filters.releaseYear;
	const { low, high, mode } = resolveSliderState(active, libMin, libMax);

	const [draftLow, setDraftLow] = useState(low);
	const [draftHigh, setDraftHigh] = useState(high);
	const [draftMode, setDraftMode] = useState<
		"range" | "before" | "after" | "exact"
	>(mode);
	const [editStart, setEditStart] = useState(String(low));
	const [editEnd, setEditEnd] = useState(String(high));
	const [fieldError, setFieldError] = useState<string | undefined>();

	// If no library bounds, hide the add/edit affordance (hooks already ran above)
	if (libMinRaw === null || libMaxRaw === null) return null;

	const decadePresets = buildDecadePresets(libMin, libMax);

	const applyFilter = (f: ReleaseYearFilterV1) => {
		const next = normalizeMatchFilters({ ...filters, releaseYear: f });
		onFiltersChange(next);
	};

	const clearFilter = () => {
		const { releaseYear: _dropped, ...rest } = filters;
		onFiltersChange(normalizeMatchFilters({ ...rest }));
	};

	const handleSliderChange = (newLow: number, newHigh: number) => {
		setDraftLow(newLow);
		setDraftHigh(newHigh);
		setEditStart(String(newLow));
		setEditEnd(String(newHigh));
		setFieldError(undefined);

		let f: ReleaseYearFilterV1;
		switch (draftMode) {
			case "before":
				f = { kind: "before", end: newHigh };
				break;
			case "after":
				f = { kind: "after", start: newLow };
				break;
			case "exact":
				f = { kind: "exact", year: newLow };
				break;
			default:
				f =
					newLow === newHigh
						? { kind: "exact", year: newLow }
						: { kind: "range", start: newLow, end: newHigh };
		}
		applyFilter(f);
	};

	const setModeChip = (m: "range" | "before" | "after") => {
		setDraftMode(m);
		setFieldError(undefined);
		switch (m) {
			case "before":
				applyFilter({ kind: "before", end: draftHigh });
				break;
			case "after":
				applyFilter({ kind: "after", start: draftLow });
				break;
			case "range":
				applyFilter({ kind: "range", start: draftLow, end: draftHigh });
				break;
		}
	};

	const handleFieldApply = () => {
		const s = Number(editStart);
		const e = Number(editEnd);
		if (!/^\d{4}$/.test(editStart) || s < YEAR_MIN || s > YEAR_MAX) {
			setFieldError("Start must be a 4-digit year (1000–9999)");
			return;
		}
		if (
			draftMode !== "before" &&
			(!/^\d{4}$/.test(editEnd) || e < YEAR_MIN || e > YEAR_MAX)
		) {
			setFieldError("End must be a 4-digit year (1000–9999)");
			return;
		}
		if (draftMode === "range" && s > e) {
			setFieldError("Start year must be ≤ end year");
			return;
		}
		setFieldError(undefined);
		setDraftLow(s);
		setDraftHigh(e);
		handleSliderChange(s, e);
	};

	const inputClass =
		"w-full border rounded-sm px-2 py-1 text-sm tabular-nums theme-border-color theme-bg theme-text placeholder:theme-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] disabled:opacity-50";

	const MODE_CHIPS: Array<{
		value: "range" | "before" | "after";
		label: string;
	}> = [
		{ value: "range", label: "Range" },
		{ value: "before", label: "≤ Through" },
		{ value: "after", label: "≥ From" },
	];

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

			<fieldset className="m-0 border-0 p-0 mb-4">
				<legend className="sr-only">Year filter mode</legend>
				<div className="flex gap-1.5">
					{MODE_CHIPS.map(({ value, label }) => {
						const isActive =
							draftMode === value ||
							(draftMode === "exact" && value === "range");
						return (
							<button
								key={value}
								type="button"
								disabled={disabled}
								onClick={() => setModeChip(value)}
								aria-pressed={isActive}
								className="border px-2.5 py-1 text-xs tracking-[0.03em] cursor-pointer transition-[background-color,color,border-color] duration-150 disabled:opacity-50"
								style={
									isActive
										? {
												background:
													"color-mix(in srgb, var(--t-primary) 12%, transparent)",
												borderColor: "var(--t-primary)",
												color: "var(--t-primary)",
											}
										: undefined
								}
							>
								<span className={isActive ? "" : "theme-text-muted"}>
									{label}
								</span>
							</button>
						);
					})}
				</div>
			</fieldset>

			<div className="px-2 mb-3">
				<SliderTrack
					libMin={libMin}
					libMax={libMax}
					low={draftLow}
					high={draftHigh}
					mode={draftMode}
					disabled={disabled}
					onChange={handleSliderChange}
				/>
				<div className="flex justify-between mt-2" aria-hidden>
					<span className="text-[11px] tabular-nums theme-text-muted">
						{libMin}
					</span>
					<span className="text-[11px] tabular-nums theme-text-muted">
						{libMax}
					</span>
				</div>
			</div>

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
						inputMode="numeric"
						maxLength={4}
						placeholder={String(libMin)}
						value={editStart}
						disabled={disabled || draftMode === "before"}
						onChange={(e) => {
							setEditStart(e.target.value);
							setFieldError(undefined);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleFieldApply();
						}}
						className={inputClass}
					/>
				</div>

				{draftMode !== "after" && (
					<>
						<span
							className="theme-text-muted text-sm shrink-0 mt-4"
							aria-hidden
						>
							–
						</span>
						<div className="flex-1">
							<label
								htmlFor={`${baseId}-end`}
								className="text-[10px] tracking-[0.06em] uppercase theme-text-muted block mb-0.5"
							>
								Through
							</label>
							<input
								id={`${baseId}-end`}
								type="text"
								inputMode="numeric"
								maxLength={4}
								placeholder={String(libMax)}
								value={editEnd}
								disabled={disabled}
								onChange={(e) => {
									setEditEnd(e.target.value);
									setFieldError(undefined);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleFieldApply();
								}}
								className={inputClass}
							/>
						</div>
					</>
				)}

				{draftMode === "after" && (
					<>
						<span
							className="theme-text-muted text-sm shrink-0 mt-4"
							aria-hidden
						>
							–
						</span>
						<div className="flex-1">
							<p className="text-[10px] tracking-[0.06em] uppercase theme-text-muted mb-0.5">
								Through
							</p>
							<input
								type="text"
								disabled
								value={String(libMax)}
								aria-label="Library max year (fixed)"
								className={inputClass}
							/>
						</div>
					</>
				)}
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

			{decadePresets.length > 0 && (
				<fieldset className="m-0 border-0 p-0 mb-2">
					<legend className="sr-only">Decade presets</legend>
					<div className="flex flex-wrap gap-1">
						{decadePresets.map((d) => {
							const isActive =
								filters.releaseYear?.kind === "range" &&
								filters.releaseYear.start === d.start &&
								filters.releaseYear.end === d.end;
							return (
								<button
									key={d.label}
									type="button"
									disabled={disabled}
									onClick={() => {
										setDraftMode("range");
										setDraftLow(d.start);
										setDraftHigh(d.end);
										setEditStart(String(d.start));
										setEditEnd(String(d.end));
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
		</div>
	);
}
