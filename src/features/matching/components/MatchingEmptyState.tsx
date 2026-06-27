import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { fonts } from "@/lib/theme/fonts";
import type { MatchViewMode } from "../types";

// "no-matches" maps to the case where a queue exists but every item was filtered
// out by the user's strictness setting. "caught-up" is when all items are resolved.
// Reason values per H8 (match-system-terminology-decisions.md).
type Reason =
	| "no-context"
	| "caught-up"
	| "none-yet"
	| "no-matches"
	| "all-decided"
	| "filtered";

interface Props {
	reason: Reason;
	// Only meaningful for reason="filtered": entitled, undecided review items
	// whose only matches sit below the user's strictness bar.
	hiddenCount?: number;
	/** Orientation of the active session — drives H9 noun in filtered copy. */
	mode?: MatchViewMode;
}

const staticCopy = {
	"no-context": {
		overline: "one more step",
		headline: ["Matches begin with", "your playlists."],
		body: "Tell us what each playlist is about and we'll pull songs from your library to match them.",
		link: {
			to: "/playlists",
			hash: undefined,
			search: undefined,
			label: "Set a matching intent",
		},
	},
	"caught-up": {
		overline: "all caught up",
		headline: ["You're caught up."],
		body: "New matches will appear here after your next sync.",
		link: { to: "/", hash: undefined, search: undefined, label: "Back home" },
	},
	// Matching ran but surfaced nothing — distinct from caught-up, which means
	// the user worked through a pile that actually existed.
	"none-yet": {
		overline: "nothing yet",
		headline: ["No matches", "just yet."],
		body: "We looked through your library and nothing lined up with your playlists this time. As it grows, fresh matches will land here.",
		link: { to: "/", hash: undefined, search: undefined, label: "Back home" },
	},
	// Legacy alias — same display as caught-up, kept so old route branches still compile.
	"all-decided": {
		overline: "all caught up",
		headline: ["You're caught up."],
		body: "New matches will appear here after your next sync.",
		link: { to: "/", hash: undefined, search: undefined, label: "Back home" },
	},
	"no-matches": {
		overline: "quiet in here",
		headline: ["No matches right now."],
		body: "Some songs may be waiting just below your strictness setting.",
		link: {
			to: "/settings",
			hash: "settings-section-matching",
			search: { from: "match" as const },
			label: "Adjust strictness",
		},
	},
} as const;

// H9: noun switches by orientation — songs in song mode, playlists in playlist mode.
function filteredBody(
	hiddenCount: number,
	mode: MatchViewMode = "song",
): string {
	const noun = mode === "playlist" ? "playlist" : "song";
	const subject =
		hiddenCount === 1
			? `1 ${noun} has matches`
			: `${hiddenCount} ${noun}s have matches`;
	return `${subject} just under your strictness setting. Loosen it up if you're curious.`;
}

export function MatchingEmptyState({
	reason,
	hiddenCount = 0,
	mode = "song",
}: Props) {
	const copy =
		reason === "filtered"
			? {
					overline: "quiet in here",
					headline: ["Some songs are waiting", "below your bar."] as const,
					body: filteredBody(hiddenCount, mode),
					link: {
						to: "/settings",
						hash: "settings-section-matching",
						search: { from: "match" as const },
						label: "Adjust strictness",
					},
				}
			: staticCopy[reason];

	const { overline, headline, body, link } = copy;

	return (
		<div
			className="flex min-h-[calc(100dvh-160px)] flex-col items-center justify-center px-8 text-center md:px-16"
			style={{ fontFamily: fonts.body }}
		>
			<StaggeredContent className="flex w-full flex-col items-center">
				<p className="theme-text-muted mb-6 text-xs tracking-widest uppercase">
					{overline}
				</p>

				<h1
					className="theme-text max-w-[520px] text-[44px] leading-[1.1] font-extralight tracking-tight text-balance md:text-[54px]"
					style={{ fontFamily: fonts.display }}
				>
					{headline[0]}
					{headline.length > 1 ? (
						<>
							{" "}
							<em>{headline[1]}</em>
						</>
					) : null}
				</h1>

				<p className="theme-text-muted mt-8 max-w-[360px] text-base leading-relaxed text-pretty">
					{body}
				</p>

				<div className="mt-12">
					<Link
						to={link.to}
						hash={link.hash}
						search={link.search}
						className="theme-text group inline-flex items-center gap-3 transition-transform duration-150 ease-out motion-safe:active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						<span className="text-base font-medium tracking-wide">
							{link.label}
						</span>
						<ArrowRightIcon
							size={16}
							weight="regular"
							className="theme-text-muted transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
						/>
					</Link>
				</div>
			</StaggeredContent>
		</div>
	);
}
