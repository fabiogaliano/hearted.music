import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import "./playlist-explorations.css";

export interface DescriptionExample {
	description: string;
	genres: readonly string[];
}

interface DescriptionExamplesShuffleProps {
	/** Fill the writing surface above with the shown example's description and
	 *  genres, then open the editor so it's ready to tweak or save. */
	onPick: (description: string, genres: readonly string[]) => void;
	/** The shuffle pool. The onboarding preview passes each demo playlist's own
	 *  tuned examples (DEMO_INTENT_EXAMPLES) so it shows only its three; this is
	 *  the sole consumer now that production no longer renders an examples rail. */
	examples: readonly DescriptionExample[];
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
	const [index, setIndex] = useState(0);
	const current = examples[index % examples.length];

	const shuffle = () => setIndex((i) => (i + 1) % examples.length);

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
					onClick={shuffle}
					aria-label="Show another example"
					className="desc-examples-shuffle"
				>
					<ArrowsClockwiseIcon size={14} weight="regular" aria-hidden="true" />
				</button>
				<button
					type="button"
					onClick={() => onPick(current.description, current.genres)}
					aria-label="Pick this example"
					// Guided mode only: Pick is the next action while the picker is open, so
					// breathe the same glow as the add toggle. Once picked the slot collapses
					// to inert/opacity-0 and Save takes over the pulse, so this goes quiet.
					className={`desc-examples-pick${variant === "guided" ? " xpl-pulse" : ""}`}
					style={{ fontFamily: fonts.body }}
				>
					Pick
				</button>
			</div>
		</div>
	);
}
