/**
 * The seeded landing beat ("What are we making?") — the first thing a user sees
 * on /playlists/new. Starting points are interactive TEMPLATES, not finished
 * picks: each row is a mad-lib whose blanks ("All things [indie]") open a
 * popover listing the account's profile-derived options — tune the blank, then
 * click the row to start from the tuned result. A sparse library shows fewer
 * rows with fewer options; a brand-new one shows a growth note. "From scratch"
 * is a real card too, saying what the scratch is (the library, with its count).
 *
 * Templates render as a compact two-column grid of SURFACE-FILLED cards
 * (hover-border-brighten: --t-surface fill + border) — the fill is what
 * separates them from the page bg in a monochrome theme, where outline-only
 * boxes read as "all the same color." The grid arrives already facet-ordered
 * from buildSeedTemplates (genre → time → artist) so it scans dimension-by-
 * dimension without group chrome, titles are Instrument Serif, and each card's
 * tunable blank is the screen's accent — color means "you can change this."
 *
 * The free-text intent is the premium capability and leads either way: it sits
 * directly under the question, with the templates as the "or start from"
 * alternative below. When the gate disallows it, the field becomes a locked CTA:
 * a labeled affordance ("In your own words") whose whole block is a button that
 * opens the paywall, with the offer copy — progress toward the free unlock path
 * first, then the instant Backstage Pass path — kept separate from the feature's
 * own name. Templates stay usable regardless — they're structured, not words.
 *
 * Templates and the total come from the taste profile query; the gate from the
 * eligibility query. Both are pre-warmed by the route loader, so this reads from
 * cache on first paint.
 */

import {
	ArrowRightIcon,
	ArrowUpRightIcon,
	LockSimpleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ALL_DEMO_INTENT_EXAMPLES } from "@/lib/content/landing/demo-intent-examples";
import type { IntentGateVM } from "@/lib/domains/playlists/intent-eligibility";
import { fonts } from "@/lib/theme/fonts";
import { intentEligibilityQueryOptions } from "../intentEligibility";
import {
	buildSeedTemplates,
	defaultSelection,
	formatGateHint,
	resolveTemplate,
} from "../seedPresets";
import type { PresetVM, SeedChoiceVM, SeedTemplateVM } from "../seedTypes";
import { tasteProfileQueryOptions } from "../tasteProfile";
import { SeedBlank } from "./SeedBlank";

// Defensive gate for the impossible pre-warm-missed case: locked with no claimed
// progress. The loader ensures the real gate is cached before first paint.
const LOCKED_GATE: IntentGateVM = { allowed: false, criteria: [] };

// The same full-sentence intent pool the onboarding preview uses, drawn on as
// the field's ghost text so the affordance shows the RANGE of what you can type
// instead of one frozen phrase.
const INTENT_EXAMPLES = ALL_DEMO_INTENT_EXAMPLES.map((e) => e.description);

// One random example, fixed for the life of the mount — shuffles on reload, not
// in-page, so the ghost text never moves under a reading eye.
function useExample(): string {
	const [example] = useState(
		() => INTENT_EXAMPLES[Math.floor(Math.random() * INTENT_EXAMPLES.length)],
	);
	return example ?? "";
}

function IntentRowLocked({
	gate,
	onUnlock,
}: {
	gate: IntentGateVM;
	onUnlock: () => void;
}) {
	// The gate is currently a single Backstage Pass path, so this renders
	// "Available with Backstage Pass" via formatGateHint. The progress/instant
	// split is kept because the rendering is gate-driven: if an accumulating path
	// (e.g. a future pack tier) is re-added to buildIntentGate, its progress leads
	// the offer and the instant pass follows — no change needed here.
	const progress = gate.criteria.find((c) => c.progress)?.progress;
	const instantLabel = gate.criteria.find((c) => !c.progress && !c.met)?.label;
	const example = useExample();

	return (
		<div className="mt-8 flex flex-col gap-2.5">
			{/* Feature identity as its own label, kept out of the offer copy below —
			    the field names the capability, the offer names the price. */}
			<p
				className="theme-text-muted text-[11px] tracking-[0.18em] uppercase"
				style={{ fontFamily: fonts.body }}
			>
				In your own words
			</p>
			{/* Whole block is the CTA: a disabled input is a dead end, so this is an
			    honest locked affordance that opens the paywall on click. The faux
			    input wears the surface fill (the screen's "clickable object"
			    material, matching the template cards) rather than an input's
			    underline — an underline promises typing, and this doesn't type. */}
			<button
				type="button"
				onClick={onUnlock}
				aria-label={
					progress
						? `Unlock describing a playlist in your own words. You're ${progress.current.toLocaleString()} of ${progress.target.toLocaleString()} songs from packs, or unlock now with ${instantLabel ?? "a Backstage Pass"}.`
						: `Upgrade to describe a playlist in your own words. Available with ${formatGateHint(gate)}.`
				}
				className="group flex w-full cursor-pointer flex-col gap-2.5 text-left"
			>
				<span className="hover-border-brighten flex items-center gap-3 px-4 py-3 group-hover:border-(--t-text-muted)">
					<span
						className="theme-text-muted min-w-0 flex-1 truncate text-base opacity-60"
						style={{ fontFamily: fonts.body }}
					>
						{example}
					</span>
					{/* The accent marks the premium act itself, tying "colored = the
					    special interaction" to the tunable blanks below. */}
					<span className="theme-primary inline-flex flex-none items-center gap-1.5 text-[11px] tracking-widest uppercase transition-opacity duration-150 group-hover:opacity-75">
						<LockSimpleIcon size={12} weight="regular" aria-hidden />
						Unlock
					</span>
				</span>
				{progress ? (
					<span
						className="theme-text-muted text-xs leading-snug"
						style={{ fontFamily: fonts.body }}
					>
						You're{" "}
						<span className="theme-text tabular-nums">
							{progress.current.toLocaleString()} /{" "}
							{progress.target.toLocaleString()}
						</span>{" "}
						songs from packs
						{instantLabel ? <> — or unlock now with {instantLabel}</> : null}
					</span>
				) : (
					// Offer line pairs the muted price ("Available with Backstage Pass")
					// with the sidebar's Upgrade treatment — display-italic word + arrow
					// that drifts up-and-right. It's a visual, not a nested button: the
					// whole block is already the CTA, so the arrow rides the parent's
					// group-hover.
					<span
						className="theme-text-muted flex items-center gap-1.5 text-xs leading-snug"
						style={{ fontFamily: fonts.body }}
					>
						Available with {formatGateHint(gate)}
						<span aria-hidden className="theme-text-muted">
							—
						</span>
						<span
							className="theme-text inline-flex items-center gap-1 text-sm leading-none transition-colors duration-150 group-hover:text-(--t-text-muted)"
							style={{ fontFamily: fonts.display }}
						>
							<em>Upgrade</em>
							<ArrowUpRightIcon
								size={13}
								weight="regular"
								aria-hidden
								className="transition-transform duration-150 ease-out motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5"
							/>
						</span>
					</span>
				)}
			</button>
		</div>
	);
}

function IntentRow({ onStart }: { onStart: (intentText: string) => void }) {
	const [intentText, setIntentText] = useState("");
	const example = useExample();
	return (
		<div className="mt-8 flex items-center gap-3">
			<input
				type="text"
				value={intentText}
				onChange={(e) => setIntentText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onStart(intentText.trim());
				}}
				placeholder={example}
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

	// hover-border-brighten fills the card with --t-surface — the same material
	// as the whole-library card below — so the grid visibly lifts off the page
	// bg instead of being one more same-color outline. The whole card commits,
	// via the arrow button's stretched ::after overlay (nesting the card in a
	// <button> would swallow the blanks, which are buttons of their own); the
	// blanks sit above the overlay (z-raised in SeedBlank) so tuning one never
	// accidentally commits.
	return (
		<div className="hover-border-brighten group relative flex items-center justify-between gap-3 px-4 py-3">
			<div className="min-w-0">
				<span
					className="theme-text block text-lg leading-tight font-light"
					style={{ fontFamily: fonts.display }}
				>
					{template.parts.map((part, i) =>
						typeof part === "string" ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: parts are a stable literal sequence
							<span key={i}>{part}</span>
						) : (
							// The blank is the sentence's emphasis word — kept as <em> for
							// semantics but not slanted; the dashed underline is the
							// "this part is tunable" cue.
							<em key={part.slot} className="not-italic">
								<SeedBlank
									value={selection[part.slot]?.label ?? "…"}
									options={template.slots[part.slot] ?? []}
									onPick={(choice) =>
										setSelection((prev) => ({ ...prev, [part.slot]: choice }))
									}
								/>
							</em>
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
				className="theme-text-muted flex flex-none cursor-pointer items-center p-2 transition-[color,transform] duration-150 after:absolute after:inset-0 after:content-[''] group-hover:text-(--t-text) focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)] motion-safe:group-hover:translate-x-1"
			>
				<ArrowRightIcon size={16} weight="regular" aria-hidden />
			</button>
		</div>
	);
}

interface SeedStageProps {
	/** preset is null for "own words" / "from scratch"; intentText is the typed vibe ("" if none). */
	onSeed: (preset: PresetVM | null, intentText: string) => void;
	/** Opens the paywall when the gated intent field is used. */
	onUnlock: () => void;
}

export function SeedStage({ onSeed, onUnlock }: SeedStageProps) {
	const { data: profile } = useQuery(tasteProfileQueryOptions());
	const { data: gate } = useQuery(intentEligibilityQueryOptions());
	const intentGate = gate ?? LOCKED_GATE;
	const totalLikedCount = profile?.totalLikedCount ?? 0;

	// Memoized on the profile: buildSeedTemplates randomizes the genre blank's
	// default, and a re-shuffle on every render would make the cards twitch.
	const templates = useMemo(
		() => (profile ? buildSeedTemplates(profile) : []),
		[profile],
	);
	const templatesSection = (
		<div className="mt-10">
			<p
				className="theme-text-muted mb-3 text-[11px] tracking-[0.18em] uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Or start from
			</p>
			{templates.length > 0 ? (
				<div className="grid grid-cols-2 gap-2.5">
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

			{/* From scratch as a real card: name what the scratch is. Same surface
			    material as the templates, but dashed — a different class of action
			    (everything, unfaceted), so it earns the different border. */}
			<button
				type="button"
				onClick={() => onSeed(null, "")}
				className="theme-border-color hover-border-brighten mt-2.5 flex w-full cursor-pointer items-center justify-between gap-3 border-dashed px-4 py-3 text-left active:scale-[0.995]"
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
		<div className="mx-auto max-w-5xl p-8 pt-20">
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
				<IntentRow onStart={(intentText) => onSeed(null, intentText)} />
			) : (
				<IntentRowLocked gate={intentGate} onUnlock={onUnlock} />
			)}
			{templatesSection}
		</div>
	);
}
