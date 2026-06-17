import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
	setDemoPlaylistMetadata,
	setFlaggedPlaylistIds,
	useDemoPlaylistMetadata,
	useFlaggedPlaylistIds,
} from "@/features/onboarding/demoSandboxStore";
import {
	usePlaylistTourReporter,
	usePlaylistTourStep,
} from "@/features/onboarding/playlistPreviewTour";
import { DEMO_INTENT_EXAMPLES } from "@/lib/content/landing/demo-intent-examples";
import { DEMO_PLAYLISTS } from "@/lib/content/landing/demo-matches";
import { CoverFlowPlaylists } from "./components/explorations/CoverFlowPlaylists";
import { SpotlightPanel } from "./components/explorations/SpotlightPanel";
import type {
	GuidedPlaylistsConfig,
	PlaylistSummary,
} from "./components/explorations/types";

/**
 * The /playlists screen as it appears during the flag-playlists onboarding
 * preview: the same presentational CoverFlowPlaylists + SpotlightPanel the
 * production screen uses, but driven entirely by local in-memory state. The
 * canned demo ids ("1"–"7") aren't real DB rows, so every action (flag a target,
 * edit intent/genres) stays local and nothing hits the server — it's a rehearsal
 * that resets on refresh. Detail open is local (no route navigation), which
 * sidesteps the /playlists/$playlistRef loader that redirects unknown ids.
 *
 * A parallel screen rather than a `sandbox?` prop on PlaylistsCoverFlowScreen so
 * the production path keeps its server wiring (queries, RPC mutations, the
 * route-based open) untouched — none of which a no-rows demo can satisfy.
 */
export function SandboxPlaylistsCoverFlowScreen() {
	// Flagged set lives in the cross-step demo store (not local state) so the
	// playlists the user flags here survive the navigation to /match and drive
	// the canned match reveal. Starts empty — the demo teaches the flag action
	// from a clean slate (the Matching cover-flow starts empty, all 7 sit in the
	// Library rail).
	const flaggedIds = useFlaggedPlaylistIds();
	const targetIds = useMemo(() => new Set(flaggedIds), [flaggedIds]);
	// Intent/genres live in the cross-step demo store (sessionStorage), not local
	// state, so a description the user already wrote survives a hard refresh and the
	// tour can derive their true resume position from it.
	const metadata = useDemoPlaylistMetadata();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const tour = usePlaylistTourReporter();
	const { step, focusPlaylistId } = usePlaylistTourStep();
	// During the forced add → intent beats the panel is held open; once the first
	// cycle releases (step "done") it's freely closable again.
	const panelLocked =
		step === "add" || step === "intent-intro" || step === "intent";

	// Report the open/closed panel to the walkthrough so it can advance from
	// "open a candidate" to "write its intent".
	useEffect(() => {
		tour.reportPanelOpen(selectedId);
	}, [selectedId, tour]);

	// The tour points at a flagged playlist still missing its intent (e.g. a refresh
	// reopened mid-cycle): open its panel so the user lands on describing it rather
	// than being able to add more. The intent step locks the panel, so it can't be
	// closed back out without finishing.
	useEffect(() => {
		if (focusPlaylistId && selectedId !== focusPlaylistId) {
			setSelectedId(focusPlaylistId);
		}
	}, [focusPlaylistId, selectedId]);

	const summaries = useMemo<PlaylistSummary[]>(
		() =>
			DEMO_PLAYLISTS.map((p) => {
				const meta = metadata[p.id];
				return {
					id: p.id,
					name: p.name,
					isTarget: targetIds.has(p.id),
					// Canned demo: covers come from /public/demo-playlists where present,
					// else null → the shared AlbumPlaceholder. No real tracks (songCount 0);
					// the panel's empty-track + unmatchable nudges are suppressed below so the
					// rehearsal stays clean. Intent/genres start blank.
					songCount: 0,
					imageUrl: p.imageUrl ?? null,
					intent: meta?.intent ?? null,
					genres: meta?.genres ?? [],
				};
			}),
		[targetIds, metadata],
	);

	const toggleTarget = (id: string, isTarget: boolean) => {
		const next = new Set(targetIds);
		if (isTarget) next.add(id);
		else next.delete(id);
		setFlaggedPlaylistIds([...next]);
	};

	const selected = useMemo(
		() => summaries.find((p) => p.id === selectedId) ?? null,
		[summaries, selectedId],
	);

	// Keep the last-opened playlist mounted through the close slide-out so the
	// panel animates away with its content instead of blanking instantly.
	const [lastShown, setLastShown] = useState<PlaylistSummary | null>(null);
	useEffect(() => {
		if (selected) setLastShown(selected);
	}, [selected]);
	const panelPlaylist = selected ?? lastShown;

	const handleSave = (id: string, intent: string | null, genres: string[]) => {
		setDemoPlaylistMetadata(id, { intent, genres });
		// Onboarding closes the panel on save so the rehearsal flows straight back to
		// the cover flow to flag the next one — production keeps it open to keep editing.
		setSelectedId(null);
	};

	// One cohesive guided config — its presence activates rehearsal mode in both
	// CoverFlowPlaylists and SpotlightPanel. Reactive fields (locked, highlightAdd,
	// autoEditOnAdd, matchingEmptyAction) are derived from tour step so the config
	// stays current without the components needing to know about the tour.
	const guidedConfig: GuidedPlaylistsConfig = {
		locked: panelLocked,
		highlightAdd: step === "add",
		autoEditOnAdd: panelLocked,
		intentPlaceholder: "Pick an example to set this playlist's intent…",
		examples: panelPlaylist
			? DEMO_INTENT_EXAMPLES[panelPlaylist.id]
			: undefined,
		matchingEmptyTitle: "What's a matching candidate?",
		matchingEmptyBody:
			"A playlist you want your liked songs to flow into. As demonstration, add a few from our library, and tell each one what it's for.",
		matchingEmptyAction:
			step === "concept" ? (
				<Button variant="primary" onClick={tour.advanceConcept}>
					Next
				</Button>
			) : undefined,
	};

	return (
		<>
			<CoverFlowPlaylists
				playlists={summaries}
				onOpen={setSelectedId}
				onAdd={(id) => toggleTarget(id, true)}
				onRemove={(id) => toggleTarget(id, false)}
				detailOpen={selectedId != null}
				guided={guidedConfig}
			/>
			<SpotlightPanel
				playlist={panelPlaylist}
				tracks={[]}
				open={selected != null}
				onClose={() => setSelectedId(null)}
				onToggleTarget={(id) => toggleTarget(id, !targetIds.has(id))}
				onSave={handleSave}
				guided={guidedConfig}
			/>
		</>
	);
}
