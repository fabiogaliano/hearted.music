/**
 * Prototype shared piece — the studio draft beat (Studio Split's layout with
 * Curation Desk's name-as-page-title). Extracted from SeededStudioScreen so
 * every landing direction (card grid, prose stack, …) flows into the same
 * second beat: sticky config rail = cause, living draft = effect, create
 * anchored in the rail, playlist name pre-filled from the chosen seed.
 */

import { fonts } from "@/lib/theme/fonts";
import { formatGateHint } from "../seedPresets";
import type { IntentGateVM, PresetVM } from "../types";
import { GenreField, IntentField, MaxSongsField } from "./ProtoConfigFields";
import { ProtoRow } from "./ProtoRow";
import { type CreateResult, RailCreateSurface } from "./RailCreateSurface";
import { RailFilters } from "./RailFilters";
import {
	type PreviewState,
	StudioPreviewSection,
} from "./StudioPreviewSection";
import type { ProtoDraft } from "./useProtoDraft";

export interface Seed {
	preset: PresetVM | null;
	intentText: string;
}

export function DraftStage({
	draft,
	seed,
	intentGate,
	previewState = "populated",
	result = "editing",
}: {
	draft: ProtoDraft;
	seed: Seed;
	intentGate: IntentGateVM;
	/** Which library state the Preview region shows. */
	previewState?: PreviewState;
	/** What the rail's create slot renders (pre-submit vs a returned result). */
	result?: CreateResult;
}) {
	// Preset intent wins over typed text (picking a preset is the later, more
	// specific gesture); empty string means the rail's placeholder shows. A
	// gated account never gets a prefill — the field renders locked instead.
	const initialIntent = intentGate.allowed
		? (seed.preset?.intent ?? seed.intentText)
		: undefined;
	const initialGenres =
		seed.preset && seed.preset.genrePills.length > 0
			? seed.preset.genrePills
			: undefined;

	return (
		<div className="mx-auto max-w-[1180px] p-8">
			<header className="mb-8">
				{/* The page's title in the a11y tree — the visible name is an editable
				    input (labelled, not a heading), so beat 2 needs its own h1. */}
				<h1 className="sr-only">{seed.preset?.label || "New playlist"}</h1>
				<p
					className="theme-text-muted mb-3 text-[11px] tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					New playlist
				</p>
				<input
					type="text"
					defaultValue={seed.preset?.label ?? ""}
					placeholder="Name this playlist…"
					aria-label="Playlist name"
					className="theme-text w-full bg-transparent leading-[0.95] font-extralight tracking-tight outline-none focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
					style={{ fontFamily: fonts.display, fontSize: "2.5rem" }}
				/>
			</header>

			<div className="grid grid-cols-1 gap-10 lg:grid-cols-[300px_1fr] lg:items-start">
				<aside className="flex flex-col gap-7 lg:sticky lg:top-8">
					<IntentField
						initial={initialIntent || undefined}
						locked={!intentGate.allowed}
						lockedHint={formatGateHint(intentGate)}
					/>
					<GenreField initial={initialGenres} />
					<RailFilters />
					<MaxSongsField />

					<RailCreateSurface result={result} draft={draft} />
				</aside>

				<main>
					<StudioPreviewSection state={previewState} draft={draft} />

					<div className="mb-4 flex items-center gap-4 px-1">
						<h2
							className="theme-text-muted m-0 text-xs font-normal tracking-[0.2em] uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Suggested to add
						</h2>
						<div className="theme-border-color h-px flex-1 border-t" />
						<button
							type="button"
							onClick={draft.refreshSuggestions}
							className="theme-text-muted cursor-pointer text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
							style={{ fontFamily: fonts.body }}
						>
							Refresh
						</button>
					</div>
					{draft.suggestions.map((song) => (
						<ProtoRow
							key={song.id}
							song={song}
							action="add"
							onAction={draft.addSong}
						/>
					))}
				</main>
			</div>
		</div>
	);
}
