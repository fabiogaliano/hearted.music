/**
 * MaxSongsSlider — polished native range input for the playlist creation page.
 *
 * Uses a native <input type="range"> styled with CSS rather than a Radix
 * component (flat/bordered materiality, no Radix). Full keyboard support
 * (arrows ±step, Home/End → min/max, PageUp/Down → ±2 steps) is handled via
 * onKeyDown because native range already handles arrows but we extend it for
 * Page/Home/End which are not universally supported across browsers.
 *
 * The aria-valuetext includes the approximate duration so screen readers
 * announce "15 songs, about 50 minutes" instead of a raw number.
 */

import { useId } from "react";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";

export const MAX_SONGS_MIN = 5;
export const MAX_SONGS_MAX = 50;
export const MAX_SONGS_STEP = 5;
export const MAX_SONGS_DEFAULT = 15;

// Average track duration used for the duration hint (≈ 3.3 min per song).
const AVG_DURATION_MIN = 3.3;

interface MaxSongsSliderProps {
	value: number;
	onChange: (value: number) => void;
	className?: string;
}

/** Clamp and snap `value` to the nearest valid step. */
export function clampAndStep(
	value: number,
	min: number,
	max: number,
	step: number,
): number {
	const clamped = Math.max(min, Math.min(max, value));
	return Math.round(clamped / step) * step;
}

/** Returns "about N minutes" for a given song count. */
export function approximateDuration(songCount: number): string {
	const totalMin = Math.round(songCount * AVG_DURATION_MIN);
	return `about ${totalMin} minutes`;
}

export function MaxSongsSlider({
	value,
	onChange,
	className,
}: MaxSongsSliderProps) {
	const inputId = useId();
	const labelId = useId();

	const percentage =
		((value - MAX_SONGS_MIN) / (MAX_SONGS_MAX - MAX_SONGS_MIN)) * 100;

	function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
		const next = clampAndStep(
			Number(event.target.value),
			MAX_SONGS_MIN,
			MAX_SONGS_MAX,
			MAX_SONGS_STEP,
		);
		if (next !== value) onChange(next);
	}

	// Extend browser keyboard handling: Home/End → min/max, PageUp/Down → ±2
	// steps. Arrows (±1 step) are handled natively by the input.
	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		let next: number | null = null;
		switch (event.key) {
			case "Home":
				next = MAX_SONGS_MIN;
				break;
			case "End":
				next = MAX_SONGS_MAX;
				break;
			case "PageUp":
				next = clampAndStep(
					value + MAX_SONGS_STEP * 2,
					MAX_SONGS_MIN,
					MAX_SONGS_MAX,
					MAX_SONGS_STEP,
				);
				break;
			case "PageDown":
				next = clampAndStep(
					value - MAX_SONGS_STEP * 2,
					MAX_SONGS_MIN,
					MAX_SONGS_MAX,
					MAX_SONGS_STEP,
				);
				break;
			default:
				return;
		}
		event.preventDefault();
		if (next !== null && next !== value) onChange(next);
	}

	const durationHint = approximateDuration(value);
	const ariaValueText = `${value} songs, ${durationHint}`;

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			<div className="flex items-baseline justify-between gap-4">
				<label
					id={labelId}
					htmlFor={inputId}
					className="theme-text-muted text-xs tracking-[0.2em] uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Songs
				</label>
				<div className="flex items-baseline gap-2" aria-hidden="true">
					<span
						className="theme-text text-2xl font-extralight tabular-nums leading-none"
						style={{ fontFamily: fonts.display }}
					>
						{value}
					</span>
					<span
						className="theme-text-muted text-xs"
						style={{ fontFamily: fonts.body }}
					>
						{durationHint}
					</span>
				</div>
			</div>

			{/* Track + thumb wrapper. The --pct custom property drives the fill via
			    a linear-gradient background so the track shows how much is selected
			    without JS measurement. */}
			<div className="relative py-2">
				<input
					id={inputId}
					type="range"
					min={MAX_SONGS_MIN}
					max={MAX_SONGS_MAX}
					step={MAX_SONGS_STEP}
					value={value}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					aria-labelledby={labelId}
					aria-valuemin={MAX_SONGS_MIN}
					aria-valuemax={MAX_SONGS_MAX}
					aria-valuenow={value}
					aria-valuetext={ariaValueText}
					className="max-songs-slider w-full cursor-pointer appearance-none bg-transparent"
					style={
						{
							"--pct": `${percentage}%`,
						} as React.CSSProperties
					}
				/>
			</div>

			{/* Min/max labels */}
			<div className="flex items-center justify-between" aria-hidden="true">
				<span
					className="theme-text-muted text-[11px] tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{MAX_SONGS_MIN}
				</span>
				<span
					className="theme-text-muted text-[11px] tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{MAX_SONGS_MAX}
				</span>
			</div>
		</div>
	);
}
