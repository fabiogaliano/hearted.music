/**
 * Fit-test piece — what the rail's create slot becomes once the orchestrator
 * returns. In prod these result states own a full-width bottom footer; here they
 * render in the 300px rail where the Create button lives, so the decision is
 * whether the REAL SuccessState / PartialState / UnsyncedState survive that
 * width or need to move to a footer / dialog. "editing" is the pre-submit button.
 */

import { Button } from "@/components/ui/Button";
import { PartialState } from "@/features/playlists/create/create-flow/PartialState";
import { SuccessState } from "@/features/playlists/create/create-flow/SuccessState";
import { UnsyncedState } from "@/features/playlists/create/create-flow/UnsyncedState";
import { fonts } from "@/lib/theme/fonts";
import type { ProtoDraft } from "./useProtoDraft";

export type CreateResult = "editing" | "success" | "partial" | "unsynced";

// Plausible fixture identifiers so the result components render their real links.
const DEMO = {
	spotifyId: "37i9dQZF1DXcBWIGoYBM5M",
	playlistId: "pl_demo_0001",
	name: "Late-night drives",
};

export function RailCreateSurface({
	result,
	draft,
}: {
	result: CreateResult;
	draft: ProtoDraft;
}) {
	if (result === "success") {
		return (
			<SuccessState
				playlistName={DEMO.name}
				spotifyId={DEMO.spotifyId}
				playlistId={DEMO.playlistId}
			/>
		);
	}
	if (result === "partial") {
		return (
			<PartialState
				spotifyId={DEMO.spotifyId}
				playlistId={DEMO.playlistId}
				failedTrackCount={3}
			/>
		);
	}
	if (result === "unsynced") {
		return (
			<UnsyncedState
				spotifyId={DEMO.spotifyId}
				isRetrying={false}
				onRetry={() => {}}
			/>
		);
	}

	return (
		<div className="theme-border-color flex flex-col gap-3 border-t pt-5">
			<Button variant="primary" size="sm" className="w-full">
				Create playlist
			</Button>
			<p
				className="theme-text-muted text-center text-xs tabular-nums"
				style={{ fontFamily: fonts.body }}
			>
				{draft.preview.length} songs · {draft.totalMinutes} min
			</p>
		</div>
	);
}
