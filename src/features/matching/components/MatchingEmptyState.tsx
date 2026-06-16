import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { fonts } from "@/lib/theme/fonts";

// "no-matches" maps to the case where a queue exists but every item was filtered
// out by the user's strictness setting. "caught-up" is when all items are resolved.
type Reason =
	| "no-context"
	| "caught-up"
	| "no-matches"
	| "all-decided"
	| "filtered";

interface Props {
	reason: Reason;
	// Only meaningful for reason="no-matches"/"filtered": entitled, undecided songs
	// whose only matches sit below the user's strictness bar.
	hiddenCount?: number;
}

const staticCopy = {
	"no-context": {
		overline: "nothing yet",
		headline: ["Check back after", "your next sync."],
		body: "Your matches will appear here once matching has run on your library.",
		link: { to: "/", hash: undefined, search: undefined, label: "Back home" },
	},
	"caught-up": {
		overline: "all caught up",
		headline: ["You're caught up."],
		body: "New matches will appear here after your next sync.",
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

function filteredBody(hiddenCount: number): string {
	const subject =
		hiddenCount === 1
			? "1 song has matches"
			: `${hiddenCount} songs have matches`;
	return `${subject} just under your strictness setting. Loosen it up if you're curious.`;
}

export function MatchingEmptyState({ reason, hiddenCount = 0 }: Props) {
	const copy =
		reason === "filtered"
			? {
					overline: "quiet in here",
					headline: ["Some songs are waiting", "below your bar."] as const,
					body: filteredBody(hiddenCount),
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
		</div>
	);
}
