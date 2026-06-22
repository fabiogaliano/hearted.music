import { XIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";

// A chosen genre is a solid accent pill. In this low-chroma palette a faint tint
// reads as grey, so value contrast (dark fill, light text) is the only thing that
// registers — it sets a chosen genre apart from the page and from the outline
// suggestions in the picker. Mirrors the primary-action button's materiality.
const chipStyle: CSSProperties = {
	color: "var(--t-text-on-primary)",
	backgroundColor: "var(--t-primary)",
	fontFamily: fonts.body,
};

interface GenreChipProps {
	children: ReactNode;
	/** When set, the chip shows a remove control and reads as interactive. */
	onRemove?: () => void;
	/** Accessible label for the remove control; defaults to a string child. */
	removeLabel?: string;
	/** Play the scale+blur enter on mount — for chips added during a session. */
	enter?: boolean;
}

/** A chosen genre, as a solid accent pill. Pass `onRemove` for the editable form. */
export function GenreChip({
	children,
	onRemove,
	removeLabel,
	enter,
}: GenreChipProps) {
	const label =
		removeLabel ?? (typeof children === "string" ? children : "genre");
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap ${enter ? "xpl-chip-enter" : ""}`}
			style={chipStyle}
		>
			{children}
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove ${label}`}
					className="-mr-1 grid size-[18px] cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 opacity-70 transition-opacity duration-150 ease hover:opacity-100"
					style={{ color: "inherit" }}
				>
					<XIcon size={11} weight="bold" aria-hidden />
				</button>
			)}
		</span>
	);
}
