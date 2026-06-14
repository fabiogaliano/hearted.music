import type { Story } from "@ladle/react";
import { useState } from "react";
import { CoverFlowPlaylists } from "./CoverFlowPlaylists";
import { samplePlaylists, sampleTracks, TOP_GENRES } from "./fixtures";
import { SpotlightPanel } from "./SpotlightPanel";
import type { PlaylistSummary } from "./types";

/**
 * The CoverFlow listing wired to the Spotlight panel — the whole flow: browse
 * the shelves, add/remove to matching, click the centered sleeve (or Open) to
 * spotlight a playlist. The harness owns the playlist set so add/remove visibly
 * move sleeves between the Matching and Library shelves.
 */
export default { title: "Playlists/Explorations/Composable" };

function Harness({ initial }: { initial: PlaylistSummary[] }) {
	const [playlists, setPlaylists] = useState(initial);
	const [openId, setOpenId] = useState<string | null>(null);
	const setTarget = (id: string, isTarget: boolean) =>
		setPlaylists((ps) => ps.map((p) => (p.id === id ? { ...p, isTarget } : p)));
	const open = playlists.find((p) => p.id === openId) ?? null;
	return (
		<div className="theme-bg relative min-h-screen overflow-hidden p-8">
			<CoverFlowPlaylists
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

// The harness seeds its playlist set once on mount, so key the element to the
// control to force a remount when it flips rather than leaving stale state.
export const CoverFlow: Story<{ allMatching: boolean }> = ({ allMatching }) => {
	const initial = allMatching
		? samplePlaylists.map((p) => ({ ...p, isTarget: true }))
		: samplePlaylists;
	return <Harness key={String(allMatching)} initial={initial} />;
};
CoverFlow.args = { allMatching: false };
CoverFlow.argTypes = { allMatching: { control: { type: "boolean" } } };
CoverFlow.meta = {
	description:
		"Two stacked shelves — Matching above, Library below. Wheel / drag / ‹ › / arrow keys to browse; ↑/↓ switch shelf, Enter opens. Flip allMatching to push every sleeve into the matching shelf.",
};
