import { useState } from "react";
import { GenrePillsPicker } from "./GenrePillsPicker";

/**
 * The chips-combobox for declaring a playlist's genres. It's a controlled
 * component — these stories own the `value` state and log changes — so no
 * server stubs are needed. `topGenres` stands in for the account's top library
 * genres (the quick-pick seed); once a pill is picked, suggestions shift to
 * genres adjacent to the picks via the curated similarity graph.
 */

export default {
	title: "Playlists/GenrePillsPicker",
};

// A believable "your top library genres" seed. Mix of canonical forms that read
// fine as-is and a couple of unpretty ones (rnb, synthpop) to sanity-check the
// render-canonical-as-is decision.
const TOP_GENRES = [
	"rock",
	"pop",
	"hip-hop",
	"electronic",
	"rnb",
	"jazz",
	"indie",
	"synthpop",
];

function Harness({
	initial = [],
	topGenres = TOP_GENRES,
	maxPills,
}: {
	initial?: string[];
	topGenres?: string[];
	maxPills?: number;
}) {
	const [value, setValue] = useState<string[]>(initial);

	return (
		<div className="mx-auto max-w-md p-10">
			<label
				htmlFor="genre-picker-demo"
				className="theme-text-muted mb-3 block text-[10px] tracking-widest uppercase"
			>
				Genres
			</label>
			<GenrePillsPicker
				value={value}
				onChange={setValue}
				topGenres={topGenres}
				maxPills={maxPills}
			/>

			<pre className="theme-text-muted mt-8 text-xs">
				value = {JSON.stringify(value)}
			</pre>
		</div>
	);
}

export const Empty = () => <Harness />;

export const WithSelection = () => <Harness initial={["hip-hop"]} />;

export const NearCap = () => (
	<Harness initial={["rock", "pop", "hip-hop", "jazz"]} />
);

export const AtCap = () => (
	<Harness initial={["rock", "pop", "hip-hop", "jazz", "soul"]} />
);

// No library genres yet (still syncing). Suggestions are empty until the user
// types or picks; the field + counter still read correctly.
export const NoTopGenres = () => <Harness topGenres={[]} />;

export const Disabled = () => {
	const [value] = useState(["hip-hop", "rnb"]);
	return (
		<div className="mx-auto max-w-md p-10">
			<GenrePillsPicker
				value={value}
				onChange={() => {}}
				topGenres={TOP_GENRES}
				disabled
			/>
		</div>
	);
};
