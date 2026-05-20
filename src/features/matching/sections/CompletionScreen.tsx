import { ArrowRightIcon } from "@phosphor-icons/react";
import { memo } from "react";
import { Button } from "@/components/ui/Button";
import { StaggeredContent } from "@/features/onboarding/components/StaggeredContent";
import { fonts } from "@/lib/theme/fonts";
import type { CompletionScreenProps } from "../types";

const IMAGE_OUTLINE = "1px solid rgba(255, 255, 255, 0.1)";

export const CompletionScreen = memo(function CompletionScreen({
	stats,
	songs,
	onExit,
}: CompletionScreenProps) {
	const additionsCopy =
		stats.totalAdditions === 1
			? "new addition to your playlists"
			: "new additions to your playlists";

	return (
		<StaggeredContent
			className="mx-auto max-w-4xl"
			staggerDelay={0.08}
			initialDelay={0.1}
		>
			<p
				className="theme-text-muted text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Session Complete
			</p>

			<div className="mt-20 mb-6">
				<p
					className="theme-text font-extralight tabular-nums leading-[0.9]"
					style={{
						fontFamily: fonts.display,
						fontSize: "clamp(120px, 18vw, 220px)",
					}}
				>
					{stats.totalAdditions}
				</p>
				<p
					className="theme-text-muted mt-6 text-xl italic"
					style={{ fontFamily: fonts.display }}
				>
					{additionsCopy}
				</p>
			</div>

			<div
				className="theme-text-muted mt-20 flex items-center gap-x-3 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				<span className="tabular-nums">
					{stats.totalSongs}{" "}
					<span className="tracking-widest uppercase">reviewed</span>
				</span>
				<span aria-hidden="true" className="opacity-40">
					·
				</span>
				<span className="tabular-nums">
					{stats.skippedCount}{" "}
					<span className="tracking-widest uppercase">skipped</span>
				</span>
			</div>

			{songs.length > 0 && (
				<div className="mt-16">
					<p
						className="theme-text-muted mb-5 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Matched this session
					</p>
					<div className="flex gap-2">
						{songs.slice(0, 5).map((song) => (
							<div
								key={song.id}
								className="relative size-20 transition-transform duration-200 ease-out motion-safe:hover:-translate-y-1"
							>
								<img
									src={song.albumArtUrl ?? undefined}
									alt={song.name}
									loading="lazy"
									className="h-full w-full object-cover"
									style={{ outline: IMAGE_OUTLINE }}
								/>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="mt-20">
				<Button
					variant="link"
					onClick={onExit}
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-base font-medium tracking-wide">
						Back to Home
					</span>
					<ArrowRightIcon
						size={16}
						weight="regular"
						className="theme-text-muted transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
					/>
				</Button>
			</div>
		</StaggeredContent>
	);
});
