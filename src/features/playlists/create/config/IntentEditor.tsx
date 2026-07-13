/**
 * IntentEditor — natural-language playlist intent input.
 *
 * Two states driven by `isEligible`:
 *   - Eligible: a live textarea wired to the draft hook's setIntent.
 *   - Ineligible: a "show then lock" teaser per conceptualization §4 — the
 *     field is visible and muted but not blurred or broken-looking; a lock
 *     icon and benefit-first CTA route to the upgrade dialog. It never blocks
 *     the rest of the creation flow.
 *
 * Autosizes to content so it never shows a scroll bar for a short phrase;
 * the draft hook debounces changes before they hit the preview query.
 */

import { ArrowUpRightIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { fonts } from "@/lib/theme/fonts";

const INTENT_MAX_CHARS = 5000;

const PLACEHOLDER_EXAMPLES = [
	"Late-night drive through an empty city",
	"Sunday morning with coffee and no plans",
	"Bittersweet nostalgia for the early 2010s",
	"Focused deep work — no words, slow build",
];

const PLACEHOLDER = PLACEHOLDER_EXAMPLES.join(" · ");

const LOCKED_DESC_ID = "intent-locked-desc";

interface IntentEditorEligibleProps {
	value: string | undefined;
	onChange: (next: string | undefined) => void;
}

function IntentEditorEligible({ value, onChange }: IntentEditorEligibleProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const autosize = useCallback(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: value drives the re-measure; autosize reads the textarea via ref
	useLayoutEffect(() => {
		autosize();
	}, [value, autosize]);

	return (
		<textarea
			ref={textareaRef}
			value={value ?? ""}
			onChange={(e) => {
				const next = e.target.value;
				onChange(next === "" ? undefined : next);
			}}
			maxLength={INTENT_MAX_CHARS}
			rows={1}
			placeholder={PLACEHOLDER}
			aria-label="Playlist intent"
			className="theme-text w-full resize-none appearance-none bg-transparent text-sm leading-relaxed outline-none placeholder:opacity-30"
			style={{
				fontFamily: fonts.body,
				minHeight: "3.5rem",
			}}
		/>
	);
}

interface IntentEditorLockedProps {
	onOpenPaywall: () => void;
}

function IntentEditorLocked({ onOpenPaywall }: IntentEditorLockedProps) {
	return (
		<>
			{/*
			 * Collapsed locked state — a single field-shaped teaser instead of a
			 * disabled textarea stacked over a CTA row. The bordered box reads as a
			 * real input (muted example on the left, lock + UNLOCK affordance on the
			 * right); the whole box is the paywall trigger. aria-describedby carries
			 * the premium requirement to screen readers.
			 *
			 * The two triggers share one `group` so hovering either lights both up
			 * as a single affordance rather than two independent hover states.
			 */}
			<div className="group flex flex-col gap-1.5">
				<button
					type="button"
					onClick={onOpenPaywall}
					aria-describedby={LOCKED_DESC_ID}
					className="theme-border-color flex w-full cursor-pointer items-center gap-3 border px-4 py-3 text-left transition-colors duration-150 group-hover:border-[var(--t-text-muted)]"
					style={{ fontFamily: fonts.body }}
				>
					<span className="theme-text-muted min-w-0 flex-1 truncate text-sm leading-relaxed opacity-50">
						{PLACEHOLDER_EXAMPLES[0]}
					</span>
					<span className="theme-text-muted inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-opacity duration-150 group-hover:opacity-70">
						<LockSimpleIcon size={12} weight="regular" aria-hidden />
						Unlock
					</span>
				</button>

				<button
					type="button"
					onClick={onOpenPaywall}
					aria-describedby={LOCKED_DESC_ID}
					className="inline-flex cursor-pointer items-center gap-1 self-start text-xs leading-snug transition-opacity duration-150 group-hover:opacity-70"
					style={{ fontFamily: fonts.body }}
				>
					<span className="theme-text-muted">
						Available with Backstage Pass —
					</span>
					<span
						className="theme-text italic"
						style={{ fontFamily: fonts.display }}
					>
						Upgrade
					</span>
					<ArrowUpRightIcon
						size={12}
						weight="regular"
						aria-hidden
						style={{ color: "var(--t-text)", flexShrink: 0 }}
					/>
				</button>
			</div>

			<p id={LOCKED_DESC_ID} className="sr-only">
				Describing the vibe in your own words is available with Backstage Pass.
			</p>
		</>
	);
}

export interface IntentEditorProps {
	/** Whether the account is eligible to use the intent field. */
	isEligible: boolean;
	value: string | undefined;
	onChange: (next: string | undefined) => void;
	/** Opens the upgrade/paywall dialog. Called only for ineligible users. */
	onOpenPaywall: () => void;
}

export function IntentEditor({
	isEligible,
	value,
	onChange,
	onOpenPaywall,
}: IntentEditorProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<span
				className="theme-text-muted block text-[11px] font-medium uppercase tracking-[0.18em]"
				style={{ fontFamily: fonts.body }}
			>
				Vibe
			</span>

			{isEligible ? (
				<IntentEditorEligible value={value} onChange={onChange} />
			) : (
				<IntentEditorLocked onOpenPaywall={onOpenPaywall} />
			)}
		</div>
	);
}
