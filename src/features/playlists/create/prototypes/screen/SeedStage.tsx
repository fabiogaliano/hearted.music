/**
 * Prototype shared piece — the seeded landing beat ("What are we making?").
 *
 * Starting points are interactive TEMPLATES, not finished picks: each card
 * is a mad-lib whose blanks ("All things [indie]") open a popover listing
 * the profile-derived options — pick one, then tap the arrow to start from
 * the tuned result. A sparse library shows
 * fewer cards with fewer options; a brand-new one shows a growth note.
 * "From scratch" is a real card too, saying what the scratch is (the whole
 * library, with its count) instead of a bare link.
 *
 * The free-text intent is the premium capability: when the gate disallows
 * it, the row renders prod IntentEditor's "show then lock" treatment
 * (visible, muted, never blurred) with every unmet path spelled out — and
 * moves BELOW the templates, so a gated account's first element is a usable
 * path rather than a locked one (Peak-End: don't front-load the negative).
 * Templates stay usable either way — they're structured, not words.
 */

import { ArrowRightIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import {
	defaultSelection,
	formatGateHint,
	resolveTemplate,
} from "../seedPresets";
import type {
	IntentGateVM,
	PresetVM,
	SeedChoiceVM,
	SeedTemplateVM,
} from "../types";
import { SeedBlank } from "./SeedBlank";

interface SeedStageProps {
	/** Derived per-account templates; empty = brand-new library. */
	templates: SeedTemplateVM[];
	/** Library size, quoted by the from-scratch card so "scratch" means something. */
	totalLikedCount: number;
	/** Gate over the free-text intent. Templates are never gated. */
	intentGate: IntentGateVM;
	/** preset is null for "own words" / "from scratch"; intentText is the typed vibe ("" if none). */
	onSeed: (preset: PresetVM | null, intentText: string) => void;
}

export function IntentRowLocked({ gate }: { gate: IntentGateVM }) {
	return (
		<div className="mt-8 flex flex-col gap-2.5">
			<input
				type="text"
				disabled
				placeholder="Something for late-night drives…"
				aria-label="Playlist intent"
				aria-describedby="seed-intent-locked"
				className="theme-border-color theme-text w-full border-b bg-transparent px-1 py-2.5 text-base opacity-50 outline-none"
				style={{ fontFamily: fonts.body }}
			/>
			<p
				id="seed-intent-locked"
				className="theme-text-muted inline-flex items-center gap-1.5 text-xs leading-snug"
				style={{ fontFamily: fonts.body }}
			>
				<LockSimpleIcon size={11} weight="regular" aria-hidden />
				Or in your own words — available with {formatGateHint(gate)}
			</p>
		</div>
	);
}

export function IntentRow({
	onStart,
}: {
	onStart: (intentText: string) => void;
}) {
	const [intentText, setIntentText] = useState("");
	return (
		<div className="mt-8 flex items-center gap-3">
			<input
				type="text"
				value={intentText}
				onChange={(e) => setIntentText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onStart(intentText.trim());
				}}
				placeholder="Something for late-night drives…"
				aria-label="Playlist intent"
				className="theme-border-color theme-text min-w-0 flex-1 border-b bg-transparent px-1 py-2.5 text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
				style={{ fontFamily: fonts.body }}
			/>
			<Button
				variant="secondary"
				size="sm"
				onClick={() => onStart(intentText.trim())}
			>
				Start
			</Button>
		</div>
	);
}

function TemplateCard({
	template,
	onUse,
}: {
	template: SeedTemplateVM;
	onUse: (preset: PresetVM) => void;
}) {
	const [selection, setSelection] = useState<Record<string, SeedChoiceVM>>(() =>
		defaultSelection(template),
	);

	const resolved = resolveTemplate(template, selection);

	return (
		<div className="theme-border-color flex items-center justify-between gap-3 border px-4 py-3">
			<div className="min-w-0">
				<span
					className="theme-text block text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{template.parts.map((part, i) =>
						typeof part === "string" ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are a stable literal sequence
							<span key={i}>{part}</span>
						) : (
							<SeedBlank
								key={part.slot}
								value={selection[part.slot]?.label ?? "…"}
								options={template.slots[part.slot] ?? []}
								onPick={(choice) =>
									setSelection((prev) => ({ ...prev, [part.slot]: choice }))
								}
							/>
						),
					)}
				</span>
				<span
					className="theme-text-muted mt-0.5 block text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{template.describe(selection)}
				</span>
			</div>
			<button
				type="button"
				onClick={() => onUse(resolved)}
				aria-label={`Start from ${resolved.label}`}
				className="theme-text-muted flex flex-none cursor-pointer items-center justify-center transition-[color,transform] duration-150 hover:text-(--t-text) focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] motion-safe:hover:translate-x-0.5"
				style={{ minWidth: 44, minHeight: 44 }}
			>
				<ArrowRightIcon size={14} weight="regular" aria-hidden />
			</button>
		</div>
	);
}

export function SeedStage({
	templates,
	totalLikedCount,
	intentGate,
	onSeed,
}: SeedStageProps) {
	const templatesSection = (
		<div className={intentGate.allowed ? "mt-10" : "mt-8"}>
			<p
				className="theme-text-muted mb-3 text-[11px] tracking-[0.18em] uppercase"
				style={{ fontFamily: fonts.body }}
			>
				{intentGate.allowed ? "Or start from" : "Start from"}
			</p>
			{templates.length > 0 ? (
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{templates.map((template) => (
						<TemplateCard
							key={template.id}
							template={template}
							onUse={(preset) => onSeed(preset, "")}
						/>
					))}
				</div>
			) : (
				<p
					className="theme-text-muted max-w-[46ch] text-[13px] text-pretty"
					style={{ fontFamily: fonts.body }}
				>
					Starting points appear here as your library grows — hearted learns
					them from what you like.
				</p>
			)}

			{/* From scratch as a real card: name what the scratch is. */}
			<button
				type="button"
				onClick={() => onSeed(null, "")}
				className="theme-border-color hover-border-brighten mt-2 flex w-full cursor-pointer items-center justify-between gap-3 border border-dashed px-4 py-3 text-left transition-[background-color] duration-150 active:scale-[0.995]"
			>
				<span className="min-w-0">
					<span
						className="theme-text block text-sm"
						style={{ fontFamily: fonts.body }}
					>
						From your whole library
					</span>
					<span
						className="theme-text-muted mt-0.5 block text-xs"
						style={{ fontFamily: fonts.body }}
					>
						{totalLikedCount.toLocaleString()} liked songs — a first cut you
						shape from there
					</span>
				</span>
				<ArrowRightIcon
					size={14}
					weight="regular"
					aria-hidden
					className="theme-text-muted flex-none"
				/>
			</button>
		</div>
	);

	return (
		<div className="mx-auto max-w-2xl p-8 pt-20">
			<p
				className="theme-text-muted mb-3 text-[11px] tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				New playlist
			</p>
			<h1
				className="theme-text text-4xl leading-[0.95] font-extralight tracking-tight"
				style={{ fontFamily: fonts.display }}
			>
				What are we <em>making</em>?
			</h1>

			{intentGate.allowed ? (
				<>
					<IntentRow onStart={(intentText) => onSeed(null, intentText)} />
					{templatesSection}
				</>
			) : (
				<>
					{templatesSection}
					<IntentRowLocked gate={intentGate} />
				</>
			)}
		</div>
	);
}
