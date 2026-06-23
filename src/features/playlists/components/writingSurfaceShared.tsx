import { fonts } from "@/lib/theme/fonts";

// Section eyebrows + the Edit affordance. Direction B moved the writing surface
// onto the lighter --t-surface plane, so the standard muted token clears 4.5:1
// easily — no need for the band-era 70%-ink boost. Matches every other section
// label in the app.
export const EYEBROW_COLOR = "var(--t-text-muted)";

/** The small uppercase section eyebrow, strong enough to read on the dark band. */
export function Label({ children }: { children: string }) {
	return (
		<span
			className="text-[11px] font-medium tracking-[0.18em] uppercase"
			style={{ fontFamily: fonts.body, color: EYEBROW_COLOR }}
		>
			{children}
		</span>
	);
}
