import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { fonts } from "@/lib/theme/fonts";

interface Props {
	reason: "no-context" | "all-decided";
}

const copy = {
	"no-context": {
		overline: "no suggestions yet",
		headline: ["Nothing to match", "just yet."],
		body: "Suggestions appear here once matching has run on your library.",
	},
	"all-decided": {
		overline: "all caught up",
		headline: ["Your songs have", "found their home."],
		body: "Check back after your next sync for new songs to match.",
	},
} as const;

export function MatchingEmptyState({ reason }: Props) {
	const { overline, headline, body } = copy[reason];

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
				{headline[0]} <em>{headline[1]}</em>
			</h1>

			<p className="theme-text-muted mt-8 max-w-[360px] text-base leading-relaxed text-pretty">
				{body}
			</p>

			<div className="mt-12">
				<Link
					to="/"
					className="theme-text group inline-flex items-center gap-3 transition-transform duration-150 ease-out motion-safe:active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-base font-medium tracking-wide">Back home</span>
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
