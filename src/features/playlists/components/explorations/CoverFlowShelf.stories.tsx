import { useState } from "react";
import { CoverFlowShelf as Shelf } from "./CoverFlowShelf";
import { samplePlaylists } from "./fixtures";

/**
 * A single cover-flow shelf in isolation. Wheel, drag, the ‹ › arrows, or click a
 * neighbor to center it; click the centered sleeve (or its name) to "open". The
 * name is the open affordance — hovering it or the cover drifts the arrow. Every
 * playlist is seeded already in matching.
 */
export default { title: "Playlists/Explorations/Components" };

// All in matching, so the caption's toggle consistently reads "In matching".
const inMatching = samplePlaylists.map((p) => ({ ...p, isTarget: true }));

function Harness() {
	const [center, setCenter] = useState(0);
	return (
		<div className="theme-bg relative min-h-[480px] overflow-hidden p-8">
			<Shelf
				label="Library"
				playlists={inMatching}
				center={center}
				onCenterChange={setCenter}
				onActivate={() => {}}
				onOpen={() => {}}
				onAdd={() => {}}
				onRemove={() => {}}
			/>
		</div>
	);
}

export const CoverFlowShelf = () => <Harness />;
