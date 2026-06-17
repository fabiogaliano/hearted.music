import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import "./playlist-explorations.css";

export interface DescriptionExample {
	description: string;
	genres: readonly string[];
}

// Ready-made intents shown below the playlist writing surface: each pairs the
// shape of a good description with the genres that fit it. Picking one fills the
// surface (description + genres) and opens the editor — a one-click start for
// users who'd otherwise face a blank intent. Genres are kept to canonical
// whitelist forms ("hip-hop", "rnb", …) so they land as real, selectable genres
// rather than invented labels.
const EXAMPLES: readonly DescriptionExample[] = [
	{ description: "songs i run to", genres: ["electronic", "house", "indie"] },
	{
		description: "slow sunday cooking",
		genres: ["jazz", "soul", "bossa nova"],
	},
	{ description: "the gym at 6am", genres: ["hip-hop", "electronic"] },
	{ description: "for rainy sundays", genres: ["indie", "folk", "ambient"] },
	{
		description: "songs that make me cry on purpose",
		genres: ["indie", "folk", "singer-songwriter"],
	},
	{
		description: "90s slow afternoons",
		genres: ["rnb", "soul", "funk"],
	},
	{
		description: "first warm day of spring, windows down",
		genres: ["indie", "pop", "dream pop"],
	},
	{ description: "songs to feel brave", genres: ["rock", "punk", "indie"] },
	{
		description: "getting over someone one song at a time",
		genres: ["indie rock", "singer-songwriter", "indie folk"],
	},
	{
		description: "pregame energy before everyone shows up",
		genres: ["hip-hop", "dance", "pop"],
	},
	{
		description: "first cold morning that actually feels like fall",
		genres: ["folk", "acoustic", "ambient"],
	},
	{
		description: "summer night, everyone up on the roof",
		genres: ["disco", "funk", "soul"],
	},
];

interface DescriptionExamplesShuffleProps {
	/** Fill the writing surface above with the shown example's description and
	 *  genres, then open the editor so it's ready to tweak or save. */
	onPick: (description: string, genres: readonly string[]) => void;
	/** Override the shuffle pool — e.g. the onboarding preview passes a playlist's
	 *  own tuned examples so each demo playlist shows only its three. Omitted (the
	 *  production /playlists screen) falls back to the generic list. */
	examples?: readonly DescriptionExample[];
	/** "guided" lifts the card onto the hero band as the only way to set an intent:
	 *  drops the legend, fills the Pick button, and reads as a prompt rather than a
	 *  passive inspiration bar. Default sits on the panel's plain bg below. */
	variant?: "default" | "guided";
}

export function DescriptionExamplesShuffle({
	onPick,
	examples,
	variant = "default",
}: DescriptionExamplesShuffleProps) {
	const pool = examples && examples.length > 0 ? examples : EXAMPLES;
	const [index, setIndex] = useState(0);
	const current = pool[index % pool.length];

	const shuffle = () => setIndex((i) => (i + 1) % pool.length);

	return (
		<div
			// xpl-reveal is guided-only — prod intent examples mount without animation
			className={`desc-examples${variant === "guided" ? " xpl-reveal guided" : ""}`}
		>
			<span className="desc-examples-legend" style={{ fontFamily: fonts.body }}>
				Examples
			</span>
			{/* `key` remounts the body on shuffle so the swap animation replays — no
			    manual DOM poke to re-trigger the CSS. */}
			<div key={index} className="desc-examples-body">
				<p className="desc-examples-quote" style={{ fontFamily: fonts.body }}>
					“{current.description}”
				</p>
				<div className="desc-examples-genres">
					{current.genres.map((genre) => (
						<span
							key={genre}
							className="desc-examples-chip"
							style={{ fontFamily: fonts.body }}
						>
							{genre}
						</span>
					))}
				</div>
			</div>
			<div className="desc-examples-actions">
				<button
					type="button"
					onClick={() => onPick(current.description, current.genres)}
					aria-label="Pick this example"
					className="desc-examples-pick"
					style={{ fontFamily: fonts.body }}
				>
					Pick
				</button>
				<button
					type="button"
					onClick={shuffle}
					aria-label="Show another example"
					className="desc-examples-shuffle"
				>
					<ArrowsClockwiseIcon size={14} weight="regular" aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}
