import { type ReactNode, useEffect, useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { AdvancedFiltersTrigger } from "./AdvancedFiltersTrigger";
import "../playlist-explorations.css";

/**
 * Counts the number of visible active chips, matching the "active count" definition
 * from decisions §7: one chip per language code + one each for releaseYear, likedAt,
 * vocalGender. Includes an unsaved detector-filled vocals chip.
 */
function countActiveChips(filters: PlaylistMatchFiltersV1): number {
	let count = 0;
	count += filters.languages?.codes.length ?? 0;
	if (filters.releaseYear !== undefined) count += 1;
	if (filters.likedAt !== undefined) count += 1;
	if (filters.vocalGender !== undefined) count += 1;
	return count;
}

interface AdvancedFiltersPanelProps {
	filters: PlaylistMatchFiltersV1;
	onFiltersChange: (next: PlaylistMatchFiltersV1) => void;

	/**
	 * Slot for CMHF-04: the Language and Vocals controls.
	 * Will be populated by CMHF-04 and passed in here.
	 */
	languageVocalsControlsSlot?: ReactNode;

	/**
	 * Slot for CMHF-05: the Release year and Liked date controls.
	 * Will be populated by CMHF-05 and passed in here.
	 */
	yearDateControlsSlot?: ReactNode;
}

// Stable ids for the ARIA disclosure association — trigger labels the region,
// region is controlled by the trigger. Module-level so they never change between
// renders, satisfying the aria-controls contract without useId.
const TRIGGER_ID = "advanced-filters-trigger";
const REGION_ID = "advanced-filters-region";

/**
 * The Advanced filters shell: trigger + active-chip row + collapsible content
 * area with clearly-named slots for CMHF-04 (language/vocals) and CMHF-05
 * (year/date) controls. Chips are always interactive in edit context — removal
 * mutates the filters draft immediately.
 *
 * Open-state rule (decisions §7):
 * - Starts open when any saved/draft filters exist.
 * - Once opened in an edit session, stays open even if the last filter is cleared.
 * - Starts collapsed only when there are no active filters at all.
 */
export function AdvancedFiltersPanel({
	filters,
	onFiltersChange,
	languageVocalsControlsSlot,
	yearDateControlsSlot,
}: AdvancedFiltersPanelProps) {
	const activeCount = countActiveChips(filters);

	// Starts open when any filter is active; once open, stays open for the session.
	const [isOpen, setIsOpen] = useState(() => activeCount > 0);
	// Tracks whether the panel has ever been opened in this edit session. Once true,
	// auto-open effects no longer fire (they already did their job) and filter-clearing
	// can never close it — that "stays open" invariant only blocks auto-close, not the
	// user's explicit collapse action via the trigger.
	const [hasOpenedOnce, setHasOpenedOnce] = useState(() => activeCount > 0);

	// Auto-open (once) when activeCount goes >0 from outside — e.g. a detector fills
	// a vocals chip. This satisfies decisions §7 without closing on subsequent clears.
	useEffect(() => {
		if (activeCount > 0 && !hasOpenedOnce) {
			setIsOpen(true);
			setHasOpenedOnce(true);
		}
	}, [activeCount, hasOpenedOnce]);

	const handleToggle = () => {
		// The trigger is a real disclosure toggle: user can open AND close it.
		// Filter-clearing never reaches here — it only mutates `filters`, not this
		// state — so the "stays open even if last filter cleared" rule is automatically
		// satisfied without any guard here.
		setIsOpen((prev) => {
			const next = !prev;
			if (next) setHasOpenedOnce(true);
			return next;
		});
	};

	const removeLanguage = (code: string) => {
		const remaining = filters.languages?.codes.filter((c) => c !== code) ?? [];
		// Omit languages entirely when the last code is removed.
		const { languages: _dropped, ...rest } = filters;
		if (remaining.length === 0) {
			onFiltersChange({ ...rest });
		} else {
			onFiltersChange({ ...filters, languages: { codes: remaining } });
		}
	};

	const removeReleaseYear = () => {
		const { releaseYear: _dropped, ...rest } = filters;
		onFiltersChange({ ...rest });
	};

	const removeLikedAt = () => {
		const { likedAt: _dropped, ...rest } = filters;
		onFiltersChange({ ...rest });
	};

	const removeVocalGender = () => {
		const { vocalGender: _dropped, ...rest } = filters;
		onFiltersChange({ ...rest });
	};

	return (
		<div className="flex flex-col gap-2">
			<AdvancedFiltersTrigger
				id={TRIGGER_ID}
				controlsId={REGION_ID}
				isOpen={isOpen}
				activeCount={activeCount}
				onToggle={handleToggle}
			/>

			{/* Active chips always visible outside the collapsible area so they serve
			    as source-of-truth in collapsed state. In collapsed+no-filter state this
			    renders null (ActiveFilterChips returns null when hasAny is false). */}
			{!isOpen && (
				<ActiveFilterChips
					filters={filters}
					onRemoveLanguage={removeLanguage}
					onRemoveReleaseYear={removeReleaseYear}
					onRemoveLikedAt={removeLikedAt}
					onRemoveVocalGender={removeVocalGender}
				/>
			)}

			{/* Collapsible body — grid-rows 0fr→1fr avoids a magic max-height and
			    lets the content animate to its natural height, matching the pattern
			    used in SpotlightPanel for the writing-surface band. */}
			<section
				id={REGION_ID}
				aria-labelledby={TRIGGER_ID}
				className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
				style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
			>
				<div className="min-h-0 overflow-hidden" inert={!isOpen}>
					<div className="flex flex-col gap-4 pt-1 pb-1">
						{/* Active chips inside the expanded panel so removals are in context
						    with the controls that produced them. */}
						<ActiveFilterChips
							filters={filters}
							onRemoveLanguage={removeLanguage}
							onRemoveReleaseYear={removeReleaseYear}
							onRemoveLikedAt={removeLikedAt}
							onRemoveVocalGender={removeVocalGender}
						/>

						{/*
						 * CMHF-04 slot — Language picker + Vocals control.
						 * CMHF-04 will render a searchable multi-select for languages
						 * and a Female/Male radio-style control for vocalGender.
						 * Props contract CMHF-04 should expect from the parent:
						 *   filters: PlaylistMatchFiltersV1
						 *   onFiltersChange: (next: PlaylistMatchFiltersV1) => void
						 */}
						{languageVocalsControlsSlot ?? (
							<ControlSlotPlaceholder label="Language + Vocals (CMHF-04)" />
						)}

						{/*
						 * CMHF-05 slot — Release year + Liked date controls.
						 * CMHF-05 will render mode-aware year/date pickers.
						 * Props contract CMHF-05 should expect from the parent:
						 *   filters: PlaylistMatchFiltersV1
						 *   onFiltersChange: (next: PlaylistMatchFiltersV1) => void
						 */}
						{yearDateControlsSlot ?? (
							<ControlSlotPlaceholder label="Release year + Liked date (CMHF-05)" />
						)}
					</div>
				</div>
			</section>
		</div>
	);
}

/** Visible placeholder so CMHF-04/05 plug-in points are obvious in Ladle review. */
function ControlSlotPlaceholder({ label }: { label: string }) {
	return (
		<div
			className="flex items-center justify-center border px-4 py-5 theme-border-color"
			style={{
				borderStyle: "dashed",
				borderColor: "color-mix(in srgb, var(--t-text) 20%, transparent)",
			}}
		>
			<span
				className="text-[11px] tracking-[0.1em] uppercase theme-text-muted"
				style={{ fontFamily: fonts.body }}
			>
				{label}
			</span>
		</div>
	);
}
