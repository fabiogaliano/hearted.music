import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	reportSpotifyAuthFailure,
	reportSpotifyAuthSuccess,
} from "@/lib/extension/connection/report-failure";
import { useExtensionConnection } from "@/lib/extension/connection/useExtensionConnection";
import { outcomeFromCommandResponse } from "@/lib/extension/spotify-action-outcome";
import { addToPlaylist } from "@/lib/extension/spotify-client";
import { addSongToPlaylist } from "@/lib/server/matching.functions";
import type { PlaylistsPanel } from "../components/song-detail-panel/song-detail-types";
import { songSuggestionsQueryOptions } from "../queries";

interface PlaylistSuggestionSong {
	// The track id — the suggestions query key and the addSongToPlaylist song id.
	id: string;
	// Spotify track id for the optimistic extension add (empty skips it).
	spotifyTrackId: string;
}

/**
 * Resolves the add-to-playlist matches the song-detail panel renders at the
 * bottom of a read. Owns the suggestions query plus the transient interaction
 * state (which playlists were added this session, whether a Spotify reconnect is
 * needed) and the add handler, then hands the panel a pre-resolved PlaylistsPanel
 * — keeping SongDetailPanelSurface pure (no queries, no billing, Ladle-renderable).
 *
 * Returns undefined when disabled (walkthrough), no song is open, or the song has
 * no undecided matches — the panel then omits the section entirely.
 *
 * `addedTo` is keyed by song id and derived, so panel prev/next (which swaps the
 * song without unmounting this hook) resets the "Added" rows for the new song.
 *
 * `reconnectNeeded` no longer tracks the one song that happened to fail (the
 * old useSpotifyReconnectState scoped it per entity key) — it mirrors the
 * shared connection verdict instead, so a dead token surfaces on whichever
 * song panel is open, not just the one that triggered the push. A failed add
 * pushes into that shared state via reportSpotifyAuthFailure and returns; the
 * private 3s recovery poll is gone too — the shared query's own
 * interval/focus refetch (plus repair's invalidate) clears it.
 *
 * `mismatch` is the invariant-2 counterpart: it fires when the extension's
 * live Spotify session is signed in as someone OTHER than `linkedSpotifyId`.
 * Unlike `spotify-disconnected`, that isn't silently repairable, so `onAdd`
 * refuses the write outright (see the guard below) and the panel renders
 * AccountMismatchPrompt instead of Add rows — the same gate/prompt pair
 * useSpotifyGate/AccountMismatchPrompt already use for the studio's create
 * flow, reused here for one UI vocabulary.
 */
export function useSongPlaylistSuggestions(
	song: PlaylistSuggestionSong | null,
	enabled: boolean,
	linkedSpotifyId: string | null,
): PlaylistsPanel | undefined {
	const songId = song?.id ?? null;
	const { data } = useQuery(
		songSuggestionsQueryOptions(enabled ? songId : null),
	);
	const queryClient = useQueryClient();
	const { verdict, refetch } = useExtensionConnection(linkedSpotifyId);
	const [added, setAdded] = useState<{ key: string; ids: string[] }>({
		key: songId ?? "",
		ids: [],
	});
	const addedTo = added.key === songId ? added.ids : [];

	if (!enabled || !song || !data || data.matches.length === 0) {
		return undefined;
	}

	const onAdd = async (playlistId: string) => {
		// Invariant 2: a mismatched account is never silently repairable, so the
		// write is refused before it can reach addToPlaylist or the DB decision
		// — the target playlist belongs to `linkedSpotifyId`, but the extension's
		// live token belongs to someone else. The panel shouldn't be able to
		// reach here at all while mismatched (AccountMismatchPrompt replaces the
		// Add rows below), so this is defense-in-depth, not the primary guard.
		if (verdict.kind === "mismatch") return;
		const suggestion = data.matches.find((m) => m.playlistId === playlistId);
		// Optimistically write through to Spotify first; only record the decision
		// server-side once that succeeds. A reconnect/error bails without marking
		// the song added, so the row stays actionable.
		if (suggestion && song.spotifyTrackId) {
			const result = await addToPlaylist(
				`spotify:playlist:${suggestion.playlistSpotifyId}`,
				[`spotify:track:${song.spotifyTrackId}`],
			);
			const outcome = outcomeFromCommandResponse(result);
			if (outcome.status === "reconnect-required") {
				reportSpotifyAuthFailure(queryClient);
				return;
			}
			if (outcome.status === "error") return;
			if (outcome.status === "success") {
				reportSpotifyAuthSuccess(queryClient);
			}
		}
		await addSongToPlaylist({
			data: { songId: song.id, playlistId, snapshotId: data.snapshotId },
		});
		setAdded((prev) =>
			prev.key === song.id
				? { key: song.id, ids: [...prev.ids, playlistId] }
				: { key: song.id, ids: [playlistId] },
		);
	};

	return {
		matches: data.matches.map((m) => ({
			playlistId: m.playlistId,
			name: m.playlistName,
			// fitScore is strictnessScore — the canonical match percent (A5, E7).
			score: m.fitScore,
		})),
		addedTo,
		reconnectNeeded: verdict.kind === "spotify-disconnected",
		mismatch:
			verdict.kind === "mismatch"
				? { extensionProfile: verdict.extensionProfile }
				: null,
		onRecheck: async () => {
			await refetch();
		},
		onAdd,
	};
}
