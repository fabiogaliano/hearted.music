import { Link } from "@tanstack/react-router";

import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

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
	const theme = useTheme();
	const { overline, headline, body } = copy[reason];

	return (
		<div
			className="flex min-h-[calc(100dvh-160px)] flex-col items-center justify-center px-8 text-center md:px-16"
			style={{ fontFamily: fonts.body }}
		>
			<p
				className="mb-6 text-xs uppercase tracking-widest"
				style={{ color: theme.textMuted }}
			>
				{overline}
			</p>

			<h1
				className="max-w-[520px] text-[44px] font-extralight leading-[1.1] tracking-tight md:text-[54px]"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				{headline[0]} <em>{headline[1]}</em>
			</h1>

			<p
				className="mt-8 max-w-[360px] text-base leading-relaxed"
				style={{ color: theme.textMuted }}
			>
				{body}
			</p>

			<div className="mt-12">
				<Link
					to="/"
					className="text-sm font-medium uppercase tracking-widest transition-opacity duration-200 hover:opacity-60"
					style={{ color: theme.primary }}
				>
					Back home
				</Link>
			</div>
		</div>
	);
}
