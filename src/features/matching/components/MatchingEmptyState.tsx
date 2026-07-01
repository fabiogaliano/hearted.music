import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { fonts } from "@/lib/theme/fonts";
import type { Reason } from "../queue-helpers";
import type { MatchViewMode } from "../types";

// "no-matches" and "all-decided" are dead branches kept only as internal
// fallbacks so the staticCopy map and its tests remain consistent.
type ComponentReason = Reason | "no-matches" | "all-decided";

interface Props {
	reason: ComponentReason;
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
	// Shown while enrichment or match-refresh is running and no visible card
	// has appeared yet — prevents a false final-empty state during first setup.
	building: {
		overline: "finding matches",
		headline: ["Finding your", "first matches…"],
		body: "We're working through your library right now. Your first match cards will appear here shortly.",
		link: { to: "/", hash: undefined, search: undefined, label: "Back home" },
	},
	// Shown while jobs are still running but the queue had items — user is
	// caught up with what's been surfaced so far, more are on the way.
	"building-more": {
		overline: "more coming",
		headline: ["More matches are", "still being found."],
		body: "We're still working through your library. More match cards will appear here soon.",
		link: { to: "/", hash: undefined, search: undefined, label: "Back home" },
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
					headline: [
						`Some ${mode === "playlist" ? "playlists" : "songs"} are waiting`,
						"below your bar.",
					] as const,
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
