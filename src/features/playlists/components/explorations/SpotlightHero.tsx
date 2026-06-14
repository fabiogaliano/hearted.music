import { fonts } from "@/lib/theme/fonts";
import { Cover } from "./Cover";
import { TargetToggle } from "./TargetToggle";
import type { PlaylistSummary } from "./types";

// Tier the serif title down as the name gets longer, so a 90-char mixtape name
// and a one-word playlist both sit comfortably in the hero.
function titleSize(name: string): string {
	const n = name.length;
	if (n > 90) return "1.7rem";
	if (n > 60) return "2rem";
	if (n > 36) return "2.5rem";
	if (n > 20) return "3.1rem";
	return "3.5rem";
}

interface SpotlightHeroProps {
	playlist: PlaylistSummary;
	onToggleTarget: () => void;
}

/**
 * The Spotlight header: a large cover beside the title under a faint theme-hue
 * wash — desaturated and clamped to the active theme, never raw cover color — so
 * the header has presence without the bloom that hurt legibility. The wash and
 * cover bleed to the panel edges via negative margins matching its padding.
 */
export function SpotlightHero({
	playlist,
	onToggleTarget,
}: SpotlightHeroProps) {
	return (
		<div
			className="theme-border-color -mx-5 -mt-[30px] mb-7 flex flex-col items-start gap-[18px] border-b px-5 pt-8 pb-7 md:-mx-10 md:-mt-[34px] md:flex-row md:items-end md:gap-7 md:px-10"
			style={{
				background:
					"linear-gradient(170deg, color-mix(in srgb, var(--t-primary) 9%, var(--t-bg)), var(--t-bg) 78%)",
			}}
		>
			<Cover
				src={playlist.imageUrl}
				size={196}
				className="flex-none"
				style={{
					boxShadow:
						"0 26px 50px -22px color-mix(in srgb, var(--t-text) 60%, transparent), inset 0 0 0 1px rgba(0,0,0,0.08)",
				}}
			/>
			<div className="min-w-0 pb-1">
				<p
					className="theme-text-muted text-[11px] tracking-[0.18em] uppercase"
					style={{ fontFamily: fonts.body }}
				>
					{playlist.isTarget ? "In matching" : "In library"}
				</p>
				<h2
					className="theme-text mt-3 leading-none font-extralight tracking-tight text-balance"
					style={{
						fontFamily: fonts.display,
						fontSize: titleSize(playlist.name),
					}}
				>
					{playlist.name}
				</h2>
				<div
					className="theme-text-muted mt-3 flex flex-wrap items-center gap-2 text-[13px]"
					style={{ fontFamily: fonts.body }}
				>
					<span>
						{playlist.songCount} {playlist.songCount === 1 ? "song" : "songs"}
					</span>
				</div>
				<div className="mt-[18px]">
					<TargetToggle
						isTarget={playlist.isTarget}
						onToggle={onToggleTarget}
					/>
				</div>
			</div>
		</div>
	);
}
