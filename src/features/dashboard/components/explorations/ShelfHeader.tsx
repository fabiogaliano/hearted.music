import { ArrowRightIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";

interface ShelfHeaderProps {
	label: string;
	count: number;
	/** Trailing verb, kept short — the label + live count carry the scent. */
	action?: string;
	onOpen: () => void;
}

/** A shelf header IS the neutral "browse" entry the sidebar used to provide:
 * section label + live count, whole line pressable. */
export function ShelfHeader({
	label,
	count,
	action = "Browse",
	onOpen,
}: ShelfHeaderProps) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="focus-edge group mb-4 flex w-full items-baseline justify-between py-1"
		>
			<span
				className="theme-text-muted text-xs tracking-widest uppercase transition-colors duration-150 ease-out group-hover:text-(--t-text) motion-reduce:transition-none"
				style={{ fontFamily: fonts.body }}
			>
				{label}
				<span className="ml-2 tabular-nums normal-case">
					· {count.toLocaleString("en-US")}
				</span>
			</span>
			<span
				className="theme-text-muted inline-flex items-center gap-1.5 text-xs transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
				style={{ fontFamily: fonts.body }}
			>
				{action}
				<ArrowRightIcon size={12} weight="regular" />
			</span>
		</button>
	);
}
