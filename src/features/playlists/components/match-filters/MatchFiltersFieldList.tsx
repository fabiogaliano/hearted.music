/**
 * MatchFiltersFieldList — the edit-mode filter surface (Structure A "field list").
 *
 * Active filters render as rows sharing one grammar: [icon] Label … value ⌄ ✕.
 * Inactive facets sit below as named dashed "Add" pills you tap to reveal inline;
 * closing one without a value folds it back into the Add row. This replaces the
 * old AdvancedFiltersAssembly (four divergent controls behind a disclosure) and
 * keeps the same prop contract so the caller owns the single draft.
 *
 * Facet-specific moves:
 *   - Vocals: one "Any · Female · Male" segment (no clear-then-repick dance).
 *   - Release era: a consecutive decade span over the single range value, plus
 *     two From/To year fields (empty bound = open-ended).
 *   - Liked date: a From/To range with a rolling "Through today" end.
 *   - Language: reuses the production LanguagePicker command-palette (search over
 *     the full catalog) — the row just provides the label + summary around it.
 *
 * State rules (decisions §7):
 *   - optionsState "loading"/"error" or isSaving freezes value-editing controls.
 *   - Removal (per-row ✕ and Clear all) stays live while loading so a filter can
 *     be dropped before options arrive, and only freezes during a save in flight.
 *
 * Register: rows sit at a quiet grammar — 12px regular labels, muted icons, no
 * row rules, chip-scale dashed Add pills — so the one surface reads calmly in
 * both homes it now serves: the narrow create-studio config rail and the
 * Spotlight editor. Full editors (From/To fields, language palette) stay intact
 * at both widths.
 */

import { XIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { languageLabel } from "@/lib/domains/taste/match-filters/languages";
import type {
	LikedAtFilterV1,
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
	ReleaseYearFilterV1,
} from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import {
	boundsToYear,
	deriveLiked,
	eraLabel,
	FACET_ICON,
	type FacetIcon,
	type FacetKey,
	languageSummary,
	likedLabel,
	shiftDate,
	yearToBounds,
} from "./facet-helpers";
import { LanguagePicker } from "./LanguagePicker";
import "../playlist-ui.css";

export type OptionsState = "ready" | "loading" | "error";

// Stable empty fallback so an unselected language facet doesn't hand a fresh []
// to LanguagePicker each render, which would recompute its ordered/display lists.
const EMPTY_CODES: string[] = [];

const c = {
	surface: "var(--t-surface)",
	dim: "var(--t-surface-dim)",
	border: "var(--t-border)",
	text: "var(--t-text)",
	muted: "var(--t-text-muted)",
	primary: "var(--t-primary)",
	onPrimary: "var(--t-text-on-primary)",
} as const;

// Always muted (no active→primary flip): in the rail register the value text's
// presence is the active signal, so a tinted icon would just re-shout it.
function Icon({ icon: Glyph, size = 13 }: { icon: FacetIcon; size?: number }) {
	return (
		<Glyph
			size={size}
			weight="regular"
			aria-hidden="true"
			style={{ flexShrink: 0, color: c.muted }}
		/>
	);
}

// grid-template-rows 0fr→1fr animates to natural height with no magic max-height;
// inert keeps the collapsed editor out of the tab order and a11y tree.
function Expand({ open, children }: { open: boolean; children: ReactNode }) {
	return (
		<div
			className="grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none"
			style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
		>
			<div className="min-h-0 overflow-hidden" inert={!open}>
				<div style={{ padding: "4px 10px 8px 10px" }}>{children}</div>
			</div>
		</div>
	);
}

function FacetRow({
	icon,
	label,
	value,
	open,
	onToggle,
	onRemove,
	removeDisabled,
	hideValueWhenOpen,
	children,
}: {
	icon: FacetIcon;
	label: string;
	value: string | null;
	open: boolean;
	onToggle: () => void;
	onRemove?: () => void;
	removeDisabled?: boolean;
	hideValueWhenOpen?: boolean;
	children: ReactNode;
}) {
	const active = value !== null;
	const showValue = !(hideValueWhenOpen && open);
	return (
		<div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					padding: "6px 10px",
					borderRadius: 10,
					// @ts-expect-error -- corner-shape not yet in CSS typings
					cornerShape: "squircle",
					background:
						"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))",
					transition: "background 150ms ease",
				}}
			>
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={open}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						flex: 1,
						minWidth: 0,
						padding: 0,
						border: "none",
						background: "transparent",
						cursor: "pointer",
						textAlign: "left",
						color: c.text,
						font: "inherit",
					}}
				>
					<Icon icon={icon} size={12} />
					<span style={{ flex: 1, fontSize: 11, color: c.muted }}>{label}</span>
					{showValue && (
						<span
							style={{
								fontSize: 11,
								color: active ? c.text : c.muted,
								fontVariantNumeric: "tabular-nums",
								maxWidth: "55%",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{value ?? "Any"}
						</span>
					)}
				</button>
				{active && onRemove && (
					<button
						type="button"
						onClick={onRemove}
						disabled={removeDisabled}
						aria-label={`Remove ${label} filter`}
						className="mf-remove"
						style={{
							display: "grid",
							placeItems: "center",
							flexShrink: 0,
							width: 18,
							height: 18,
							borderRadius: 999,
							border: "none",
							background: "transparent",
							font: "inherit",
							lineHeight: 1,
						}}
					>
						<XIcon size={10} weight="bold" aria-hidden="true" />
					</button>
				)}
			</div>
			<Expand open={open}>{children}</Expand>
		</div>
	);
}

const VOCALS_OPTS: Array<{ key: "any" | "female" | "male"; label: string }> = [
	{ key: "any", label: "Any" },
	{ key: "female", label: "Female" },
	{ key: "male", label: "Male" },
];

function VocalsSegment({
	value,
	onChange,
	disabled,
}: {
	value: "female" | "male" | undefined;
	onChange: (v: "female" | "male" | undefined) => void;
	disabled?: boolean;
}) {
	const current = value ?? "any";
	return (
		<fieldset
			style={{
				display: "flex",
				gap: 2,
				margin: "0 auto",
				width: "fit-content",
				padding: 2,
				border: "none",
				minInlineSize: 0,
				borderRadius: 8,
				// @ts-expect-error -- corner-shape not yet in CSS typings
				cornerShape: "squircle",
				background:
					"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))",
				opacity: disabled ? 0.5 : 1,
			}}
		>
			<legend className="sr-only">Vocals</legend>
			{VOCALS_OPTS.map((o) => {
				const selected = o.key === current;
				return (
					<button
						key={o.key}
						type="button"
						disabled={disabled}
						aria-pressed={selected}
						className="mf-seg"
						onClick={() => onChange(o.key === "any" ? undefined : o.key)}
						style={{
							padding: "4px 12px",
							borderRadius: 6,
							// @ts-expect-error -- corner-shape not yet in CSS typings
							cornerShape: "squircle",
							border: "none",
							cursor: disabled ? "default" : "pointer",
							fontSize: 11,
							fontWeight: 500,
							color: selected ? c.onPrimary : c.text,
							background: selected ? c.primary : "transparent",
						}}
					>
						{o.label}
					</button>
				);
			})}
		</fieldset>
	);
}

// Layout only — the .mf-field class owns the well's border, fill, recessed
// shadow and themed placeholder so the inputs read on the low-contrast band.
const fieldLayout: CSSProperties = {
	width: 84,
	padding: "5px 8px",
	fontSize: 11,
	fontVariantNumeric: "tabular-nums",
};

const chipLayout: CSSProperties = {
	padding: "4px 8px",
	fontSize: 11,
};

function EraEditor({
	value,
	onChange,
	options,
	disabled,
}: {
	value: ReleaseYearFilterV1 | undefined;
	onChange: (v: ReleaseYearFilterV1 | undefined) => void;
	options: PlaylistMatchFilterOptions;
	disabled?: boolean;
}) {
	const bounds = yearToBounds(value);
	const min = options.releaseYears.min ?? 1960;
	const max = options.releaseYears.max ?? 2026;
	const decades: Array<{ label: string; lo: number; hi: number }> = [];
	for (let d = Math.floor(min / 10) * 10; d <= max; d += 10) {
		decades.push({ label: `${d}s`, lo: d, hi: d + 9 });
	}
	const band: [number, number] | null =
		value?.kind === "range"
			? [value.start, value.end]
			: value?.kind === "exact"
				? [value.year, value.year]
				: null;
	const clickDecade = (lo: number, hi: number) => {
		if (!band) {
			onChange({ kind: "range", start: lo, end: hi });
			return;
		}
		const [blo, bhi] = band;
		const inside = lo >= blo && hi <= bhi;
		if (inside) {
			// One-decade band: clicking it clears. Otherwise clicking an end shrinks
			// that side; clicking the middle leaves the consecutive span intact.
			if (bhi - blo <= 9) {
				onChange(undefined);
				return;
			}
			if (lo === blo) {
				onChange({ kind: "range", start: blo + 10, end: bhi });
				return;
			}
			if (hi === bhi) {
				onChange({ kind: "range", start: blo, end: bhi - 10 });
				return;
			}
			return;
		}
		// Extend to include the clicked decade, filling any gap so the span stays a
		// single consecutive range — keeps releaseYear one value, no model change.
		onChange({
			kind: "range",
			start: Math.min(blo, lo),
			end: Math.max(bhi, hi),
		});
	};
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 8,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<input
					key={`low-${bounds.low}`}
					className="mf-field"
					style={fieldLayout}
					inputMode="numeric"
					placeholder={`From ${min}`}
					defaultValue={bounds.low}
					disabled={disabled}
					onBlur={(e) => onChange(boundsToYear(e.target.value, bounds.high))}
					aria-label="From year"
				/>
				<span style={{ color: c.muted, fontSize: 11 }}>to</span>
				<input
					key={`high-${bounds.high}`}
					className="mf-field"
					style={fieldLayout}
					inputMode="numeric"
					placeholder={`To ${max}`}
					defaultValue={bounds.high}
					disabled={disabled}
					onBlur={(e) => onChange(boundsToYear(bounds.low, e.target.value))}
					aria-label="To year"
				/>
			</div>
			<div style={{ fontSize: 10, color: c.muted }}>
				Decades pick a consecutive span. Same year both sides = exact.
			</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
				{decades.map((d) => {
					const selected = band !== null && d.lo >= band[0] && d.hi <= band[1];
					return (
						<button
							key={d.label}
							type="button"
							disabled={disabled}
							aria-pressed={selected}
							className="mf-chip"
							style={chipLayout}
							onClick={() => clickDecade(d.lo, d.hi)}
						>
							{d.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function LikedEditor({
	value,
	onChange,
	options,
	disabled,
}: {
	value: LikedAtFilterV1 | undefined;
	onChange: (v: LikedAtFilterV1 | undefined) => void;
	options: PlaylistMatchFilterOptions;
	disabled?: boolean;
}) {
	const oldest = options.likedAt.oldest ?? "2019-01-01";
	const today = options.likedAt.today;

	const from = value && value.kind !== "before" ? value.startDate : "";
	const to =
		value?.kind === "before"
			? value.endDate
			: value?.kind === "range" && value.end.kind === "date"
				? value.end.date
				: "";
	const todayPinned = value?.kind === "range" && value.end.kind === "today";

	// Relative spans are only offered when likes actually reach that far back.
	const presets: Array<{ label: string; start: string }> = [
		{ label: "Last 30 days", start: shiftDate(today, { days: 30 }) },
		{ label: "Last 3 months", start: shiftDate(today, { months: 3 }) },
		{ label: "Last 6 months", start: shiftDate(today, { months: 6 }) },
		{ label: "Last year", start: shiftDate(today, { years: 1 }) },
		{ label: "Last 2 years", start: shiftDate(today, { years: 2 }) },
	].filter((p) => p.start > oldest);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 8,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					flexWrap: "wrap",
				}}
			>
				<input
					key={`from-${from}`}
					className="mf-field"
					style={{ ...fieldLayout, width: 96 }}
					placeholder={oldest}
					defaultValue={from}
					disabled={disabled}
					onBlur={(e) =>
						onChange(deriveLiked(e.target.value, to, false, oldest))
					}
					aria-label="Liked from date"
				/>
				<span style={{ color: c.muted, fontSize: 10 }}>–</span>
				{todayPinned ? (
					<button
						type="button"
						disabled={disabled}
						aria-pressed={true}
						className="mf-chip"
						style={{ ...chipLayout, borderRadius: 8 }}
						onClick={() => onChange(deriveLiked(from, "", false, oldest))}
						aria-label="Rolling through today — tap to use a fixed end date instead"
					>
						↻ today
					</button>
				) : (
					<>
						<input
							key={`to-${to}`}
							className="mf-field"
							style={{ ...fieldLayout, width: 96 }}
							placeholder={today}
							defaultValue={to}
							disabled={disabled}
							onBlur={(e) =>
								onChange(deriveLiked(from, e.target.value, false, oldest))
							}
							aria-label="Liked to date"
						/>
						<button
							type="button"
							disabled={disabled}
							className="mf-chip"
							style={{ ...chipLayout, borderRadius: 8 }}
							onClick={() => onChange(deriveLiked(from, "", true, oldest))}
						>
							Through today
						</button>
					</>
				)}
			</div>
			<div style={{ fontSize: 9, color: c.muted }}>
				{todayPinned
					? `↻ Rolling end — moves with today`
					: `First like ${oldest}`}
			</div>
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 5,
					justifyContent: "center",
				}}
			>
				{presets.map((p) => {
					const selected =
						todayPinned &&
						value?.kind === "range" &&
						value.startDate === p.start;
					return (
						<button
							key={p.label}
							type="button"
							disabled={disabled}
							aria-pressed={selected}
							className="mf-chip"
							style={chipLayout}
							onClick={() =>
								onChange(
									selected
										? undefined
										: {
												kind: "range",
												startDate: p.start,
												end: { kind: "today" },
											},
								)
							}
						>
							{p.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

export interface MatchFiltersFieldListProps {
	filters: PlaylistMatchFiltersV1;
	onFiltersChange: (next: PlaylistMatchFiltersV1) => void;
	options: PlaylistMatchFilterOptions;
	/** "loading"/"error" disable value-editing while keeping removal live (§7). */
	optionsState?: OptionsState;
	/** A save in flight freezes everything, including removal, to avoid losing a
	 *  removal when the server response reconciles the submitted draft. */
	isSaving?: boolean;
}

// No loading notice: the facet rows themselves are the skeleton (they render
// immediately with editing frozen), so extra copy on top is noise. Errors still
// get a line because a frozen editor with no explanation reads as broken.
function OptionsErrorNotice() {
	// role="status" (implicit aria-live="polite") so the error is announced
	// while the editor is open.
	return (
		<p role="status" style={{ fontSize: 11, color: c.muted, margin: 0 }}>
			Filter options unavailable.
		</p>
	);
}

export function MatchFiltersFieldList({
	filters,
	onFiltersChange,
	options,
	optionsState = "ready",
	isSaving = false,
}: MatchFiltersFieldListProps) {
	const [open, setOpen] = useState<FacetKey | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: PointerEvent) => {
			if (!containerRef.current?.contains(e.target as Node)) {
				setOpen(null);
			}
		};
		document.addEventListener("pointerdown", handler);
		return () => document.removeEventListener("pointerdown", handler);
	}, [open]);

	// Value-editing is frozen while options aren't ready or a save is in flight;
	// removal only freezes during a save (§7).
	const editFrozen = optionsState !== "ready" || isSaving;

	const toggle = (k: FacetKey) => {
		setOpen((cur) => (cur === k ? null : k));
	};

	const clearFacet = (k: FacetKey) => {
		const next = { ...filters };
		if (k === "language") delete next.languages;
		if (k === "vocals") delete next.vocalGender;
		if (k === "era") delete next.releaseYear;
		if (k === "liked") delete next.likedAt;
		onFiltersChange(next);
		if (open === k) setOpen(null);
	};

	const facets: Array<{
		key: FacetKey;
		label: string;
		icon: FacetIcon;
		value: string | null;
		hideValueWhenOpen?: boolean;
		editor: ReactNode;
	}> = [
		{
			key: "language",
			label: "Language",
			icon: FACET_ICON.language,
			value: languageSummary(filters.languages?.codes, languageLabel),
			hideValueWhenOpen: true,
			editor: (
				<LanguagePicker
					value={filters.languages?.codes ?? EMPTY_CODES}
					onChange={(codes) =>
						onFiltersChange({
							...filters,
							languages: codes.length > 0 ? { codes } : undefined,
						})
					}
					options={options}
					disabled={editFrozen}
					isSaving={isSaving}
					hideLabel
					expanded={open === "language"}
				/>
			),
		},
		{
			key: "vocals",
			label: "Vocals",
			icon: FACET_ICON.vocals,
			value: filters.vocalGender
				? filters.vocalGender === "female"
					? "Female"
					: "Male"
				: null,
			editor: (
				<VocalsSegment
					value={filters.vocalGender}
					disabled={editFrozen}
					onChange={(v) => onFiltersChange({ ...filters, vocalGender: v })}
				/>
			),
		},
		{
			key: "era",
			label: "Release era",
			icon: FACET_ICON.era,
			value: filters.releaseYear ? eraLabel(filters.releaseYear) : null,
			editor: (
				<EraEditor
					value={filters.releaseYear}
					options={options}
					disabled={editFrozen}
					onChange={(v) => onFiltersChange({ ...filters, releaseYear: v })}
				/>
			),
		},
		{
			key: "liked",
			label: "Liked date",
			icon: FACET_ICON.liked,
			value: filters.likedAt ? likedLabel(filters.likedAt) : null,
			editor: (
				<LikedEditor
					value={filters.likedAt}
					options={options}
					disabled={editFrozen}
					onChange={(v) => onFiltersChange({ ...filters, likedAt: v })}
				/>
			),
		},
	];

	const activeCount = facets.filter((f) => f.value !== null).length;

	return (
		<div ref={containerRef} style={{ fontFamily: fonts.body }}>
			<span className="theme-text-muted text-[10px] uppercase tracking-[0.16em] block mb-2.5">
				Filters
			</span>
			{optionsState === "error" && <OptionsErrorNotice />}

			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				{facets.map((f) => (
					<FacetRow
						key={f.key}
						icon={f.icon}
						label={f.label}
						value={f.value}
						open={open === f.key}
						onToggle={() => toggle(f.key)}
						onRemove={() => clearFacet(f.key)}
						removeDisabled={isSaving}
						hideValueWhenOpen={f.hideValueWhenOpen}
					>
						{f.editor}
					</FacetRow>
				))}
			</div>

			{activeCount > 0 && (
				<button
					type="button"
					disabled={isSaving}
					onClick={() => {
						onFiltersChange({ version: 1 });
						setOpen(null);
					}}
					style={{
						marginTop: 12,
						padding: 0,
						background: "transparent",
						border: "none",
						color: c.muted,
						fontSize: 11,
						cursor: isSaving ? "default" : "pointer",
						opacity: isSaving ? 0.5 : 1,
						textDecoration: "underline",
					}}
				>
					Clear all
				</button>
			)}
		</div>
	);
}
