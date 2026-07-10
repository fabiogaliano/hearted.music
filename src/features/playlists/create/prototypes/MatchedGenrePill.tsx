/**
 * Prototype shared atom — Direction B (pill echo). Renders a song's own
 * genre pill, but highlighted with the primary accent when it's the genre
 * that matched the active config, so the reason "lives" in a chip the user
 * already recognizes from GenrePillsPicker instead of new copy.
 */

import { fonts } from "@/lib/theme/fonts";

interface MatchedGenrePillProps {
	genre: string;
	isMatched: boolean;
}

export function MatchedGenrePill({ genre, isMatched }: MatchedGenrePillProps) {
	return (
		<span
			className="hidden flex-none lg:inline-flex"
			style={{
				fontFamily: fonts.body,
				fontSize: "0.625rem",
				letterSpacing: "0.07em",
				padding: isMatched ? "2px 8px" : undefined,
				borderRadius: isMatched ? 12 : undefined,
				color: isMatched ? "var(--t-primary)" : "var(--t-text-muted)",
				backgroundColor: isMatched
					? "color-mix(in oklch, var(--t-primary) 12%, transparent)"
					: undefined,
				opacity: isMatched ? 1 : 0.5,
			}}
		>
			{genre}
		</span>
	);
}
