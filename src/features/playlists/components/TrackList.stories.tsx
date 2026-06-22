import type { Story } from "@ladle/react";
import { sampleTracks } from "./fixtures";
import { TrackList as List } from "./TrackList";
import type { PlaylistTrackVM } from "./types";

/**
 * The track list. `set` picks the loaded rows; `songCount` is the playlist's
 * true total — set it above the loaded count to surface the "+ N more" tail, or
 * use the empty set + 0 for the waiting-for-songs state. Presentational, so the
 * controls take effect immediately.
 */
export default { title: "Playlists/Explorations/Components" };

const SETS: Record<string, PlaylistTrackVM[]> = {
	mce: sampleTracks.mce,
	dubolt: sampleTracks.dubolt,
	empty: [],
};

export const TrackList: Story<{ set: string; songCount: number }> = ({
	set,
	songCount,
}) => (
	<div className="theme-bg mx-auto max-w-2xl p-10">
		<List tracks={SETS[set] ?? []} songCount={songCount} />
	</div>
);
TrackList.args = { set: "mce", songCount: 6 };
TrackList.argTypes = {
	set: { options: ["mce", "dubolt", "empty"], control: { type: "select" } },
	songCount: { control: { type: "range", min: 0, max: 40, step: 1 } },
};
