/**
 * MatchFiltersSummary — active-filter summary for the collapsed (non-editing)
 * state under the intent/genres. Mirrors the field-list grammar: each active
 * facet shows its icon + plain-language value. When onEdit is provided the whole
 * summary is a tap target into the editor, matching the collapsed intent/genres
 * affordance; editing the values themselves still requires entering edit mode
 * (decisions §7 "Collapsed/non-editing state").
 *
 * The language value truncates to "A, B +N" — hovering it reveals the full list
 * in a small popover. That reveal is pointer-only (a span, not a focusable
 * trigger) so it stays valid nested inside the Edit-filters button; keyboard
 * users reach the full list by opening the editor, where every code is shown.
 */

import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { languageLabel } from "@/lib/domains/taste/match-filters/labels";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import {
	eraLabel,
	FACET_ICON,
	type FacetKey,
	languageSummary,
	likedLabel,
	vocalsLabel,
} from "./facet-helpers";

function SummaryIcon({ path }: { path: string }) {
	return (
		<svg
			width={14}
			height={14}
			viewBox="0 0 16 16"
			fill="none"
			stroke="var(--t-text-muted)"
			strokeWidth={1.4}
			strokeLinecap="round"
			strokeLinejoin="round"
			role="presentation"
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			<path d={path} />
		</svg>
	);
}

/**
 * Pointer-hover reveal for the truncated language value. Supplementary, so it
 * carries no focusable trigger and stays valid inside the Edit-filters button.
 * The card is portalled to <body> with fixed positioning so the drawer's and the
 * collapsing band's overflow-hidden can't clip it to a sliver at the band edge.
 */
function OverflowTip({ children, tip }: { children: ReactNode; tip: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const show = () => {
		const r = ref.current?.getBoundingClientRect();
		if (r) setPos({ top: r.bottom + 6, left: r.left });
	};
	return (
		<span
			ref={ref}
			className="inline-flex"
			onPointerEnter={show}
			onPointerLeave={() => setPos(null)}
		>
			{children}
			{pos &&
				createPortal(
					<span
						role="tooltip"
						className="theme-surface-bg theme-border-color block max-w-[16rem] border p-2.5 text-xs leading-snug text-pretty"
						style={{
							position: "fixed",
							top: pos.top,
							left: pos.left,
							zIndex: 60,
							fontFamily: fonts.body,
							color: "var(--t-text-muted)",
							boxShadow:
								"0 8px 24px -12px color-mix(in srgb, var(--t-text) 30%, transparent)",
						}}
					>
						{tip}
					</span>,
					document.body,
				)}
		</span>
	);
}

function Chip({
	icon,
	value,
	overflowAll,
}: {
	icon: string;
	value: string;
	/** Full comma-joined list, shown on hover when the value is truncated. */
	overflowAll?: string;
}) {
	const text = (
		<span
			className="text-xs theme-text"
			style={{ fontVariantNumeric: "tabular-nums" }}
		>
			{value}
		</span>
	);
	return (
		<span className="theme-border-color inline-flex items-center gap-1.5 rounded-full border bg-(--t-surface-dim) px-2.5 py-1 transition-colors duration-150 group-hover/filters:border-(--t-primary)">
			<SummaryIcon path={icon} />
			{overflowAll ? <OverflowTip tip={overflowAll}>{text}</OverflowTip> : text}
		</span>
	);
}

export function MatchFiltersSummary({
	filters,
	onEdit,
}: {
	filters: PlaylistMatchFiltersV1;
	/** Enter edit mode on click — mirrors the collapsed intent/genres affordance. */
	onEdit?: () => void;
}) {
	const items: Array<{
		key: FacetKey;
		icon: string;
		value: string;
		overflowAll?: string;
	}> = [];

	const codes = filters.languages?.codes;
	const langValue = languageSummary(codes, languageLabel);
	if (langValue && codes) {
		// Only attach the hover list when the value is actually truncated (>2 codes).
		const overflowAll =
			codes.length > 2 ? codes.map(languageLabel).join(", ") : undefined;
		items.push({
			key: "language",
			icon: FACET_ICON.language,
			value: langValue,
			overflowAll,
		});
	}
	if (filters.vocalGender) {
		items.push({
			key: "vocals",
			icon: FACET_ICON.vocals,
			value: vocalsLabel(filters.vocalGender),
		});
	}
	if (filters.releaseYear) {
		items.push({
			key: "era",
			icon: FACET_ICON.era,
			value: eraLabel(filters.releaseYear),
		});
	}
	if (filters.likedAt) {
		items.push({
			key: "liked",
			icon: FACET_ICON.liked,
			value: likedLabel(filters.likedAt),
		});
	}

	if (items.length === 0) return null;

	// Clickable summary: a single button wrapping the chips, like the collapsed
	// genres row. aria-label names the action; the chip values are decorative
	// inside it (the live source-of-truth values stay readable in the editor).
	if (onEdit) {
		return (
			<button
				type="button"
				onClick={onEdit}
				aria-label="Edit filters"
				className="group/filters flex w-fit cursor-pointer flex-wrap items-center gap-2 text-left"
				style={{ fontFamily: fonts.body }}
			>
				{items.map((item) => (
					<Chip
						key={item.key}
						icon={item.icon}
						value={item.value}
						overflowAll={item.overflowAll}
					/>
				))}
			</button>
		);
	}

	return (
		<ul
			className="m-0 flex list-none flex-wrap gap-2 p-0"
			aria-label="Active filters"
			style={{ fontFamily: fonts.body }}
		>
			{items.map((item) => (
				<li key={item.key}>
					<Chip
						icon={item.icon}
						value={item.value}
						overflowAll={item.overflowAll}
					/>
				</li>
			))}
		</ul>
	);
}
