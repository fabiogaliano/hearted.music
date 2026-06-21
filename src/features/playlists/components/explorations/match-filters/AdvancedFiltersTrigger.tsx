import { CaretDownIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";

// Fixed color for the eyebrow/label row — matches WritingSurface's EYEBROW_COLOR.
const EYEBROW_COLOR =
	"color-mix(in srgb, var(--t-text) 70%, var(--t-text-muted))";

interface AdvancedFiltersTriggerProps {
	isOpen: boolean;
	/** Count of currently visible active chips, including unsaved detector fills. */
	activeCount: number;
	onToggle: () => void;
	/** id of the controlled region element — wires aria-controls for AT. */
	controlsId: string;
	/** id placed on this button so the region can reference it via aria-labelledby. */
	id: string;
}

/**
 * Collapsible trigger row for the Advanced filters subsection. Shows the label,
 * the active-chip count badge (when > 0), and a caret indicator. Keyboard-operable
 * via click, Enter, and Space — using a <button> gives Enter/Space for free.
 * aria-controls + aria-expanded wire the AT disclosure relationship to the region.
 *
 * Open state is controlled by AdvancedFiltersPanel which holds the session logic
 * per decisions §7.
 */
export function AdvancedFiltersTrigger({
	isOpen,
	activeCount,
	onToggle,
	controlsId,
	id,
}: AdvancedFiltersTriggerProps) {
	return (
		<button
			type="button"
			id={id}
			aria-expanded={isOpen}
			aria-controls={controlsId}
			onClick={onToggle}
			className="group flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left transition-[opacity] duration-150 hover:opacity-80"
		>
			<span
				className="text-[11px] font-medium tracking-[0.18em] uppercase"
				style={{ fontFamily: fonts.body, color: EYEBROW_COLOR }}
			>
				Advanced filters
			</span>

			{activeCount > 0 && (
				<>
					{/* Visual badge — hidden from AT; count is announced via the sr-only span below */}
					<span
						className="inline-flex items-center justify-center rounded-full bg-(--t-primary) px-1.5 min-w-[18px] h-[18px] text-[9px] font-medium leading-none tabular-nums theme-text-on-primary"
						style={{ fontFamily: fonts.body }}
						aria-hidden
					>
						{activeCount}
					</span>
					{/* Announces the filter count to screen readers without duplicating visual text */}
					<span className="sr-only">{activeCount} active</span>
				</>
			)}

			<span
				className="ml-auto transition-transform duration-200 ease-out motion-reduce:transition-none"
				style={{
					color: EYEBROW_COLOR,
					transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
				}}
			>
				<CaretDownIcon size={12} weight="bold" aria-hidden />
			</span>
		</button>
	);
}
