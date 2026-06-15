import { fonts } from "@/lib/theme/fonts";
import { Cover } from "./Cover";
import { TargetToggle } from "./TargetToggle";
import type { PlaylistSummary } from "./types";

// Fluid title sized in container-query units so it tracks the title column's own
// width, not the viewport (the column lives inside a sub-viewport panel, so vw
// would compute the wrong size). Each tier's middle term is the slope-intercept
// line through two anchors — minSize at a ~220px column (panel at its 520 floor)
// and maxSize at a ~430px column (panel at its 760 ceiling), the column's real
// travel after the cover, gaps and padding are subtracted. Computing the slope
// this way (≈12cqi for short names, not a gentle 8) is what makes the title
// visibly grow with the panel instead of sitting pinned near its min. Longer
// names step the whole line down so they wrap to a sane height rather than
// shrinking to nothing.
function titleSize(name: string): string {
	const n = name.length;
	if (n > 90) return "clamp(1.2rem, calc(0.57rem + 4.6cqi), 1.8rem)";
	if (n > 60) return "clamp(1.35rem, calc(0.56rem + 5.7cqi), 2.1rem)";
	if (n > 36) return "clamp(1.5rem, calc(0.45rem + 7.6cqi), 2.5rem)";
	if (n > 20) return "clamp(1.7rem, calc(0.34rem + 9.9cqi), 3rem)";
	return "clamp(1.9rem, calc(0.22rem + 12.2cqi), 3.5rem)";
}

interface SpotlightHeroProps {
	playlist: PlaylistSummary;
	onToggleTarget: () => void;
}

/**
 * The Spotlight masthead: cover beside title on a hue-tinted band a clear tonal step
 * darker than the panel bg, so it reads as a distinct zone — value, not faint tint,
 * is what registers in this low-chroma palette. The body sits lighter below, giving
 * top-to-bottom hierarchy without borders or cards. The redundant membership kicker
 * is gone (the toggle states it). The band bleeds to the panel edges via negative
 * margins matching its padding.
 */
export function SpotlightHero({
	playlist,
	onToggleTarget,
}: SpotlightHeroProps) {
	return (
		<div
			className="-mx-5 -mt-[30px] mb-0 flex flex-col items-start gap-5 px-5 pt-9 pb-8 md:-mx-10 md:-mt-[34px] md:flex-row md:items-center md:gap-8 md:px-10 md:pr-20"
			style={{
				background:
					"color-mix(in srgb, var(--t-primary) 12%, var(--t-surface-dim))",
			}}
		>
			<div className="aspect-square w-full max-w-[260px] mx-auto flex-none md:mx-0 md:w-[clamp(150px,16vw,184px)] md:max-w-none">
				<Cover
					src={playlist.imageUrl}
					size="fill"
					style={{
						boxShadow:
							"0 12px 30px -18px color-mix(in srgb, var(--t-text) 42%, transparent), inset 0 0 0 1px rgba(0,0,0,0.08)",
					}}
				/>
			</div>
			<div className="@container flex w-full min-w-0 flex-1 flex-col items-center gap-5 md:w-auto md:max-w-[34rem] md:items-start">
				<h2
					className="theme-text text-center leading-[1.04] font-extralight tracking-tight text-balance break-words md:text-left"
					style={{
						fontFamily: fonts.display,
						fontSize: titleSize(playlist.name),
					}}
				>
					{playlist.name}
				</h2>
				<div>
					<TargetToggle
						isTarget={playlist.isTarget}
						onToggle={onToggleTarget}
					/>
				</div>
			</div>
		</div>
	);
}
