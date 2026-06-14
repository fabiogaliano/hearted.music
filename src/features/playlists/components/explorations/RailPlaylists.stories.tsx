import { useState } from "react";
import { samplePlaylists, sampleTracks, TOP_GENRES } from "./fixtures";
import { RailPlaylists } from "./RailPlaylists";
import { SpotlightPanel } from "./SpotlightPanel";
import type { PlaylistSummary } from "./types";

/**
 * The Rail listing wired to the Spotlight panel. Switch the All / Matching /
 * Library segment to filter in place; add/remove moves rows between segments;
 * click a row to spotlight it. Try the "mobile" width addon — the count column
 * drops and the row stays a clean cover/name/action triple.
 */
export default { title: "Playlists/Explorations/Composable" };

function Harness({
	initial = samplePlaylists,
}: {
	initial?: PlaylistSummary[];
}) {
	const [playlists, setPlaylists] = useState(initial);
	const [openId, setOpenId] = useState<string | null>(null);
	const setTarget = (id: string, isTarget: boolean) =>
		setPlaylists((ps) => ps.map((p) => (p.id === id ? { ...p, isTarget } : p)));
	const open = playlists.find((p) => p.id === openId) ?? null;
	return (
		<div className="theme-bg relative min-h-screen overflow-hidden p-8">
			<RailPlaylists
				playlists={playlists}
				onOpen={setOpenId}
				onAdd={(id) => setTarget(id, true)}
				onRemove={(id) => setTarget(id, false)}
			/>
			<SpotlightPanel
				playlist={open}
				tracks={open ? (sampleTracks[open.id] ?? []) : []}
				open={openId !== null}
				onClose={() => setOpenId(null)}
				onToggleTarget={(id) =>
					setTarget(
						id,
						!(playlists.find((p) => p.id === id)?.isTarget ?? false),
					)
				}
				topGenres={TOP_GENRES}
			/>
		</div>
	);
}

export const Rail = () => <Harness />;
Rail.meta = {
	description:
		"One editorial column with an in-place All / Matching / Library toggle.",
};
