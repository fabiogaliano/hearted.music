import { fonts } from "@/lib/theme/fonts";
import { MastheadNavLine } from "./MastheadNavLine";
import { ProfileLink } from "./ProfileLink";
import type { Destination, MastheadVariant } from "./types";
import { Wordmark } from "./Wordmark";

interface MastheadProps {
	variant: MastheadVariant;
	active: Destination;
	matchCount: number;
	/** Sketch A's answer to losing the sidebar badge: a quiet ♡-count beside the
	 * wordmark. Ignored in the "line" variant, whose nav carries the count. */
	ambientBadge?: boolean;
	handle: string;
	planLabel: string;
	onNavigate: (destination: Destination) => void;
}

/** Spoke-page chrome only — the hub compositions carry their own brand
 * headers. Wordmark (home) left, profile strip (settings) right, and in
 * Sketch B a single line of section links between. */
export function Masthead({
	variant,
	active,
	matchCount,
	ambientBadge = false,
	handle,
	planLabel,
	onNavigate,
}: MastheadProps) {
	const showAmbientBadge =
		variant === "pure" && ambientBadge && matchCount > 0 && active !== "match";

	return (
		<header className="theme-border-color border-b">
			<div className="mx-auto flex max-w-5xl items-center justify-between gap-8 px-8 py-5">
				<div className="flex items-baseline gap-4">
					<Wordmark size="md" onHome={() => onNavigate("home")} />
					{showAmbientBadge && (
						<button
							type="button"
							onClick={() => onNavigate("match")}
							title={`${matchCount} songs waiting to match`}
							className="focus-edge-offset theme-text-muted text-xs tabular-nums transition-colors duration-150 ease-out hover:text-(--t-text) motion-reduce:transition-none"
							style={{ fontFamily: fonts.body }}
						>
							♡ {matchCount}
						</button>
					)}
				</div>
				<div className="flex items-center gap-8">
					{variant === "line" && (
						<MastheadNavLine
							active={active}
							matchCount={matchCount}
							onNavigate={onNavigate}
						/>
					)}
					<ProfileLink
						handle={handle}
						planLabel={planLabel}
						isActive={active === "settings"}
						onOpen={() => onNavigate("settings")}
					/>
				</div>
			</div>
		</header>
	);
}
