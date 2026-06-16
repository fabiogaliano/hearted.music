import { useEffect, useMemo, useState } from "react";
import { DEMO_INTENT_EXAMPLES } from "@/lib/content/landing/demo-intent-examples";
import { DEMO_PLAYLISTS } from "@/lib/content/landing/demo-matches";
import { CoverFlowPlaylists } from "./components/explorations/CoverFlowPlaylists";
import { SpotlightPanel } from "./components/explorations/SpotlightPanel";
import type { PlaylistSummary } from "./components/explorations/types";

interface DemoMetadata {
	intent: string | null;
	genres: string[];
}

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
	// None flagged initially — the demo teaches the flag action from a clean
	// slate (the Matching cover-flow starts empty, all 7 sit in the Library rail).
	const [targetIds, setTargetIds] = useState<Set<string>>(() => new Set());
	const [metadata, setMetadata] = useState<Map<string, DemoMetadata>>(
		() => new Map(),
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const summaries = useMemo<PlaylistSummary[]>(
		() =>
			DEMO_PLAYLISTS.map((p) => {
				const meta = metadata.get(p.id);
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
		setTargetIds((prev) => {
			const next = new Set(prev);
			if (isTarget) next.add(id);
			else next.delete(id);
			return next;
		});
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
		setMetadata((prev) => {
			const next = new Map(prev);
			next.set(id, { intent, genres });
			return next;
		});
	};

	return (
		<>
			<CoverFlowPlaylists
				playlists={summaries}
				onOpen={setSelectedId}
				onAdd={(id) => toggleTarget(id, true)}
				onRemove={(id) => toggleTarget(id, false)}
				detailOpen={selectedId != null}
				showSearch={false}
			/>
			<SpotlightPanel
				playlist={panelPlaylist}
				tracks={[]}
				open={selected != null}
				onClose={() => setSelectedId(null)}
				onToggleTarget={(id) => toggleTarget(id, !targetIds.has(id))}
				onSave={handleSave}
				hideUnmatchableWarning
				hideTracksEmptyState
				examples={
					panelPlaylist ? DEMO_INTENT_EXAMPLES[panelPlaylist.id] : undefined
				}
			/>
		</>
	);
}
