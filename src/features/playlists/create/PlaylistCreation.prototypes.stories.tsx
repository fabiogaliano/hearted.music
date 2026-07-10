/**
 * Playlist Creation — U3 Ladle-only prototypes (NOT prod).
 *
 * Loose explorations for two ideas that need visual validation before any
 * prod wiring: match-reason hints ("why is this song here") and starting
 * presets (one-tap config seeds for an empty config surface). Per the plan,
 * these fake data the real engine doesn't expose yet (`matchReason`,
 * `PresetVM`) via LOCAL fixtures in `prototypes/fixtures.ts` — the shared
 * `src/lib/domains/playlists/fixtures.ts` is untouched.
 *
 * Shares the same flat "Playlist Creation" title group as the atom/composable
 * stories so the sidebar stays one list; story names are prefixed
 * "Prototype — " to keep them visually distinct from prod stories.
 */

import type { Story } from "@ladle/react";
import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import {
	PROTO_ACTIVE_GENRE_PILLS,
	PROTO_PRESETS,
	PROTO_PREVIEW_SONGS,
	PROTO_SUGGESTIONS,
} from "./prototypes/fixtures";
import { MatchedGenrePill } from "./prototypes/MatchedGenrePill";
import { PresetCardsRow } from "./prototypes/PresetCardsRow";
import { PresetChips } from "./prototypes/PresetChips";
import { PresetEmptyStateTakeover } from "./prototypes/PresetEmptyStateTakeover";
import { PreviewRowHoverDetail } from "./prototypes/PreviewRowHoverDetail";
import { PreviewRowInlineHint } from "./prototypes/PreviewRowInlineHint";
import { PreviewRowPillEcho } from "./prototypes/PreviewRowPillEcho";
import { SuggestionRowHoverDetail } from "./prototypes/SuggestionRowHoverDetail";
import { SuggestionRowInlineHint } from "./prototypes/SuggestionRowInlineHint";
import { SuggestionRowPillEcho } from "./prototypes/SuggestionRowPillEcho";
import type { PresetVM } from "./prototypes/types";

export default { title: "Playlist Creation" };

// ─── Shared believable-list chrome ───────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="mb-4 flex items-center gap-4 px-1">
			<span
				className="theme-text-muted text-xs tracking-[0.2em] uppercase"
				style={{ fontFamily: fonts.body }}
			>
				{children}
			</span>
			<div className="theme-border-color h-px flex-1 border-t" />
		</div>
	);
}

/** Small legend explaining the active config, so the "why" hints read as answers to a question the reviewer can see. */
function ActiveConfigLegend() {
	return (
		<p
			className="theme-text-muted mb-4 px-1 text-xs"
			style={{ fontFamily: fonts.body }}
		>
			Active config: genres{" "}
			{PROTO_ACTIVE_GENRE_PILLS.map((g) => (
				<MatchedGenrePill key={g} genre={g} isMatched={false} />
			))}
		</p>
	);
}

// ─── Direction A: muted inline hint under the artist line ────────────────────

export const MatchReasonInlineHint: Story = () => {
	const [preview, setPreview] = useState(PROTO_PREVIEW_SONGS);
	const [suggestions, setSuggestions] = useState(PROTO_SUGGESTIONS);
	return (
		<div className="mx-auto max-w-lg p-8">
			<ActiveConfigLegend />
			<SectionLabel>Preview</SectionLabel>
			<ul className="mb-10">
				{preview.map((song) => (
					<li key={song.id} style={{ listStyle: "none" }}>
						<PreviewRowInlineHint
							song={song}
							onRemove={(id) =>
								setPreview((prev) => prev.filter((s) => s.id !== id))
							}
						/>
					</li>
				))}
			</ul>
			<SectionLabel>Suggested to add</SectionLabel>
			<ul>
				{suggestions.map((song) => (
					<li key={song.id} style={{ listStyle: "none" }}>
						<SuggestionRowInlineHint
							song={song}
							onAdd={(id) =>
								setSuggestions((prev) => prev.filter((s) => s.id !== id))
							}
						/>
					</li>
				))}
			</ul>
		</div>
	);
};
MatchReasonInlineHint.storyName = "Prototype — Match Reason: Inline Hint";
MatchReasonInlineHint.meta = {
	description:
		"Direction A: a muted third line under the artist name ('Indie pop · 2014', 'Matches your Pop pick · 2020', 'From your top artist SZA'). Always visible, costs one text line per row on both preview and suggestion rows.",
};

// ─── Direction B: genre-pill echo ────────────────────────────────────────────

export const MatchReasonPillEcho: Story = () => {
	const [preview, setPreview] = useState(PROTO_PREVIEW_SONGS);
	const [suggestions, setSuggestions] = useState(PROTO_SUGGESTIONS);
	return (
		<div className="mx-auto max-w-lg p-8">
			<ActiveConfigLegend />
			<SectionLabel>Preview</SectionLabel>
			<ul className="mb-10">
				{preview.map((song) => (
					<li key={song.id} style={{ listStyle: "none" }}>
						<PreviewRowPillEcho
							song={song}
							onRemove={(id) =>
								setPreview((prev) => prev.filter((s) => s.id !== id))
							}
						/>
					</li>
				))}
			</ul>
			<SectionLabel>Suggested to add</SectionLabel>
			<ul>
				{suggestions.map((song) => (
					<li key={song.id} style={{ listStyle: "none" }}>
						<SuggestionRowPillEcho
							song={song}
							onAdd={(id) =>
								setSuggestions((prev) => prev.filter((s) => s.id !== id))
							}
						/>
					</li>
				))}
			</ul>
		</div>
	);
};
MatchReasonPillEcho.storyName = "Prototype — Match Reason: Pill Echo";
MatchReasonPillEcho.meta = {
	description:
		"Direction B: no new copy line — the row's existing genre pill (already in prod) is highlighted in the accent color when it's the pill that matched the active config, with the exact reason as a hover tooltip. Rows with no genre match (e.g. 'From your top artist SZA') fall back to a plain, unhighlighted pill.",
};

// ─── Direction C: hover/focus-revealed detail ────────────────────────────────

export const MatchReasonHoverDetail: Story = () => {
	const [preview, setPreview] = useState(PROTO_PREVIEW_SONGS);
	const [suggestions, setSuggestions] = useState(PROTO_SUGGESTIONS);
	return (
		<div className="mx-auto max-w-lg p-8">
			<p
				className="theme-text-muted mb-4 px-1 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				Hover or tab into a row to reveal its match reason.
			</p>
			<SectionLabel>Preview</SectionLabel>
			<ul className="mb-10">
				{preview.map((song) => (
					<li key={song.id} style={{ listStyle: "none" }}>
						<PreviewRowHoverDetail
							song={song}
							onRemove={(id) =>
								setPreview((prev) => prev.filter((s) => s.id !== id))
							}
						/>
					</li>
				))}
			</ul>
			<SectionLabel>Suggested to add</SectionLabel>
			<ul>
				{suggestions.map((song) => (
					<li key={song.id} style={{ listStyle: "none" }}>
						<SuggestionRowHoverDetail
							song={song}
							onAdd={(id) =>
								setSuggestions((prev) => prev.filter((s) => s.id !== id))
							}
						/>
					</li>
				))}
			</ul>
		</div>
	);
};
MatchReasonHoverDetail.storyName = "Prototype — Match Reason: Hover Detail";
MatchReasonHoverDetail.meta = {
	description:
		"Direction C: the reason line is hidden at rest and reveals under the artist line on row hover/focus-within (CSS grid-rows transition, motion-reduce aware). Costs zero space until the user is inspecting a specific song, at the cost of discoverability — a first-time user may not know to hover.",
};

// ─── Direction 1: preset cards row above the config surface ─────────────────

function PresetCardsRowHarness() {
	const [selected, setSelected] = useState<PresetVM | null>(null);
	const [dismissed, setDismissed] = useState(false);

	function handleSelect(preset: PresetVM) {
		setSelected(preset);
		setDismissed(true);
	}

	return (
		<div className="mx-auto max-w-2xl p-8">
			{!dismissed && (
				<PresetCardsRow presets={PROTO_PRESETS} onSelect={handleSelect} />
			)}
			<div className="theme-border-color border p-6">
				<p
					className="theme-text-muted mb-2 text-xs tracking-[0.2em] uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Configure (stand-in)
				</p>
				{selected ? (
					<p className="theme-text text-sm" style={{ fontFamily: fonts.body }}>
						Seeded from <em>{selected.label}</em> — genres:{" "}
						{selected.genrePills.join(", ") || "none"}
						{selected.intent ? ` · intent: "${selected.intent}"` : ""}
					</p>
				) : (
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						Empty — pick a quick start above, or configure manually.
					</p>
				)}
			</div>
		</div>
	);
}

export const PresetCardsRowStory: Story = () => <PresetCardsRowHarness />;
PresetCardsRowStory.storyName = "Prototype — Presets: Cards Row";
PresetCardsRowStory.meta = {
	description:
		"Direction 1: a row of preset cards ('Recent favorites', 'All things indie', 'Throwbacks: 2010s', 'Late-night electronic') above the config surface, shown only while config is empty. Picking one seeds genres/intent and the row disappears — its job is done.",
};

// ─── Direction 2: chips inside the intent/genre area ─────────────────────────

function PresetChipsHarness() {
	const [selected, setSelected] = useState<PresetVM | null>(null);

	return (
		<div className="mx-auto max-w-lg p-8">
			<div className="flex flex-col gap-4">
				<span
					className="theme-text-muted text-[11px] font-medium uppercase tracking-[0.18em]"
					style={{ fontFamily: fonts.body }}
				>
					Genres
				</span>
				{!selected && (
					<PresetChips presets={PROTO_PRESETS} onSelect={setSelected} />
				)}
				<div className="theme-border-color border border-dashed px-3 py-2">
					<span
						className="theme-text-muted text-xs"
						style={{ fontFamily: fonts.body }}
					>
						{selected
							? selected.genrePills.join(", ") || "(no genres, intent-only)"
							: "+ add genre"}
					</span>
				</div>
			</div>
		</div>
	);
}

export const PresetChipsStory: Story = () => <PresetChipsHarness />;
PresetChipsStory.storyName = "Prototype — Presets: Chips In Config";
PresetChipsStory.meta = {
	description:
		"Direction 2: preset chips ('Or start from…') sit directly above the genre picker, styled as dashed low-commitment chips (echoes GenrePillsPicker's own quick-pick row) rather than a separate section — a smaller nudge than a full card row.",
};

// ─── Direction 3: empty-state takeover ────────────────────────────────────────

function PresetEmptyStateTakeoverHarness() {
	const [choseManual, setChoseManual] = useState(false);
	const [selected, setSelected] = useState<PresetVM | null>(null);

	if (choseManual || selected) {
		return (
			<div className="mx-auto max-w-2xl p-8">
				<div className="theme-border-color border p-6">
					<p
						className="theme-text-muted mb-2 text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Configure (stand-in)
					</p>
					{selected ? (
						<p
							className="theme-text text-sm"
							style={{ fontFamily: fonts.body }}
						>
							Seeded from <em>{selected.label}</em> — genres:{" "}
							{selected.genrePills.join(", ") || "none"}
							{selected.intent ? ` · intent: "${selected.intent}"` : ""}
						</p>
					) : (
						<p
							className="theme-text-muted text-sm"
							style={{ fontFamily: fonts.body }}
						>
							Starting from scratch — config surface would render here.
						</p>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl p-8">
			<PresetEmptyStateTakeover
				presets={PROTO_PRESETS}
				onSelect={setSelected}
				onStartFromScratch={() => setChoseManual(true)}
			/>
		</div>
	);
}

export const PresetEmptyStateTakeoverStory: Story = () => (
	<PresetEmptyStateTakeoverHarness />
);
PresetEmptyStateTakeoverStory.storyName =
	"Prototype — Presets: Empty-State Takeover";
PresetEmptyStateTakeoverStory.meta = {
	description:
		"Direction 3: the boldest option — replaces the entire config surface with a full-bleed 'Where should we start?' choice screen on first landing, with an explicit 'Start from scratch' escape hatch so it never traps a user who wants the manual form.",
};
