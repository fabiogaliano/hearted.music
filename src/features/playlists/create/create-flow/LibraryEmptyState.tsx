/**
 * LibraryEmptyState — shown when totalEligible === 0.
 *
 * Two distinct sub-states surfaced via the `isWarming` flag:
 *  - warming: Phase-1 enrichment is still running after the lazy backfill
 *    triggered in the route loader. Nudge the user to wait a moment.
 *  - genuinely empty: The library has songs but none pass Phase-1 enrichment
 *    or the user has no liked songs at all. Nudge to like more songs or
 *    broaden filters.
 */

import { fonts } from "@/lib/theme/fonts";

interface LibraryEmptyStateProps {
	/**
	 * True when the Phase-1 enrichment backfill is still in progress and
	 * totalEligible === 0 because nothing has cleared enrichment yet.
	 * False (default) when the enrichment pass is done but matched nothing.
	 */
	isWarming?: boolean;
}

export function LibraryEmptyState({
	isWarming = false,
}: LibraryEmptyStateProps) {
	return (
		<div className="px-1 py-6" role="status" aria-live="polite">
			<p
				className="theme-text-muted text-sm"
				style={{ fontFamily: fonts.body }}
			>
				{isWarming ? (
					<>Still warming up your library&hellip;</>
				) : (
					<>No songs match the current filters.</>
				)}
			</p>
			<p
				className="theme-text-muted mt-1 text-xs"
				style={{ fontFamily: fonts.body, opacity: 0.7 }}
			>
				{isWarming
					? "hearted is preparing your library for the first time. Try again in a moment."
					: "Like more songs on Spotify, or broaden your genre and filter settings."}
			</p>
		</div>
	);
}
