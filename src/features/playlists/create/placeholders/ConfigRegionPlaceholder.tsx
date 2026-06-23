/**
 * ConfigRegionPlaceholder — seam for T5.
 *
 * T5 will replace this with GenrePillsPicker, MatchFiltersFieldList, and the
 * IntentEditor (premium locked teaser). The placeholder preserves the column
 * space and documents the seam clearly.
 */

import { fonts } from "@/lib/theme/fonts";

export function ConfigRegionPlaceholder() {
	return (
		<div
			className="theme-border-color flex min-h-[120px] flex-col justify-center gap-2 border border-dashed px-4 py-6"
			style={{ opacity: 0.4 }}
			aria-hidden="true"
		>
			<p
				className="theme-text-muted text-[11px] tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				T5 — Intent editor + genre pills + filters
			</p>
			<p
				className="theme-text-muted text-xs"
				style={{ fontFamily: fonts.body }}
			>
				GenrePillsPicker, MatchFiltersFieldList, IntentEditor (locked teaser for
				free tier)
			</p>
		</div>
	);
}
