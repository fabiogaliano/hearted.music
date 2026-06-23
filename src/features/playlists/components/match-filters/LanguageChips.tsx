import { XIcon } from "@phosphor-icons/react";
import { languageLabel } from "@/lib/domains/taste/match-filters/languages";

interface LanguageChipsProps {
	selectedCodes: string[];
	/** Freeze removal while a save is in flight so a removal can't be lost. */
	isSaving: boolean;
	onRemove: (code: string) => void;
}

/**
 * The selected-language chips — rendered as a sibling of the trigger (not nested
 * inside it) so the browser doesn't suppress their pointer-events via
 * disabled-button inheritance (decisions §7).
 */
export function LanguageChips({
	selectedCodes,
	isSaving,
	onRemove,
}: LanguageChipsProps) {
	if (selectedCodes.length === 0) return null;
	return (
		<ul
			className="m-0 list-none flex flex-wrap gap-1 p-0 mb-1.5"
			aria-label="Selected languages"
		>
			{selectedCodes.map((code) => (
				<li key={code}>
					<span className="mf-lang-chip xpl-chip-enter">
						<span className="text-[11px] leading-none tracking-[0.04em]">
							{languageLabel(code)}
						</span>
						<button
							type="button"
							onClick={() => onRemove(code)}
							disabled={isSaving}
							aria-label={`Remove ${languageLabel(code)} language`}
							className="mf-lang-chip-x"
						>
							<XIcon size={10} weight="bold" aria-hidden />
						</button>
					</span>
				</li>
			))}
		</ul>
	);
}
