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
 */

import { CaretRightIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
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

const EASE = "var(--ease-out-expo)";

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

function Icon({ icon: Glyph, active }: { icon: FacetIcon; active: boolean }) {
	// Color via CSS (Phosphor fills with currentColor) so the active flip
	// transitions; weight="regular" matches the rest of the app's icon set.
	return (
		<Glyph
			size={16}
			weight="regular"
			aria-hidden="true"
			style={{
				flexShrink: 0,
				color: active ? c.primary : c.muted,
				transition: `color 200ms ${EASE}`,
			}}
		/>
	);
}

function Chevron({ open }: { open: boolean }) {
	return (
		<CaretRightIcon
			size={14}
			weight="regular"
			aria-hidden="true"
			style={{
				flexShrink: 0,
				color: c.muted,
				transform: open ? "rotate(90deg)" : "rotate(0deg)",
				transition: `transform 200ms ${EASE}`,
			}}
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
				<div style={{ padding: "4px 0 12px 28px" }}>{children}</div>
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
	children,
}: {
	icon: FacetIcon;
	label: string;
	value: string | null;
	open: boolean;
	onToggle: () => void;
	onRemove?: () => void;
	removeDisabled?: boolean;
	children: ReactNode;
}) {
	const active = value !== null;
	return (
		<div
			style={{
				borderBottom:
					"1px solid color-mix(in srgb, var(--t-text) 9%, transparent)",
			}}
		>
			<div style={{ display: "flex", alignItems: "center" }}>
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={open}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						flex: 1,
						minWidth: 0,
						padding: "12px 4px",
						background: "transparent",
						border: "none",
						cursor: "pointer",
						textAlign: "left",
						color: c.text,
						font: "inherit",
					}}
				>
					<Icon icon={icon} active={active} />
					<span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
						{label}
					</span>
					<span
						style={{
							fontSize: 13,
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
					<Chevron open={open} />
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
							width: 28,
							height: 28,
							marginLeft: 4,
							borderRadius: 999,
							border: "none",
							background: "transparent",
							font: "inherit",
							fontSize: 15,
							lineHeight: 1,
						}}
					>
						✕
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
				display: "inline-flex",
				gap: 2,
				margin: 0,
				padding: 2,
				border: "none",
				minInlineSize: 0,
				borderRadius: 10,
				background: c.dim,
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
							padding: "5px 14px",
							borderRadius: 8,
							border: "none",
							cursor: disabled ? "default" : "pointer",
							fontSize: 13,
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
	width: 92,
	padding: "7px 10px",
	fontSize: 13,
	fontVariantNumeric: "tabular-nums",
};

// Layout only — the .mf-chip class owns the outline/pressed look and press feel.
const chipLayout: CSSProperties = {
	padding: "5px 10px",
	fontSize: 12,
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
		<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
				<span style={{ color: c.muted, fontSize: 13 }}>to</span>
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
			<div style={{ fontSize: 12, color: c.muted }}>
				Decades pick a consecutive span. Same year both sides = exact.
			</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
		<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					flexWrap: "wrap",
				}}
			>
				<input
					key={`from-${from}`}
					className="mf-field"
					style={{ ...fieldLayout, width: 124 }}
					placeholder={`From ${oldest}`}
					defaultValue={from}
					disabled={disabled}
					onBlur={(e) =>
						onChange(deriveLiked(e.target.value, to, false, oldest))
					}
					aria-label="Liked from date"
				/>
				<span style={{ color: c.muted, fontSize: 13 }}>to</span>
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
							style={{ ...fieldLayout, width: 124 }}
							placeholder={`To ${today}`}
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
			<div style={{ fontSize: 12, color: c.muted }}>
				{todayPinned
					? `↻ Rolling — keeps counting likes up to today (${today}) as the date moves forward.`
					: `Your first like was ${oldest}.`}
			</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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

function OptionsStateNotice({ state }: { state: "loading" | "error" }) {
	// role="status" (implicit aria-live="polite") so the loading→ready/error
	// transition is announced while the editor is open.
	return (
		<p role="status" style={{ fontSize: 11, color: c.muted, margin: 0 }}>
			{state === "loading"
				? "Loading filter options…"
				: "Filter options unavailable."}
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
	const [revealed, setRevealed] = useState<Set<FacetKey>>(() => new Set());

	// Value-editing is frozen while options aren't ready or a save is in flight;
	// removal only freezes during a save (§7).
	const editFrozen = optionsState !== "ready" || isSaving;

	const toggle = (k: FacetKey, active: boolean) => {
		const closing = open === k;
		setOpen((cur) => (cur === k ? null : k));
		// A facet revealed for editing but never given a value folds back into the
		// Add row once its editor closes.
		if (closing && !active) {
			setRevealed((s) => {
				const n = new Set(s);
				n.delete(k);
				return n;
			});
		}
	};

	const reveal = (k: FacetKey) => {
		setRevealed((s) => new Set(s).add(k));
		setOpen(k);
	};

	const clearFacet = (k: FacetKey) => {
		const next = { ...filters };
		if (k === "language") delete next.languages;
		if (k === "vocals") delete next.vocalGender;
		if (k === "era") delete next.releaseYear;
		if (k === "liked") delete next.likedAt;
		onFiltersChange(next);
		// Drop a just-revealed-but-now-empty facet back into the Add row.
		setRevealed((s) => {
			const n = new Set(s);
			n.delete(k);
			return n;
		});
		if (open === k) setOpen(null);
	};

	const facets: Array<{
		key: FacetKey;
		label: string;
		icon: FacetIcon;
		value: string | null;
		editor: ReactNode;
	}> = [
		{
			key: "language",
			label: "Language",
			icon: FACET_ICON.language,
			value: languageSummary(filters.languages?.codes, languageLabel),
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
	// Active facets (and any facet currently being added) show as rows; the rest
	// live in the named Add row below.
	const visible = facets.filter(
		(f) => f.value !== null || revealed.has(f.key) || open === f.key,
	);
	const addable = facets.filter(
		(f) => f.value === null && !revealed.has(f.key) && open !== f.key,
	);

	return (
		<div style={{ fontFamily: fonts.body }}>
			{/* Section eyebrow parallel to "Matching intent" / "Genres" (same Label
			    recipe), so the filters read as a peer section, not a stray block. */}
			<span
				className="text-[11px] font-medium uppercase tracking-[0.18em]"
				style={{
					display: "block",
					marginBottom: 10,
					color: "color-mix(in srgb, var(--t-text) 70%, var(--t-text-muted))",
				}}
			>
				Filters
			</span>
			{optionsState !== "ready" && <OptionsStateNotice state={optionsState} />}

			{visible.map((f) => (
				<FacetRow
					key={f.key}
					icon={f.icon}
					label={f.label}
					value={f.value}
					open={open === f.key}
					onToggle={() => toggle(f.key, f.value !== null)}
					onRemove={() => clearFacet(f.key)}
					removeDisabled={isSaving}
				>
					{f.editor}
				</FacetRow>
			))}

			{addable.length > 0 && (
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						alignItems: "center",
						gap: 8,
						marginTop: 14,
					}}
				>
					{addable.map((f) => (
						<button
							key={f.key}
							type="button"
							disabled={editFrozen}
							onClick={() => reveal(f.key)}
							aria-label={`Add ${f.label} filter`}
							className="mf-add"
						>
							<Icon icon={f.icon} active={false} />
							{f.label}
						</button>
					))}
				</div>
			)}

			{activeCount > 0 && (
				<button
					type="button"
					disabled={isSaving}
					onClick={() => {
						onFiltersChange({ version: 1 });
						// Clearing the model must also drop the view state derived from
						// it, otherwise just-cleared facets linger as empty "Any" rows
						// instead of folding back into the Add chips.
						setRevealed(new Set());
						setOpen(null);
					}}
					style={{
						marginTop: 12,
						padding: 0,
						background: "transparent",
						border: "none",
						color: c.muted,
						fontSize: 12,
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
