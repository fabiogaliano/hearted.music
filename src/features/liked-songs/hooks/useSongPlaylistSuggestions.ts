import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { outcomeFromCommandResponse } from "@/lib/extension/spotify-action-outcome";
import { addToPlaylist } from "@/lib/extension/spotify-client";
import { useSpotifyReconnectState } from "@/lib/extension/useSpotifyReconnectState";
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
 */
export function useSongPlaylistSuggestions(
	song: PlaylistSuggestionSong | null,
	enabled: boolean,
): PlaylistsPanel | undefined {
	const songId = song?.id ?? null;
	const { data } = useQuery(
		songSuggestionsQueryOptions(enabled ? songId : null),
	);
	const { reconnectNeeded, setReconnectNeeded } = useSpotifyReconnectState(
		songId ?? "",
	);
	const [added, setAdded] = useState<{ key: string; ids: string[] }>({
		key: songId ?? "",
		ids: [],
	});
	const addedTo = added.key === songId ? added.ids : [];

	if (!enabled || !song || !data || data.matches.length === 0) {
		return undefined;
	}

	const onAdd = async (playlistId: string) => {
		setReconnectNeeded(false);
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
				setReconnectNeeded(true);
				return;
			}
			if (outcome.status === "error") return;
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
		reconnectNeeded,
		onAdd,
	};
}
