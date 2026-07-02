import { ListBulletsIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";

interface CoverPeekBadgeProps {
	/** Height in px; the glyph and count scale with it. Song rows use ~20, the
	 *  larger playlist review cover a little more — same badge, sized to context. */
	size?: number;
	/** Track count shown beside the glyph — a bare number in the compact song
	 *  badge, the full "N songs" on the roomier review cover. Omit for glyph-only. */
	label?: string;
	/** Extra classes, e.g. a hover fade for when a fuller reveal takes over. */
	className?: string;
}

/**
 * The shared "this cover opens its track list" signifier: a small frosted badge
 * pinned to the bottom-right of a cover, identical in song rows and the playlist
 * review cover so the same affordance reads the same everywhere.
 *
 * Built from theme tokens instead of a translucent scrim over the art, so it
 * stays equally noticeable on any album. The old text-tinted scrim was, by
 * definition, a near-neighbor of the cover's own colors — a dark scrim sank into
 * dark art. Here a near-opaque surface fill fixes the glyph's contrast (surface
 * vs text is the app's guaranteed contrast pair, independent of the cover), and
 * the edge is carried by a black drop shadow (reads on light art) plus a hairline
 * ring in --t-text (reads on dark art) — so the badge separates from anything.
 */
export function CoverPeekBadge({
	size = 20,
	label,
	className = "",
}: CoverPeekBadgeProps) {
	return (
		<span
			aria-hidden="true"
			className={`pointer-events-none absolute right-2 bottom-2 inline-flex items-center justify-center gap-1.5 rounded-md ${
				label ? "px-2" : ""
			} ${className}`}
			style={{
				height: size,
				width: label ? undefined : size,
				background: "color-mix(in srgb, var(--t-surface) 92%, transparent)",
				color: "var(--t-text)",
				backdropFilter: "blur(6px)",
				WebkitBackdropFilter: "blur(6px)",
				boxShadow:
					"0 2px 6px -1px rgba(0, 0, 0, 0.3), 0 0 0 0.5px color-mix(in srgb, var(--t-text) 20%, transparent)",
			}}
		>
			<ListBulletsIcon size={Math.round(size * 0.62)} weight="bold" />
			{label && (
				<span
					className="tracking-wide tabular-nums leading-none"
					style={{
						fontFamily: fonts.body,
						fontSize: Math.max(10, Math.round(size * 0.46)),
					}}
				>
					{label}
				</span>
			)}
		</span>
	);
}
