/**
 * Fit-test piece — the studio's Preview region across the library states the
 * fixtures otherwise hide. Uses the REAL takeover components (LibraryEmptyState,
 * NotEnoughSongsNote) so the decision is "does the studio's first-cut hero hold
 * up when there's nothing to show", not a mockup of them:
 *   - "populated"  — the normal song list.
 *   - "empty"      — no eligible songs (library takeover).
 *   - "warming"    — backfill still running (same takeover, patient copy).
 *   - "not-enough" — a short list plus the sub-max note beneath it.
 */

import { LibraryEmptyState } from "@/features/playlists/create/create-flow/LibraryEmptyState";
import { NotEnoughSongsNote } from "@/features/playlists/create/create-flow/NotEnoughSongsNote";
import { ProtoRow } from "./ProtoRow";
import { ProtoSectionLabel } from "./ProtoSectionLabel";
import type { ProtoDraft } from "./useProtoDraft";

export type PreviewState = "populated" | "empty" | "warming" | "not-enough";

export function StudioPreviewSection({
	state,
	draft,
}: {
	state: PreviewState;
	draft: ProtoDraft;
}) {
	const showList = state === "populated" || state === "not-enough";

	return (
		<>
			<ProtoSectionLabel
				meta={`${draft.preview.length} songs · ${draft.totalMinutes} min`}
			>
				Preview
			</ProtoSectionLabel>
			<div className="mb-10">
				{state === "empty" && <LibraryEmptyState isWarming={false} />}
				{state === "warming" && <LibraryEmptyState isWarming={true} />}
				{showList &&
					draft.preview.map((song) => (
						<ProtoRow
							key={song.id}
							song={song}
							action="remove"
							onAction={draft.removeSong}
						/>
					))}
				{state === "not-enough" && (
					<div className="mt-3">
						<NotEnoughSongsNote totalEligible={draft.preview.length} />
					</div>
				)}
			</div>
		</>
	);
}
