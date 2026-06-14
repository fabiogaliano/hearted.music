import type { CSSProperties, ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";

// color-mix needs the literal var, so the accent tint is inline rather than a
// theme-* utility. Mirrors the picker's selected-chip treatment.
const chipStyle: CSSProperties = {
	color: "var(--t-primary)",
	borderColor: "color-mix(in srgb, var(--t-primary) 32%, transparent)",
	backgroundColor: "color-mix(in srgb, var(--t-primary) 9%, transparent)",
	fontFamily: fonts.body,
};

/** A read-only genre tag. The editable chips live in GenrePicker. */
export function GenreChip({ children }: { children: ReactNode }) {
	return (
		<span
			className="inline-flex items-center rounded-full border px-3 py-1 text-xs whitespace-nowrap"
			style={chipStyle}
		>
			{children}
		</span>
	);
}
