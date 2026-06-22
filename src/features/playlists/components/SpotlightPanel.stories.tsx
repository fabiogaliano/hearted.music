import type { Story } from "@ladle/react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { samplePlaylists, sampleTracks, TOP_GENRES } from "./fixtures";
import { SpotlightPanel as Panel } from "./SpotlightPanel";
import type { PlaylistSummary, PlaylistTrackVM } from "./types";

/**
 * The whole Spotlight detail panel. Opens by default so the composition is
 * visible; close it (scrim, ✕, or Esc) and reopen via the button. The writing
 * surface is fully live — Edit the intent + genres, Save/Cancel — and the
 * target toggle flips the hero kicker. Switch the `playlist` control to compare
 * a full panel, a long name with a track remainder, and a fully empty playlist.
 */
export default { title: "Playlists/Explorations/Composable" };

const byId = (id: string): PlaylistSummary =>
	samplePlaylists.find((p) => p.id === id) ?? samplePlaylists[0];

function Harness({
	playlist,
	tracks = [],
}: {
	playlist: PlaylistSummary;
	tracks?: PlaylistTrackVM[];
}) {
	const [open, setOpen] = useState(true);
	const [isTarget, setIsTarget] = useState(playlist.isTarget);
	return (
		<div className="theme-bg relative min-h-screen overflow-hidden p-10">
			<Button onClick={() => setOpen(true)}>Open panel</Button>
			<Panel
				playlist={{ ...playlist, isTarget }}
				tracks={tracks}
				open={open}
				onClose={() => setOpen(false)}
				onToggleTarget={() => setIsTarget((t) => !t)}
				topGenres={TOP_GENRES}
			/>
		</div>
	);
}

export const SpotlightPanel: Story<{ playlist: string }> = ({ playlist }) => (
	<Harness
		key={playlist}
		playlist={byId(playlist)}
		tracks={sampleTracks[playlist] ?? []}
	/>
);
SpotlightPanel.args = { playlist: "mce" };
SpotlightPanel.argTypes = {
	playlist: {
		options: ["mce", "dubolt", "souvenir"],
		control: { type: "select" },
	},
};
SpotlightPanel.meta = {
	description:
		"mce = the full panel (intent, genres, tracks) · dubolt = a long name that tiers down with a '+ N more' tail · souvenir = empty (no intent/genres/tracks).",
};
