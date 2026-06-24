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

import { LockSimpleIcon } from "@phosphor-icons/react";
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
		<div className="flex flex-col gap-3">
			{/*
			 * Disabled textarea as the teaser — §4: show then lock, never blur.
			 * A real <textarea disabled> correctly signals non-interactivity to both
			 * the a11y tree and browser UA styles without needing ARIA role hacks.
			 * aria-describedby explains the premium requirement to screen readers.
			 */}
			<textarea
				disabled
				aria-label="Playlist intent"
				aria-describedby={LOCKED_DESC_ID}
				value={PLACEHOLDER_EXAMPLES[0]}
				readOnly
				rows={1}
				className="theme-text-muted theme-border-color w-full resize-none appearance-none border-b bg-transparent pb-2 text-sm leading-relaxed outline-none opacity-50"
				style={{
					fontFamily: fonts.body,
					minHeight: "3.5rem",
				}}
			/>
			<p id={LOCKED_DESC_ID} className="sr-only">
				Describing the vibe in your own words is available with Backstage Pass.
			</p>
			<button
				type="button"
				onClick={onOpenPaywall}
				aria-describedby={LOCKED_DESC_ID}
				className="inline-flex items-center gap-1.5 self-start text-left"
				style={{ fontFamily: fonts.body }}
			>
				<LockSimpleIcon
					size={11}
					weight="regular"
					aria-hidden
					style={{ color: "var(--t-text-muted)", flexShrink: 0 }}
				/>
				<span className="theme-text-muted text-xs leading-snug underline underline-offset-2 transition-opacity duration-150 hover:opacity-70">
					Describe the vibe in your own words — available with Backstage Pass
				</span>
			</button>
		</div>
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
