import type { SongVM } from "@/lib/domains/playlists/types";
import type { CreatePlaylistFromDraftInput } from "@/lib/extension/create-playlist-from-draft";
import type { CreatePlaylistDraftConfig } from "./useCreatePlaylistDraft";

interface StudioSubmitDraft {
	tracklist: readonly Pick<SongVM, "id">[];
	committedConfig: Pick<
		CreatePlaylistDraftConfig,
		"genrePills" | "matchFilters" | "intent"
	>;
	intentApplied: boolean;
}

/** Build a publish payload exclusively from the preview's committed snapshot. */
export function buildStudioSubmitInput(
	name: string,
	draft: StudioSubmitDraft,
): CreatePlaylistFromDraftInput {
	return {
		name: name.trim(),
		songIds: draft.tracklist.map((song) => song.id),
		genrePills: draft.committedConfig.genrePills,
		matchFilters: draft.committedConfig.matchFilters,
		intentApplied: draft.intentApplied,
		intent:
			draft.intentApplied && draft.committedConfig.intent
				? draft.committedConfig.intent
				: null,
	};
}
