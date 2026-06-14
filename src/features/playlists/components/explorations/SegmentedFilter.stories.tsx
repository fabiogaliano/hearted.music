import { useState } from "react";
import { SegmentedFilter as Filter, type RailSegment } from "./SegmentedFilter";

export default { title: "Playlists/Explorations/Components" };

function Harness() {
	const [value, setValue] = useState<RailSegment>("all");
	return (
		<div className="theme-bg p-10">
			<Filter
				value={value}
				onChange={setValue}
				counts={{ all: 8, matching: 4, library: 4 }}
			/>
		</div>
	);
}

export const SegmentedFilter = () => <Harness />;
