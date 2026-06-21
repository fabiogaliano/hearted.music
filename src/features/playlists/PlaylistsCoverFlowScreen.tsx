import {
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ALL_DEMO_INTENT_EXAMPLES } from "@/lib/content/landing/demo-intent-examples";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { parseStoredMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { savePlaylistMatchConfig } from "@/lib/server/playlists.functions";
import { fonts } from "@/lib/theme/fonts";
import { CoverFlowPlaylists } from "./components/explorations/CoverFlowPlaylists";
import { SpotlightPanel } from "./components/explorations/SpotlightPanel";
import type {
	PlaylistSummary,
	PlaylistTrackVM,
} from "./components/explorations/types";
import { usePlaylistSession } from "./hooks/usePlaylistSession";
import {
	buildPlaylistRouteRef,
	resolvePlaylistIdFromRouteRef,
} from "./playlistRouteRef";
import {
	accountTopGenresQueryOptions,
	playlistKeys,
	playlistManagementQueryOptions,
	playlistMatchFilterOptionsQueryOptions,
	playlistTracksInfiniteQueryOptions,
} from "./queries";

interface PlaylistsCoverFlowScreenProps {
	accountId: string;
}

/**
 * Exported for unit-testing the warn contract: when wasNormalized is true
 * the caller (toSummary) must emit a structured warning with full context so
 * ops can trace corrupt stored data back to the owning account + playlist.
 */
export function parseSummaryMatchFilters(
	accountId: string,
	playlistId: string,
	raw: unknown,
): ReturnType<typeof parseStoredMatchFilters> {
	const parsed = parseStoredMatchFilters(raw);
	// StoredParseResult always resolves to ok:true (normalizes, never hard-fails).
	// The ok guard is still required to narrow the union — TypeScript cannot see
	// wasNormalized/value on the ParseFailure arm without it.
	if (parsed.ok && parsed.wasNormalized) {
		// Invalid stored match_filters must not crash the screen — normalize to
		// { version: 1 } and log so ops can diagnose without user-facing errors.
		console.warn("[playlists] invalid stored match_filters normalized", {
			accountId,
			playlistId,
			raw,
		});
	}
	return parsed;
}

function toSummary(
	playlist: Playlist,
	isTarget: boolean,
	accountId: string,
): PlaylistSummary {
	const parsed = parseSummaryMatchFilters(
		accountId,
		playlist.id,
		playlist.match_filters,
	);
	const matchFilters = parsed.ok ? parsed.value : { version: 1 as const };
	return {
		id: playlist.id,
		name: playlist.name,
		isTarget,
		songCount: playlist.song_count ?? 0,
		imageUrl: playlist.image_url,
		intent: playlist.match_intent,
		genres: playlist.genre_pills ?? [],
		matchFilters,
	};
}

export function PlaylistsCoverFlowScreen({
	accountId,
}: PlaylistsCoverFlowScreenProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	// strict:false reads the param when the active match is
	// /playlists/$playlistRef and returns undefined on the bare /playlists list.
	const { playlistRef } = useParams({ strict: false });

	const { data } = useQuery(playlistManagementQueryOptions(accountId));
	const { data: topGenresData } = useQuery(
		accountTopGenresQueryOptions(accountId),
	);
	const { optimisticTargets, toggleTarget, markMetadataChanged } =
		usePlaylistSession(accountId);

	const playlists = useMemo(() => data?.playlists ?? [], [data]);

	// The committed target set folded with in-flight optimistic toggles, so a
	// cover jumps between matching and library the instant the user acts.
	const targetIds = useMemo(() => {
		const ids = new Set(data?.targetPlaylistIds ?? []);
		for (const [id, isTarget] of optimisticTargets) {
			if (isTarget) ids.add(id);
			else ids.delete(id);
		}
		return ids;
	}, [data?.targetPlaylistIds, optimisticTargets]);

	const summaries = useMemo(
		() => playlists.map((p) => toSummary(p, targetIds.has(p.id), accountId)),
		[playlists, targetIds, accountId],
	);

	const routeRefById = useMemo(
		() => new Map(playlists.map((p) => [p.id, buildPlaylistRouteRef(p)])),
		[playlists],
	);

	const selectedId = useMemo(
		() => resolvePlaylistIdFromRouteRef(playlists, playlistRef),
		[playlists, playlistRef],
	);
	const selected = useMemo(
		() => summaries.find((p) => p.id === selectedId) ?? null,
		[summaries, selectedId],
	);

	// Keep the last opened playlist mounted through the close slide-out so the
	// panel animates away with its content instead of blanking instantly.
	const [lastShown, setLastShown] = useState<PlaylistSummary | null>(null);
	useEffect(() => {
		if (selected) setLastShown(selected);
	}, [selected]);
	const panelPlaylist = selected ?? lastShown;

	// Only fetch filter options when a target playlist panel is open — the editor
	// (and therefore the filter controls) is only reachable for target playlists.
	// The query is account-scoped with a 5min staleTime, so a second target playlist
	// reuses the cached result. We gate on `selected` (not panelPlaylist) so the
	// query disables as soon as the panel starts closing, not after the fade-out.
	const {
		data: filterOptionsData,
		isPending: filterOptionsPending,
		isError: filterOptionsError,
	} = useQuery({
		...playlistMatchFilterOptionsQueryOptions(accountId),
		enabled: selected?.isTarget === true,
	});

	const matchFilterOptionsState =
		selected?.isTarget !== true
			? ("loading" as const)
			: filterOptionsPending
				? ("loading" as const)
				: filterOptionsError
					? ("error" as const)
					: ("ready" as const);

	const tracksQuery = useInfiniteQuery(
		playlistTracksInfiniteQueryOptions(selectedId),
	);
	const tracks = useMemo<PlaylistTrackVM[]>(
		() =>
			(tracksQuery.data?.pages.flatMap((page) => page.tracks) ?? []).map(
				(t) => ({
					position: t.position,
					name: t.name,
					artists: t.artists,
					albumName: t.albumName,
					imageUrl: t.imageUrl,
				}),
			),
		[tracksQuery.data],
	);
	const loadMoreTracks = () => {
		if (tracksQuery.hasNextPage && !tracksQuery.isFetchingNextPage)
			void tracksQuery.fetchNextPage();
	};

	const open = (id: string) => {
		const ref = routeRefById.get(id);
		if (ref)
			void navigate({
				to: "/playlists/$playlistRef",
				params: { playlistRef: ref },
			});
	};
	const close = () => void navigate({ to: "/playlists" });

	const handleSave = async (
		id: string,
		intent: string | null,
		genres: string[],
		matchFilters: PlaylistMatchFiltersV1,
	) => {
		const result = await savePlaylistMatchConfig({
			data: {
				playlistId: id,
				matchIntent: intent,
				genrePills: genres,
				matchFilters,
			},
		});
		// Fire-and-forget side effects after a confirmed write — invalidation failure
		// is already logged server-side and is non-fatal from the UI's perspective.
		markMetadataChanged();
		queryClient.invalidateQueries({
			queryKey: playlistKeys.management(accountId),
		});
		return result;
	};

	if (!data) {
		return (
			<div className="mx-auto flex min-h-[40vh] max-w-[1180px] items-center justify-center">
				<p
					className="theme-text-muted text-sm"
					style={{ fontFamily: fonts.body }}
				>
					Listening for your playlists…
				</p>
			</div>
		);
	}

	return (
		<>
			<CoverFlowPlaylists
				playlists={summaries}
				onOpen={open}
				onAdd={(id) => void toggleTarget(id, true)}
				onRemove={(id) => void toggleTarget(id, false)}
				detailOpen={playlistRef != null}
			/>
			<SpotlightPanel
				playlist={panelPlaylist}
				tracks={tracks}
				open={selected != null}
				onClose={close}
				onToggleTarget={(id) => void toggleTarget(id, !targetIds.has(id))}
				onSave={handleSave}
				topGenres={topGenresData?.genres}
				tracksHasMore={tracksQuery.hasNextPage}
				tracksLoadingMore={tracksQuery.isFetchingNextPage}
				onLoadMoreTracks={loadMoreTracks}
				intentExamples={ALL_DEMO_INTENT_EXAMPLES}
				matchFilterOptions={filterOptionsData}
				matchFilterOptionsState={matchFilterOptionsState}
			/>
		</>
	);
}
