/**
 * Ladle stub for @/lib/extension/playlist-description-save.
 *
 * The real `commit`/`sync` paths call a TanStack server function
 * (acknowledgePlaylistUpdate) which pulls drizzle queries into the module graph
 * — node-only code that can't bundle for the browser. Aliasing this whole module
 * (ladle-vite.config.ts) severs that chain so OnboardingDescriptionDialog renders
 * in Ladle.
 *
 * The behavior is controllable so the dialog's stories can drive every save
 * outcome the UI renders differently: success/close, the inline failure line,
 * the Spotify-reconnect swap, and the frozen "Saving…" state. Set it during
 * render (not in an effect) so it's in place before a story's auto-save fires.
 */

import type { SpotifyErrorCode } from "../../shared/spotify-command-protocol";

export type DescriptionSaveBehavior =
	| "ready" // prepare ok → commit ok → toast + close
	| "commit-failed" // prepare ok → commit fails → inline error line
	| "conflict" // Spotify has a newer description → toast + close
	| "reconnect-required" // Save button swaps to the reconnect link
	| "extension-required" // toast + close
	| "fetch-failed" // inline error line
	| "hang"; // prepare never settles → frozen "Saving…"

let behavior: DescriptionSaveBehavior = "ready";

export function setDescriptionSaveBehavior(next: DescriptionSaveBehavior) {
	behavior = next;
}

type PreparedPlaylistDescriptionSave = {
	spotifyId: string;
	nextDescription: string;
	latestMetadata: {
		name: string;
		description: string | null;
		trackCount: number;
		imageUrl: string | null;
	};
};

const never = <T>() => new Promise<T>(() => {});

export async function preparePlaylistDescriptionSave(args: {
	spotifyId: string;
	baselineDescription: string | null;
	nextDescription: string;
}) {
	const commit: PreparedPlaylistDescriptionSave = {
		spotifyId: args.spotifyId,
		nextDescription: args.nextDescription,
		latestMetadata: {
			name: "Ladle Playlist",
			description: args.baselineDescription,
			trackCount: 42,
			imageUrl: null,
		},
	};

	switch (behavior) {
		case "hang":
			return never<{
				status: "ready";
				commit: PreparedPlaylistDescriptionSave;
			}>();
		case "reconnect-required":
			return { status: "reconnect-required" as const };
		case "extension-required":
			return { status: "extension-required" as const };
		case "fetch-failed":
			return {
				status: "fetch-failed" as const,
				errorCode: "UPSTREAM_ERROR" as SpotifyErrorCode,
			};
		case "conflict":
			return {
				status: "conflict" as const,
				latestDescription: "a newer description living on Spotify",
				commit,
			};
		default:
			return { status: "ready" as const, commit };
	}
}

export async function commitPlaylistDescriptionSave(
	_commit: PreparedPlaylistDescriptionSave,
) {
	if (behavior === "commit-failed") {
		return { ok: false as const, error: new Error("stubbed commit failure") };
	}
	return { ok: true as const, value: { revision: "stub-rev" } };
}
