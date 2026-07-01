import { Fragment, memo } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { MatchViewMode } from "../types";

const MODES: { value: MatchViewMode; label: string }[] = [
	{ value: "playlist", label: "Playlist" },
	{ value: "song", label: "Song" },
];

export interface MatchModeToggleProps {
	/** Current UI view mode — drives which button has aria-pressed="true". */
	mode: MatchViewMode;
	/** Disables both buttons during pending navigation or actions. */
	disabled?: boolean;
	/** Called when the user activates the non-current mode; the current mode is a no-op. */
	onModeChange: (mode: MatchViewMode) => void;
}

/**
 * Song/Playlist orientation toggle. Extracted from MatchingHeader so every
 * match surface — the ready card header, the unavailable/error cards, and the
 * empty state — shares one accessible control, so a user can never get stranded
 * in one orientation on a non-ready screen (A2).
 */
export const MatchModeToggle = memo(function MatchModeToggle({
	mode,
	disabled = false,
	onModeChange,
}: MatchModeToggleProps) {
	return (
		// aria-pressed on each button (not tablist/tab) because selecting a mode
		// triggers a navigation rather than switching a visible panel in-place.
		// biome-ignore lint/a11y/useSemanticElements: navigation toggle, not a form-control group; aria-pressed buttons with a group label is the correct pattern
		<div
			role="group"
			aria-label="View mode"
			className="flex items-baseline gap-3 self-end"
		>
			{MODES.map(({ value, label }, index) => {
				const isSelected = mode === value;
				// One opacity utility per state — emitting two (e.g. a base opacity plus
				// the disabled override) makes the winner depend on stylesheet order
				// rather than this array's order.
				const stateClasses = disabled
					? "theme-text-muted opacity-40 cursor-not-allowed"
					: isSelected
						? "theme-text opacity-100"
						: "theme-text-muted opacity-60 hover:opacity-90 cursor-pointer";
				return (
					<Fragment key={value}>
						{index > 0 && (
							<span
								aria-hidden="true"
								className="theme-text-muted text-xl font-extralight leading-none opacity-40"
								style={{ fontFamily: fonts.display }}
							>
								/
							</span>
						)}
						<button
							type="button"
							aria-pressed={isSelected}
							disabled={disabled}
							onClick={() => {
								// Guard: never navigate when mode is already current (A3).
								if (isSelected) return;
								onModeChange(value);
							}}
							className={[
								"py-1 text-2xl font-extralight leading-none transition-[opacity,color] duration-150 ease-out",
								stateClasses,
							].join(" ")}
							style={{ fontFamily: fonts.display }}
						>
							{label}
						</button>
					</Fragment>
				);
			})}
		</div>
	);
});
